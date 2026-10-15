import { BaseCheckpointSaver, interrupt } from "@langchain/langgraph";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { AnalysisPlanner, analysisPlanSchema } from "./analysisPlanner";
import { InsightsResponder } from "./insightsResponder";
import { QueryResolver } from "./queryResolver";
import { SparrowState } from "./sparrowState";
import { AnalysisPlan, ExecutionToolResult, SparrowThinkingStep } from "./types";
import { clarificationSchema, createClarificationInteraction } from "./clarification";
import { advancePeriod, dateOnly, resolveForecastRange } from "./forecastWindow";
import { compactMemory, compactProjectContext, compactToolResults } from "./projectContext";
import { setupTimestampedLogging } from "../../utils/logger";
import { throwIfSparrowStopped } from "./executionContext";

export interface SparrowGraphDependencies {
  tools: Map<string, any>;
  checkpointer: BaseCheckpointSaver;
  now?: () => number;
  onThinkingUpdate?: (steps: SparrowThinkingStep[]) => void;
  agents?: {
    resolve: typeof QueryResolver.resolveQuery;
    plan: typeof AnalysisPlanner.createPlan;
    respond: typeof InsightsResponder.generateResponse;
  };
}

export const MAX_TOOL_CALLS = 20;
export const MAX_RECTIFICATIONS = 5;

function safeJsonSerialize<T>(value: T): T {
  if (value === null || value === undefined) return value;
  try {
    return JSON.parse(
      JSON.stringify(value, (_key, val) =>
        typeof val === "bigint"
          ? Number.isSafeInteger(Number(val)) ? Number(val) : val.toString()
          : val instanceof Error
            ? { message: val.message, name: val.name, stack: val.stack }
            : val
      )
    );
  } catch {
    return String(value) as unknown as T;
  }
}

