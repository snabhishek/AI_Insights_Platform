import { promises as fs } from "fs";
import fsSync from "fs";
import path from "path";
import { Annotation, StateGraph, MemorySaver } from "@langchain/langgraph";
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
import { createFetchSampleDataTool } from "./tools/profiling/fetchSampleData.tool";
import { createContentValueProfileTool } from "./tools/profiling/contentValueProfile.tool";
import { createCompletenessProfileTool } from "./tools/profiling/completenessProfile.tool";
import { createStatisticalProfileTool } from "./tools/profiling/statisticalProfile.tool";
import { createAnalyzeProfilingTool } from "./tools/preprocessing/analyzeProfiling.tool";
import { createApplyDataCleaningTool } from "./tools/preprocessing/applyDataCleaning.tool";
import { createDuplicateDetectionTool } from "./tools/preprocessing/duplicateDetection.tool";
import { createMissingValueTool } from "./tools/preprocessing/missingValue.tool";
import { createCategoricalTool } from "./tools/preprocessing/categorical.tool";
import { createOutlierTool } from "./tools/preprocessing/outlier.tool";
import { createNormalizationTool } from "./tools/preprocessing/normalization.tool";
import { createStatisticsTool } from "./tools/preprocessing/statistics.tool";
import { IFileService } from "../file.service.interface";
import { ProjectService } from "../project.service";
import { buildResolveSchemaPrompt } from "./prompts/resolveSchema.prompt";
import { getTopicsFromParquetSchema, writeResolvedSchemaParquet } from "./tools/parquetHelper";

const INSPECTION_INITIAL_BATCH_SIZE = 10;
const INSPECTION_FOLLOW_UP_BATCH_SIZE = 5;

type BatchedTableState = {
  tableName: string;
  status: string;
  node: string;
  summary: string;
};

type WorkflowSessionMeta = {
  threadId: string;
  connectorId: string[];
  userPrompt: string;
};

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
  batchedTables: Annotation<BatchedTableState[]>({
    reducer: (left = [], right = []) => {
      const mergedMap = new Map<string, BatchedTableState>();
      for (const entry of left) {
        if (entry.tableName) {
          mergedMap.set(entry.tableName, entry);
        }
      }
      for (const entry of right) {
        if (!entry.tableName) {
          continue;
        }
        const existingEntry = mergedMap.get(entry.tableName);
        mergedMap.set(entry.tableName, existingEntry ? { ...existingEntry, ...entry } : entry);
      }
      return Array.from(mergedMap.values());
    },
    default: () => [],
  }),
  steps: Annotation<Array<{ name: string; status: string; summary: string }>>({
    reducer: (left, right) => [...left, ...right],
    default: () => [],
  }),
  stageOutputs: Annotation<Record<string, unknown>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  stageStatuses: Annotation<Record<string, string>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({
      inspect: "Pending",
      profileData: "Pending",
      preprocess: "Pending",
      resolveSchema: "Pending",
    }),
  }),
});

type SupportedChatModel = ChatOpenAI | AzureChatOpenAI | ChatGoogleGenerativeAI;
type InspectionPayload = Record<string, unknown> & {
  tables?: Array<Record<string, unknown>>;
};

export class IngestionAgentService implements IIngestionAgentService {
  private activeTraceSession?: { filePath: string; startedAt: string };
  private checkpointer = new MemorySaver();
  private sessionMeta = new Map<string, WorkflowSessionMeta>();

  constructor(
    private connectorService: ConnectorService,
    private connectionTester: ConnectionTesterService,
    private fileService: IFileService,
    private projectService: ProjectService
  ) { }

  private mergeBatchedTableStates(left: BatchedTableState[] = [], right: BatchedTableState[] = []): BatchedTableState[] {
    const mergedMap = new Map<string, BatchedTableState>();

    for (const entry of left) {
      if (entry.tableName) {
        mergedMap.set(entry.tableName, entry);
      }
    }

    for (const entry of right) {
      if (!entry.tableName) {
        continue;
      }

      const existingEntry = mergedMap.get(entry.tableName);
      mergedMap.set(entry.tableName, existingEntry ? { ...existingEntry, ...entry } : entry);
    }

    return Array.from(mergedMap.values());
  }

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
      console.error(error);
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

