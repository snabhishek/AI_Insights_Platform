import { BaseCheckpointSaver, interrupt } from "@langchain/langgraph";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { AnalysisPlanner, analysisPlanSchema } from "./analysisPlanner";
import { InsightsResponder } from "./insightsResponder";
import { QueryResolver } from "./queryResolver";
import { SparrowState } from "./sparrowState";
import { AnalysisPlan, ExecutionToolResult, SparrowThinkingStep } from "./types";
import { clarificationSchema, createClarificationInteraction } from "./clarification";

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

export function createSparrowNodes(deps: SparrowGraphDependencies) {
  const agents = deps.agents ?? {
    resolve: QueryResolver.resolveQuery, plan: AnalysisPlanner.createPlan, respond: InsightsResponder.generateResponse,
  };
  const toolCatalog = Array.from(deps.tools, ([name, tool]) => ({
    name, description: tool.description, parameters: toJsonSchema(tool.schema),
  }));
  const progress = (state: SparrowState, node: string, text: string) => {
    const thinking = [...state.thinking, { time: `00:${String(state.thinking.length + 1).padStart(2, "0")}`, text, done: true }];
    deps.onThinkingUpdate?.(thinking);
    return { thinking, history: [{ node, summary: text }] };
  };
  const executionContext = (state: SparrowState, repairing = false) => ({
    userQuery: state.userQuery, messages: state.messages, memory: state.memory,
    clarificationAnswer: state.clarificationAnswer,
    toolResults: state.toolResults, previousPlan: state.plan, toolCatalog,
    toolSchemas: Array.from(deps.tools, ([name, tool]) => ({ name, schema: tool.schema })),
    repairing, remainingToolCalls: MAX_TOOL_CALLS - state.toolCalls,
    intentDefinition: state.intentCatalog.find((intent) => intent.code === state.queryUnderstanding?.intent),
    inferenceCapabilities: { segmentFilters: false, featureScenarioChanges: false },
  });

  const execute = async (name: string, args: Record<string, unknown>, state: SparrowState): Promise<ExecutionToolResult> => {
    try {
      const instance = deps.tools.get(name);
      if (!instance) throw new Error(`Unregistered tool '${name}'.`);
      if (name === "web_search" && !process.env.TAVILY_API_KEY) {
        throw new Error("External search is unavailable because no search provider is configured.");
      }
      if (name === "runModelInference") {
        const intent = state.intentCatalog.find((item) => item.code === state.queryUnderstanding?.intent);
        if (!intent?.allowsInference) throw new Error("The resolved intent does not permit model inference.");
        if (state.queryUnderstanding?.filters?.length || state.queryUnderstanding?.scenarioChanges?.length) {
          throw new Error("The current inference engine does not apply segment filters or feature scenario changes. Do not substitute an unfiltered forecast.");
        }
        if (state.queryUnderstanding?.targetMetric && state.projectContext.targetColumn && state.queryUnderstanding.targetMetric.toLowerCase() !== state.projectContext.targetColumn.toLowerCase()) {
          throw new Error(`The trained project target is '${state.projectContext.targetColumn}', which differs from the requested metric.`);
        }
        if (!state.toolResults.some((item) => item.toolName === "discoverAvailableModels" && item.success)) {
          throw new Error("Discover available models before inference.");
        }
      }
      const parsedArgs = await instance.schema.parseAsync(args);
      if (name === "runModelInference" && state.queryUnderstanding?.timeRange?.horizon && parsedArgs.predictionHorizon !== state.queryUnderstanding.timeRange.horizon) {
        throw new Error("Inference horizon must match the resolved user request.");
      }
      const previousFailure = state.toolResults.find((result) => !result.success && result.toolName === name && JSON.stringify(result.args) === JSON.stringify(parsedArgs));
      if (previousFailure) throw new Error("Identical failed call rejected; correct its parameters or explain the limitation.");
      let data = await instance.invoke(parsedArgs);
      if (typeof data === "string") {
        try { data = JSON.parse(data); } catch { throw new Error(data); }
      }
      if (!data || typeof data !== "object") throw new Error("Tool returned no structured result.");
      return {
        toolName: name, args: parsedArgs, executedAt: new Date().toISOString(),
        success: data.success !== false && !data.error,
        data, error: data.success === false || data.error ? (data.error || data.message || "Tool execution failed.") : undefined,
      };
    } catch (error) {
      return { toolName: name, args, success: false, error: error instanceof Error ? error.message : String(error), executedAt: new Date().toISOString() };
    }
  };

  const decide = async (state: SparrowState, repairing: boolean): Promise<Partial<SparrowState>> => {
    try {
      const plan = analysisPlanSchema.parse(await agents.plan(state.queryUnderstanding!, state.projectContext, executionContext(state, repairing)));
      if (plan.action === "tool" && !deps.tools.has(plan.steps[0].toolName)) {
        throw new Error(`Planner selected unregistered tool '${plan.steps[0].toolName}'.`);
      }
      return { plan, decisionReady: true, hitlState: plan.clarification ?? null,
        ...(plan.action === "clarify" ? { interaction: createClarificationInteraction(deps.now?.()) } : {}) };
    } catch (error) {
      // Preserve invalid planning as a real failure and let the rectifier see it.
      const failure: ExecutionToolResult = {
        toolName: "analysisPlanner", success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      return { plan: null, decisionReady: false, toolResults: [...state.toolResults, failure] };
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
      const latest = state.toolResults[state.toolResults.length - 1];
      if (latest?.success === false && state.toolResults.length > state.correctedResultsCount) {
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
      const understanding = await agents.resolve(state.userQuery, state.projectContext, state.messages, state.intentCatalog, {
        ...state.memory, clarificationAnswer: state.clarificationAnswer, pendingUnderstanding: state.queryUnderstanding,
      });
      return { queryUnderstanding: understanding, ...progress(state, "queryResolver", "Interpreted your request in its conversation and project context.") };
    },
    projectContextNode: async (state: SparrowState): Promise<Partial<SparrowState>> => {
      const metadata = await execute("getProjectContext", {}, state);
      const schema = await execute("getProjectDataSchema", {}, state);
      return {
        projectContext: {
          ...state.projectContext, ...(metadata.success ? metadata.data : {}),
          tables: schema.success ? schema.data.tables : [],
          schemaError: schema.error, dataFiles: schema.success ? schema.data.dataFiles : [],
        },
        toolResults: [...state.toolResults, metadata, schema], toolCalls: state.toolCalls + 2,
        contextInspected: true, queryUnderstanding: null,
        ...progress(state, "projectContext", "Inspected available project metadata and data schema."),
      };
    },
    toolExecutorNode: async (state: SparrowState): Promise<Partial<SparrowState>> => {
      const step = state.plan!.steps[0];
      const result = await execute(step.toolName, step.args, state);
      const projectContext = result.success && step.toolName === "getProjectDataSchema"
        ? { ...state.projectContext, tables: result.data.tables, dataFiles: result.data.dataFiles, schemaError: undefined }
        : result.success && step.toolName === "getProjectContext"
          ? { ...state.projectContext, ...result.data } : state.projectContext;
      return { projectContext, toolResults: [...state.toolResults, result], toolCalls: state.toolCalls + 1,
        ...progress(state, "toolExecutor", result.success ? `Completed ${step.toolName}.` : `${step.toolName} could not complete; reviewing the failure.`) };
    },
    programRectificationNode: async (state: SparrowState): Promise<Partial<SparrowState>> => {
      const update = await decide(state, true);
      return { ...update, rectifications: state.rectifications + 1,
        correctedResultsCount: state.toolResults.length,
        ...progress(state, "programRectification", "Reassessed the failed operation using available schema and results.") };
    },
    clarificationNode: async (state: SparrowState): Promise<Partial<SparrowState>> => {
      // LangGraph saves the pending task; only the checkpoint token leaves the server.
      const prompt = clarificationSchema.parse(state.hitlState);
      const resumed = interrupt(prompt);
      const answer = typeof resumed === "string" ? resumed : resumed?.answer;
      const interaction = typeof resumed === "object" && resumed?.interaction ? resumed.interaction : state.interaction;
      if (typeof answer !== "string" || !answer.trim()) throw new Error("Clarification answer is required.");
      return {
        clarificationAnswer: answer.trim(), queryUnderstanding: null, plan: null, hitlState: null, decisionReady: false,
        intentCatalog: typeof resumed === "object" && Array.isArray(resumed?.intentCatalog) ? resumed.intentCatalog : state.intentCatalog,
        interaction: interaction ? { ...interaction, status: "answered", answeredAt: new Date(deps.now?.() ?? Date.now()).toISOString() } : null,
        clarificationHistory: [...state.clarificationHistory, ...(interaction
          ? [{ id: interaction.id, question: prompt.question, answer: answer.trim() }] : [])].slice(-24),
        messages: [...state.messages, { role: "assistant" as const, content: state.hitlState!.question }, { role: "user" as const, content: answer.trim() }].slice(-24),
        ...progress(state, "clarification", "Received clarification; continuing with preserved results."),
      };
    },
    responderNode: async (state: SparrowState): Promise<Partial<SparrowState>> => {
      const plan: AnalysisPlan = state.plan ?? { action: "respond", planType: "general_response", steps: [], rationale: state.stopReason || "Answer with available context." };
      const response = await agents.respond(state.userQuery, state.queryUnderstanding!, plan, state.toolResults, state.projectContext, state.thinking, {
        ...state.memory, messages: state.messages, clarificationAnswer: state.clarificationAnswer, stopReason: state.stopReason,
      });
      const update = progress(state, "responder", "Prepared an answer from the available evidence.");
      return {
        ...update, response: { ...response, thinking: update.thinking },
        messages: [...state.messages, { role: "assistant" as const, content: response.content }].slice(-24),
        memory: {
          previousUnderstanding: state.queryUnderstanding,
          previousQuery: state.userQuery, previousAnswer: response.content,
          // Prior-turn evidence is explicitly dated and never passed as a fresh result.
          previousEvidence: [
            ...(Array.isArray(state.memory.previousEvidence) ? state.memory.previousEvidence : []),
            ...state.toolResults.filter((result) => result.success && !["getProjectContext", "getProjectDataSchema"].includes(result.toolName)),
          ].slice(-12),
          recordedAt: new Date().toISOString(),
        },
      };
    },
  };
}
