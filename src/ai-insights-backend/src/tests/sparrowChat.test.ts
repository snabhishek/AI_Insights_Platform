import assert from "node:assert/strict";
import { test } from "node:test";
import { Command, MemorySaver } from "@langchain/langgraph";
import { z } from "zod";
import { createSparrowGraph, SparrowGraphDependencies } from "../agents/sparrow/graph";
import { MAX_TOOL_CALLS, MAX_RECTIFICATIONS } from "../agents/sparrow/nodes";
import { analysisPlanSchema } from "../agents/sparrow/analysisPlanner";
import { validateUnderstanding } from "../agents/sparrow/queryResolver";
import { assertSafeReadOnlySql, createComparePeriodsTool } from "../agents/sparrow/tools/dataAnalysis.tools";
import { QueryUnderstanding } from "../agents/sparrow/types";
import { SparrowOrchestrator } from "../agents/sparrow/sparrowOrchestrator";
import { QueryResolver } from "../agents/sparrow/queryResolver";
import { AnalysisPlanner } from "../agents/sparrow/analysisPlanner";
import { InsightsResponder } from "../agents/sparrow/insightsResponder";
import { interactionAt } from "../agents/sparrow/clarification";
import { SparrowChatController } from "../controllers/sparrowChat.controller";
import { createRunModelInferenceTool } from "../agents/sparrow/tools/modelInference.tools";

const intents = [
  { code: "ANALYZE", description: "Analyze business data", allowsInference: false, conversational: false },
  { code: "CUSTOM_RETENTION", description: "Customer retention investigation", allowsInference: false, conversational: false },
];
const understanding: QueryUnderstanding = {
  intent: "ANALYZE", responseStyle: "detailed",
  isGeneralConversation: false, isProjectIrrelevant: false, needsClarification: false,
  requiresWebSearch: false, explanation: "Analyze revenue",
};
const toolPlan = (sql: string) => ({
  action: "tool" as const, planType: "data_analysis" as const,
  steps: [{ toolName: "queryProjectData", args: { sql }, description: "Calculate revenue" }], rationale: "Use observed revenue",
});
const responsePlan = { action: "respond" as const, planType: "data_analysis" as const, steps: [], rationale: "Evidence is sufficient" };
const config = (id: string) => ({ configurable: { thread_id: id }, recursionLimit: 80 });
const seed = {
  projectId: "p1", userQuery: "Compare revenue", projectContext: { projectId: "p1" },
  messages: [{ role: "user" as const, content: "Compare revenue" }], intentCatalog: intents,
};
function fakeTool(schema: any, invoke: (args: any) => Promise<any>) {
  return { schema, invoke, description: "Controlled test tool" };
}
function fixture(options: {
  saver?: MemorySaver; resolve?: any; plan?: any; query?: any; respond?: any; now?: () => number;
} = {}) {
  const saver = options.saver ?? new MemorySaver();
  const seen: any[] = [];
  const tools = new Map<string, any>([
    ["getProjectContext", fakeTool(z.object({}), async () => ({ success: true, projectName: "Retail" }))],
    ["getProjectDataSchema", fakeTool(z.object({}), async () => ({
      success: true, tables: [{ tableName: "transactions", columns: [{ name: "revenue", type: "DOUBLE" }] }],
    }))],
    ["queryProjectData", fakeTool(z.object({ sql: z.string() }), options.query ?? (async () => ({ success: true, rows: [{ total: 125 }] })))],
    ["runModelInference", fakeTool(z.object({}), async () => { throw new Error("Inference must not run"); })],
  ]);
  const deps: SparrowGraphDependencies = {
    checkpointer: saver, tools, now: options.now,
    agents: {
      resolve: options.resolve ?? (async () => understanding),
      plan: options.plan ?? (async (_under: any, context: any, execution: any) => {
        if (_under.needsClarification) return { action: "clarify", planType: "clarification", steps: [], rationale: "Resolve the missing business parameter",
          clarification: { question: _under.clarificationQuestion, missingField: _under.missingField, options: _under.clarificationOptions } };
        seen.push({ context, execution });
        return execution.toolResults.some((item: any) => item.toolName === "queryProjectData" && item.success)
          ? responsePlan : toolPlan("SELECT SUM(revenue) AS total FROM transactions");
      }),
      respond: options.respond ?? (async (_query: any, _under: any, _plan: any, results: any[]) => ({
        status: "complete", content: "Revenue is 125.", thinking: [], tables: [{ columns: ["total"], rows: results.find((item) => item.toolName === "queryProjectData" && item.success)?.data.rows ?? [] }],
      })),
    },
  };
  return { graph: createSparrowGraph(deps), deps, saver, seen };
}