  private getModel(): SupportedChatModel | null {
    return this.createAzureOpenAIModel() || this.createOpenAIModel() || this.createGeminiModel();
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
      model: model,
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

  private async getPromptFromFile(fileName: string, fallback: string): Promise<string> {
    try {
      const promptPath = path.resolve(__dirname, "prompts", fileName);
      return await fs.readFile(promptPath, "utf8");
    } catch (error) {
      console.warn(`Unable to load prompt file ${fileName}, using fallback`, error);
      return fallback;
    }
  }

  private chunkInspectionTableNames(tableNames: string[]): string[][] {
    const normalizedTableNames = tableNames.filter((tableName) => typeof tableName === "string" && tableName.trim().length > 0);
    if (normalizedTableNames.length === 0) {
      return [];
    }

    const batches: string[][] = [];

    batches.push(normalizedTableNames.slice(0, INSPECTION_INITIAL_BATCH_SIZE));
    for (let index = INSPECTION_INITIAL_BATCH_SIZE; index < normalizedTableNames.length; index += INSPECTION_FOLLOW_UP_BATCH_SIZE) {
      batches.push(normalizedTableNames.slice(index, index + INSPECTION_FOLLOW_UP_BATCH_SIZE));
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

  private buildBatchedTableState(tableNames: string[], node: string, status: string, summary: string): BatchedTableState[] {
    return tableNames
      .filter((tableName) => typeof tableName === "string" && tableName.trim().length > 0)
      .map((tableName) => ({
        tableName,
        status,
        node,
        summary,
      }));
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
    const model = this.createOpenAIModel();
    return this.invokeAgentJson(stepName, model, prompt, fallback, {
      traceLabel: `openai:${stepName}`,
    });
  }

  private async runInspectorWithTools(connector: any) {
    const inspectTool = createInspectTool(this.fileService, this.connectorService);
    const schemaTool = createGetSchemaTool(this.connectionTester, this.connectorService);
    const model = this.getModel();
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
        batchedTables: [],
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
    const inspectionTableStatuses = batches.flatMap((batchTableNames, batchIndex) => this.buildBatchedTableState(
      batchTableNames,
      "inspect",
      "analysed",
      `Analyzed in inspection batch ${batchIndex + 1}/${batches.length}`
    ));
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
      return {
        ...accumulatedInspection,
        batchedTables: inspectionTableStatuses,
      };
    }

    if (lastToolResult) {
      return {
        connectorId: connector.id,
        connectorName: connector.name,
        batchedTables: inspectionTableStatuses,
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
      batchedTables: inspectionTableStatuses,
      schemaType: schema?.type || "unknown",
      tableCount: Array.isArray(schema?.tables) ? schema.tables.length : 0,
      tables: Array.isArray(schema?.tables) ? schema.tables : [],
      notes: "Fallback schema used; limited column details.",
    };
  }

  private async inspect(connector: any) {
    return this.runInspectorWithTools(connector);
  }

  private resolvePackageFilePath(filename: string): string {
    const candidatePaths = [
      path.resolve(__dirname, "../../../../packages", filename),
      path.resolve(process.cwd(), "../packages", filename),
      path.resolve(process.cwd(), "src/packages", filename),
      path.resolve(__dirname, "../../packages", filename),
    ];
    for (const candidate of candidatePaths) {
      if (fsSync.existsSync(candidate)) {
        return candidate;
      }
    }
    return candidatePaths[0];
  }

  private async resolveSchema(
    connector: any, 
    inspection: Record<string, unknown>, 
    userPrompt?: string, 
    dataProfile?: Record<string, unknown>
  ) {
    const inspectionSources = Array.isArray((inspection as any)?.sources)
      ? (inspection as any).sources
      : [inspection];
    const tables = inspectionSources.flatMap((source: any) => Array.isArray(source?.tables) ? source.tables : []);


    // Infer business domain fallback from tables or connector name
    const tableDomain = tables.find((t: any) => t.businessDomain || t.domain)?.businessDomain || tables.find((t: any) => t.businessDomain || t.domain)?.domain;
    const inferredDomain = tableDomain || (connector?.name ? `${connector.name} Data Domain` : "General Business Domain");

    const allFields: Array<{ datasetField: string; targetTopic: string }> = [];
    tables.forEach((table: any) => {
      const tableName = table.name || table.tableName || "table";
      if (Array.isArray(table.columns) && table.columns.length > 0) {
        table.columns.forEach((col: any) => {
          const colName = typeof col === "string" ? col : col.name || col.columnName || "";
          if (colName) {
            allFields.push({
              datasetField: `${tableName}.${colName}`,
              targetTopic: "General",
            });
          }
        });
      } else {
        allFields.push({
          datasetField: tableName,
          targetTopic: "General",
        });
      }
    });

    const staticSchemaPath = this.resolvePackageFilePath("static_schema_updated.parquet");
    const targetParquetTopics = await getTopicsFromParquetSchema(staticSchemaPath);

    const defaultTopic = targetParquetTopics[0] || "General";
    const fallbackMappings = [
      { datasetField: inferredDomain, targetTopic: "Domain" },
      ...allFields.map((f) => ({
        datasetField: f.datasetField,
        targetTopic: defaultTopic,
      }))
    ];

    const fallback: Record<string, any> = {
      domain: inferredDomain,
      resolvedTables: tables.map((table: any) => table.name || table.tableName || table.id || "table"),
      strategy: tables.length > 0 ? "inspect-and-map" : "fallback",
      mappings: fallbackMappings,
      unmappedDatasetFields: []
    };

    const prompt = buildResolveSchemaPrompt(connector, inspection, targetParquetTopics, userPrompt, dataProfile);
    const model = this.getModel();

    const result = await this.invokeAgentJson("resolveSchema", model, prompt, fallback, {
      traceLabel: "agent:resolveSchema",
    });

    const rawMappings = (result && Array.isArray(result.mappings) && result.mappings.length > 0)
      ? result.mappings
      : fallbackMappings;

    const resolvedDomain = (typeof result?.domain === "string" && result.domain.trim().length > 0)
      ? result.domain.trim()
      : inferredDomain;

    // Ensure a Domain topic mapping exists in mappingsToWrite so writeResolvedSchemaParquet populates the Domain column
    const hasDomainMapping = rawMappings.some((m: any) => m.targetTopic === "Domain");
    const mappingsToWrite = hasDomainMapping
      ? rawMappings
      : [{ datasetField: resolvedDomain, targetTopic: "Domain" }, ...rawMappings];

    if (mappingsToWrite.length > 0) {
      const outputParquetPath = path.resolve(path.dirname(staticSchemaPath), "resolved_schema.parquet");
      await writeResolvedSchemaParquet(
        outputParquetPath,
        mappingsToWrite as Array<{ datasetField: string; targetTopic: string }>,
        targetParquetTopics
      );
      console.info(`[resolveSchema] Wrote resolved_schema.parquet to ${outputParquetPath} with ${mappingsToWrite.length} mappings`);
    }

    return {
      ...fallback,
      ...result,
      domain: resolvedDomain,
      mappings: mappingsToWrite,
    };
  }

  private async profileData(connector: any, inspection: Record<string, unknown>) {
    const model = this.getModel();

    const fetchSampleTool = createFetchSampleDataTool(this.connectionTester, this.connectorService);
    const contentProfileTool = createContentValueProfileTool();
    const completenessProfileTool = createCompletenessProfileTool();
    const statisticalProfileTool = createStatisticalProfileTool();

    const profilingTools = [fetchSampleTool, contentProfileTool, completenessProfileTool, statisticalProfileTool];

    // Extract table and relationship info from inspection
    const inspectionSources = Array.isArray((inspection as any)?.sources)
      ? (inspection as any).sources
      : [inspection];
    const allTables = inspectionSources.flatMap((source: any) => {
      const sourceTables = Array.isArray(source?.tables) ? source.tables : [];
      return sourceTables.filter((t: any) => {
        const name = typeof t?.name === "string" ? t.name : typeof t?.tableName === "string" ? t.tableName : "";
        return name.trim().length > 0;
      });
    });
    const tableNames = allTables.map((t: any) => t.name || t.tableName);

    const fallback = {
      status: "OK",
      tables: allTables.map((t: any) => {
        const tableName = t.name || t.tableName;
        const columns = Array.isArray(t.columns) ? t.columns : [];
        return {
          tableName,
          contentProfile: { columns: columns.map((c: any) => ({ name: c.name || c, sampleValues: [], uniqueCount: 0, dataType: c.dataType || "string" })) },
          completenessProfile: { columns: columns.map((c: any) => ({ name: c.name || c, nullCount: 0, completeness: 1.0 })) },
          statisticalProfile: { numericColumns: [], dateColumns: [] },
        };
      }),
      tableOrder: tableNames,
      summary: `Profiled ${tableNames.length} tables`,
    };

    if (!model) {
      return fallback;
    }

    const systemPrompt = await this.getPromptFromFile(
      "dataprofile.md",
      "You are an AI data profiler. Analyze the tables and columns provided in the context and return a detailed data profiling result as valid JSON."
    );

    const inspectionSummary = allTables.map((t: any) => ({
      tableName: t.name || t.tableName,
      columns: Array.isArray(t.columns) ? t.columns.map((c: any) => ({ name: c.name || c, dataType: c.dataType || "string", nullable: c.nullable ?? true })) : [],
      relationships: {
        explicit: Array.isArray(t.relations) ? t.relations : [],
        inferred: Array.isArray(t.relationships?.inferred) ? t.relationships.inferred : [],
      },
      businessDomain: t.businessDomain || t.domain || "general",
    }));

    const userMessage = [
      `Connector: ${connector.name} (${connector.type})`,
      `Tables to profile (${allTables.length}): ${JSON.stringify(inspectionSummary, null, 2)}`,
      "Generate complete profiling analysis JSON containing 'status', 'tables' array (with contentProfile, completenessProfile, statisticalProfile for each table), and 'tableOrder'.",
      "Return valid JSON only."
    ].join("\n\n");

    try {
      const result = await this.invokeAgentJson(
        "profileData",
        model,
        userMessage,
        fallback,
        {
          systemPrompt,
          traceLabel: "agent:profileData",
          tools: profilingTools
        }
      );
      return {
        ...fallback,
        ...result,
      };
    } catch (error) {
      console.warn("DataProfile agent execution failed, using fallback", error);
      return fallback;
    }
  }

  private async preprocess(connector: any, dataProfile: Record<string, unknown>) {
    const model = this.getModel();

    const analyzeProfilingTool = createAnalyzeProfilingTool();
    const missingValueTool = createMissingValueTool();
    const categoricalTool = createCategoricalTool();
    const outlierTool = createOutlierTool();
    const normalizationTool = createNormalizationTool();
    const statisticsTool = createStatisticsTool();
    const applyCleaningTool = createApplyDataCleaningTool(this.connectionTester, this.connectorService);
    const duplicateDetectionTool = createDuplicateDetectionTool(this.connectionTester, this.connectorService);

    const preprocessingTools = [
      analyzeProfilingTool,
      missingValueTool,
      categoricalTool,
      outlierTool,
      normalizationTool,
      statisticsTool,
      applyCleaningTool,
      duplicateDetectionTool,
    ];

    const profileTables = Array.isArray((dataProfile as any)?.tables)
      ? (dataProfile as any).tables
      : Array.isArray((dataProfile as any)?.sources)
        ? (dataProfile as any).sources
        : [];
    const tableCount = profileTables.length;

    const fallback = {
      status: "OK",
      tableCount,
      preprocessingPlan: {
        connectorType: connector.type,
        tables: profileTables.map((t: any) => ({
          tableName: t.tableName || "table",
          actions: [{ action: "cleanNulls", column: "all", status: "applied" }],
        })),
      },
      summary: {
        totalActions: profileTables.length,
        applied: profileTables.length,
        skipped: 0,
        failed: 0,
      },
    };

    if (!model) {
      return fallback;
    }

    const systemPrompt = await this.getPromptFromFile(
      "preprocess.md",
      "You are an AI preprocessing assistant. Analyze profiling results and create a data preprocessing plan. Return valid JSON only."
    );

    const userMessage = [
      `Connector: ${connector.name} (${connector.type})`,
      `Data Profile summary: ${JSON.stringify(dataProfile, null, 2)}`,
      "Generate preprocessing plan JSON containing 'status', 'tableCount', 'preprocessingPlan', and 'summary' with action metrics.",
      "Return valid JSON only."
    ].join("\n\n");

    try {
      const result = await this.invokeAgentJson(
        "preprocess",
        model,
        userMessage,
        fallback,
        {
          systemPrompt,
          tools: preprocessingTools,
          traceLabel: "agent:preprocess",
        }
      );
      return {
        ...fallback,
        ...result,
      };
    } catch (error) {
      console.warn("Preprocess agent execution failed, using fallback", error);
      return fallback;
    }
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
            stageStatuses: { inspect: "Failed" },
          };
        }
        const inspections = await Promise.all(validConnectors.map(async (connector) => await this.inspect(connector)));
        const batchedTables = inspections.flatMap((inspection: any) => Array.isArray(inspection?.batchedTables) ? inspection.batchedTables : []);
        return {
          inspection: { sources: inspections },
          batchedTables: this.mergeBatchedTableStates(state.batchedTables, batchedTables),
          status: "running",
          summary: "Inspection completed",
          steps: [{ name: "Inspector", status: "completed", summary: "Source inspection finished" }],
          stageOutputs: { inspect: { sources: inspections } },
          stageStatuses: { inspect: "Completed" },
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
        const updatedBatchedTables = this.mergeBatchedTableStates(
          state.batchedTables,
          this.buildBatchedTableState(
            (state.batchedTables || []).map((table) => table.tableName),
            "profileData",
            "profiled",
            "Table data profile completed"
          )
        );
        return {
          dataProfile: { sources: profileSources },
          batchedTables: updatedBatchedTables,
          status: "running",
          summary: "Data profiling completed",
          steps: [{ name: "Data Profiler", status: "completed", summary: "Profiling completed" }],
          stageOutputs: { profileData: { sources: profileSources } },
          stageStatuses: { profileData: "Completed" },
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
        const updatedBatchedTables = this.mergeBatchedTableStates(
          state.batchedTables,
          this.buildBatchedTableState(
            (state.batchedTables || []).map((table) => table.tableName),
            "preprocess",
            "preprocessed",
            "Table preprocessing completed"
          )
        );
        return {
          preprocessing: { sources: preprocessSources },
          batchedTables: updatedBatchedTables,
          status: "running",
          summary: "Preprocessing completed",
          steps: [{ name: "Data Preprocessor", status: "completed", summary: "Data staged for downstream use" }],
          stageOutputs: { preprocess: { sources: preprocessSources } },
          stageStatuses: { preprocess: "Completed" },
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
          const resolved = await this.resolveSchema(
            connector, 
            inspection, 
            typeof state.userPrompt === "string" ? state.userPrompt : "",
            state.dataProfile
          );
          return {
            connectorId: connector.id,
            connectorName: connector.name,
            ...resolved,
          };
        }));
        const updatedBatchedTables = this.mergeBatchedTableStates(
          state.batchedTables,
          this.buildBatchedTableState(
            (state.batchedTables || []).map((table) => table.tableName),
            "resolveSchema",
            "resolved",
            "Table schema resolution completed"
          )
        );
        return {
          schemaResolution: { sources: resolvedSources },
          batchedTables: updatedBatchedTables,
          status: "completed",
          summary: "Schema resolution completed",
          steps: [{ name: "Schema Resolver", status: "completed", summary: "Schema mapping prepared" }],
          stageOutputs: { resolveSchema: { sources: resolvedSources } },
          stageStatuses: { resolveSchema: "Completed" },
        };
      })
      .addEdge("__start__", "inspect")
      .addEdge("inspect", "profileData")
      .addEdge("profileData", "preprocess")
      .addEdge("preprocess", "resolveSchema")
      .addEdge("resolveSchema", "__end__");