export function createSparrowNodes(deps: SparrowGraphDependencies) {
  setupTimestampedLogging();
  let liveThinking: SparrowThinkingStep[] = [];
  const agents = deps.agents ?? {
    resolve: QueryResolver.resolveQuery, plan: AnalysisPlanner.createPlan, respond: InsightsResponder.generateResponse,
  };
  const toolCatalog = Array.from(deps.tools, ([name, tool]) => ({
    name, description: tool.description, parameters: toJsonSchema(tool.schema),
  }));
  const getToolResults = (state: SparrowState): ExecutionToolResult[] =>
    compactToolResults(Array.isArray(state?.toolResults) ? state.toolResults : []);

  const report = (state: SparrowState, text: string, done = true) => {
    throwIfSparrowStopped();
    if (state.thinking?.length > liveThinking.length) liveThinking = [...state.thinking];
    const timestamp = new Date();
    liveThinking = [...liveThinking, { time: timestamp.toLocaleTimeString("en-GB", { hour12: false }), timestamp: timestamp.toISOString(), text, done, status: done ? "completed" as const : "running" as const }].slice(-400);
    console.info(`[Sparrow] ${text}`);
    deps.onThinkingUpdate?.([...liveThinking]);
    return [...liveThinking];
  };
  const begin = (state: SparrowState, text: string) => {
    liveThinking = liveThinking.map(step => ({ ...step, done: true, status: "completed" }));
    report(state, text, false);
  };
  const progress = (state: SparrowState, node: string, text: string) => {
    liveThinking = liveThinking.map(step => ({ ...step, done: true, status: "completed" }));
    return { thinking: report(state, text), history: [{ node, summary: text }] };
  };
  const executionContext = (state: SparrowState, repairing = false) => {
    const toolResults = getToolResults(state);
    return {
      userQuery: state.userQuery, messages: Array.isArray(state.messages) ? state.messages : [], memory: compactMemory(state.memory),
      clarificationAnswer: state.clarificationAnswer,
      clarificationHistory: state.clarificationHistory,
      toolResults, previousPlan: state.plan, toolCatalog,
      toolSchemas: Array.from(deps.tools, ([name, tool]) => ({ name, schema: tool.schema })),
      repairing, remainingToolCalls: MAX_TOOL_CALLS - state.toolCalls,
      intentDefinition: (Array.isArray(state.intentCatalog) ? state.intentCatalog : []).find((intent) => intent.code === state.queryUnderstanding?.intent),
      inferenceCapabilities: { segmentFilters: false, featureScenarioChanges: false },
    };
  };

  const execute = async (name: string, args: Record<string, unknown>, state: SparrowState): Promise<ExecutionToolResult> => {
    try {
      const instance = deps.tools.get(name);
      if (!instance) throw new Error(`Unregistered tool '${name}'.`);
      if (name === "web_search" && !process.env.TAVILY_API_KEY) {
        throw new Error("External search is unavailable because no search provider is configured.");
      }
      if (name === "runModelInference") {
        const intent = (Array.isArray(state.intentCatalog) ? state.intentCatalog : []).find((item) => item.code === state.queryUnderstanding?.intent);
        if (!intent?.allowsInference) throw new Error("The resolved intent does not permit model inference.");
        if (state.queryUnderstanding?.filters?.length || state.queryUnderstanding?.scenarioChanges?.length) {
          throw new Error("The current inference engine does not apply segment filters or feature scenario changes. Do not substitute an unfiltered forecast.");
        }
        const understanding = state.queryUnderstanding;
        const directTarget = !understanding?.targetMetric || !state.projectContext.targetColumn
          || understanding.targetMetric.toLowerCase().trim() === state.projectContext.targetColumn.toLowerCase().trim();
        const supportedDerivation = understanding?.metricRelationship === "derived" && !!understanding.derivation?.rationale.trim()
          && understanding.derivation.forecastTarget === state.projectContext.targetColumn;
        if (understanding?.metricRelationship === "unsupported" || (!directTarget && !supportedDerivation)) {
          throw new Error(`The trained project target is '${state.projectContext.targetColumn}', which differs from the requested metric.`);
        }
        if (!getToolResults(state).some((item) => item.toolName === "discoverAvailableModels" && item.success)) {
          throw new Error("Discover available models before inference.");
        }
      }
      const parsedArgs = await instance.schema.parseAsync(args);
      if (name === "runModelInference" && state.queryUnderstanding?.timeRange?.horizon && parsedArgs.predictionHorizon !== state.queryUnderstanding.timeRange.horizon) {
        throw new Error("Inference horizon must match the resolved user request.");
      }
      if (name === "runModelInference" && state.queryUnderstanding?.timeRange?.startDate) {
        parsedArgs.requestedStartDate = state.queryUnderstanding.timeRange.startDate;
      }
      if (name === "runModelInference" && state.queryUnderstanding?.timeRange?.frequency && parsedArgs.predictionFrequency !== state.queryUnderstanding.timeRange.frequency) {
        throw new Error("Inference frequency must match the resolved request.");
      }
      if (name === "runModelInference" && parsedArgs.historyEvidenceIndex !== undefined) {
        const coverage = getToolResults(state)[parsedArgs.historyEvidenceIndex];
        const lastDate = coverage?.data?.rows?.[0]?.[parsedArgs.historyEndColumn];
        if (!coverage?.success || coverage.toolName !== "queryProjectData" || coverage.data?.rows?.length !== 1 || !lastDate) {
          throw new Error("Inspect MAX(date) coverage through a successful query before forecasting across the data gap.");
        }
        const origin = advancePeriod(dateOnly(String(lastDate).slice(0, 10)), parsedArgs.predictionFrequency).toISOString().slice(0, 10);
        if (parsedArgs.predictionObjectiveStartDate !== origin) throw new Error(`Inference must start after observed history at ${origin}, then bridge to the requested window.`);
      }
      const previousFailure = getToolResults(state).find((result) => !result.success && result.toolName === name && JSON.stringify(result.args) === JSON.stringify(parsedArgs));
      if (previousFailure) throw new Error("Identical failed call rejected; correct its parameters or explain the limitation.");
      let data = instance.invokeWithContext
        ? await instance.invokeWithContext(parsedArgs, state, { onProgress: (text: string) => report(state, text) })
        : await instance.invoke(parsedArgs);
      if (typeof data === "string") {
        try { data = JSON.parse(data); } catch { throw new Error(data); }
      }
      if (!data || typeof data !== "object") throw new Error("Tool returned no structured result.");
      if (name === "runModelInference" && data.success !== false && state.projectContext.targetColumn && data.targetColumn !== state.projectContext.targetColumn) {
        throw new Error("Inference returned a target that does not match the inspected trained target.");
      }
      const cleanData = safeJsonSerialize(data);
      const cleanArgs = safeJsonSerialize(parsedArgs);
      return {
        toolName: name, args: cleanArgs, executedAt: new Date().toISOString(),
        success: cleanData.success !== false && !cleanData.error,
        data: cleanData, error: cleanData.success === false || cleanData.error ? (cleanData.error || cleanData.message || "Tool execution failed.") : undefined,
      };
    } catch (error) {
      throwIfSparrowStopped();
      return { toolName: name, args: safeJsonSerialize(args), success: false, error: error instanceof Error ? error.message : String(error), executedAt: new Date().toISOString() };
    }
  };

  const decide = async (state: SparrowState, repairing: boolean): Promise<Partial<SparrowState>> => {
    begin(state, repairing ? "Reviewing the execution failure and choosing a correction." : "Reviewing the evidence and choosing the next action.");
    try {
      const plan = analysisPlanSchema.parse(await agents.plan(state.queryUnderstanding!, compactProjectContext(state.projectContext), executionContext(state, repairing)));
      if (plan.action === "tool" && !deps.tools.has(plan.steps[0].toolName)) {
        throw new Error(`Planner selected unregistered tool '${plan.steps[0].toolName}'.`);
      }
      const trace = progress(state, "supervisor", `Decision: ${plan.rationale}`);
      return { ...trace, plan, decisionReady: true, hitlState: plan.clarification ?? null,
        ...(plan.action === "clarify" ? { interaction: createClarificationInteraction(deps.now?.()) } : {}) };
    } catch (error) {
      throwIfSparrowStopped();
      // Preserve invalid planning as a real failure and let the rectifier see it.
      const failure: ExecutionToolResult = {
        toolName: "analysisPlanner", success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      return { ...progress(state, "supervisor", "Could not select a valid action; reviewing the planning failure."), plan: null, decisionReady: false, toolResults: [...getToolResults(state), failure] };
    }
  };

  return {
    supervisorNode: async (state: SparrowState): Promise<Partial<SparrowState>> => {
      if (state.response) return { nextAction: "finish" as const };
      if (!state.queryUnderstanding) return { nextAction: "resolve" as const };
      const understanding = state.queryUnderstanding;
      if (!understanding.isGeneralConversation && !understanding.isProjectIrrelevant && !state.contextInspected) {
        return { nextAction: "context" as const };
      }
      if (state.toolCalls >= MAX_TOOL_CALLS) {
        return { nextAction: "respond" as const, stopReason: "Execution limit reached. Report available evidence and remaining gaps." };
      }
      const toolResults = getToolResults(state);
      const latest = toolResults[toolResults.length - 1];
      if (latest?.success === false && toolResults.length > state.correctedResultsCount) {
        if (state.rectifications >= MAX_RECTIFICATIONS) {
          return { nextAction: "respond" as const, stopReason: "Correction limit reached. Explain the unresolved failure and any partial results." };
        }
        return { nextAction: "rectify" as const };
      }
      const update = state.decisionReady ? {} : await decide(state, false);
      const plan = update.plan ?? state.plan;
      if (update.decisionReady === false) return { ...update, nextAction: "rectify" as const };
      return { ...update, nextAction: plan!.action!, decisionReady: false };
    },
    queryResolverNode: async (state: SparrowState): Promise<Partial<SparrowState>> => {
      begin(state, "Interpreting your request and identifying the required evidence.");
      const clockContext = { ...compactProjectContext(state.projectContext), currentDate: new Date(deps.now?.() ?? Date.now()).toISOString().slice(0, 10) };
      const understanding = await agents.resolve(state.userQuery, clockContext, state.messages, state.intentCatalog, {
        ...compactMemory(state.memory), clarificationAnswer: state.clarificationAnswer, pendingUnderstanding: state.queryUnderstanding,
        clarificationHistory: state.clarificationHistory,
      });
      if (state.intentCatalog.find(intent => intent.code === understanding.intent)?.allowsInference) {
        understanding.timeRange = resolveForecastRange(understanding.timeRange, deps.now?.() ?? Date.now());
      }
      return { projectContext: clockContext, queryUnderstanding: understanding, ...progress(state, "queryResolver", "Interpreted your request in its conversation and project context.") };
    },
    projectContextNode: async (state: SparrowState): Promise<Partial<SparrowState>> => {
      begin(state, "Inspecting project metadata and available data.");
      const metadata = await execute("getProjectContext", {}, state);
      const schema = await execute("getProjectDataSchema", {}, state);
      return {
        projectContext: compactProjectContext({
          ...state.projectContext, ...(metadata.success ? metadata.data : {}),
          tables: schema.success ? schema.data.tables : [],
          schemaError: schema.error, dataFiles: schema.success ? schema.data.dataFiles : [],
        }),
        toolResults: [...getToolResults(state), metadata, schema], toolCalls: state.toolCalls + 2,
        contextInspected: true, queryUnderstanding: null,
        ...progress(state, "projectContext", "Inspected available project metadata and data schema."),
      };
    },
    toolExecutorNode: async (state: SparrowState): Promise<Partial<SparrowState>> => {
      const step = state.plan!.steps[0];
      begin(state, `${step.toolName}: ${step.description}`);
      const result = await execute(step.toolName, step.args, state);
      const projectContext = result.success && step.toolName === "getProjectDataSchema"
        ? { ...state.projectContext, tables: result.data.tables, dataFiles: result.data.dataFiles, schemaError: undefined }
        : result.success && step.toolName === "getProjectContext"
          ? { ...state.projectContext, ...result.data } : state.projectContext;
      return { projectContext: compactProjectContext(projectContext), toolResults: [...getToolResults(state), result], toolCalls: state.toolCalls + 1,
        ...progress(state, "toolExecutor", result.success ? `Completed ${step.toolName}.` : `${step.toolName} could not complete; reviewing the failure.`) };
    },
    programRectificationNode: async (state: SparrowState): Promise<Partial<SparrowState>> => {
      const update = await decide(state, true);
      return { ...update, rectifications: state.rectifications + 1,
        correctedResultsCount: getToolResults(state).length,
        ...progress(state, "programRectification", "Reassessed the failed operation using available schema and results.") };
    },
    clarificationNode: async (state: SparrowState): Promise<Partial<SparrowState>> => {
      // LangGraph saves the pending task; only the checkpoint token leaves the server.
      const prompt = clarificationSchema.parse(state.hitlState);
      progress(state, "clarification", `Waiting for clarification: ${prompt.question}`);
      const resumed = interrupt(prompt);
      const answer = typeof resumed === "string" ? resumed : resumed?.answer;
      const interaction = typeof resumed === "object" && resumed?.interaction ? resumed.interaction : state.interaction;
      if (typeof answer !== "string" || !answer.trim()) throw new Error("Clarification answer is required.");
      return {
        clarificationAnswer: answer.trim(), queryUnderstanding: null, plan: null, hitlState: null, decisionReady: false,
        intentCatalog: typeof resumed === "object" && Array.isArray(resumed?.intentCatalog) ? resumed.intentCatalog : state.intentCatalog,
        interaction: interaction ? { ...interaction, status: "answered", answeredAt: new Date(deps.now?.() ?? Date.now()).toISOString() } : null,
        clarificationHistory: [...(Array.isArray(state.clarificationHistory) ? state.clarificationHistory : []), ...(interaction
          ? [{ id: interaction.id, question: prompt.question, answer: answer.trim() }] : [])].slice(-24),
        messages: [...(Array.isArray(state.messages) ? state.messages : []), { role: "assistant" as const, content: state.hitlState!.question }, { role: "user" as const, content: answer.trim() }].slice(-24),
        ...progress(state, "clarification", "Received clarification; continuing with preserved results."),
      };
    },
    responderNode: async (state: SparrowState): Promise<Partial<SparrowState>> => {
      begin(state, "Preparing your answer from the collected evidence.");
      const plan: AnalysisPlan = state.plan ?? { action: "respond", planType: "general_response", steps: [], rationale: state.stopReason || "Answer with available context." };
      const toolResults = getToolResults(state);
      const response = await agents.respond(state.userQuery, state.queryUnderstanding!, plan, toolResults, compactProjectContext(state.projectContext), state.thinking, {
        ...compactMemory(state.memory), messages: state.messages, clarificationAnswer: state.clarificationAnswer, stopReason: state.stopReason,
        clarificationHistory: state.clarificationHistory,
      });
      const update = progress(state, "responder", "Prepared an answer from the available evidence.");
      return {
        ...update, response: { ...response, thinking: update.thinking },
        messages: [...(Array.isArray(state.messages) ? state.messages : []), { role: "assistant" as const, content: response.content }].slice(-24),
        memory: {
          previousUnderstanding: state.queryUnderstanding,
          previousQuery: state.userQuery, previousAnswer: response.content,
          // Prior-turn evidence is explicitly dated and never passed as a fresh result.
          previousEvidence: [
            ...(Array.isArray(state.memory?.previousEvidence) ? state.memory.previousEvidence : []),
            ...toolResults.filter((result) => result.success && !["getProjectContext", "getProjectDataSchema"].includes(result.toolName)),
          ].slice(-12),
          recordedAt: new Date().toISOString(),
        },
      };
    },
  };
}
