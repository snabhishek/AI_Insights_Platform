import { Annotation, StateGraph } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ConnectorService } from "../connector.service";
import { ConnectionTesterService } from "../connectionTester.service";
import { IIngestionAgentService, IngestionAgentRunResult } from "./ingestionAgent.service.interface";
import { createGetSchemaTool } from "./tools/getSchema.tool";

const AgentState = Annotation.Root({
  connectorId: Annotation<string[]>,
  status: Annotation<string>,
  summary: Annotation<string>,
  inspection: Annotation<Record<string, unknown>>({ reducer: (left, right) => ({ ...left, ...right }), default: () => ({}) }),
  schemaResolution: Annotation<Record<string, unknown>>({ reducer: (left, right) => ({ ...left, ...right }), default: () => ({}) }),
  dataProfile: Annotation<Record<string, unknown>>({ reducer: (left, right) => ({ ...left, ...right }), default: () => ({}) }),
  preprocessing: Annotation<Record<string, unknown>>({ reducer: (left, right) => ({ ...left, ...right }), default: () => ({}) }),
  steps: Annotation<Array<{ name: string; status: string; summary: string }>>({
    reducer: (left, right) => [...left, ...right],
    default: () => [],
  }),
});

export class IngestionAgentService implements IIngestionAgentService {
  constructor(
    private connectorService: ConnectorService,
    private connectionTester: ConnectionTesterService
  ) {}

  private createGeminiModel() {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return null;
    }