test("schema-aware execution returns to the supervisor after each worker", async () => {
  const f = fixture();
  const result = await f.graph.invoke(seed, config("schema"));
  assert.equal(result.response?.content, "Revenue is 125.");
  assert.equal(f.seen.length, 2);
  assert.equal(f.seen[0].context.tables[0].columns[0].name, "revenue");
  assert.equal(f.seen[1].execution.toolResults.at(-1).data.rows[0].total, 125);
  assert.equal(result.nextAction, "finish");
  assert.deepEqual(result.history.map((item) => item.node), ["queryResolver", "projectContext", "queryResolver", "toolExecutor", "responder"]);
});

test("a tool failure is corrected using its error and schema before answering", async () => {
  let calls = 0;
  let repaired = false;
  const f = fixture({
    query: async () => ++calls === 1 ? { success: false, error: "Unknown column revenue_total" } : { success: true, rows: [{ total: 125 }] },
    plan: async (_u: any, context: any, execution: any) => {
      if (execution.repairing) {
        assert.equal(execution.toolResults.at(-1).error, "Unknown column revenue_total");
        assert.equal(context.tables[0].columns[0].name, "revenue");
        repaired = true;
        return toolPlan("SELECT SUM(revenue) AS total FROM transactions");
      }
      return calls ? responsePlan : toolPlan("SELECT SUM(revenue_total) FROM transactions");
    },
  });
  const result = await f.graph.invoke(seed, config("repair"));
  assert.equal(repaired, true);
  assert.equal(calls, 2);
  assert.equal(result.rectifications, 1);
  assert.equal(result.toolResults.filter((item) => item.toolName === "queryProjectData")[0].success, false);
  assert.ok(result.response);
});

test("clarification interrupts and resumes a newly compiled graph with preserved results", async () => {
  let resolvedAnswer = "";
  const f = fixture({
    resolve: async (_query: any, _ctx: any, _messages: any, _intents: any, memory: any) => {
      resolvedAnswer = memory.clarificationAnswer;
      return memory.clarificationAnswer ? { ...understanding, targetMetric: "revenue" } : {
        ...understanding, needsClarification: true, clarificationQuestion: "Which metric?", missingField: "targetMetric",
      };
    },
  });
  await f.graph.invoke(seed, config("hitl"));
  const paused = await f.graph.getState(config("hitl"));
  assert.equal(paused.tasks[0].interrupts[0].value.question, "Which metric?");
  assert.equal(paused.values.toolResults.length, 2);
  const restarted = createSparrowGraph(f.deps);
  const result = await restarted.invoke(new Command({ resume: "Revenue, compare all regions" }), config("hitl"));
  assert.equal(resolvedAnswer, "Revenue, compare all regions");
  assert.equal(result.toolResults.filter((item) => item.toolName === "getProjectDataSchema").length, 1);
  assert.equal(result.messages.at(-2)?.content, "Revenue, compare all regions");
  assert.ok(result.response);
});

