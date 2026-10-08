import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "crypto";
import { Pool } from "pg";
import { Command } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { z } from "zod";
import { migrateSparrow } from "../db/migrations/sparrow";
import { PostgresSparrowIntentRepository } from "../repositories/sparrowIntent.repository";
import { createSparrowGraph } from "../agents/sparrow/graph";

// Uses only a temporary schema in the configured database; no project records.
test("startup migration preserves edits and PostgreSQL restores Sparrow interrupts and memory", async () => {
  const options = {
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASS,
    connectionTimeoutMillis: 5000,
  };
  const admin = new Pool(options);
  const schema = `sparrow_test_${randomBytes(8).toString("hex")}`;
  let scoped: Pool | undefined;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    scoped = new Pool({ ...options, options: `-c search_path=${schema}` });
    await migrateSparrow(scoped);
    await scoped.query("UPDATE sparrow_intents SET description = $1 WHERE code = 'ANALYZE'", ["Edited by operator"]);
    await migrateSparrow(scoped);
    const repository = new PostgresSparrowIntentRepository(scoped);
    const intents = await repository.getActiveIntents();
    assert.equal(intents.length, 13);
    assert.equal(intents.find((intent) => intent.code === "ANALYZE")?.description, "Edited by operator");
    await scoped.query("INSERT INTO sparrow_intents (code, description) VALUES ('CUSTOM', 'Runtime addition')");
    assert.ok((await repository.getActiveIntents()).some((intent) => intent.code === "CUSTOM"));

    const firstSaver = new PostgresSaver(scoped, undefined, { schema });
    await firstSaver.setup();
    const tools = new Map<string, any>([
      ["getProjectContext", { schema: z.object({}), description: "Metadata", invoke: async () => ({ success: true }) }],
      ["getProjectDataSchema", { schema: z.object({}), description: "Schema", invoke: async () => ({ success: true, tables: [] }) }],
    ]);
    const agents = {
      resolve: async (_q: any, _c: any, _h: any, _i: any, memory: any) => ({
        intent: "ANALYZE", responseStyle: "detailed" as const, isGeneralConversation: false,
        isProjectIrrelevant: false, needsClarification: !memory.clarificationAnswer,
        clarificationQuestion: "Which metric?", missingField: "targetMetric",
      }),
      plan: async () => ({ action: "respond" as const, planType: "data_analysis" as const, steps: [], rationale: "Report available context" }),
      respond: async () => ({ status: "complete" as const, content: "No analytical observations are available yet.", thinking: [] }),
    };
    const config = { configurable: { thread_id: `sparrow:p1:${schema}` }, recursionLimit: 80 };
    await createSparrowGraph({ checkpointer: firstSaver, tools, agents }).invoke({
      projectId: "p1", userQuery: "Analyze", intentCatalog: intents,
      messages: [{ role: "user", content: "Analyze" }],
    }, config);
    // A completely new saver/compiled graph must recover from the database.
    const secondSaver = new PostgresSaver(scoped, undefined, { schema });
    await secondSaver.setup();
    const restarted = createSparrowGraph({ checkpointer: secondSaver, tools, agents });
    const saved = await restarted.getState(config);
    assert.equal(saved.values.projectId, "p1");
    assert.equal(saved.values.toolResults.length, 2);
    assert.equal((saved.tasks[0].interrupts[0].value as any).question, "Which metric?");
    // Exercise the catalog refresh used by the orchestrator before Command resume.
    await restarted.updateState(config, { intentCatalog: await repository.getActiveIntents() });
    const result = await restarted.invoke(new Command({ resume: "Revenue" }), config);
    assert.equal(result.toolResults.length, 2);
    assert.equal(result.response?.status, "complete");
    assert.equal(result.memory.previousUnderstanding && (result.memory.previousUnderstanding as any).intent, "ANALYZE");
    const third = createSparrowGraph({ checkpointer: new PostgresSaver(scoped, undefined, { schema }), tools, agents });
    assert.equal((await third.getState(config)).values.memory.previousAnswer, result.response?.content);
    console.log("Verified 14 database intents, preserved operator edits, persisted interrupt/resume and conversation memory.");
  } finally {
    await scoped?.end();
    try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await admin.end(); }
  }
});
