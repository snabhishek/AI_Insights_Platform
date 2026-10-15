import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { runMigrations } from "../db";
import { PostgresSparrowChatRepository } from "../repositories/sparrowChat.repository";
import { stoppedResponse } from "../agents/sparrow/executionContext";

test("PostgreSQL saves complete/stopped chat transcripts and restores them across repository restart", { timeout: 60000 }, async () => {
  const options = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASS, connectionTimeoutMillis: 5000 };
  const admin = new Pool(options); const schema = `chat_test_${randomBytes(8).toString("hex")}`; let pool: Pool | undefined;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ ...options, options: `-c search_path=${schema}` });
    await runMigrations(pool, schema);
    await pool.query("INSERT INTO workspaces(id,name) VALUES('w1','Chat fixture'); INSERT INTO projects(id,name,workspace_id) VALUES('p1','Chat fixture','w1'),('p2','Other project','w1')");
    const repository = new PostgresSparrowChatRepository(pool);
    const turn = { projectId: "p1", conversationId: "c1", requestId: "r1", messageId: "a1", userMessageId: "u1", userQuery: "Predict", session: { title: "My question", agentPersona: "orchestrator" } };
    await repository.begin(turn);
    await repository.finish(turn, { status: "complete", content: "Revenue is 125", thinking: [], tables: [{ columns: ["revenue"], rows: [{ revenue: 125 }] }], chart: [{ type: "bar", title: "Revenue", labels: ["Month"], data: [125] }] });
    const next = { ...turn, requestId: "r2", messageId: "a2", userMessageId: "u2", userQuery: "Compare models" };
    await repository.begin(next);
    const trace = [{ time: "17:48:09", timestamp: "2026-10-09T12:18:09Z", text: "Running script", done: false }];
    await repository.progress(next, trace);
    await repository.stop(next, stoppedResponse(trace));
    await repository.progress(next, [{ ...trace[0], text: "Late progress", done: true }]);
    await repository.finish(next, { status: "complete", content: "Late answer", thinking: [] });
    const restored = await new PostgresSparrowChatRepository(pool).list(["p1"]);
    assert.equal(restored[0].messages.length, 4); assert.equal(restored[0].messages[0].content, "Predict");
    assert.equal(restored[0].messages[1].tables[0].rows[0].revenue, 125); assert.equal(restored[0].messages[1].chart.data[0], 125);
    assert.equal(restored[0].messages[3].content, "Agent was stopped"); assert.equal(restored[0].messages[3].isThinking, false);
    assert.equal(restored[0].messages[3].thinking[0].status, "stopped"); assert.equal(restored[0].messages[3].thinking[0].text, "Running script");
    assert.deepEqual(await repository.list(["p2"]), []);
    await repository.importSession({ ...restored[0], messages: [{ id: "a2", role: "assistant", content: "Stale browser response" }] });
    assert.equal((await repository.list(["p1"]))[0].messages.length, 4);
    const early = { ...turn, conversationId: "early", messageId: "early-a", requestId: "early-r", userMessageId: "early-u" };
    await repository.stop(early, stoppedResponse([]));
    assert.equal((await repository.begin(early)).status, "stopped");
    const resumed = { ...next, requestId: "r3", userMessageId: "u3" }; await repository.begin(resumed);
    const stale = await repository.stop(next, stoppedResponse(trace));
    assert.equal(stale.requestId, "r3"); assert.equal(stale.status, "sending");
    await repository.metadata("p1", "c1", { title: "Renamed", pinned: true });
    assert.equal((await repository.list(["p1"])).find(session => session.id === "c1")!.pinned, true);
    await repository.remove("p1", "c1");
    assert.equal((await pool.query("SELECT COUNT(*) FROM sparrow_chat_messages WHERE conversation_id='c1'")).rows[0].count, "0");
  } finally {
    await pool?.end();
    try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await admin.end(); }
  }
});
