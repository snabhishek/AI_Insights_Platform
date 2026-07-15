import { promises as fs } from "fs";
import path from "path";
import { Annotation, StateGraph } from "@langchain/langgraph";
import { tool } from "@langchain/core/tools";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AzureChatOpenAI, ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { createAgent } from "langchain";
import { z } from "zod";
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
  userPrompt: Annotation<string>({
    reducer: (left, right) => (typeof right === "string" ? right : left),
    default: () => "",
  }),
  inspection: Annotation<Record<string, unknown>>({ reducer: (left, right) => ({ ...left, ...right }), default: () => ({}) }),
  schemaResolution: Annotation<Record<string, unknown>>({ reducer: (left, right) => ({ ...left, ...right }), default: () => ({}) }),
  dataProfile: Annotation<Record<string, unknown>>({ reducer: (left, right) => ({ ...left, ...right }), default: () => ({}) }),
  preprocessing: Annotation<Record<string, unknown>>({ reducer: (left, right) => ({ ...left, ...right }), default: () => ({}) }),
  steps: Annotation<Array<{ name: string; status: string; summary: string }>>({
    reducer: (left, right) => [...left, ...right],
    default: () => [],
  }),
});

type SupportedChatModel = ChatOpenAI | AzureChatOpenAI | ChatGoogleGenerativeAI;
type InspectionPayload = Record<string, unknown> & {
  tables?: Array<Record<string, unknown>>;
};

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

  private createAzureOpenAIModel() {
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT || process.env.AZURE_OPENAI_BASE_PATH || process.env.AZURE_OPENAI_INSTANCE_ENDPOINT;
    const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || process.env.AZURE_OPENAI_DEPLOYMENT;
    const instanceName = process.env.AZURE_OPENAI_INSTANCE_NAME;
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2024-02-01";

    if (!apiKey || !deploymentName || (!endpoint && !instanceName)) {
      return null;
    }

    return new AzureChatOpenAI({
      azureOpenAIApiKey: apiKey,
      azureOpenAIApiVersion: apiVersion,
      azureOpenAIApiDeploymentName: deploymentName,
      azureOpenAIEndpoint: endpoint,
      model: process.env.AZURE_OPENAI_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0,
      maxTokens: 32000,
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

  private extractModelText(response: unknown): string {
    const content = response && typeof response === "object" && "content" in response
      ? (response as { content?: unknown }).content
      : response;

    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      return content.map((part: any) => typeof part === "string" ? part : part?.text || "").join("");
    }

    return JSON.stringify(content ?? response ?? {});
  }

  private parseJsonObject<T extends Record<string, unknown>>(rawText: string, fallback: T): T {
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

    return fallback;
  }

  private getLatestAgentMessage(agentResult: unknown): unknown {
    const messages = Array.isArray((agentResult as any)?.messages) ? (agentResult as any).messages : [];
    return messages.length > 0 ? messages[messages.length - 1] : agentResult;
  }

  private getLastToolResult(agentResult: unknown): Record<string, unknown> | undefined {
    const messages = Array.isArray((agentResult as any)?.messages) ? (agentResult as any).messages : [];

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index] as any;
      const messageType = typeof message?.getType === "function" ? message.getType() : message?.type;
      if (messageType !== "tool") {
        continue;
      }

      const toolText = this.extractModelText(message);
      try {
        const parsed = JSON.parse(toolText);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        continue;
      }
    }

    return undefined;
  }

  private async invokeAgentJson<T extends Record<string, unknown>>(
    stepName: string,
    model: SupportedChatModel | null,
    userMessage: string,
    fallback: T,
    options?: {
      systemPrompt?: string;
      tools?: unknown[];
      traceLabel?: string;
    }
  ): Promise<T> {
    if (!model) {
      return fallback;
    }

    const agent = createAgent({
      model,
      tools: (options?.tools ?? []) as any,
      systemPrompt: options?.systemPrompt,
    });

    const input = {
      messages: [new HumanMessage(userMessage)],
    };

    try {
      const result = await this.invokeWithTrace(
        options?.traceLabel ?? `agent:${stepName}`,
        {
          systemPrompt: options?.systemPrompt,
          userMessage,
        },
        async () => agent.invoke(input)
      );
      const rawText = this.extractModelText(this.getLatestAgentMessage(result));
      return this.parseJsonObject(rawText, fallback);
    } catch (error) {
      console.warn(`Agent ${stepName} fallback triggered`, error);
      return fallback;
    }
  }

  private async getInspectionSystemPrompt(): Promise<string> {
    try {
      const promptPath = path.resolve(__dirname, "prompts", "injectioninspection.md");
      return await fs.readFile(promptPath, "utf8");
    } catch (error) {
      console.warn("Unable to load inspection prompt from file, using fallback", error);
      return [
        "You are an AI ingestion inspector.",
        "Process the provided tables in batches, use inspectDataSource for the current batch only, and carry previousAnalysis forward.",
        "Return final output as valid JSON only.",
      ].join("\n");
    }
  }

  private chunkInspectionTableNames(tableNames: string[]): string[][] {
    const normalizedTableNames = tableNames.filter((tableName) => typeof tableName === "string" && tableName.trim().length > 0);
    if (normalizedTableNames.length === 0) {
      return [];
    }

    const batches: string[][] = [];
    const initialBatchSize = 10;
    const followUpBatchSize = 5;

    batches.push(normalizedTableNames.slice(0, initialBatchSize));
    for (let index = initialBatchSize; index < normalizedTableNames.length; index += followUpBatchSize) {
      batches.push(normalizedTableNames.slice(index, index + followUpBatchSize));
    }

    return batches;
  }

  private normalizeInspectionTable(table: Record<string, unknown>): Record<string, unknown> {
    const tableName = typeof table.tableName === "string" && table.tableName.trim().length > 0
      ? table.tableName
      : typeof table.name === "string" && table.name.trim().length > 0
        ? table.name
        : undefined;

    if (!tableName) {
      return table;
    }

    return {
      ...table,
      tableName,
      name: typeof table.name === "string" && table.name.trim().length > 0 ? table.name : tableName,
    };
  }

  private normalizeInspectionPayload(payload: InspectionPayload): InspectionPayload {
    const tables = Array.isArray(payload.tables)
      ? payload.tables
        .filter((table): table is Record<string, unknown> => !!table && typeof table === "object" && !Array.isArray(table))
        .map((table) => this.normalizeInspectionTable(table))
      : [];

    return {
      ...payload,
      tables,
    };
  }

  private mergeInspectionPayload(
    accumulated: InspectionPayload,
    incoming: InspectionPayload,
    connector: any,
    schemaType: string,
    tableCount: number
  ): InspectionPayload {
    const normalizedAccumulated = this.normalizeInspectionPayload(accumulated);
    const normalizedIncoming = this.normalizeInspectionPayload(incoming);
    const mergedTableMap = new Map<string, Record<string, unknown>>();

    for (const table of normalizedAccumulated.tables || []) {
      const tableName = typeof table.tableName === "string" ? table.tableName : typeof table.name === "string" ? table.name : undefined;
      if (tableName) {
        mergedTableMap.set(tableName, table);
      }
    }

    for (const table of normalizedIncoming.tables || []) {
      const tableName = typeof table.tableName === "string" ? table.tableName : typeof table.name === "string" ? table.name : undefined;
      if (!tableName) {
        continue;
      }

      const previousTable = mergedTableMap.get(tableName) || {};
      mergedTableMap.set(tableName, this.normalizeInspectionTable({
        ...previousTable,
        ...table,
      }));
    }

    return {
      ...normalizedAccumulated,
      ...normalizedIncoming,
      connectorId: connector.id,
      connectorName: connector.name,
      schemaType: normalizedIncoming.schemaType || normalizedAccumulated.schemaType || schemaType,
      tableCount,
      tables: Array.from(mergedTableMap.values()),
    };
  }

  private buildInspectionBatchUserMessage(params: {
    safeConnector: Record<string, unknown>;
    schemaSummary: Record<string, unknown>;
    batchTableNames: string[];
    batchIndex: number;
    totalBatches: number;
    previousAnalysis: InspectionPayload;
  }): string {
    const {
      safeConnector,
      schemaSummary,
      batchTableNames,
      batchIndex,
      totalBatches,
      previousAnalysis,
    } = params;

    return [
      `Connector context: ${JSON.stringify(safeConnector, null, 2)}`,
      `Schema summary: ${JSON.stringify(schemaSummary, null, 2)}`,
      `Batch progress: ${JSON.stringify({ currentBatch: batchIndex + 1, totalBatches }, null, 2)}`,
      `selectedTables: ${JSON.stringify(batchTableNames, null, 2)}`,
      `previousAnalysis: ${JSON.stringify(previousAnalysis, null, 2)}`,
      "Process only the selectedTables in this batch. Use previousAnalysis as context, do not reprocess unrelated tables, and return valid JSON only.",
    ].join("\n\n");
  }

  private async invokeGemini<T extends Record<string, unknown>>(stepName: string, prompt: string, fallback: T): Promise<T> {
    return this.invokeAgentJson(stepName, this.createGeminiModel(), prompt, fallback, {
      traceLabel: `gemini:${stepName}`,
    });
  }

  private async invokeOpenAI<T extends Record<string, unknown>>(stepName: string, prompt: string, fallback: T): Promise<T> {
    const model = this.createOpenAIModel() || this.createGeminiModel();
    return this.invokeAgentJson(stepName, model, prompt, fallback, {
      traceLabel: `openai:${stepName}`,
    });
  }

  private async runInspectorWithTools(connector: any) {
    const inspectTool = createInspectTool(this.fileService, this.connectorService);
    const schemaTool = createGetSchemaTool(this.connectionTester, this.connectorService);
    const model = this.createAzureOpenAIModel()
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
        connectorId: connector.id,
        connectorType: connector.type,
        maxTables: 50,
        maxColumns: 200,
      }) as Record<string, unknown>;
      return {
        connectorId: connector.id,
        connectorName: connector.name,
        ...inspectionPayload,
      };
    }

    const inspectionPrompt = await this.getInspectionSystemPrompt();
    const inspectAgentTool = tool(
      async ({
        connectorId,
        connectorType,
        tableNames,
        maxTables,
        maxColumns,
      }: {
        connectorId?: string;
        connectorType?: string;
        tableNames?: string[];
        maxTables?: number;
        maxColumns?: number;
      }) => inspectTool.invoke({
        connectorId: connectorId || connector.id,
        connectorType: connectorType || connector.type,
        tableNames,
        maxTables: typeof maxTables === "number" && maxTables > 0 ? maxTables : 50,
        maxColumns: typeof maxColumns === "number" && maxColumns > 0 ? maxColumns : 200,
      }),
      {
        name: "inspectDataSource",
        description: "Inspect a connector source and return table fields, data types, constraints, and relationships.",
        schema: z.object({
          connectorId: z.string().optional().describe("Connector ID used to resolve the stored connection settings"),
          connectorType: z.string().optional().describe("Connector type fallback when connectorId is unavailable"),
          tableNames: z.array(z.string()).optional().describe("Specific tables to inspect for column/constraint details"),
          maxTables: z.number().optional().describe("Maximum tables to list when tableNames is not provided"),
          maxColumns: z.number().optional().describe("Maximum columns per table in detailed inspection"),
        }),
      }
    );

    let schemaDetails: { success?: boolean; type?: string; tables?: Array<Record<string, unknown>> } | undefined;
    try {
      schemaDetails = await schemaTool.invoke({
        connectorId: connector.id,
        connectorType: connector.type,
      }) as { success?: boolean; type?: string; tables?: Array<Record<string, unknown>> };
    } catch (error) {
      console.warn("Schema tool inspection failed, continuing without table context", error);
    }

    const tableList = Array.isArray(schemaDetails?.tables)
      ? schemaDetails.tables.map((table: Record<string, unknown>) => ({
          name: table.name || table.tableName || table.id || "unknown",
          type: table.type || table.tableType || "unknown",
        }))
      : [];
    const schemaType = schemaDetails?.type || "unknown";
    const tableNames = tableList
      .map((table) => typeof table.name === "string" ? table.name : "")
      .filter((tableName) => tableName.trim().length > 0);

    if (tableNames.length === 0) {
      const inspectionPayload = await inspectTool.invoke({
        connectorId: connector.id,
        connectorType: connector.type,
        maxTables: 50,
        maxColumns: 200,
      }) as Record<string, unknown>;
      return {
        connectorId: connector.id,
        connectorName: connector.name,
        ...inspectionPayload,
      };
    }

    const schemaSummary = {
      type: schemaType,
      tableCount: tableList.length,
    };
    const batches = this.chunkInspectionTableNames(tableNames);
    const inspectionAgent = createAgent({
      model,
      tools: [inspectAgentTool],
      systemPrompt: inspectionPrompt,
    });
    let accumulatedInspection: InspectionPayload = {
      connectorId: connector.id,
      connectorName: connector.name,
      schemaType,
      tableCount: tableNames.length,
      tables: [],
    };
    let lastToolResult: Record<string, unknown> | undefined;

    for (const [batchIndex, batchTableNames] of batches.entries()) {
      const userMessage = this.buildInspectionBatchUserMessage({
        safeConnector,
        schemaSummary,
        batchTableNames,
        batchIndex,
        totalBatches: batches.length,
        previousAnalysis: accumulatedInspection,
      });

      let inspectionResult: unknown;
      try {
        inspectionResult = await this.invokeWithTrace(
          `inspect:${connector.type}:batch-${batchIndex + 1}`,
          {
            systemPrompt: inspectionPrompt,
            userMessage,
          },
          async () => inspectionAgent.invoke({
            messages: [new HumanMessage(userMessage)],
          })
        );
      } catch (error) {
        console.warn("Inspector agent execution failed for batch, falling back to direct inspection", error);
        inspectionResult = undefined;
      }

      let parsedBatchPayload: InspectionPayload | undefined;
      try {
        const rawText = this.extractModelText(this.getLatestAgentMessage(inspectionResult));
        const parsed = this.parseJsonObject(rawText, { __parseFailed: true } as Record<string, unknown>);
        if (!("__parseFailed" in parsed)) {
          parsedBatchPayload = parsed;
        }
      } catch (error) {
        console.warn("Inspector tool-calling output parse failed for batch, using fallback", error);
      }

      const batchToolResult = this.getLastToolResult(inspectionResult);
      if (batchToolResult) {
        lastToolResult = batchToolResult;
      }

      if (!parsedBatchPayload && batchToolResult) {
        parsedBatchPayload = batchToolResult;
      }

      if (!parsedBatchPayload) {
        parsedBatchPayload = await inspectTool.invoke({
          connectorId: connector.id,
          connectorType: connector.type,
          tableNames: batchTableNames,
          maxColumns: 200,
        }) as InspectionPayload;
      }

      accumulatedInspection = this.mergeInspectionPayload(
        accumulatedInspection,
        parsedBatchPayload,
        connector,
        schemaType,
        tableNames.length
      );
    }

    if (Array.isArray(accumulatedInspection.tables) && accumulatedInspection.tables.length > 0) {
      return accumulatedInspection;
    }

    if (lastToolResult) {
      return {
        connectorId: connector.id,
        connectorName: connector.name,
        ...lastToolResult,
      };
    }

    const schema = schemaDetails || await schemaTool.invoke({
      connectorId: connector.id,
      connectorType: connector.type,
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

  private async resolveSchema(connector: any, inspection: Record<string, unknown>, userPrompt?: string) {
    const tables = Array.isArray((inspection as any).tables) ? (inspection as any).tables : [];
    const fallback = {
      resolvedTables: tables.map((table: any) => table.name || table.id || "table"),
      strategy: tables.length > 0 ? "inspect-and-map" : "fallback",
    };

    const prompt = [
      "You are an AI schema resolver. Convert the discovered tables into a compact ingestion plan and return valid JSON only.",
      "Use this shape: {\"resolvedTables\": [\"string\"], \"strategy\": \"string\"}",
      `Inspection context: ${JSON.stringify({ connector, inspection }, null, 2)}`,
      `User request: ${typeof userPrompt === "string" && userPrompt.trim().length > 0 ? userPrompt : "No additional request provided."}`,
    ].join("\n");

    return this.invokeOpenAI("resolveSchema", prompt, fallback);
  }

  private async profileData(connector: any, inspection: Record<string, unknown>) {
    const inspectionSources = Array.isArray((inspection as any)?.sources)
      ? (inspection as any).sources
      : [inspection];
    const tables = inspectionSources.flatMap((source: any) => {
      const sourceTables = Array.isArray(source?.tables) ? source.tables : [];
      return sourceTables
        .map((table: any) => typeof table?.name === "string"
          ? table.name
          : typeof table?.tableName === "string"
            ? table.tableName
            : "")
        .filter((tableName: string) => tableName.trim().length > 0);
    });
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
      `Inspection context: ${JSON.stringify({ connector, inspection }, null, 2)}`,
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
        const inspections = await Promise.all(validConnectors.map(async (connector) => await this.inspect(connector)));
        return {
          inspection: { sources: inspections },
          status: "running",
          summary: "Inspection completed",
          steps: [{ name: "Inspector", status: "completed", summary: "Source inspection finished" }],
        };
      })
      .addNode("profileData", async (state: typeof AgentState.State) => {
        const connectors = await Promise.all(state.connectorId.map(async (connectorId) => await this.connectorService.getById(connectorId)));
        const validConnectors = connectors.filter((connector) => !!connector);
        const inspectionSources = Array.isArray((state.inspection as any)?.sources)
          ? (state.inspection as any).sources
          : [state.inspection];
        const profileSources = await Promise.all(validConnectors.map(async (connector) => {
          const inspection = inspectionSources.find((source: any) => source?.connectorId === connector.id) || state.inspection;
          const profile = await this.profileData(connector, inspection);
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
          status: "running",
          summary: "Preprocessing completed",
          steps: [{ name: "Data Preprocessor", status: "completed", summary: "Data staged for downstream use" }],
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
          const resolved = await this.resolveSchema(connector, inspection, typeof state.userPrompt === "string" ? state.userPrompt : "");
          return {
            connectorId: connector.id,
            connectorName: connector.name,
            ...resolved,
          };
        }));
        return {
          schemaResolution: { sources: resolvedSources },
          status: "completed",
          summary: "Schema resolution completed",
          steps: [{ name: "Schema Resolver", status: "completed", summary: "Schema mapping prepared" }],
        };
      })
      .addEdge("__start__", "inspect")
      .addEdge("inspect", "profileData")
      .addEdge("profileData", "preprocess")
      .addEdge("preprocess", "resolveSchema")
      .addEdge("resolveSchema", "__end__");

    return workflow.compile();
  }

  async run(connectorId: string[], userPrompt?: string): Promise<IngestionAgentRunResult> {
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
        userPrompt: userPrompt ?? "",
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
