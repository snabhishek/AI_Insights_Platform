import assert from "node:assert/strict";
import { test } from "node:test";
import { createCalculateMetricTool, calculationSchema } from "../agents/sparrow/tools/calculation.tools";
import { validateUnderstanding } from "../agents/sparrow/queryResolver";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { decisionTransportSchema } from "../agents/sparrow/llm";

const tool = createCalculateMetricTool();
const state = {
  userQuery: "Estimate profit. Use a cost of 40 INR per unit.",
  clarificationAnswer: "", clarificationHistory: [],
  toolResults: [
    { toolName: "queryProjectData", success: true, args: { sql: "SELECT SUM(revenue)/NULLIF(SUM(units),0) AS price FROM orders" },
      executedAt: "2026-10-09T12:00:00Z", data: { rows: [{ price: 25, revenue: 9000, cost: 5400 }] } },
    { toolName: "runModelInference", success: true, data: {
      modelResults: [{ modelId: "m1", periods: [{ period: "2026-11-01", predicted: 110 },
        { period: "2026-12-01", predicted: 120 }, { period: "2027-01-01", predicted: 130 }] }],
    } },
  ],
} as any;

const revenuePlan = {
  purpose: "Estimate revenue using forecast sold units and observed realized unit price",
  assumptions: ["Hold the observed unit price constant during the forecast window."],
  bindings: [
    { name: "units", input: { source: "tool" as const, resultIndex: 1, path: ["modelResults", "0", "periods", "*", "predicted"] } },
    { name: "price", input: { source: "tool" as const, resultIndex: 0, path: ["rows", "0", "price"] } },
  ],
  calculations: [
    { name: "monthly", operation: "multiply" as const, inputs: ["units", "price"] },
    { name: "total", operation: "sum" as const, inputs: ["monthly"] },
  ],
  outputs: [
    { name: "monthly", label: "Estimated revenue", labels: { resultIndex: 1, path: ["modelResults", "0", "periods", "*", "period"] } },
    { name: "total", label: "Total estimated revenue" },
  ],
};

test("agent-authored revenue plan uses executed evidence, period labels and disclosed assumptions", async () => {
  const result = await tool.invokeWithContext(revenuePlan, state);
  assert.deepEqual(result.outputs[0].value, [2750, 3000, 3250]);
  assert.deepEqual(result.outputs[0].labels, ["2026-11-01", "2026-12-01", "2027-01-01"]);
  assert.equal(result.outputs[1].value, 9000);
  assert.equal(result.outputs[1].unit, undefined);
  assert.equal(result.provenance[1].args, state.toolResults[0].args);
  assert.match(result.assumptions[0], /constant/);
});

test("the same executor computes profit and margin without a business-specific tool", async () => {
  const result = await tool.invokeWithContext({
    purpose: "Compute gross profit and margin from observed totals", assumptions: [],
    bindings: [
      { name: "revenue", input: { source: "tool", resultIndex: 0, path: ["rows", "0", "revenue"] } },
      { name: "cost", input: { source: "tool", resultIndex: 0, path: ["rows", "0", "cost"] } },
      { name: "percent", input: { source: "constant", name: "hundred" } },
    ],
    calculations: [
      { name: "profit", operation: "subtract", inputs: ["revenue", "cost"] },
      { name: "ratio", operation: "divide", inputs: ["profit", "revenue"] },
      { name: "margin", operation: "multiply", inputs: ["ratio", "percent"] },
    ],
    outputs: [{ name: "profit", label: "Gross profit" }, { name: "margin", label: "Gross margin", unit: "%" }],
  }, state);
  assert.deepEqual(result.outputs.map(output => output.value), [3600, 40]);
});

test("quoted user inputs work from requests or resumed clarification, including zero", async () => {
  for (const value of [40, 0, -2.5, 1000, 0.5]) {
    const quote = value === 1000 ? "1,000 INR" : value === 0.5 ? ".5 INR" : `${value} INR`;
    const args = { ...revenuePlan, bindings: [revenuePlan.bindings[0], { name: "price", input: { source: "user" as const, value, quote } }] };
    const result = await tool.invokeWithContext(args, { ...state, userQuery: "Estimate revenue", clarificationHistory: [{ answer: `Use ${quote}` }] });
    assert.equal(result.outputs[1].value, 360 * value);
    assert.equal(result.provenance[1].source, "user");
  }
});

test("invented numbers, assistant guesses, old-turn user inputs and failed evidence are rejected", async () => {
  const args = { ...revenuePlan, bindings: [revenuePlan.bindings[0], { name: "price", input: { source: "user" as const, value: 40, quote: "40 INR" } }] };
  await assert.rejects(() => tool.invokeWithContext(args, { ...state, userQuery: "No price available", messages: [{ role: "assistant", content: "40 INR" }], memory: { previousQuery: "Use 40 INR" } }), /exact quote/);
  await assert.rejects(() => tool.invokeWithContext({ ...args, bindings: [args.bindings[0], { name: "price", input: { source: "user", value: 400, quote: "40 INR" } }] }, state), /exact quote/);
  await assert.rejects(() => tool.invokeWithContext(revenuePlan, { ...state, toolResults: [{ ...state.toolResults[0], success: false }, state.toolResults[1]] }), /successful current-turn/);
  assert.throws(() => calculationSchema.parse({ ...args, bindings: [{ name: "price", input: { source: "constant", name: "unit_price", value: 40 } }] }));
});

