import assert from "node:assert/strict";
import { test } from "node:test";
import { Command, MemorySaver } from "@langchain/langgraph";
import { z } from "zod";
import { advancePeriod, dateOnly, forecastWindow, resolveForecastRange, selectForecastPeriods } from "../agents/sparrow/forecastWindow";
import { createRunModelInferenceTool } from "../agents/sparrow/tools/modelInference.tools";
import { createCalculateMetricTool } from "../agents/sparrow/tools/calculation.tools";
import { createGetProjectContextTool } from "../agents/sparrow/tools/projectContext.tools";
import { createSparrowGraph } from "../agents/sparrow/graph";
import { ModelValidationAgent } from "../agents/ModelTrainingValidation/ModelValidation/modelValidationAgent";

const now = Date.parse("2026-10-09T12:00:00Z");
const monthly = { anchor: "calendar" as const, horizon: 3, frequency: "Monthly", startDate: "2026-01-01" };
const intents = [{ code: "PREDICT", allowsInference: true, conversational: false, description: "Forecast" }];
const understanding = { intent: "PREDICT", targetMetric: "revenue", timeRange: monthly, responseStyle: "brief" as const,
  metricRelationship: "derived" as const,
  derivation: { forecastTarget: "Order_Quantity", rationale: "Sold units multiplied by an applicable unit price", requiredInputs: ["unit price"] },
  isGeneralConversation: false, isProjectIrrelevant: false, needsClarification: false };
const request = { predictionObjectiveStartDate: "2026-01-01", requestedStartDate: "2026-11-01",
  predictionHorizon: 3, predictionFrequency: "Monthly" as const, selectedModels: ["m1"], historyEvidenceIndex: 2, historyEndColumn: "history_end" };

function inferenceFixture(missing = false) {
  const calls: any[] = [];
  const tool = createRunModelInferenceTool("p1", {
    projectService: { getById: async () => ({ agentState: { splitDate: "2025-01-01", modelValidation: { report: "DO_NOT_SEND" } } }) } as any,
    modelValidationService: {
      getValidationCandidates: async () => ({ candidates: [{ model_id: "m1" }] }),
      validateModels: async () => { throw new Error("Sparrow must never launch validation."); },
    } as any,
    executionService: {
      execute: async (request: any) => {
        const input = request.prediction;
        calls.push(input);
        const count = input.predictionHorizon - (missing ? 1 : 0);
        const dates = Array.from({ length: count }, (_, index) => advancePeriod(dateOnly(input.predictionObjectiveStartDate), input.predictionFrequency, index).toISOString().slice(0, 10));
        return { success: true, output: {
          targetColumn: "Order_Quantity", modelResults: [{ modelId: "m1",
            periods: dates.map((period, index) => ({ period, predicted: (index + 1) * 10 })) }],
        } };
      },
    } as any,
  });
  return { tool, calls };
}

test("calendar months use the request date; explicit and dataset-relative windows stay distinct", () => {
  for (const clock of [now, Date.parse("2026-10-10T12:00:00Z")]) {
    assert.deepEqual(resolveForecastRange(monthly, clock), { ...monthly, startDate: "2026-11-01", endDate: "2027-01-31" });
  }
  assert.equal(resolveForecastRange({ ...monthly, anchor: "explicit", startDate: "2027-04-01" }, now)?.startDate, "2027-04-01");
  assert.equal(resolveForecastRange({ ...monthly, anchor: "latest_data" }, now)?.startDate, "2026-01-01");
  assert.equal(resolveForecastRange({ ...monthly, frequency: "months" }, now)?.frequency, "Monthly");
  assert.equal(resolveForecastRange({ ...monthly, anchor: "latest_data", frequency: "months" }, now)?.frequency, "Monthly");
  assert.equal(resolveForecastRange({ anchor: "calendar", horizon: 2, frequency: "Weekly" }, now)?.startDate, "2026-10-12");
  assert.equal(resolveForecastRange({ anchor: "calendar", horizon: 2, frequency: "Yearly" }, now)?.endDate, "2028-12-31");
});