test("repeated ambiguity remains interrupted rather than guessing the answer", async () => {
  const f = fixture({ resolve: async () => ({
    ...understanding, needsClarification: true, clarificationQuestion: "Which date range?", missingField: "timeRange",
  }) });
  await f.graph.invoke(seed, config("ambiguous"));
  await f.graph.invoke(new Command({ resume: "Not sure" }), config("ambiguous"));
  const paused = await f.graph.getState(config("ambiguous"));
  assert.equal(paused.tasks[0].interrupts[0].value.question, "Which date range?");
  assert.equal(paused.values.response, null);
});

test("clarification can discover grounded options before pausing", async () => {
  const f = fixture({
    resolve: async () => ({ ...understanding, needsClarification: true, clarificationQuestion: "Which regions?", missingField: "regions" }),
    query: async () => ({ success: true, rows: [{ region: "North" }, { region: "South" }] }),
    plan: async (_u: any, _ctx: any, execution: any) => {
      const rows = execution.toolResults.find((result: any) => result.toolName === "queryProjectData")?.data.rows;
      return rows ? { action: "clarify", planType: "clarification", steps: [], rationale: "Use observed region values",
        clarification: { question: "Which regions should I compare?", missingField: "regions", options: rows.map((row: any) => row.region) } }
        : toolPlan("SELECT DISTINCT region FROM transactions");
    },
  });
  await f.graph.invoke(seed, config("choices"));
  const paused = await f.graph.getState(config("choices"));
  assert.deepEqual(paused.tasks[0].interrupts[0].value.options, ["North", "South"]);
  assert.equal(paused.values.toolResults.filter((result: any) => result.toolName === "queryProjectData").length, 1);
});

test("100-second expiry survives restart and late answers resume without repeating workers", async (t) => {
  let now = Date.parse("2026-10-08T12:00:00Z");
  const f = fixture({ now: () => now,
    resolve: async (_q: any, _c: any, _h: any, _i: any, memory: any) => memory.clarificationAnswer ? understanding
      : { ...understanding, needsClarification: true, clarificationQuestion: "Which regions?", missingField: "regions" },
  });
  const thread = config("sparrow:p1:deadline");
  await f.graph.invoke(seed, thread);
  const paused = await f.graph.getState(thread);
  const original = paused.values.interaction!;
  assert.equal(Date.parse(original.expiresAt) - Date.parse(original.requestedAt), 100_000);
  assert.equal(interactionAt(original, now + 99_999).status, "waiting");
  now += 100_000;
  let heldLocks = 0;
  const orchestrator = new SparrowOrchestrator({
    projectService: { getById: async () => ({ id: "p1", name: "Retail" }) } as any,
    duckDBService: {} as any, modelValidationService: {} as any,
    checkpointer: f.saver, intentRepository: { getActiveIntents: async () => intents }, now: () => now,
    withConversationLock: async (_id, work) => { heldLocks++; try { return await work(); } finally { heldLocks--; } },
  });
  const expired = await orchestrator.getInteraction({ projectId: "p1", conversationId: "deadline" });
  assert.equal(expired.interaction?.status, "timed_out");
  assert.equal(expired.interaction?.id, original.id);
  assert.equal(heldLocks, 0);
  const afterExpiry = await f.graph.getState(thread);
  assert.equal(afterExpiry.tasks[0].interrupts.length, 1);
  assert.equal(afterExpiry.values.toolResults.length, paused.values.toolResults.length);
  assert.equal(afterExpiry.values.interaction?.expiresAt, original.expiresAt);
  t.mock.method(QueryResolver, "resolveQuery", async () => ({ ...understanding, filters: [{ column: "region", operator: "in", value: ["North", "South"] }] }));
  t.mock.method(AnalysisPlanner, "createPlan", async () => responsePlan);
  t.mock.method(InsightsResponder, "generateResponse", async () => ({ status: "complete", content: "Continued with preserved context.", thinking: [] }));
  await assert.rejects(() => orchestrator.run({ projectId: "p1", conversationId: "deadline", userQuery: "North", interactionId: "stale-id" }), /no longer pending/);
  const result = await orchestrator.run({ projectId: "p1", conversationId: "deadline", userQuery: "North and South", interactionId: original.id });
  assert.equal(result.status, "complete");
  assert.equal(heldLocks, 0);
  const finished = await f.graph.getState(thread);
  assert.equal(finished.values.toolResults.length, paused.values.toolResults.length);
  assert.equal(finished.values.messages.some((message: any) => message.content === "North and South"), true);
  assert.equal(finished.values.interaction?.status, "answered");
  const duplicate = await orchestrator.run({ projectId: "p1", conversationId: "deadline", userQuery: "North and South", interactionId: original.id });
  assert.equal(duplicate.content, result.content);
  assert.equal((await f.graph.getState(thread)).values.clarificationHistory.length, 1);
});