    // interruptBefore pauses BEFORE these nodes, creating 3 approval gates:
    //   Stage 1 (Data Ingestion):  start → inspect → pause before profileData
    //   Stage 2 (Data Profiling):  resume → profileData → preprocess → pause before resolveSchema
    //   Stage 3 (Schema Resolver): resume → resolveSchema → end
    return workflow.compile({
      checkpointer: this.checkpointer,
      interruptBefore: ["profileData", "resolveSchema"],
    });
  }

  private determineCurrentStage(nextNodes: string[], stageStatuses: Record<string, string>): string {
    // If graph is interrupted before a node, the last completed node is the current stage
    if (nextNodes.includes("profileData")) return "inspect";
    if (nextNodes.includes("resolveSchema")) return "preprocess";
    // Graph completed or not yet started — check what's completed
    if (stageStatuses.resolveSchema === "Completed") return "resolveSchema";
    if (stageStatuses.preprocess === "Completed") return "preprocess";
    if (stageStatuses.profileData === "Completed") return "profileData";
    if (stageStatuses.inspect === "Completed") return "inspect";
    return "inspect";
  }

  private buildMessage(nextNodes: string[], status: string): string {
    if (status === "completed" || status === "failed") {
      return status === "completed" ? "Workflow completed successfully." : "Workflow failed.";
    }
    if (nextNodes.includes("profileData")) {
      return "Inspect stage completed. Approve to continue to data profiling.";
    }
    if (nextNodes.includes("resolveSchema")) {
      return "Data profiling and preprocessing completed. Approve to continue to schema resolution.";
    }
    return "Workflow is running.";
  }

  private buildResultFromGraphState(
    graphState: any,
    threadId: string,
    connectorId: string[]
  ): IngestionAgentRunResult {
    const values = graphState?.values ?? {};
    const nextNodes: string[] = Array.isArray(graphState?.next) ? graphState.next : [];
    const defaultStatuses = { inspect: "Pending", profileData: "Pending", preprocess: "Pending", resolveSchema: "Pending" };
    const stageStatuses = (values.stageStatuses && typeof values.stageStatuses === "object")
      ? values.stageStatuses as Record<string, string>
      : defaultStatuses;
    const status = (typeof values.status === "string" && values.status) ? values.status : "running";
    const isCompleted = status === "completed" || status === "failed";
    const requiresApproval = !isCompleted && nextNodes.length > 0;
    const currentStage = this.determineCurrentStage(nextNodes, stageStatuses);

    return {
      connectorId,
      status,
      summary: (typeof values.summary === "string" && values.summary) ? values.summary : "Workflow updated",
      steps: Array.isArray(values.steps) ? values.steps : [],
      inspection: (values.inspection && typeof values.inspection === "object") ? values.inspection : {},
      schemaResolution: (values.schemaResolution && typeof values.schemaResolution === "object") ? values.schemaResolution : {},
      dataProfile: (values.dataProfile && typeof values.dataProfile === "object") ? values.dataProfile : {},
      preprocessing: (values.preprocessing && typeof values.preprocessing === "object") ? values.preprocessing : {},
      batchedTables: Array.isArray(values.batchedTables) ? values.batchedTables : [],
      sessionId: threadId,
      requiresApproval,
      nextStep: nextNodes[0],
      currentNode: currentStage,
      currentStage,
      stageOutputs: (values.stageOutputs && typeof values.stageOutputs === "object") ? values.stageOutputs : {},
      stageStatuses,
      message: this.buildMessage(nextNodes, status),
    };
  }

  private mapRetryStepToInterruptNode(step?: string): string | undefined {
    // Map frontend step names to the graph interrupt node to resume from
    const mapping: Record<string, string> = {
      inspect: "inspect",
      profileData: "profileData",
      preprocess: "profileData",   // retry "Data Profiling" re-runs from profileData
      resolveSchema: "resolveSchema",
      "Data Ingestion": "inspect",
      "Data Profiling": "profileData",
      "Schema Resolver": "resolveSchema",
    };
    return step ? mapping[step] : undefined;
  }

  async run(connectorId: string[], userPrompt?: string, options?: { sessionId?: string; action?: "approve" | "retry"; step?: string; projectId?: string }): Promise<IngestionAgentRunResult> {
    const traceSession = await this.createTraceSession();
    const runStartedAt = new Date().toISOString();

    if (traceSession) {
      await this.appendTraceEntry("workflow:start", "input", {
        connectorId,
        startedAt: runStartedAt,
        action: options?.action,
        step: options?.step,
        sessionId: options?.sessionId,
      });
    }

    try {
      const workflow = this.createWorkflow();

      // Resolve or create the thread ID
      let threadId: string = options?.sessionId ?? "";
      let meta = threadId ? this.sessionMeta.get(threadId) : undefined;

      if (!meta) {
        threadId = `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        meta = { threadId, connectorId, userPrompt: userPrompt ?? "" };
        this.sessionMeta.set(threadId, meta);
      }

      const config = { configurable: { thread_id: threadId } };

      if (options?.action === "retry" && options.step) {
        const targetNode = this.mapRetryStepToInterruptNode(options.step);
        console.info(`[Workflow] Retry requested for step "${options.step}" → target node "${targetNode}", thread ${threadId}`);

        if (targetNode === "inspect") {
          // Retry inspect = start fresh with a new thread
          threadId = `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          meta = { threadId, connectorId, userPrompt: userPrompt ?? meta.userPrompt ?? "" };
          this.sessionMeta.set(threadId, meta);
          const freshConfig = { configurable: { thread_id: threadId } };
          await workflow.invoke(
            { connectorId, userPrompt: meta.userPrompt, status: "queued", summary: "Retrying from inspect" },
            freshConfig
          );
          const graphState = await workflow.getState(freshConfig);
          return this.buildResultFromGraphState(graphState, threadId, connectorId);
        }

        // For profileData or resolveSchema retry: find the checkpoint where that node is next
        let retryCheckpointId: string | undefined;
        try {
          for await (const snapshot of workflow.getStateHistory(config)) {
            const snapshotNext = Array.isArray(snapshot.next) ? snapshot.next : [];
            if (snapshotNext.includes(targetNode!)) {
              retryCheckpointId = (snapshot.config as any)?.configurable?.checkpoint_id;
              break;
            }
          }
        } catch (historyError: any) {
          console.warn(`[Workflow] Failed to read state history for retry:`, historyError?.message);
        }

        if (retryCheckpointId) {
          console.info(`[Workflow] Retrying from checkpoint ${retryCheckpointId}`);
          const retryConfig = { configurable: { thread_id: threadId, checkpoint_id: retryCheckpointId } };
          await workflow.invoke(null, retryConfig);
          const graphState = await workflow.getState(config);
          return this.buildResultFromGraphState(graphState, threadId, connectorId);
        }

        // Fallback: resume from current position
        console.warn(`[Workflow] No checkpoint found for retry target "${targetNode}", resuming from current position`);
        await workflow.invoke(null, config);
      } else if (options?.action === "approve") {
        // Approve: resume from the current interrupt
        console.info(`[Workflow] Approve — resuming thread ${threadId}`);
        await workflow.invoke(null, config);
      } else {
        // New workflow: first invocation
        console.info(`[Workflow] Starting new workflow, thread ${threadId}, connectors: [${connectorId.join(", ")}]`);
        await workflow.invoke(
          { connectorId, userPrompt: userPrompt ?? "", status: "queued", summary: "Ingestion workflow started" },
          config
        );
      }

      const graphState = await workflow.getState(config);
      
      console.info(`[Workflow] State after invoke — next: [${Array.isArray(graphState?.next) ? graphState.next.join(", ") : "none"}], status: ${graphState?.values?.status || "unknown"}`);
      const result = this.buildResultFromGraphState(graphState, threadId, connectorId);

      if (options?.projectId) {
        try {
          await this.projectService.updateAgentState(options.projectId, graphState?.values ?? {});
        } catch (persistError: any) {
          console.warn(`[Workflow] Failed to persist agent state for project ${options.projectId}:`, persistError?.message || persistError);
        }
      }

      if (traceSession) {
        await this.appendTraceEntry("workflow:end", "output", {
          connectorId,
          startedAt: runStartedAt,
          completedAt: new Date().toISOString(),
          status: result.status,
          summary: result.summary,
          nextStep: result.nextStep,
        });
      }

      return result;
    } catch (error: any) {
      console.error(`[Workflow] Run failed:`, error?.message || error);
      if (traceSession) {
        await this.appendTraceEntry("workflow:error", "error", {
          connectorId,
          error: error?.message || String(error),
        }).catch(() => {});
      }
      throw error;
    } finally {
      this.activeTraceSession = undefined;
    }
  }
}
