import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import express from "express";
import { SparrowChatController } from "../controllers/sparrowChat.controller";
const { readSparrowStream } = require("../../../ai-insights-webapp/app/services/sparrowStream");

function mockResponse() {
  const response: any = new EventEmitter(); const chunks: string[] = [];
  response.setHeader = () => undefined; response.flushHeaders = () => undefined;
  response.write = (chunk: string) => { chunks.push(chunk); return true; };
  response.end = () => { response.writableEnded = true; };
  response.json = (value: any) => { response.body = value; }; response.status = () => response;
  return { response, chunks };
}

test("controller forwards live activity before execution completes and retains JSON clients", async () => {
  let finish!: (value: any) => void;
  const service: any = { sendMessage: async (input: any) => {
    input.onThinkingUpdate?.([{ time: "00:00", text: "Inspecting script", done: false }]);
    return new Promise(resolve => { finish = resolve; });
  } };
  const controller = new SparrowChatController(service); const f = mockResponse();
  const pending = controller.sendMessage({ body: { projectId: "p1", userQuery: "Predict" }, headers: { accept: "text/event-stream" } } as any, f.response);
  assert.ok(f.chunks.some(chunk => /Inspecting script/.test(chunk))); assert.equal(f.response.writableEnded, undefined);
  finish({ status: "needs_clarification", interaction: { id: "token" }, clarification: { question: "Price?" } });
  await pending;
  assert.ok(f.chunks.some(chunk => /"type":"result"/.test(chunk))); assert.equal(f.response.writableEnded, true);
  const json = mockResponse();
  await new SparrowChatController({ sendMessage: async () => ({ status: "complete", content: "Done", thinking: [] }) } as any).sendMessage({ body: { projectId: "p1", message: "Hello" }, headers: {} } as any, json.response);
  assert.equal(json.response.body.data.content, "Done"); assert.equal(json.chunks.length, 0);
});

test("frontend parser renders progress before final result, across fragmented UTF-8 and CRLF", async () => {
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  const updates: any[] = []; let completed = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; } });
  const pending = readSparrowStream(new Response(body), (steps: any) => updates.push(steps)).then((value: any) => { completed = true; return value; });
  const bytes = new TextEncoder().encode(': heartbeat\r\n\r\ndata: {"type":"thinking","thinking":[{"time":"00:02","text":"₹ script running","done":false}]}\r\n\r\n');
  for (const byte of bytes) streamController!.enqueue(new Uint8Array([byte]));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(completed, false); assert.equal(updates[0][0].text, "₹ script running");
  streamController!.enqueue(new TextEncoder().encode('data: {"type":"result","data":{"status":"needs_clarification","interaction":{"id":"saved"},"clarification":{"question":"Price?"}}}\n\n'));
  streamController!.close(); const result = await pending;
  assert.equal(result.interaction.id, "saved"); assert.equal(result.clarification.question, "Price?");
});

test("frontend parser distinguishes server errors and an interrupted stream", async () => {
  await assert.rejects(readSparrowStream(new Response('data: {"type":"error","error":"Runner failed"}\n\n')), /Runner failed/);
  await assert.rejects(readSparrowStream(new Response('data: {"type":"thinking","thinking":[]}\n\n')), /before the final response/);
});

test("rapid activity is coalesced and final snapshot is flushed even under backpressure", async () => {
  const f = mockResponse(); let calls = 0;
  f.response.write = (chunk: string) => { f.chunks.push(chunk); calls++; return calls !== 2; };
  const service: any = { sendMessage: async (input: any) => {
    for (let i = 0; i < 100; i++) input.onThinkingUpdate([{ time: "00:01", text: `Log ${i}`, done: false }]);
    return { status: "complete", content: "Done", thinking: [] };
  } };
  await new SparrowChatController(service).sendMessage({ body: { projectId: "p1", userQuery: "Execute" }, headers: { accept: "text/event-stream" } } as any, f.response);
  assert.ok(f.chunks.length < 10); assert.ok(f.chunks.some(chunk => /Log 99/.test(chunk))); assert.ok(f.chunks.at(-1)!.includes('"type":"result"'));
});

test("real HTTP POST sends activity before its delayed final response", async t => {
  const app = express(); app.use(express.json()); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const controller = new SparrowChatController({ sendMessage: async (input: any) => {
    input.onThinkingUpdate([{ time: "00:00", text: "Docker runner started", done: false }]);
    await gate; return { status: "complete", content: "Verified", thinking: [] };
  } } as any);
  app.post("/chat/message", controller.sendMessage);
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => { release(); server.close(); });
  const address = server.address() as any;
  const response = await fetch(`http://127.0.0.1:${address.port}/chat/message`, { method: "POST", headers: { Accept: "text/event-stream", "Content-Type": "application/json" }, body: JSON.stringify({ projectId: "p1", userQuery: "Forecast" }) });
  assert.match(response.headers.get("content-type")!, /text\/event-stream/);
  const updates: any[] = [];
  const resultPromise = readSparrowStream(response, (steps: any) => { updates.push(steps); if (steps.some((step: any) => step.text === "Docker runner started")) release(); });
  const result = await resultPromise;
  assert.equal(result.content, "Verified"); assert.ok(updates.some(steps => steps.some((step: any) => step.text === "Docker runner started")));
});
