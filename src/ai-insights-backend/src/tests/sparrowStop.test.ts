import assert from "node:assert/strict";
import { test } from "node:test";
import { MemorySaver } from "@langchain/langgraph";
import { SparrowChatService } from "../services/chat/sparrowChat.service";
import { sparrowRunContext, stoppedResponse } from "../agents/sparrow/executionContext";
import { createSparrowGraph } from "../agents/sparrow/graph";
import { z } from "zod";
const { stopChatMessage, traceClock } = require("../../../ai-insights-webapp/app/services/chatLifecycle");
const thinking = [{ time: "17:48:01", timestamp: "2026-10-09T12:18:01Z", text: "Schema inspected", done: true },
  { time: "17:48:09", timestamp: "2026-10-09T12:18:09Z", text: "Running script", done: false }];
const turn = { projectId: "p1", conversationId: "c1", requestId: "r1", messageId: "a1", userMessageId: "u1", userQuery: "Analyze" };
function fixture(run: (input: any) => Promise<any>) {
  const messages = new Map<string, any>();
  const imported: any[] = [];
  const repo: any = {
    importSession: async (session: any) => { imported.push(session); },
    latest: async () => [...messages.values()].at(-1),
    begin: async (input: any) => { const saved = messages.get(input.messageId); if (!saved || saved.requestId !== input.requestId) messages.set(input.messageId, { requestId: input.requestId, chatMode: input.chatMode, status: "sending", thinking: [] }); return messages.get(input.messageId); },
    get: async (input: any) => { const saved = messages.get(input.messageId); return saved?.requestId === input.requestId ? saved : undefined; },
    progress: async (input: any, steps: any) => { const saved = await repo.get(input); if (saved?.status === "sending") saved.thinking = steps; },
    finish: async (input: any, response: any) => { const saved = await repo.get(input); if (saved?.status === "sending") Object.assign(saved, response, { isThinking: false }); return saved; },
    stop: async (input: any, response: any) => { const saved = messages.get(input.messageId); if (saved && saved.requestId !== input.requestId) return saved;
      if (!saved) messages.set(input.messageId, { requestId: input.requestId, ...response }); return repo.finish(input, response); },
  };
  const service = new SparrowChatService({ getById: async () => ({ id: "p1" }) } as any, {} as any, {} as any,
    { checkpointer: new MemorySaver(), intentRepository: {} as any, lockPool: {} as any, chatRepository: repo, orchestrator: { run, getInteraction: async () => ({}) } });
  return { service, messages, imported };
}

test("Stop ends ordinary and clarification UI messages, retaining completed steps without a pending spinner", () => {
  for (const clarification of [undefined, { question: "Price?", missingField: "price" }]) {
    const stopped = stopChatMessage({ id: "a1", role: "assistant", content: "", timestamp: "5:48 PM", status: "sending", isThinking: true, thinking, clarification });
    assert.equal(stopped.status, "stopped"); assert.equal(stopped.content, "Agent was stopped"); assert.equal(stopped.isThinking, false);
    assert.equal(stopped.thinking[0].done, true); assert.equal(stopped.thinking[1].done, false); assert.equal(stopped.thinking[1].status, "stopped"); assert.equal(stopped.clarification, undefined);
    assert.equal(JSON.parse(JSON.stringify(stopped)).isThinking, false);
  }
  assert.match(traceClock(thinking[1]), /^\d{2}:\d{2}:\d{2}$/);
  assert.equal(traceClock({ time: "00:01", done: false, text: "legacy" }), "—");
});

test("API callers select a mode without UI state and same-request mode changes are rejected", async () => {
  let calls = 0;
  const f = fixture(async input => {
    calls++;
    assert.equal(input.chatMode, "expert");
    assert.equal(sparrowRunContext.getStore()?.chatMode, "expert");
    return { status: "complete", content: "Evidence reviewed.", thinking: [] };
  });
  const result = await f.service.sendMessage({ ...turn, chatMode: "expert" });
  assert.equal(result.chatMode, "expert");
  assert.equal(f.messages.get("a1").chatMode, "expert");
  assert.equal((await f.service.sendMessage(turn)).chatMode, "expert");
  await assert.rejects(() => f.service.sendMessage({ ...turn, chatMode: "fast" }), /different response mode/);
  assert.equal(calls, 1);
});