test("missing clarification parameters fail validation instead of using a default", () => {
  assert.throws(() => validateUnderstanding({ ...understanding, needsClarification: true, clarificationQuestion: "Which period?" }, intents), /missingField/);
  assert.throws(() => analysisPlanSchema.parse({ action: "clarify", planType: "clarification", steps: [], rationale: "Ambiguous",
    clarification: { question: " ", missingField: "period", options: [] } }));
  assert.throws(() => analysisPlanSchema.parse({ action: "clarify", planType: "clarification", steps: [], rationale: "Ambiguous",
    clarification: { question: "Which period?", missingField: "period", options: [""] } }));
});

test("retries after a second clarification or synthesis failure do not consume an answer twice", async (t) => {
  const resolve = async (_q: any, _c: any, _h: any, _i: any, memory: any) => memory.clarificationAnswer === "September"
    ? understanding : { ...understanding, needsClarification: true,
      clarificationQuestion: memory.clarificationAnswer ? "Which period?" : "Which regions?",
      missingField: memory.clarificationAnswer ? "period" : "regions" };
  const f = fixture({ resolve });
  const thread = config("sparrow:p1:retries");
  await f.graph.invoke(seed, thread);
  const first = (await f.graph.getState(thread)).values.interaction!;
  t.mock.method(QueryResolver, "resolveQuery", resolve);
  t.mock.method(AnalysisPlanner, "createPlan", async (under: any) => under.needsClarification
    ? { action: "clarify", planType: "clarification", steps: [], rationale: "Resolve the remaining parameter",
      clarification: { question: under.clarificationQuestion, missingField: under.missingField } } as any : responsePlan);
  let responses = 0;
  t.mock.method(InsightsResponder, "generateResponse", async () => {
    if (++responses === 1) throw new Error("Temporary synthesis failure");
    return { status: "complete", content: "Resumed September comparison.", thinking: [] };
  });
  const orchestrator = new SparrowOrchestrator({ projectService: { getById: async () => ({ id: "p1", name: "Retail" }) } as any,
    duckDBService: {} as any, modelValidationService: {} as any, checkpointer: f.saver,
    intentRepository: { getActiveIntents: async () => intents } });
  const input = { projectId: "p1", conversationId: "retries", userQuery: "North and South", interactionId: first.id };
  const second = await orchestrator.run(input);
  assert.equal(second.clarification?.question, "Which period?");
  assert.notEqual(second.interaction?.id, first.id);
  const duplicate = await orchestrator.run(input);
  assert.equal(duplicate.interaction?.id, second.interaction?.id);
  assert.equal((await f.graph.getState(thread)).values.clarificationHistory.length, 1);
  const reply = { ...input, userQuery: "September", interactionId: second.interaction!.id };
  await assert.rejects(() => orchestrator.run(reply), /Temporary synthesis/);
  const retried = await orchestrator.run(reply);
  assert.equal(retried.status, "complete");
  const finished = await f.graph.getState(thread);
  assert.equal(finished.values.clarificationHistory.length, 2);
  assert.equal(finished.values.toolResults.length, 2);
});

