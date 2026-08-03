import { promises as fs } from "fs";
import * as fsSync from "fs";
import * as path from "path";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AzureChatOpenAI, ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { createAgent } from "langchain";
import { BatchedTableState, IngestionServices } from "../state";

export type SupportedChatModel = ChatOpenAI | AzureChatOpenAI | ChatGoogleGenerativeAI;
export type InspectionPayload = Record<string, unknown> & {
  tables?: Array<Record<string, unknown>>;
};

export class AgentTraceHelper {
  private activeTraceSession?: { filePath: string; startedAt: string };

  public getTraceConfig() {
    const enabled = process.env.AI_LLM_TRACE_ENABLED === "true"
      || (process.env.AI_LLM_TRACE_ENABLED !== "false" && process.env.NODE_ENV !== "production");
    const maxChars = Number.parseInt(process.env.AI_LLM_TRACE_MAX_CHARS || "4000", 10);

    return {
      enabled,
      maxChars: Number.isFinite(maxChars) && maxChars > 0 ? maxChars : 4000,
    };
  }

  public serializeForLog(value: unknown, maxChars: number): string {
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

  public sanitizeConnectionConfig(value: unknown): unknown {
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

  public getTraceFileName(): string {
    const now = new Date();
    const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").replace("T", "-");
    return `${stamp}.log`;
  }

  public getTraceDirectory(): string {
    return path.resolve(process.cwd(), "logs", "ai-traces");
  }

  public async createTraceSession() {
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

  public async appendTraceEntry(stepName: string, direction: "input" | "output" | "error", payload: unknown) {
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

  public logLlmTrace(stepName: string, direction: "input" | "output" | "error", payload: unknown, maxChars: number) {
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

  public async invokeWithTrace<T>(stepName: string, input: unknown, invoke: () => Promise<T>): Promise<T> {
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

  public clearTraceSession() {
    this.activeTraceSession = undefined;
  }
}

export function createGeminiModel() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return null;
  }

  return new ChatGoogleGenerativeAI({
    apiKey,
    model: process.env.GEMINI_MODEL || "gemini-3.1-pro-preview",
    temperature: 0,
    maxOutputTokens: 32000,
  });
}

export function createAzureOpenAIModel() {
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

export function createOpenAIModel() {
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

export function getModel(): SupportedChatModel | null {
  const provider = (process.env.AI_PROVIDER || "").toLowerCase().trim();
  if (provider === "gemini" || provider === "google") {
    const gemini = createGeminiModel();
    if (gemini) return gemini;
  } else if (provider === "azure" || provider === "azure_openai") {
    const azure = createAzureOpenAIModel();
    if (azure) return azure;
  } else if (provider === "openai") {
    const openai = createOpenAIModel();
    if (openai) return openai;
  }

  return createGeminiModel() || createAzureOpenAIModel() || createOpenAIModel();
}

export function extractModelText(response: unknown): string {
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

import * as yaml from "js-yaml";

export function parseJsonObject<T extends Record<string, unknown>>(rawText: string, fallback: T): T {
  const normalizedText = rawText
    .replace(/^```(?:json|yaml|yml)?/i, "")
    .replace(/```$/i, "")
    .trim();

  if (!normalizedText) {
    return fallback;
  }

  try {
    const yamlParsed = yaml.load(normalizedText);
    if (yamlParsed && typeof yamlParsed === "object" && !Array.isArray(yamlParsed)) {
      return yamlParsed as T;
    }
  } catch {
    // Fallback to JSON parse below
  }

  try {
    const parsed = JSON.parse(normalizedText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as T;
    }
  } catch {
    // Ignore error
  }

  return fallback;
}

export function getLatestAgentMessage(agentResult: unknown): unknown {
  const messages = Array.isArray((agentResult as any)?.messages) ? (agentResult as any).messages : [];
  return messages.length > 0 ? messages[messages.length - 1] : agentResult;
}

export function getLastToolResult(agentResult: unknown): Record<string, unknown> | undefined {
  const messages = Array.isArray((agentResult as any)?.messages) ? (agentResult as any).messages : [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as any;
    const messageType = typeof message?.getType === "function" ? message.getType() : message?.type;
    if (messageType !== "tool") {
      continue;
    }

    const toolText = extractModelText(message);
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

export async function invokeAgentJson<T extends Record<string, unknown>>(
  stepName: string,
  model: SupportedChatModel | null,
  userMessage: string,
  fallback: T,
  services: IngestionServices,
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
    const result = await services.traceHelper.invokeWithTrace(
      options?.traceLabel ?? `agent:${stepName}`,
      {
        systemPrompt: options?.systemPrompt,
        userMessage,
      },
      async () => agent.invoke(input)
    );
    
    // Dynamically log thinking messages based on the running step name
    const substepMap: Record<string, string> = {
      profileData: "Data Profiling",
      preprocess: "Data Profiling",
      resolveSchema: "Schema Resolver"
    };
    const substep = substepMap[stepName] || "Data Ingestion";
    await logAgentMessagesAsThinking(services, substep, result);

    const rawText = extractModelText(getLatestAgentMessage(result));
    return parseJsonObject(rawText, fallback);
  } catch (error) {
    console.warn(`Agent ${stepName} fallback triggered`, error);
    return fallback;
  }
}

export function resolvePromptFilePath(filename: string): string {
  const candidatePaths = [
    path.resolve(__dirname, "../prompts", filename),
    path.resolve(process.cwd(), "src/agents/prompts", filename),
    path.resolve(__dirname, "../../../src/agents/prompts", filename),
  ];
  for (const candidate of candidatePaths) {
    if (fsSync.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidatePaths[0];
}

export async function getInspectionSystemPrompt(): Promise<string> {
  try {
    const promptPath = resolvePromptFilePath("injectioninspection.md");
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

export async function getPromptFromFile(fileName: string, fallback: string): Promise<string> {
  try {
    const promptPath = resolvePromptFilePath(fileName);
    return await fs.readFile(promptPath, "utf8");
  } catch (error) {
    console.warn(`Unable to load prompt file ${fileName}, using fallback`, error);
    return fallback;
  }
}

export function chunkInspectionTableNames(tableNames: string[], initialBatchSize = 10, followUpBatchSize = 5): string[][] {
  const normalizedTableNames = tableNames.filter((tableName) => typeof tableName === "string" && tableName.trim().length > 0);
  if (normalizedTableNames.length === 0) {
    return [];
  }

  const batches: string[][] = [];

  batches.push(normalizedTableNames.slice(0, initialBatchSize));
  for (let index = initialBatchSize; index < normalizedTableNames.length; index += followUpBatchSize) {
    batches.push(normalizedTableNames.slice(index, index + followUpBatchSize));
  }

  return batches;
}

export function normalizeInspectionTable(table: Record<string, unknown>): Record<string, unknown> {
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

export function normalizeInspectionPayload(payload: InspectionPayload): InspectionPayload {
  const tables = Array.isArray(payload.tables)
    ? payload.tables
      .filter((table): table is Record<string, unknown> => !!table && typeof table === "object" && !Array.isArray(table))
      .map((table) => normalizeInspectionTable(table))
    : [];

  return {
    ...payload,
    tables,
  };
}

export function mergeInspectionPayload(
  accumulated: InspectionPayload,
  incoming: InspectionPayload,
  connector: any,
  schemaType: string,
  tableCount: number
): InspectionPayload {
  const normalizedAccumulated = normalizeInspectionPayload(accumulated);
  const normalizedIncoming = normalizeInspectionPayload(incoming);
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
    mergedTableMap.set(tableName, normalizeInspectionTable({
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

export function buildBatchedTableState(tableNames: string[], node: string, status: string, summary: string): BatchedTableState[] {
  return tableNames
    .filter((tableName) => typeof tableName === "string" && tableName.trim().length > 0)
    .map((tableName) => ({
      tableName,
      status,
      node,
      summary,
    }));
}

export function buildInspectionBatchUserMessage(params: {
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

export function mergeBatchedTableStates(left: BatchedTableState[] = [], right: BatchedTableState[] = []): BatchedTableState[] {
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

export function determineCurrentStage(nextNodes: string[], stageStatuses: Record<string, string>): string {
  if (nextNodes.includes("profileData")) return "inspect";
  if (nextNodes.includes("resolveSchema")) return "preprocess";
  if (stageStatuses.resolveSchema === "Completed") return "resolveSchema";
  if (stageStatuses.preprocess === "Completed") return "preprocess";
  if (stageStatuses.profileData === "Completed") return "profileData";
  if (stageStatuses.inspect === "Completed") return "inspect";
  return "inspect";
}

export function buildMessage(nextNodes: string[], status: string): string {
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

export function buildResultFromGraphState(
  graphState: any,
  threadId: string,
  connectorId: string[]
): any {
  const values = graphState?.values ?? {};
  const nextNodes: string[] = Array.isArray(graphState?.next) ? graphState.next : [];
  const defaultStatuses = { inspect: "Pending", profileData: "Pending", preprocess: "Pending", resolveSchema: "Pending" };
  const stageStatuses = (values.stageStatuses && typeof values.stageStatuses === "object")
    ? values.stageStatuses as Record<string, string>
    : defaultStatuses;
  const status = (typeof values.status === "string" && values.status) ? values.status : "running";
  const isCompleted = status === "completed" || status === "failed";
  const requiresApproval = !isCompleted && nextNodes.length > 0;
  const currentStage = determineCurrentStage(nextNodes, stageStatuses);

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
    message: buildMessage(nextNodes, status),
  };
}

export function mapRetryStepToInterruptNode(step?: string): string | undefined {
  const mapping: Record<string, string> = {
    inspect: "inspect",
    profileData: "profileData",
    preprocess: "profileData",
    resolveSchema: "resolveSchema",
    "Data Ingestion": "inspect",
    "Data Profiling": "profileData",
    "Schema Resolver": "resolveSchema",
  };
  return step ? mapping[step] : undefined;
}

export async function logMilestoneThinking(
  services: any,
  substep: string,
  text: string
): Promise<void> {
  const { agentThinkingService, projectId, pipeline } = services || {};
  if (!agentThinkingService || !projectId || !pipeline) {
    return;
  }
  try {
    const existing = await agentThinkingService.getThinking(projectId, pipeline, substep);
    const thinkingLogs = existing ? [...existing.thinking] : [];
    
    // Check for duplicates
    if (thinkingLogs.some((l: any) => l.text === text)) {
      return;
    }

    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-US", { hour12: true, hour: "2-digit", minute: "2-digit", second: "2-digit" });

    thinkingLogs.push({
      time: timeStr,
      text,
      done: true,
    });

    await agentThinkingService.saveThinking(projectId, pipeline, substep, thinkingLogs);
  } catch (err) {
    console.warn("[AgentUtils] Failed to log milestone thinking:", err);
  }
}

export async function logAgentMessagesAsThinking(
  services: any,
  substep: string,
  agentResult: any
): Promise<void> {
  const { agentThinkingService, projectId, pipeline } = services || {};
  if (!agentThinkingService || !projectId || !pipeline || !agentResult) {
    return;
  }
  try {
    const messages = Array.isArray(agentResult?.messages) ? agentResult.messages : [];
    if (messages.length === 0) return;

    const thinkingLogs: Array<{ time: string; text: string; done: boolean }> = [];

    for (const msg of messages) {
      const now = new Date();
      const timeStr = now.toLocaleTimeString("en-US", { hour12: true, hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const type = typeof msg?.getType === "function" ? msg.getType() : msg?.type;

      if (type === "ai") {
        const content = extractModelText(msg);
        if (content && content.trim() && content.trim().length > 10) {
          thinkingLogs.push({
            time: timeStr,
            text: `Agent reasoning: ${content.trim()}`,
            done: true,
          });
        }
        if (msg?.tool_calls && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            thinkingLogs.push({
              time: timeStr,
              text: `Invoking tool '${tc.name}' with arguments: ${JSON.stringify(tc.args)}`,
              done: true,
            });
          }
        }
      } else if (type === "tool") {
        const content = extractModelText(msg);
        thinkingLogs.push({
          time: timeStr,
          text: `Tool output: ${content.length > 200 ? content.slice(0, 200) + "..." : content}`,
          done: true,
        });
      }
    }

    if (thinkingLogs.length > 0) {
      const existing = await agentThinkingService.getThinking(projectId, pipeline, substep);
      const allLogs = existing ? [...existing.thinking] : [];

      for (const log of thinkingLogs) {
        if (!allLogs.some((l: any) => l.text === log.text)) {
          allLogs.push(log);
        }
      }

      await agentThinkingService.saveThinking(projectId, pipeline, substep, allLogs);
    }
  } catch (err) {
    console.warn("[AgentUtils] Failed to log agent messages as thinking:", err);
  }
}