test("execution bridges January 2026 to January 2027 but returns only November through January", async () => {
  const f = inferenceFixture();
  const result: any = await f.tool.invoke(request);
  assert.equal(result.success, true);
  assert.equal(f.calls[0].predictionObjectiveStartDate, "2026-01-01");
  assert.equal(f.calls[0].predictionHorizon, 13);
  assert.equal(f.calls[0].executionMode, undefined);
  assert.deepEqual(result.modelResults[0].periods, [
    { period: "2026-11-01", predicted: 110 }, { period: "2026-12-01", predicted: 120 }, { period: "2027-01-01", predicted: 130 },
  ]);
  assert.equal(result.modelResults[0].forecastTotal, 360);
  assert.equal(result.startDate, "2026-11-01");
  assert.equal(JSON.stringify(result).includes("999999"), false);
  assert.equal(JSON.stringify(result).includes("DO_NOT_SEND"), false);
  assert.equal(result.modelResults[0].score, undefined);
});

test("calendar-past unobserved bridge periods execute as predictions rather than backtests", () => {
  assert.equal(ModelValidationAgent.determineValidationMode("2026-01-01", "2026-10-09", "future_prediction"), "future_prediction");
  assert.equal(ModelValidationAgent.determineValidationMode("2026-01-01", "2026-10-09"), "backtesting");
});

test("partial, duplicate and invalid dated forecasts fail instead of relabeling or fabricating months", async () => {
  const f = inferenceFixture(true);
  const result: any = await f.tool.invoke(request);
  assert.equal(result.success, false);
  assert.match(result.error, /every requested forecast period/);
  assert.throws(() => forecastWindow("2026-12-01", "2026-11-01", 3, "Monthly"), /precedes/);
  assert.throws(() => forecastWindow("1900-01-01", "2026-11-01", 3, "Monthly"), /1000/);
  assert.throws(() => dateOnly("2026-02-30"), /Invalid/);
  assert.throws(() => selectForecastPeriods({ dates: ["2026-11-01", "2026-11-01"], predictedSeries: [1, 2] }, dateOnly("2026-11-01"), dateOnly("2027-01-01"), 2, "Monthly"), /every requested/);
});

const userCalculation = (forecastIndex: number) => ({
  purpose: "Estimate revenue from forecast sold units and the user-supplied unit price",
  assumptions: ["The supplied price applies to every forecast month."],
  bindings: [
    { name: "units", input: { source: "tool" as const, resultIndex: forecastIndex, path: ["modelResults", "0", "periods", "*", "predicted"] } },
    { name: "price", input: { source: "user" as const, value: 40, quote: "40 INR" } },
  ],
  calculations: [
    { name: "monthly_revenue", operation: "multiply" as const, inputs: ["units", "price"] },
    { name: "total_revenue", operation: "sum" as const, inputs: ["monthly_revenue"] },
  ],
  outputs: [{ name: "total_revenue", label: "Estimated revenue", unit: "INR" }],
});

test("project inspection omits training/validation state, model rankings and stale objectives", async () => {
  const tool = createGetProjectContextTool("p1", { projectService: {
    getById: async () => ({ id: "p1", name: "Retail", agentState: {
      targetColumn: "Order_Quantity", modelTraining: { report: "DO_NOT_SEND" }, modelValidation: { report: "DO_NOT_SEND" },
      stageStatuses: { modelValidation: "DO_NOT_SEND" }, splitDate: "2025-01-01", modelSelection: { candidates: { bad: "DO_NOT_SEND" } },
    } }), getProjectWithWorkspace: async () => ({ workspaceName: "Retail" }),
  } as any, duckDBService: {} as any });
  const result: any = await tool.invoke({});
  assert.equal(result.targetColumn, "Order_Quantity");
  assert.equal(JSON.stringify(result).includes("DO_NOT_SEND"), false);
  assert.equal(result.predictionObjectiveStartDate, undefined);
});