test("a checkpointed response failure can retry without rerunning completed analytics", async () => {
  let attempts = 0;
  let queryCalls = 0;
  const f = fixture({
    query: async () => { queryCalls++; return { success: true, rows: [{ total: 125 }] }; },
    respond: async () => {
      if (++attempts === 1) throw new Error("Temporary provider failure");
      return { status: "complete", content: "Revenue is 125.", thinking: [] };
    },
  });
  await assert.rejects(() => f.graph.invoke(seed, config("failed-response")), /Temporary provider failure/);
  const restarted = createSparrowGraph(f.deps);
  const result = await restarted.invoke(null, config("failed-response"));
  assert.equal(queryCalls, 1);
  assert.equal(attempts, 2);
  assert.equal(result.response?.content, "Revenue is 125.");
});

test("follow-up turns retain conversation memory while resetting current execution", async () => {
  let memory: any;
  const f = fixture({ resolve: async (_q: any, _c: any, _h: any, _i: any, m: any) => { memory = m; return understanding; } });
  await f.graph.invoke(seed, config("memory"));
  const first = await f.graph.getState(config("memory"));
  await f.graph.invoke({
    ...seed, userQuery: "What about next year?", messages: [...first.values.messages, { role: "user", content: "What about next year?" }],
    response: null, queryUnderstanding: null, plan: null, toolResults: [], contextInspected: false,
    decisionReady: false, thinking: [], toolCalls: 0, rectifications: 0, correctedResultsCount: 0,
  }, config("memory"));
  assert.equal(memory.previousQuery, "Compare revenue");
  assert.equal(memory.previousUnderstanding.intent, "ANALYZE");
  assert.ok(memory.recordedAt);
  assert.ok(memory.previousEvidence.length);
});

test("invalid tool decisions trigger bounded correction and truthful partial synthesis", async () => {
  let stopReason = "";
  const f = fixture({
    plan: async () => ({ ...toolPlan("unused"), steps: [{ toolName: "inventedTool", args: {}, description: "" }] }),
    respond: async (_q: any, _u: any, _p: any, results: any, _ctx: any, _thinking: any, memory: any) => {
      stopReason = memory.stopReason;
      assert.ok(results.some((item: any) => item.error?.includes("unregistered tool")));
      return { status: "complete", content: "The required operation could not complete.", thinking: [] };
    },
  });
  const result = await f.graph.invoke(seed, config("invalid"));
  assert.equal(result.rectifications, MAX_RECTIFICATIONS);
  assert.match(stopReason, /Correction limit/);
});

test("identical failed calls are not executed again", async () => {
  let calls = 0;
  const f = fixture({
    query: async () => { calls++; return { success: false, error: "Unavailable dataset" }; },
    plan: async () => toolPlan("SELECT SUM(revenue) FROM transactions"),
  });
  const result = await f.graph.invoke(seed, config("duplicate"));
  assert.equal(calls, 1);
  assert.equal(result.rectifications, MAX_RECTIFICATIONS);
  assert.ok(result.toolResults.some((item) => item.error?.includes("Identical failed call")));
});

test("execution budget stops a supervisor that keeps asking for more work", async () => {
  let sequence = 0;
  const f = fixture({ plan: async () => toolPlan(`SELECT ${++sequence} FROM transactions`) });
  const result = await f.graph.invoke(seed, config("budget"));
  assert.equal(result.toolCalls, MAX_TOOL_CALLS);
  assert.match(result.stopReason, /Execution limit/);
});

test("ordinary conversation does not inspect datasets", async () => {
  const f = fixture({
    resolve: async () => ({ ...understanding, isGeneralConversation: true }),
    plan: async () => ({ ...responsePlan, planType: "general_response" }),
  });
  const result = await f.graph.invoke(seed, config("greeting"));
  assert.equal(result.toolCalls, 0);
});

test("analytical intents cannot run model inference", async () => {
  const f = fixture({ plan: async () => ({ ...toolPlan(""), steps: [{ toolName: "runModelInference", args: {}, description: "Forbidden" }] }) });
  const result = await f.graph.invoke(seed, config("inference"));
  assert.ok(result.toolResults.some((item) => item.error?.includes("does not permit model inference")));
});

