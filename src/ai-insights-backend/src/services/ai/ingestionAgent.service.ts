import { promises as fs } from "fs";
import path from "path";
import { Annotation, StateGraph } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ConnectorService } from "../connector.service";
import { ConnectionTesterService } from "../connectionTester.service";
import { IIngestionAgentService, IngestionAgentRunResult } from "./ingestionAgent.service.interface";
import { createGetSchemaTool } from "./tools/getSchema.tool";
import { createInspectTool } from "./tools/inspect.tool";
import { createDataProfileTool } from "./tools/dataProfile.tool";
import { createPreprocessTool } from "./tools/preprocess.tool";
import { IFileService } from "../file.service.interface";

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
  private activeTraceSession?: { filePath: string; startedAt: string };

  constructor(
    private connectorService: ConnectorService,
    private connectionTester: ConnectionTesterService,
    private fileService: IFileService
  ) {}

  private getTraceConfig() {
    const enabled = process.env.AI_LLM_TRACE_ENABLED === "true"
      || (process.env.AI_LLM_TRACE_ENABLED !== "false" && process.env.NODE_ENV !== "production");
    const maxChars = Number.parseInt(process.env.AI_LLM_TRACE_MAX_CHARS || "4000", 10);

    return {
      enabled,
      maxChars: Number.isFinite(maxChars) && maxChars > 0 ? maxChars : 4000,
    };
  }

  private serializeForLog(value: unknown, maxChars: number): string {
    const sanitize = (input: unknown, depth = 0): unknown => {
      if (depth > 4) {
        return "[truncated]";
      }

      if (input === null || input === undefined) {
        return input;
      }

      if (typeof input === "string") {
        let text = input;
        text = text.replace(/("?(password|apiKey|api_key|token|secret|authorization)"?\s*:\s*")([^"]*)"/gi, '$1***REDACTED***"');
        text = text.replace(/("?(password|apiKey|api_key|token|secret|authorization)"?\s*:\s*)([^,\n}\]]+)/gi, '$1***REDACTED***');
        return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
      }

      if (typeof input === "number" || typeof input === "boolean") {
        return input;
      }

      if (Array.isArray(input)) {
        return input.slice(0, 20).map((item) => sanitize(item, depth + 1));
      }

      if (typeof input === "object") {
        const objectValue = input as Record<string, unknown>;
        const result: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(objectValue)) {
          const lowerKey = key.toLowerCase();
          if (lowerKey.includes("password") || lowerKey.includes("secret") || lowerKey.includes("token") || (lowerKey.includes("api") && lowerKey.includes("key"))) {
            result[key] = "***REDACTED***";
            continue;
          }

          if (key === "connectionConfig" && child && typeof child === "object") {
            result[key] = this.sanitizeConnectionConfig(child);
            continue;
          }

          result[key] = sanitize(child, depth + 1);
        }
        return result;
      }

      return String(input);
    };

    try {
      const normalized = sanitize(value);
      const text = JSON.stringify(normalized, null, 2);
      return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
    } catch {
      return String(value);
    }
  }

  private sanitizeConnectionConfig(value: unknown): unknown {
    if (!value || typeof value !== "object") {
      return value;
    }

    const objectValue = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(objectValue)) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes("password") || lowerKey.includes("secret") || lowerKey.includes("token") || (lowerKey.includes("api") && lowerKey.includes("key"))) {
        sanitized[key] = "***REDACTED***";
      } else if (child && typeof child === "object") {
        sanitized[key] = this.sanitizeConnectionConfig(child);
      } else {
        sanitized[key] = child;
      }
    }
    return sanitized;
  }

  private getTraceFileName(): string {
    const now = new Date();
    const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").replace("T", "-");
    return `${stamp}.log`;
  }

  private getTraceDirectory(): string {
    return path.resolve(process.cwd(), "logs", "ai-traces");
  }

  private async createTraceSession() {
    const traceConfig = this.getTraceConfig();
    if (!traceConfig.enabled) {
      return undefined;
    }

    const directory = this.getTraceDirectory();
    await fs.mkdir(directory, { recursive: true });
    const filePath = path.join(directory, this.getTraceFileName());
    this.activeTraceSession = { filePath, startedAt: new Date().toISOString() };
    return this.activeTraceSession;
  }

  private async appendTraceEntry(stepName: string, direction: "input" | "output" | "error", payload: unknown) {
    const traceConfig = this.getTraceConfig();
    if (!traceConfig.enabled || !this.activeTraceSession) {
      return;
    }

    const entry = {
      timestamp: new Date().toISOString(),
      stepName,
      direction,
      payload: this.serializeForLog(payload, traceConfig.maxChars),
    };

    await fs.appendFile(this.activeTraceSession.filePath, `${JSON.stringify(entry)}\n`, "utf8");
  }

  private logLlmTrace(stepName: string, direction: "input" | "output" | "error", payload: unknown, maxChars: number) {
    const traceConfig = this.getTraceConfig();
    if (!traceConfig.enabled) {
      return;
    }

    const prefix = `[AI Trace] [${stepName}] ${direction}`;
    const message = this.serializeForLog(payload, maxChars);
    if (direction === "error") {
      console.error(`${prefix}: ${message}`);
      return;
    }

    console.info(`${prefix}: ${message}`);
  }

  private async invokeWithTrace<T>(stepName: string, input: unknown, invoke: () => Promise<T>): Promise<T> {
    const traceConfig = this.getTraceConfig();
    if (traceConfig.enabled) {
      this.logLlmTrace(stepName, "input", input, traceConfig.maxChars);
      await this.appendTraceEntry(stepName, "input", input);
    }

    try {
      const output = await invoke();
      if (traceConfig.enabled) {
        this.logLlmTrace(stepName, "output", output, traceConfig.maxChars);
        await this.appendTraceEntry(stepName, "output", output);
      }
      return output;
    } catch (error) {
      if (traceConfig.enabled) {
        this.logLlmTrace(stepName, "error", error, traceConfig.maxChars);
        await this.appendTraceEntry(stepName, "error", error);
      }
      throw error;
    }
  }

  private createGeminiModel() {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return null;
    }

    return new ChatGoogleGenerativeAI({
      apiKey,
      model: process.env.GEMINI_MODEL || "gemini-2.5-pro",
      temperature: 0,
      maxOutputTokens: 32000,
    });
  }

  private createOpenAIModel() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return null;
    }

    return new ChatOpenAI({
      apiKey,
      model: process.env.OPENAI_MODEL || "gpt-5.4-mini-2026-03-17",
      temperature: 0,
      maxTokens: 32000,
    });
  }

  private async invokeGemini<T extends Record<string, unknown>>(stepName: string, prompt: string, fallback: T): Promise<T> {
    const model = this.createGeminiModel();
    if (!model) {
      return fallback;
    }

    try {
      const response = await this.invokeWithTrace(`gemini:${stepName}`, prompt, async () => model.invoke(prompt));
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

  private async invokeOpenAI<T extends Record<string, unknown>>(stepName: string, prompt: string, fallback: T): Promise<T> {
    const model = this.createOpenAIModel() || this.createGeminiModel();
    if (!model) {
      return fallback;
    }

    try {
      const response = await this.invokeWithTrace(`openai:${stepName}`, prompt, async () => model.invoke(prompt));
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
      console.warn(`OpenAI ${stepName} fallback triggered`, error);
    }

    return fallback;
  }

  private async runInspectorWithTools(connector: any) {
    const inspectTool = createInspectTool(this.fileService);
    const schemaTool = createGetSchemaTool(this.connectionTester);
    const model = this.createOpenAIModel()
    const connectionConfig = connector.connectionConfig || {};
    const safeConnector = {
      ...connector,
      connectionConfig: {
        ...connectionConfig,
        password: connectionConfig.password ? "***" : undefined,
      },
    };

    if (!model) {
      const inspectionPayload = await inspectTool.invoke({
        connectorType: connector.type,
        connectionConfig,
        maxTables: 50,
        maxColumns: 200,
      }) as Record<string, unknown>;
      return {
        connectorId: connector.id,
        connectorName: connector.name,
        ...inspectionPayload,
      };
    }

    const toolBoundModel = model.bindTools([inspectTool]);
    const messages: BaseMessage[] = [
      new SystemMessage([
        "You are an AI ingestion inspector.",
        "Use the inspectDataSource tool to list tables first, then request detailed columns/constraints/relations for relevant tables.",
        "For large databases, avoid requesting every table at once; sample or prioritize key tables.",
        "Return final output as valid JSON only using this shape:",
        "{\"connectorId\":\"string\",\"connectorName\":\"string\",\"schemaType\":\"string\",\"tableCount\":0,\"tables\":[{\"name\":\"string\",\"type\":\"string\",\"columns\":[{\"name\":\"string\",\"dataType\":\"string\",\"nullable\":true}],\"constraints\":[],\"relations\":[]}]}",
      ].join("\n")),
      new HumanMessage(`Connector context: ${JSON.stringify(safeConnector, null, 2)}`),
    ];

    let response = await this.invokeWithTrace(`inspect:${connector.type}`, messages, async () => toolBoundModel.invoke(messages));
    let lastToolResult: Record<string, unknown> | undefined;

    for (let i = 0; i < 3; i += 1) {
      const toolCalls = (response as any)?.tool_calls || [];
      if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
        break;
      }

      messages.push(response as BaseMessage);
      for (const [index, call] of toolCalls.entries()) {
        const args = call?.args || {};
        if (!args.connectorType) {
          args.connectorType = connector.type;
        }
        if (!args.connectionConfig) {
          args.connectionConfig = connectionConfig;
        }
        if (!args.maxTables) {
          args.maxTables = 50;
        }
        if (!args.maxColumns) {
          args.maxColumns = 200;
        }
        const toolResult = await inspectTool.invoke(args);
        lastToolResult = toolResult as Record<string, unknown>;
        messages.push(new ToolMessage({
          content: JSON.stringify(toolResult),
          tool_call_id: call?.id || call?.tool_call_id || `inspect-${i}-${index}`,
        }));
      }

      response = await this.invokeWithTrace(`inspect:${connector.type}`, messages, async () => toolBoundModel.invoke(messages));
    }

    const rawText = typeof response?.content === "string"
      ? response.content
      : Array.isArray(response?.content)
        ? response.content.map((part: any) => typeof part === "string" ? part : part?.text || "").join("")
        : JSON.stringify(response ?? {});
    const normalizedText = rawText.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();

    try {
      const parsed = JSON.parse(normalizedText);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (error) {
      console.warn("Inspector tool-calling output parse failed, falling back", error);
    }

    if (lastToolResult) {
      return {
        connectorId: connector.id,
        connectorName: connector.name,
        ...lastToolResult,
      };
    }

    const schema = await schemaTool.invoke({
      connectorType: connector.type,
      connectionConfig,
    }) as { success?: boolean; type?: string; tables?: Array<Record<string, unknown>> };

    return {
      connectorId: connector.id,
      connectorName: connector.name,
      schemaType: schema?.type || "unknown",
      tableCount: Array.isArray(schema?.tables) ? schema.tables.length : 0,
      tables: Array.isArray(schema?.tables) ? schema.tables : [],
      notes: "Fallback schema used; limited column details.",
    };
  }

  private async inspect(connector: any) {
    return this.runInspectorWithTools(connector);
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

    return this.invokeOpenAI("resolveSchema", prompt, fallback);
  }

  private async profileData(connector: any, schemaResolution: Record<string, unknown>) {
    const tables = Array.isArray(schemaResolution.resolvedTables) ? schemaResolution.resolvedTables : [];
    const profileTool = createDataProfileTool(this.connectionTester);
    let profilePayload: Record<string, unknown> | undefined;

    try {
      profilePayload = await profileTool.invoke({
        connectorType: connector.type,
        connectionConfig: connector.connectionConfig || {},
        tables,
      }) as Record<string, unknown>;
    } catch (error) {
      console.warn("DataProfile tool invocation failed, using fallback", error);
    }

    const fallback = {
      selectedTables: tables,
      profile: {
        sampleSize: 5,
        quality: tables.length > 0 ? "ready" : "needs-review",
      },
    };

    const prompt = [
      "You are an AI data profiler. Use the profiling tool output to summarize data health and sample quality.",
      "Return valid JSON only using this shape: {\"selectedTables\": [\"string\"], \"profile\": {\"sampleSize\": 0, \"quality\": \"string\", \"tables\": []}}",
      `Profiling tool output: ${JSON.stringify(profilePayload ?? fallback, null, 2)}`,
      `Schema context: ${JSON.stringify({ connector, schemaResolution }, null, 2)}`,
    ].join("\n");

    return this.invokeOpenAI("profileData", prompt, fallback);
  }

  private async preprocess(connector: any, dataProfile: Record<string, unknown>) {
    const preprocessTool = createPreprocessTool();
    let preprocessPayload: Record<string, unknown> | undefined;

    try {
      preprocessPayload = await preprocessTool.invoke({
        connectorType: connector.type,
        dataProfile,
      }) as Record<string, unknown>;
    } catch (error) {
      console.warn("Preprocess tool invocation failed, using fallback", error);
    }

    const fallback = {
      normalized: true,
      tableCount: Array.isArray((dataProfile as any).selectedTables) ? (dataProfile as any).selectedTables.length : 0,
      notes: "Data has been staged for downstream ingestion.",
      steps: ["normalize_nulls", "trim_strings", "standardize_dates"],
    };

    const prompt = [
      "You are an AI preprocessing assistant. Use the preprocessing tool output and data profile to decide preprocessing steps.",
      "Return valid JSON only using this shape: {\"normalized\": true, \"tableCount\": 0, \"notes\": \"string\", \"steps\": [\"string\"]}",
      `Preprocess tool output: ${JSON.stringify(preprocessPayload ?? fallback, null, 2)}`,
      `Data profile context: ${JSON.stringify({ connector, dataProfile }, null, 2)}`,
    ].join("\n");

    return this.invokeOpenAI("preprocess", prompt, fallback);
  }

  private createWorkflow() {
    const workflow = new StateGraph(AgentState)
      .addNode("inspect", async (state: typeof AgentState.State) => {
        const connectors = await Promise.all(state.connectorId.map(async (connectorId) => await this.connectorService.getById(connectorId)));
        const validConnectors = connectors.filter((connector) => !!connector);
        if (validConnectors.length === 0) {
          return {
            status: "failed",
            summary: "Connector not found",
            steps: [{ name: "Inspector", status: "failed", summary: "Connector not found" }],
          };
        }
        const inspections = await Promise.all(validConnectors.map((connector) => this.inspect(connector)));
        return {
          inspection: { sources: inspections },
          status: "running",
          summary: "Inspection completed",
          steps: [{ name: "Inspector", status: "completed", summary: "Source inspection finished" }],
        };
      })
      .addNode("resolveSchema", async (state: typeof AgentState.State) => {
        const connectors = await Promise.all(state.connectorId.map(async (connectorId) => await this.connectorService.getById(connectorId)));
        const validConnectors = connectors.filter((connector) => !!connector);
        const inspectionSources = Array.isArray((state.inspection as any)?.sources)
          ? (state.inspection as any).sources
          : [state.inspection];
        const resolvedSources = await Promise.all(validConnectors.map(async (connector) => {
          const inspection = inspectionSources.find((source: any) => source?.connectorId === connector.id) || state.inspection;
          const resolved = await this.resolveSchema(connector, inspection);
          return {
            connectorId: connector.id,
            connectorName: connector.name,
            ...resolved,
          };
        }));
        return {
          schemaResolution: { sources: resolvedSources },
          status: "running",
          summary: "Schema resolution completed",
          steps: [{ name: "Schema Resolver", status: "completed", summary: "Schema mapping prepared" }],
        };
      })
      .addNode("profileData", async (state: typeof AgentState.State) => {
        const connectors = await Promise.all(state.connectorId.map(async (connectorId) => await this.connectorService.getById(connectorId)));
        const validConnectors = connectors.filter((connector) => !!connector);
        const schemaSources = Array.isArray((state.schemaResolution as any)?.sources)
          ? (state.schemaResolution as any).sources
          : [state.schemaResolution];
        const profileSources = await Promise.all(validConnectors.map(async (connector) => {
          const schemaResolution = schemaSources.find((source: any) => source?.connectorId === connector.id) || state.schemaResolution;
          const profile = await this.profileData(connector, schemaResolution);
          return {
            connectorId: connector.id,
            connectorName: connector.name,
            ...profile,
          };
        }));
        return {
          dataProfile: { sources: profileSources },
          status: "running",
          summary: "Data profiling completed",
          steps: [{ name: "Data Profiler", status: "completed", summary: "Profiling completed" }],
        };
      })
      .addNode("preprocess", async (state: typeof AgentState.State) => {
        const connectors = await Promise.all(state.connectorId.map(async (connectorId) => await this.connectorService.getById(connectorId)));
        const validConnectors = connectors.filter((connector) => !!connector);
        const profileSources = Array.isArray((state.dataProfile as any)?.sources)
          ? (state.dataProfile as any).sources
          : [state.dataProfile];
        const preprocessSources = await Promise.all(validConnectors.map(async (connector) => {
          const dataProfile = profileSources.find((source: any) => source?.connectorId === connector.id) || state.dataProfile;
          const preprocessed = await this.preprocess(connector, dataProfile);
          return {
            connectorId: connector.id,
            connectorName: connector.name,
            ...preprocessed,
          };
        }));
        return {
          preprocessing: { sources: preprocessSources },
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
    const traceSession = await this.createTraceSession();
    const runStartedAt = new Date().toISOString();

    if (traceSession) {
      await this.appendTraceEntry("workflow:start", "input", {
        connectorId,
        startedAt: runStartedAt,
        status: "queued",
        summary: "Ingestion workflow started",
      });
    }

    try {
      const result = await workflow.invoke({
        connectorId,
        status: "queued",
        summary: "Ingestion workflow started",
        steps: [],
      });

      if (traceSession) {
        await this.appendTraceEntry("workflow:end", "output", {
          connectorId,
          startedAt: runStartedAt,
          completedAt: new Date().toISOString(),
          status: result.status,
          summary: result.summary,
        });
      }

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
    } finally {
      this.activeTraceSession = undefined;
    }
  }
}
