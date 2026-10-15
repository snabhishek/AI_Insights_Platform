import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "crypto";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { basename, dirname, join, resolve } from "path";
import { Pool } from "pg";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import duckdb from "duckdb";
import { runMigrations } from "../db";
import { PostgresSparrowIntentRepository } from "../repositories/sparrowIntent.repository";
import { SparrowOrchestrator } from "../agents/sparrow/sparrowOrchestrator";

// Opt-in live evaluation: configured LLM, real DuckDB, isolated PostgreSQL schema.
test("live Sparrow answers analysis, follow-ups and late clarification replies from real data", { timeout: 480000 }, async () => {
  const options = {
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASS,
    connectionTimeoutMillis: 5000,
  };
  const admin = new Pool(options);
  const schema = `sparrow_live_${randomBytes(8).toString("hex")}`;
  const folder = await mkdtemp(join(tmpdir(), "sparrow-live-"));
  const dbPath = join(folder, "fixture.duckdb");
  const db = new duckdb.Database(dbPath);
  const conn = db.connect();
  const exec = (sql: string) => new Promise<void>((resolve, reject) => conn.exec(sql, (err: Error | null) => err ? reject(err) : resolve()));
  const runQuery = (_path: string, sql: string) => new Promise<any[]>((resolve, reject) => conn.all(sql, (err: Error | null, rows: any[]) => err ? reject(err) : resolve(rows)));
  let scoped: Pool | undefined;
  try {
    await exec(`CREATE TABLE transactions (date DATE, region VARCHAR, revenue DOUBLE);
      INSERT INTO transactions VALUES ('2026-08-01', 'North', 100), ('2026-08-01', 'South', 200),
      ('2026-09-01', 'North', 150), ('2026-09-01', 'South', 180)`);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    scoped = new Pool({ ...options, options: `-c search_path=${schema}` });
    await runMigrations(scoped, schema);
    const checkpointer = new PostgresSaver(scoped, undefined, { schema });
    await checkpointer.setup();
    const project = { id: "sparrow-fixture", name: "Sparrow Test Retail", domain: "Retail", agentState: { targetColumn: "revenue" } };
    let now = Date.now();
    const orchestrator = new SparrowOrchestrator({
      projectService: { getById: async () => project, getProjectWithWorkspace: async () => ({ project, workspaceName: "Sparrow Test Workspace" }) } as any,
      duckDBService: { getProjectDuckDbPath: () => dbPath, runQuery } as any,
      modelValidationService: {} as any,
      checkpointer, intentRepository: new PostgresSparrowIntentRepository(scoped), now: () => now,
    });
    const response = await orchestrator.run({
      projectId: project.id, conversationId: "live-test",
      userQuery: "Hi, compare revenue by region for September 2026 against August 2026. Use only project data.",
      onThinkingUpdate: (steps) => console.log(steps.at(-1)?.text),
    });
    assert.equal(response.status, "complete", response.content);
    const config = { configurable: { thread_id: `sparrow:${project.id}:live-test` } };
    const first = await checkpointer.getTuple(config);
    const results = first!.checkpoint.channel_values.toolResults as any[];
    assert.ok(results.some((result) => result.success && ["queryProjectData", "comparePeriods", "aggregateMetrics"].includes(result.toolName)), JSON.stringify({ message: "Must execute analytics", results, response: response.content }));
    assert.ok(!results.some((result) => result.toolName === "runModelInference"));
    const followUp = await orchestrator.run({
      projectId: project.id, conversationId: "live-test", executionState: response.executionState,
      userQuery: "Show the percentage change for each of those regions over the same periods.",
      onThinkingUpdate: (steps) => console.log(steps.at(-1)?.text),
    });
    assert.equal(followUp.status, "complete", followUp.content);
    const saved = await checkpointer.getTuple(config);
    const freshResults = saved!.checkpoint.channel_values.toolResults as any[];
    const memory = saved!.checkpoint.channel_values.memory as any;
    const evidence = JSON.stringify([...freshResults, ...(memory.previousEvidence ?? [])].filter((result) => result.success && result.toolName !== "getProjectContext" && result.toolName !== "getProjectDataSchema"));
    assert.ok(evidence.includes("50") && evidence.includes("-10"), JSON.stringify({
      message: "Observed regional changes must be +50% and -10%",
      evidence, understanding: saved!.checkpoint.channel_values.queryUnderstanding,
      plan: saved!.checkpoint.channel_values.plan, response: followUp.content,
    }));
    console.log("Live LLM + DuckDB verified regional comparison and contextual follow-up: North +50%, South -10%.");
    const clarification = await orchestrator.run({ projectId: project.id, conversationId: "live-test",
      userQuery: "Now compare revenue for a subset of regions. Do not choose the regions for me: ask me which regions using choices from actual data. I will supply the regions and the two periods in my reply.",
      onThinkingUpdate: steps => console.log(steps.at(-1)?.text),
    });
    assert.equal(clarification.status, "awaiting_user_input", clarification.content);
    assert.ok(clarification.clarification?.question.trim());
    assert.ok(clarification.clarification?.missingField.trim());
    assert.deepEqual(new Set(clarification.clarification?.options), new Set(["North", "South"]));
    assert.ok(clarification.interaction?.id);
    now = Date.parse(clarification.interaction!.expiresAt) + 1;
    const expired = await orchestrator.getInteraction({ projectId: project.id, conversationId: "live-test" });
    assert.equal(expired.interaction?.status, "timed_out");
    const continued = await orchestrator.run({ projectId: project.id, conversationId: "live-test",
      userQuery: "North and South, comparing September 2026 against August 2026.", interactionId: clarification.interaction!.id,
      onThinkingUpdate: steps => console.log(steps.at(-1)?.text),
    });
    assert.equal(continued.status, "complete", continued.content);
    const resumed = await checkpointer.getTuple(config);
    assert.equal((resumed!.checkpoint.channel_values.clarificationHistory as any[]).length, 1);
    console.log("Live agent authored grounded North/South choices and resumed the saved request after the 100-second deadline.");
  } finally {
    await new Promise<void>((resolve) => conn.close(() => resolve()));
    await new Promise<void>((resolve) => db.close(() => resolve()));
    if (resolve(dirname(folder)) !== resolve(tmpdir()) || !basename(folder).startsWith("sparrow-live-")) {
      throw new Error("Refusing to clean up an unexpected test directory.");
    }
    await rm(folder, { recursive: true, force: true });
    await scoped?.end();
    try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await admin.end(); }
  }
});