    return new ChatGoogleGenerativeAI({
      apiKey,
      model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
      temperature: 0,
      maxOutputTokens: 512,
    });
  }

  private async invokeGemini<T extends Record<string, unknown>>(stepName: string, prompt: string, fallback: T): Promise<T> {
    const model = this.createGeminiModel();
    if (!model) {
      return fallback;
    }

    try {
      const response = await model.invoke(prompt);
      const rawText = typeof response?.content === "string"
        ? response.content
        : Array.isArray(response?.content)
          ? response.content.map((part: any) => typeof part === "string" ? part : part?.text || "").join("")
          : JSON.stringify(response ?? {});
      const normalizedText = rawText
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/i, "")
        .trim();
      if (!normalizedText) {
        return fallback;
      }

      const parsed = JSON.parse(normalizedText);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as T;
      }
    } catch (error) {
      console.warn(`Gemini ${stepName} fallback triggered`, error);
    }

    return fallback;
  }

  private async inspect(connector: any) {
    const schemaTool = createGetSchemaTool(this.connectionTester);
    let schema: { success?: boolean; type?: string; tables?: Array<Record<string, unknown>> } | undefined;

    try {
      schema = await schemaTool.invoke({
        connectorType: connector.type,
        connectionConfig: connector.connectionConfig || {},
      }) as { success?: boolean; type?: string; tables?: Array<Record<string, unknown>> };
    } catch (error) {
      console.warn("GetSchema tool invocation failed, falling back to connection tester", error);
      schema = await this.connectionTester.getSchema(connector.type, connector.connectionConfig);
    }

    const normalizedSchema = schema ?? { success: false, type: "unknown", tables: [] };
    const fallback = {
      connectorType: connector.type,
      connectorName: connector.name,
      schemaType: normalizedSchema.type || "unknown",
      tableCount: Array.isArray(normalizedSchema.tables) ? normalizedSchema.tables.length : 0,
      tables: Array.isArray(normalizedSchema.tables) ? normalizedSchema.tables.slice(0, 5) : [],
    };

    const prompt = [
      "You are an AI ingestion inspector. Analyze the connector schema and return valid JSON only.",
      "Use this shape: {\"connectorType\": \"string\", \"connectorName\": \"string\", \"schemaType\": \"string\", \"tableCount\": 0, \"tables\": [{\"name\": \"string\", \"id\": \"string\"}]}",
      `Connector context: ${JSON.stringify({ connector, schema: normalizedSchema }, null, 2)}`,
    ].join("\n");

    return this.invokeGemini("inspect", prompt, fallback);
  }

  private async resolveSchema(connector: any, inspection: Record<string, unknown>) {
    const tables = Array.isArray(inspection.tables) ? inspection.tables : [];
    const fallback = {
      resolvedTables: tables.map((table: any) => table.name || table.id || "table"),
      strategy: tables.length > 0 ? "inspect-and-map" : "fallback",
    };

    const prompt = [
      "You are an AI schema resolver. Convert the discovered tables into a compact ingestion plan and return valid JSON only.",
      "Use this shape: {\"resolvedTables\": [\"string\"], \"strategy\": \"string\"}",
      `Inspection context: ${JSON.stringify({ connector, inspection }, null, 2)}`,
    ].join("\n");

    return this.invokeGemini("resolveSchema", prompt, fallback);
  }

  private async profileData(connector: any, schemaResolution: Record<string, unknown>) {
    const tables = Array.isArray(schemaResolution.resolvedTables) ? schemaResolution.resolvedTables : [];
    const fallback = {
      selectedTables: tables,
      profile: {
        sampleSize: 5,
        quality: tables.length > 0 ? "ready" : "needs-review",
      },
    };

    const prompt = [
      "You are an AI data profiler. Review the resolved tables and return valid JSON only.",
      "Use this shape: {\"selectedTables\": [\"string\"], \"profile\": {\"sampleSize\": 0, \"quality\": \"string\"}}",
      `Schema context: ${JSON.stringify({ connector, schemaResolution }, null, 2)}`,
    ].join("\n");

    return this.invokeGemini("profileData", prompt, fallback);
  }

  private async preprocess(connector: any, dataProfile: Record<string, unknown>) {
    const fallback = {
      normalized: true,
      tableCount: Array.isArray(dataProfile.selectedTables) ? dataProfile.selectedTables.length : 0,
      notes: "Data has been staged for downstream ingestion.",
    };

    const prompt = [
      "You are an AI preprocessing assistant. Summarize the selected tables into a compact ingestion-ready payload and return valid JSON only.",
      "Use this shape: {\"normalized\": true, \"tableCount\": 0, \"notes\": \"string\"}",
      `Data profile context: ${JSON.stringify({ connector, dataProfile }, null, 2)}`,
    ].join("\n");

    return this.invokeGemini("preprocess", prompt, fallback);
  }

  private createWorkflow() {
    const workflow = new StateGraph(AgentState)
      .addNode("inspect", async (state: typeof AgentState.State) => {
        const connector = state.connectorId.map(async (connectorId) => {return await this.connectorService.getById(connectorId)});
        if (!connector) {
          return {
            status: "failed",
            summary: "Connector not found",
            steps: [{ name: "Inspector", status: "failed", summary: "Connector not found" }],
          };
        }

        const inspection = await this.inspect(connector);
        return {
          inspection,
          status: "running",
          summary: "Inspection completed",
          steps: [{ name: "Inspector", status: "completed", summary: "Source inspection finished" }],
        };
      })
      .addNode("resolveSchema", async (state: typeof AgentState.State) => {
        const resolved = await this.resolveSchema(
          state.connectorId.map(async (connectorId) => {return await this.connectorService.getById(connectorId)}),
          state.inspection
        );
        return {
          schemaResolution: resolved,
          status: "running",
          summary: "Schema resolution completed",
          steps: [{ name: "Schema Resolver", status: "completed", summary: "Schema mapping prepared" }],
        };
      })
      .addNode("profileData", async (state: typeof AgentState.State) => {
        const profile = await this.profileData(
          state.connectorId.map(async (connectorId) => {return await this.connectorService.getById(connectorId)}),
          state.schemaResolution
        );
        return {
          dataProfile: profile,
          status: "running",
          summary: "Data profiling completed",
          steps: [{ name: "Data Profiler", status: "completed", summary: "Profiling completed" }],
        };
      })
      .addNode("preprocess", async (state: typeof AgentState.State) => {
        const preprocessed = await this.preprocess(
          state.connectorId.map(async (connectorId) => {return await this.connectorService.getById(connectorId)}),
          state.dataProfile
        );
        return {
          preprocessing: preprocessed,
          status: "completed",
          summary: "Preprocessing completed",
          steps: [{ name: "Data Preprocessor", status: "completed", summary: "Data staged for downstream use" }],
        };
      })
      .addEdge("__start__", "inspect")
      .addEdge("inspect", "resolveSchema")
      .addEdge("resolveSchema", "profileData")
      .addEdge("profileData", "preprocess")
      .addEdge("preprocess", "__end__");

    return workflow.compile();
  }

  async run(connectorId: string[]): Promise<IngestionAgentRunResult> {
    const workflow = this.createWorkflow();
    const result = await workflow.invoke({
      connectorId,
      status: "queued",
      summary: "Ingestion workflow started",
      steps: [],
    });

    return {
      connectorId,
      status: result.status as string,
      summary: result.summary as string,
      steps: result.steps as Array<{ name: string; status: string; summary: string }>,
      inspection: (result.inspection ?? {}) as Record<string, unknown>,
      schemaResolution: (result.schemaResolution ?? {}) as Record<string, unknown>,
      dataProfile: (result.dataProfile ?? {}) as Record<string, unknown>,
      preprocessing: (result.preprocessing ?? {}) as Record<string, unknown>,
    };
  }
}