test("missing and nonnumeric values are not coerced to zero, and invalid paths are rejected", async () => {
  for (const price of [null, undefined, "25", NaN, Infinity]) {
    await assert.rejects(() => tool.invokeWithContext(revenuePlan, { ...state, toolResults: [{ ...state.toolResults[0], data: { rows: [{ price }] } }, state.toolResults[1]] }), /finite numbers/);
  }
  await assert.rejects(() => tool.invokeWithContext({ ...revenuePlan, bindings: [{ name: "x", input: { source: "tool", resultIndex: 0, path: ["__proto__"] } }] }, state), /Evidence path/);
  await assert.rejects(() => tool.invokeWithContext({ ...revenuePlan, bindings: [{ name: "x", input: { source: "tool", resultIndex: 99, path: ["rows"] } }] }, state), /successful current-turn/);
});

test("vectors and labels must align; zero divisors and numeric overflow fail explicitly", async () => {
  const vectorState = { ...state, toolResults: [{ toolName: "queryProjectData", success: true, data: { a: [1, 2], b: [3], zero: 0, large: Number.MAX_VALUE, labels: ["only-one"] } }] };
  const args = {
    purpose: "Compare aligned observations", assumptions: [],
    bindings: [
      { name: "a", input: { source: "tool" as const, resultIndex: 0, path: ["a"] } },
      { name: "b", input: { source: "tool" as const, resultIndex: 0, path: ["b"] } },
    ], calculations: [{ name: "result", operation: "multiply" as const, inputs: ["a", "b"] }], outputs: [{ name: "result", label: "Result" }],
  };
  await assert.rejects(() => tool.invokeWithContext(args, vectorState), /Vector lengths differ/);
  await assert.rejects(() => tool.invokeWithContext({ ...args, bindings: [args.bindings[0], { name: "b", input: { source: "tool", resultIndex: 0, path: ["zero"] } }], calculations: [{ name: "result", operation: "divide", inputs: ["a", "b"] }] }, vectorState), /Division by zero/);
  await assert.rejects(() => tool.invokeWithContext({ ...args, bindings: args.bindings.map(binding => ({ ...binding, input: { ...binding.input, path: ["large"] } })) }, vectorState), /finite numbers/);
  await assert.rejects(() => tool.invokeWithContext({ ...args, bindings: [args.bindings[0]], calculations: [{ name: "result", operation: "add", inputs: ["a", "a"] }], outputs: [{ name: "result", label: "Result", labels: { resultIndex: 0, path: ["labels"] } }] }, vectorState), /labels must match/);
});

test("invalid computation graphs fail rather than overwriting evidence or silently supplying values", async () => {
  await assert.rejects(() => tool.invokeWithContext({ ...revenuePlan, bindings: [revenuePlan.bindings[0], revenuePlan.bindings[0]] }, state), /Duplicate/);
  await assert.rejects(() => tool.invokeWithContext({ ...revenuePlan, calculations: [{ name: "total", operation: "sum", inputs: ["future"] }] }, state), /forward calculation reference/);
  await assert.rejects(() => tool.invokeWithContext({ ...revenuePlan, calculations: [{ name: "total", operation: "multiply", inputs: ["units"] }] }, state), /Wrong input count/);
});

test("calculation schema exposes explicit provider-compatible arguments without recursive expressions", () => {
  assert.doesNotThrow(() => toJsonSchema(calculationSchema));
  assert.equal(JSON.stringify(decisionTransportSchema(calculationSchema)).includes('"maxItems"'), false);
  assert.throws(() => calculationSchema.parse({ ...revenuePlan, bindings: Array.from({ length: 33 }, () => revenuePlan.bindings[0]) }));
});

test("derived requests require an agent-authored rationale rather than a revenue-specific relationship", () => {
  const request = { intent: "PREDICT", metricRelationship: "derived", targetMetric: "profit", responseStyle: "brief",
    isGeneralConversation: false, isProjectIrrelevant: false, needsClarification: false, requiresWebSearch: false, explanation: "Forecast profit" };
  const intents = [{ code: "PREDICT", conversational: false, allowsInference: true, description: "Forecast" }];
  assert.throws(() => validateUnderstanding(request, intents), /forecast basis/);
  assert.equal(validateUnderstanding({ ...request, derivation: { forecastTarget: "units", rationale: "Units times evidenced contribution margin", requiredInputs: ["contribution margin"] } }, intents).metricRelationship, "derived");
});