test("intent validation supports database additions and rejects unknown codes", () => {
  assert.equal(validateUnderstanding({ ...understanding, intent: "CUSTOM_RETENTION" }, intents).intent, "CUSTOM_RETENTION");
  assert.throws(() => validateUnderstanding({ ...understanding, intent: "invented" }, intents), /Unregistered/);
  assert.throws(() => validateUnderstanding({ ...understanding, isGeneralConversation: true }, intents), /Analytical intent/);
  assert.throws(() => validateUnderstanding({ ...understanding, needsClarification: true }, intents), /question/);
});

test("planner contract rejects static multi-step plans and empty tool decisions", () => {
  assert.throws(() => analysisPlanSchema.parse({ ...toolPlan("SELECT 1"), steps: [] }));
  assert.throws(() => analysisPlanSchema.parse({ ...toolPlan("SELECT 1"), steps: [...toolPlan("SELECT 1").steps, ...toolPlan("SELECT 2").steps] }));
  assert.throws(() => analysisPlanSchema.parse({ ...responsePlan, action: "clarify" }));
});

test("metadata-only follow-ups retain earlier analytical evidence", async () => {
  const f = fixture({ plan: async (_u: any, _ctx: any, execution: any) =>
    execution.memory.previousEvidence?.length || execution.toolResults.some((item: any) => item.toolName === "queryProjectData")
      ? responsePlan : toolPlan("SELECT SUM(revenue) FROM transactions") });
  await f.graph.invoke(seed, config("evidence"));
  const previous = await f.graph.getState(config("evidence"));
  const result = await f.graph.invoke({
    ...seed, userQuery: "Explain those results", messages: previous.values.messages,
    response: null, queryUnderstanding: null, plan: null, toolResults: [], contextInspected: false,
    toolCalls: 0, thinking: [], decisionReady: false,
  }, config("evidence"));
  assert.equal(result.toolResults.filter((item) => item.toolName === "queryProjectData").length, 0);
  assert.ok((result.memory.previousEvidence as any[]).some((item) => item.data.rows[0].total === 125));
});

test("inference does not silently ignore unsupported segment filters or scenarios", async () => {
  const f = fixture({
    resolve: async () => ({ ...understanding, intent: "PREDICT", scenarioChanges: [{ feature: "price", change: "+10%" }] }),
    plan: async () => ({ ...toolPlan(""), steps: [{ toolName: "runModelInference", args: {}, description: "Scenario" }] }),
  });
  const result = await f.graph.invoke({ ...seed, intentCatalog: [...intents, { code: "PREDICT", description: "Forecast", allowsInference: true, conversational: false }] }, config("scenario"));
  assert.ok(result.toolResults.some((item) => item.error?.includes("does not apply segment filters or feature scenario changes")));
  const inference = createRunModelInferenceTool("p1", { projectService: {} as any, modelValidationService: {} as any });
  const args = { predictionHorizon: 4, predictionFrequency: "Monthly", selectedModels: ["model1"] };
  await assert.rejects(() => inference.schema.parseAsync({ ...args, filters: { region: "North" } }));
  await assert.rejects(() => inference.schema.parseAsync({ ...args, predictionFrequency: "Daily" }));
});

test("read-only SQL rejects mutations, external sources and stacked statements", () => {
  assert.doesNotThrow(() => assertSafeReadOnlySql('WITH t AS (SELECT "revenue" FROM "transactions") SELECT SUM("revenue") FROM t;'));
  assert.doesNotThrow(() => assertSafeReadOnlySql("SELECT * FROM transactions WHERE region = 'DROP zone'"));
  for (const sql of [
    "COPY transactions TO 'outside.csv'", "ATTACH 'other.duckdb'", "SELECT 1; DELETE FROM transactions",
    "SELECT * FROM read_csv('private.csv')", "SELECT * FROM 'private.parquet'",
    'SELECT * FROM "read_parquet"(\'private.parquet\')', "SELECT * FROM transactions -- bypass",
  ]) assert.throws(() => assertSafeReadOnlySql(sql), sql);
});

