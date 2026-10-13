import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/services/chatSessionHistory.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2017 } });
const { chatSessionKey, normalizeChatSessions, mergeChatSessionHistory, resolveActiveSessionKey, createChatSession } =
  await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

function session(projectId, overrides = {}) {
  return { id: "shared-session", projectId, title: `${projectId} conversation`, agentPersona: "orchestrator",
    createdAt: "2026-10-13T00:00:00Z", updatedAt: "2026-10-13T00:00:00Z", messages: [], ...overrides };
}

test("conversation identity includes its project and cannot collide through separators", () => {
  assert.notEqual(chatSessionKey(session("alpha")), chatSessionKey(session("beta")));
  assert.notEqual(chatSessionKey({ projectId: "a:b", id: "c" }), chatSessionKey({ projectId: "a", id: "b:c" }));
  assert.equal(chatSessionKey({ id: "welcome" }), chatSessionKey({ projectId: undefined, id: "welcome" }));
});

test("normalizes repeated snapshots of one identity without discarding another project's transcript", () => {
  const old = session("alpha");
  const newer = session("alpha", { updatedAt: "2026-10-13T01:00:00Z", messages: [{ id: "a1", content: "New transcript" }] });
  const beta = session("beta", { messages: [{ id: "a1", content: "Separate transcript" }] });
  const input = [old, beta, newer, beta];
  assert.deepEqual(normalizeChatSessions(input), [newer, beta]);
  assert.equal(input.length, 4);
});

test("database history wins over cached copies while retaining new local conversations", () => {
  const cached = session("alpha", { title: "Cached title" });
  const saved = session("alpha", { title: "Database title" });
  const beta = session("beta");
  const draft = session("alpha", { id: "created-during-load" });
  assert.deepEqual(mergeChatSessionHistory([cached, beta, draft], [saved, beta]), [saved, beta, draft]);
});

test("preserves only the matching project transcript while its response is streaming", () => {
  const alpha = session("alpha", { messages: [{ id: "a1", content: "Streaming response" }] });
  const beta = session("beta", { title: "Stale beta" });
  const savedAlpha = session("alpha");
  const savedBeta = session("beta", { title: "Database beta" });
  assert.deepEqual(mergeChatSessionHistory([alpha, beta], [savedAlpha, savedBeta],
    { projectId: "alpha", conversationId: "shared-session" }), [alpha, savedBeta]);
});

test("repeated history loads are idempotent for project-scoped session identities", () => {
  const alpha = session("alpha");
  const beta = session("beta");
  let current = [alpha, alpha, beta];
  for (let attempt = 0; attempt < 5; attempt++) current = mergeChatSessionHistory(current, [alpha, beta, beta]);
  assert.deepEqual(current, [alpha, beta]);
});

test("migrates legacy active IDs and restores the exact project for new stored selections", () => {
  const alpha = session("alpha");
  const beta = session("beta");
  assert.equal(resolveActiveSessionKey([alpha, beta], "shared-session"), chatSessionKey(alpha));
  assert.equal(resolveActiveSessionKey([alpha, beta], chatSessionKey(beta)), chatSessionKey(beta));
  assert.equal(resolveActiveSessionKey([alpha, beta], "deleted-session"), chatSessionKey(alpha));
  assert.equal(resolveActiveSessionKey([], null), "");
});

test("creates distinct project-bound conversation IDs even within the same millisecond", () => {
  const created = Array.from({ length: 100 }, () => createChatSession("alpha", "Alpha", "orchestrator"));
  assert.equal(new Set(created.map(item => item.id)).size, created.length);
  const beta = createChatSession("beta", "Beta", "orchestrator");
  assert.equal(created[0].projectId, "alpha");
  assert.equal(beta.projectId, "beta");
  assert.match(beta.id, /^session-[\da-f-]{36}$/);
  assert.deepEqual(beta.messages, []);
});
