import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve, dirname, basename } from "path";
import duckdb from "duckdb";
import { MemorySaver, Command } from "@langchain/langgraph";
import { createSparrowGraph } from "../agents/sparrow/graph";
import { createGetProjectContextTool, createGetProjectDataSchemaTool } from "../agents/sparrow/tools/projectContext.tools";
import { createQueryProjectDataTool } from "../agents/sparrow/tools/dataAnalysis.tools";
import { createDiscoverAvailableModelsTool, createRunModelInferenceTool } from "../agents/sparrow/tools/modelInference.tools";
import { createCalculateMetricTool } from "../agents/sparrow/tools/calculation.tools";
import { advancePeriod, dateOnly } from "../agents/sparrow/forecastWindow";

// Opt in: real configured LLM + real SQL, simulated model execution, no production writes.
test("live Sparrow derives revenue and profit, asks for missing inputs, and honors refusal", {
  skip: process.env.SPARROW_FORECAST_LIVE !== "1", timeout: 600000,
}, async (t) => {
  const folder = await mkdtemp(join(tmpdir(), "sparrow-forecast-"));
  const dbPath = join(folder, "fixture.duckdb");
  const db = new duckdb.Database(dbPath);
  const connection = db.connect();
  const sql = (query: string) => new Promise<void>((resolve, reject) => connection.exec(query, err => err ? reject(err) : resolve()));
  const runQuery = (_path: string, query: string) => new Promise<any[]>((resolve, reject) => connection.all(query, (err, rows) => err ? reject(err) : resolve(rows)));
  try {
    const project = { id: "p1", name: "Fixture Retail", folderPath: folder, useCase: "Unit demand forecasting", domain: "Retail",
      agentState: { targetColumn: "Sold_Items", modelValidation: { report: "EXCLUDED_VALIDATION" }, splitDate: "2025-01-01" } };
    const projectService = { getById: async () => project, getProjectWithWorkspace: async () => ({ workspaceName: "Fixture" }) } as any;
    const duckDBService = { getProjectDuckDbPath: () => dbPath, runQuery } as any;
    const executions: any[] = [];
    const modelValidationService = {
      getValidationCandidates: async () => ({ candidates: [{ model_id: "m1", displayName: "Fixture unit model" }], championModelId: "m1" }),
      validateModels: async (input: any) => {
        executions.push(input);
        return { status: "Completed", report: { target_column: "Sold_Items", champion_model_id: "m1", ranked_models: [{ model_id: "m1",
          chartData: { dates: Array.from({ length: input.predictionHorizon }, (_, index) => advancePeriod(dateOnly(input.predictionObjectiveStartDate), input.predictionFrequency, index).toISOString().slice(0, 10)),
            predictedSeries: Array.from({ length: input.predictionHorizon }, (_, index) => (index + 1) * 10) } }] } };
      },
    } as any;
    const tools = new Map<string, any>([
      ["getProjectContext", createGetProjectContextTool("p1", { projectService, duckDBService })],
      ["getProjectDataSchema", createGetProjectDataSchemaTool("p1", { projectService, duckDBService })],
      ["queryProjectData", createQueryProjectDataTool("p1", { projectService, duckDBService })],
      ["discoverAvailableModels", createDiscoverAvailableModelsTool("p1", { projectService, modelValidationService })],
      ["runModelInference", createRunModelInferenceTool("p1", { projectService, modelValidationService })],
      ["calculateMetric", createCalculateMetricTool()],
    ]);
    const graph = createSparrowGraph({ tools, checkpointer: new MemorySaver(), now: () => Date.parse("2026-10-09T12:00:00Z"),
      onThinkingUpdate: steps => console.log(steps.at(-1)?.text) });
    const intents = [{ code: "PREDICT", description: "Predict future business metrics", allowsInference: true, conversational: false }];
    const seed = { projectId: "p1", projectContext: {}, intentCatalog: intents,
      userQuery: "Predict business revenue for the next 3 months. Sold_Items represents units sold. Use project data and disclose any pricing assumption." };
    const config = (id: string) => ({ configurable: { thread_id: id }, recursionLimit: 80 });

    await sql("CREATE TABLE orders (order_date DATE, Sold_Items DOUBLE, Unit_Price DOUBLE); INSERT INTO orders VALUES ('2025-11-30',10,25),('2025-12-31',20,25)");
    await t.test("dataset pricing", async () => {
      const priced = await graph.invoke(seed, config("dataset-price"));
      assert.equal(priced.response?.status, "complete");
      const calculated = priced.toolResults.find(result => result.toolName === "calculateMetric" && result.success);
      assert.equal(calculated?.data.outputs.find((output: any) => output.value === 9000)?.value, 9000, JSON.stringify({ results: priced.toolResults, answer: priced.response?.content }));
      assert.equal(executions[0].predictionHorizon, 13);
      assert.equal(priced.queryUnderstanding?.timeRange?.startDate, "2026-11-01");
      assert.equal(priced.queryUnderstanding?.metricRelationship, "derived");
      assert.equal(JSON.stringify(priced.projectContext).includes("EXCLUDED_VALIDATION"), false);
      assert.doesNotMatch(priced.response!.content, /\$\s*\d|\bUSD\b|\bdollars\b/i);
      console.log("LIVE VERIFIED: schema price yields 9,000 estimated revenue for Nov–Jan; execution has 13 periods.");

    });

    await sql("ALTER TABLE orders ADD COLUMN Unit_Cost DOUBLE DEFAULT 10");
    await t.test("agent-selected profit method", async () => {
      const profit = await graph.invoke({ ...seed,
        userQuery: "Predict gross profit for the next 3 months. Sold_Items represents units sold; Unit_Price is selling price per unit and Unit_Cost is cost per unit. Use project evidence and disclose assumptions." }, config("dataset-profit"));
      assert.equal(profit.response?.status, "complete");
      assert.ok(profit.toolResults.some(result => result.toolName === "calculateMetric" && result.success
        && result.data.outputs.some((output: any) => output.value === 5400)),
        JSON.stringify({ results: profit.toolResults, answer: profit.response?.content }));
      assert.equal(profit.toolResults.some(result => !result.success), false);
      assert.doesNotMatch(profit.response!.content, /\$\s*\d|\bUSD\b|\bdollars\b/i);
      console.log("LIVE VERIFIED: agent selects a different method for gross profit, yielding 5,400 through the same calculator.");
    });
    await sql("ALTER TABLE orders DROP COLUMN Unit_Cost");

    await sql("ALTER TABLE orders DROP COLUMN Unit_Price");
    for (const answer of ["Use a unit price of 40 INR for every forecast month.", "No, I cannot provide a price. Give me the predicted units and a formula instead."]) {
      await t.test(answer.startsWith("Use") ? "user-supplied input" : "declined input", async () => {
        const thread = config(answer.startsWith("Use") ? "user-price" : "declined-price");
        await graph.invoke(seed, thread);
        const paused = await graph.getState(thread);
        const prompt = paused.tasks.flatMap(task => task.interrupts ?? [])[0]?.value as any;
        assert.ok(prompt?.question, JSON.stringify({ message: "Missing dataset price must lead to a clarification.",
          results: paused.values.toolResults, answer: paused.values.response?.content }));
        console.log(`LIVE CLARIFICATION: ${prompt.question}`);
        const result = await graph.invoke(new Command({ resume: answer }), thread);
        assert.equal(result.response?.status, "complete");
        const forecast = result.toolResults.find(r => r.toolName === "runModelInference" && r.success);
        assert.equal(forecast?.data.modelResults[0].forecastTotal, 360, JSON.stringify({ results: result.toolResults, answer: result.response?.content }));
        const revenue = result.toolResults.find(r => r.toolName === "calculateMetric" && r.success);
        if (answer.startsWith("Use")) {
          assert.equal(revenue?.data.outputs.find((output: any) => output.value === 14400)?.value, 14400);
          assert.ok(revenue?.data.outputs.some((output: any) => output.unit === "INR"));
          console.log("LIVE VERIFIED: user price yields 14,400 INR for Nov–Jan.");
        } else {
          assert.equal(revenue, undefined);
          assert.match(result.response!.content, /revenue[\s\S]*(?:×|\*|multiply|multiplied|price)/i);
          console.log("LIVE VERIFIED: refusal yields 360 units and a revenue formula, with no invented monetary forecast.");
        }
      });
    }
  } finally {
    await new Promise<void>(resolve => connection.close(() => resolve()));
    await new Promise<void>(resolve => db.close(() => resolve()));
    if (resolve(dirname(folder)) !== resolve(tmpdir()) || !basename(folder).startsWith("sparrow-forecast-")) throw new Error("Unexpected fixture directory.");
    await rm(folder, { recursive: true, force: true });
  }
});