test("missing period observations are not fabricated as zero", async () => {
  const tool = createComparePeriodsTool("p1", {
    projectService: { getById: async () => ({ name: "test" }), getProjectWithWorkspace: async () => ({ workspaceName: "test" }) } as any,
    duckDBService: { getProjectDuckDbPath: () => "unused", runQuery: async () => [{ current_total: null, prev_total: null }] } as any,
  });
  const result: any = await tool.invoke({ metricColumn: "revenue", timeColumn: "date", currentPeriodFilter: "TRUE", previousPeriodFilter: "FALSE", tableName: "transactions" });
  assert.equal(result.success, false);
  assert.match(result.error, /no matching observations/);
});

test("project and checkpoint boundaries are checked before any model invocation", async () => {
  const orchestrator = new SparrowOrchestrator({
    projectService: { getById: async (id: string) => id === "p1" ? { id: "p1" } : undefined } as any,
    duckDBService: {} as any, modelValidationService: {} as any,
    checkpointer: new MemorySaver(), intentRepository: { getActiveIntents: async () => intents },
  });
  await assert.rejects(() => orchestrator.run({ projectId: "missing", userQuery: "Query" }), /restricted/);
  await assert.rejects(() => orchestrator.run({ projectId: "p1", userQuery: "Query", executionState: { projectId: "other", threadId: "one" } }), /different project/);
  await assert.rejects(() => orchestrator.run({ projectId: "p1", userQuery: "Query", conversationId: "one", executionState: { threadId: "two" } }), /does not match/);
});

test("controller rejects a non-string query without invoking the agent", async () => {
  let status = 0;
  const controller = new SparrowChatController({ sendMessage: async () => { throw new Error("Must not invoke"); }, getInteraction: async () => ({}) });
  await controller.sendMessage({ body: { userQuery: {}, projectId: "p1" } } as any, {
    status: (value: number) => { status = value; return { json: () => {} }; },
  } as any);
  assert.equal(status, 400);
});

test("discoverAvailableModels handles dictionary candidates object without crashing", async () => {
  const { createDiscoverAvailableModelsTool } = await import("../agents/sparrow/tools/modelInference.tools");
  const tool = createDiscoverAvailableModelsTool("p1", {
    projectService: { getById: async () => ({ agentState: {} }) } as any,
    modelValidationService: {
      getValidationCandidates: async () => ({
        candidates: {
          lightgbm_sota: { model_id: "lightgbm_sota", display_name: "LightGBM Fast GBDT" },
          xgboost_sota: { model_id: "xgboost_sota", display_name: "XGBoost Optimized Trees" },
        },
        championModelId: "lightgbm_sota",
      }),
    } as any,
  });
  const res: any = await tool.invoke({});
  assert.equal(res.success, true);
  assert.equal(res.models.length, 2);
  assert.equal(res.championModelId, "lightgbm_sota");
  assert.equal(res.models[0].isChampion, true);
});