test("cached sessions import explicit response modes without changing message-level choices", async () => {
  const f = fixture(async () => { throw new Error("Import must not execute the agent."); });
  const session = { id: "c1", projectId: "p1", title: "Saved inquiry", agentPersona: "orchestrator", chatMode: "fast",
    messages: [{ id: "a1", role: "assistant", content: "Detailed findings", timestamp: "5:48 PM", chatMode: "expert", modeStrategy: "application" }] };
  await f.service.importSessions([session]);
  assert.deepEqual(f.imported, [session]);
  await assert.rejects(() => f.service.importSessions([{ ...session, chatMode: "auto" }]));
  assert.equal(f.imported.length, 1);
});

test("a clarification retains the saved mode and rejects changing it before execution", async () => {
  let calls = 0;
  const f = fixture(async input => {
    calls++;
    assert.equal(input.chatMode, "expert");
    return calls === 1 ? { status: "awaiting_user_input", content: "Which region?", thinking: [] }
      : { status: "complete", content: "Region analyzed.", thinking: [] };
  });
  await f.service.sendMessage({ ...turn, chatMode: "expert" });
  const answer = { ...turn, requestId: "r2", userMessageId: "u2", userQuery: "North", interactionId: "i1" };
  await assert.rejects(() => f.service.sendMessage({ ...answer, chatMode: "fast" }), /original request/);
  assert.equal(calls, 1);
  const resumed = await f.service.sendMessage(answer);
  assert.equal(resumed.chatMode, "expert");
  assert.equal(calls, 2);
});

test("Stop aborts active work and saves the stopped trace; late completion cannot replace it", async () => {
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; }); let finish!: () => void;
  const late = new Promise<void>(resolve => { finish = resolve; }); let signal!: AbortSignal;
  const f = fixture(async input => { signal = sparrowRunContext.getStore()!.signal; input.onThinkingUpdate(thinking); started(); await late; return { status: "complete", content: "Late answer", thinking }; });
  const pending = f.service.sendMessage(turn); await ready;
  const stopped = await f.service.stop(turn);
  assert.equal(signal.aborted, true); assert.equal(stopped.status, "stopped"); assert.equal(stopped.thinking[1].status, "stopped");
  finish(); const result = await pending;
  assert.equal(result.content, "Agent was stopped"); assert.equal(f.messages.get("a1").status, "stopped");
});

test("Stop before registration persists a cancellation and prevents model execution", async () => {
  let calls = 0; const f = fixture(async () => { calls++; return { status: "complete", content: "Wrong", thinking: [] }; });
  await f.service.stop(turn); const result = await f.service.sendMessage(turn);
  assert.equal(result.status, "stopped"); assert.equal(calls, 0);
});

test("a stale Stop does not abort a newer request reusing a clarification message", async () => {
  let ready!: () => void; const started = new Promise<void>(resolve => { ready = resolve; }); let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; }); let signal!: AbortSignal;
  const f = fixture(async () => { signal = sparrowRunContext.getStore()!.signal; ready(); await gate; return { status: "complete", content: "New answer", thinking: [] }; });
  const next = { ...turn, requestId: "r2", userMessageId: "u2" }; const pending = f.service.sendMessage(next); await started;
  await f.service.stop(turn); assert.equal(signal.aborted, false); finish(); assert.equal((await pending).content, "New answer");
});

test("node lifecycle logs identify each chat step and the trace uses clock timestamps", async t => {
  const logs: string[] = []; t.mock.method(console, "info", (...args: any[]) => logs.push(args.join(" ")));
  const graph = createSparrowGraph({ tools: new Map([["getProjectContext", { schema: z.object({}) }]]), checkpointer: new MemorySaver(), agents: {
    resolve: async () => ({ intent: "GREETING", isGeneralConversation: true, isProjectIrrelevant: false, needsClarification: false, responseStyle: "brief" }),
    plan: async () => ({ action: "respond", planType: "general_response", rationale: "Greeting", steps: [] }),
    respond: async () => ({ status: "complete", content: "Hello", thinking: [] }),
  } });
  const result = await sparrowRunContext.run({ signal: new AbortController().signal, ...turn, thinking: [] }, () => graph.invoke({ projectId: "p1", userQuery: "Hi", intentCatalog: [] }, { configurable: { thread_id: "log-test" } }));
  assert.ok(logs.some(log => log.includes("Node [queryResolverNode] started agent execution") && log.includes("conversation=c1 request=r1")));
  assert.ok(logs.some(log => log.includes("Node [responderNode] completed")));
  assert.ok(result.response!.thinking.every(step => /^\d{2}:\d{2}:\d{2}$/.test(step.time)));
});