function conversationFixture() {
  const inference = inferenceFixture();
  const tools = new Map<string, any>([
    ["getProjectContext", { schema: z.object({}), description: "Project", invoke: async () => ({ success: true, targetColumn: "Order_Quantity" }) }],
    ["getProjectDataSchema", { schema: z.object({}), description: "Schema", invoke: async () => ({ success: true, tables: [{ tableName: "orders", columns: [{ name: "date", type: "DATE" }, { name: "Order_Quantity", type: "DOUBLE" }] }] }) }],
    ["queryProjectData", { schema: z.object({ sql: z.string() }), description: "Coverage", invoke: async () => ({ success: true, rows: [{ history_end: "2025-12-31" }] }) }],
    ["discoverAvailableModels", { schema: z.object({}), description: "Models", invoke: async () => ({ success: true, models: [{ modelId: "m1" }] }) }],
    ["runModelInference", inference.tool], ["calculateMetric", createCalculateMetricTool()],
  ]);
  const graph = createSparrowGraph({ tools, now: () => now, checkpointer: new MemorySaver(), agents: {
    resolve: async (_query, context, _history, _intents, memory: any) => {
      assert.equal(JSON.stringify(context).includes("DO_NOT_SEND"), false);
      assert.equal(JSON.stringify(memory).includes("DO_NOT_SEND"), false);
      return { ...understanding };
    },
    plan: async (under, context, execution: any) => {
      assert.equal(context.currentDate, "2026-10-09");
      assert.equal(under.timeRange?.startDate, "2026-11-01");
      const results = execution.toolResults;
      const step = (toolName: string, args: any) => ({ action: "tool" as const, planType: "model_inference" as const, rationale: "Next evidence", steps: [{ toolName, args, description: "Evidence" }] });
      if (!results.some((r: any) => r.toolName === "queryProjectData")) return step("queryProjectData", { sql: "SELECT MAX(date) AS history_end FROM orders" });
      if (!execution.clarificationAnswer) return { action: "clarify", planType: "clarification", steps: [], rationale: "No price field in schema", clarification: { question: "What unit price should I use? You can decline and receive units and a formula.", missingField: "unitPrice" } };
      if (!results.some((r: any) => r.toolName === "discoverAvailableModels")) return step("discoverAvailableModels", {});
      if (!results.some((r: any) => r.toolName === "runModelInference")) return step("runModelInference", request);
      if (execution.clarificationAnswer !== "No" && !results.some((r: any) => r.toolName === "calculateMetric")) return step("calculateMetric", userCalculation(results.findIndex((r: any) => r.toolName === "runModelInference" && r.success)));
      return { action: "respond", planType: "model_inference", steps: [], rationale: "Request answered" };
    },
    respond: async (_q, under, _p, results) => {
      const revenue = results.find(r => r.toolName === "calculateMetric" && r.success);
      return { status: "complete", thinking: [], content: !revenue
        ? "November–January: 360 units. Revenue = forecast units × unit price."
        : `November–January estimated revenue: ${revenue?.data.outputs.find((output: any) => output.name === "total_revenue").value} INR.` };
    },
  } });
  const seed = { projectId: "p1", userQuery: "Predict revenue for the next three months", intentCatalog: intents,
    projectContext: { targetColumn: "Order_Quantity", availableModels: "DO_NOT_SEND", modelValidation: "DO_NOT_SEND" },
    memory: { fullTrainingState: "DO_NOT_SEND", previousEvidence: [] } };
  return { graph, seed, calls: inference.calls };
}

for (const answer of ["40 INR", "No"]) {
  test(`price clarification resumes preserved evidence with answer ${answer}`, async () => {
    const f = conversationFixture();
    const config = { configurable: { thread_id: `price-${answer}` }, recursionLimit: 80 };
    await f.graph.invoke(f.seed, config);
    const paused = await f.graph.getState(config);
    assert.ok(paused.tasks.some(task => task.interrupts?.length));
    assert.ok(paused.values.thinking.some((step: any) => step.text.includes("Decision: No price field")));
    assert.ok(paused.values.thinking.every((step: any) => step.done && Number.isFinite(Date.parse(step.timestamp!))));
    const result = await f.graph.invoke(new Command({ resume: answer }), config);
    assert.equal(result.response?.status, "complete");
    assert.equal(result.toolResults.filter(r => r.toolName === "queryProjectData").length, 1);
    assert.equal(f.calls[0].predictionHorizon, 13);
    assert.equal(result.toolResults.some(r => !r.success), false);
    if (answer === "No") {
      assert.match(result.response!.content, /360 units.*Revenue =/);
      assert.equal(result.toolResults.some(r => r.toolName === "calculateMetric"), false);
    } else assert.match(result.response!.content, /14400 INR/);
  });
}