test("the supervisor can answer a derived request with a capability gap without a prescribed calculation", async () => {
  const predictIntents = [{ code: "PREDICT", description: "Forecast", allowsInference: true, conversational: false }];
  const f = fixture({
    resolve: async () => ({ ...understanding, intent: "PREDICT", targetMetric: "profit", metricRelationship: "derived",
      derivation: { forecastTarget: "units", rationale: "Units times contribution margin", requiredInputs: ["contribution margin"] } }),
    plan: async (_u: any, _c: any, execution: any) => execution.toolResults.some((result: any) => result.toolName === "discoverAvailableModels")
      ? { ...responsePlan, rationale: "No trained models are available; explain the gap without fabricating a forecast." }
      : { action: "tool", planType: "model_inference", steps: [{ toolName: "discoverAvailableModels", args: {}, description: "Inspect model availability" }], rationale: "Check actual capability" },
    respond: async () => ({ status: "complete", content: "No trained model is available to forecast units. A profit estimate also needs contribution margin.", thinking: [] }),
  });
  const tools = new Map(f.deps.tools);
  tools.set("discoverAvailableModels", fakeTool(z.object({}), async () => ({ success: true, models: [] })));
  const result = await createSparrowGraph({ ...f.deps, tools }).invoke({ ...seed, intentCatalog: predictIntents,
    projectContext: { targetColumn: "units" } }, config("derived-gap"));
  assert.match(result.response!.content, /No trained model/);
  assert.equal(result.toolResults.some(result => !result.success), false);
  assert.equal(result.toolResults.some(result => result.toolName === "calculateMetric"), false);
});

test("an agent-justified derived metric permits inference of the inspected trained target", async () => {
  const f = fixture({
    resolve: async () => ({ ...understanding, intent: "PREDICT", targetMetric: "Order_Value", metricRelationship: "derived", derivation: { forecastTarget: "Order_Quantity", rationale: "Forecast sold units, then use evidenced price when available", requiredInputs: ["unit price"] } }),
    plan: async () => ({
      action: "tool" as const, planType: "model_inference" as const,
      steps: [{ toolName: "runModelInference", args: { predictionHorizon: 3, predictionFrequency: "Monthly", selectedModels: ["m1"] }, description: "Inference" }],
      rationale: "Forecast volume to project revenue",
    }),
  });
  const predictIntents = [...intents, { code: "PREDICT", description: "Forecast", allowsInference: true, conversational: false }];
  // With discoverAvailableModels successful in toolResults, runModelInference should not throw metric mismatch
  const seedWithContext = {
    ...seed,
    intentCatalog: predictIntents,
    projectContext: { projectId: "p1", targetColumn: "Order_Quantity" },
  };
  const toolsWithDiscovery = new Map(f.deps.tools);
  toolsWithDiscovery.set("discoverAvailableModels", fakeTool(z.object({}), async () => ({ success: true, models: [] })));
  toolsWithDiscovery.set("runModelInference", fakeTool(
    z.object({ predictionHorizon: z.number(), predictionFrequency: z.string(), selectedModels: z.array(z.string()) }),
    async () => ({ success: true, forecastTotal: 1000 })
  ));
  const graph = createSparrowGraph({ ...f.deps, tools: toolsWithDiscovery });
  // First run discoverAvailableModels, then model inference
  let currentStep = 0;
  const multiStepGraph = createSparrowGraph({
    ...f.deps,
    tools: toolsWithDiscovery,
    agents: {
      ...f.deps.agents!,
      resolve: async () => ({ ...understanding, intent: "PREDICT", targetMetric: "Order_Value", metricRelationship: "derived", derivation: { forecastTarget: "Order_Quantity", rationale: "Forecast sold units, then use evidenced price when available", requiredInputs: ["unit price"] } }),
      plan: async (_u: any, _c: any, exec: any) => {
        if (!exec.toolResults.some((t: any) => t.toolName === "discoverAvailableModels")) {
          return { action: "tool" as const, planType: "model_inference" as const, steps: [{ toolName: "discoverAvailableModels", args: {}, description: "Discovery" }], rationale: "Discover" };
        }
        return currentStep++ === 0
          ? { action: "tool" as const, planType: "model_inference" as const, steps: [{ toolName: "runModelInference", args: { predictionHorizon: 3, predictionFrequency: "Monthly", selectedModels: ["m1"] }, description: "Inference" }], rationale: "Run inference" }
          : responsePlan;
      },
    },
  });
  const res = await multiStepGraph.invoke(seedWithContext, config("rev-vol-compat"));
  assert.ok(res.toolResults.some((t: any) => t.toolName === "runModelInference" && t.success));
});

