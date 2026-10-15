import assert from "node:assert/strict";
import { test, TestContext } from "node:test";
import { chatModeSchema, resolveTurnChatMode } from "../agents/sparrow/chatMode";
import { createSparrowModel, bindSparrowTools } from "../agents/sparrow/modelAdapter";
import { sparrowRunContext } from "../agents/sparrow/executionContext";
import { ModelProvider, parseModelParameters } from "../agents/utils/modelRuntime";
import { SparrowChatController } from "../controllers/sparrowChat.controller";
import { z } from "zod";

function environment(t: TestContext, values: Record<string, string | undefined>) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("response mode validates explicit choices without assigning a mode to existing callers", () => {
  assert.equal(chatModeSchema.optional().parse(undefined), undefined);
  for (const invalid of [null, "", "auto", "MAX", {}, true]) assert.equal(chatModeSchema.optional().safeParse(invalid).success, false);
  assert.equal(resolveTurnChatMode(undefined, "expert", false), undefined);
  assert.equal(resolveTurnChatMode("fast", "expert", false), "fast");
  assert.equal(resolveTurnChatMode(undefined, "expert", true), "expert");
  assert.equal(resolveTurnChatMode(undefined, undefined, true), undefined);
  assert.throws(() => resolveTurnChatMode("fast", "expert", true), /original request/);
  assert.throws(() => resolveTurnChatMode("expert", undefined, true), /original request/);
});

test("controller rejects invalid modes before starting SSE or executing the agent", async () => {
  let calls = 0;
  const controller = new SparrowChatController({ sendMessage: async () => { calls++; } } as any);
  for (const chatMode of [null, "", "high", false]) {
    let status: number | undefined;
    const response = { status: (code: number) => { status = code; return response; }, json: () => {},
      setHeader: () => { throw new Error("Invalid input must not start streaming."); } } as any;
    await controller.sendMessage({ body: { userQuery: "Analyze", projectId: "p1", chatMode }, headers: { accept: "text/event-stream" } } as any, response);
    assert.equal(status, 400);
  }
  assert.equal(calls, 0);
});

test("native model controls reject unknown parameters and deployment mismatches", t => {
  environment(t, { AI_PROVIDER: "litellm", LITELLM_MODEL: "configured-model", LITELLM_PROXY_URL: "https://gateway.invalid/v1", LITELLM_VIRTUAL_KEY: "test-key" });
  assert.throws(() => parseModelParameters("litellm", { temperature: 9 }), /Unrecognized/);
  assert.throws(() => parseModelParameters("ollama", { think: "guessed-level" }));
  assert.throws(() => parseModelParameters("gemini", { thinkingConfig: {} }));
  assert.throws(() => parseModelParameters("gemini", { thinkingConfig: { thinkingLevel: "HIGH", thinkingBudget: 1024 } }));
  assert.throws(() => createSparrowModel("expert", JSON.stringify({ provider: "litellm", model: "another-model",
    fast: { reasoning_effort: "low" }, expert: { reasoning_effort: "high" } })), /do not match/);
  assert.throws(() => createSparrowModel("expert", "{}"));
  assert.equal(createSparrowModel("expert", undefined).modeStrategy, "application");
  assert.equal(createSparrowModel(undefined, "invalid unused native configuration").modeStrategy, undefined);
});

const tool = { type: "function" as const, function: { name: "respond", description: "Respond using the evidence", parameters: { type: "object", properties: {}, additionalProperties: false } } };

test("provider adapters forward declared native controls in actual HTTP request bodies", async t => {
  const providers: Array<{ provider: ModelProvider; model: string; env: Record<string, string>; fast: Record<string, unknown>; expert: Record<string, unknown> }> = [
    { provider: "litellm", model: "vendor/custom-model", env: { LITELLM_PROXY_URL: "https://gateway.invalid/v1", LITELLM_VIRTUAL_KEY: "test-key", LITELLM_MODEL: "vendor/custom-model" }, fast: { reasoning_effort: "low" }, expert: { reasoning_effort: "high" } },
    { provider: "openai", model: "gpt-5-test", env: { OPENAI_API_KEY: "test-key", OPENAI_MODEL: "gpt-5-test" }, fast: { reasoning_effort: "low", verbosity: "low" }, expert: { reasoning_effort: "high", verbosity: "high" } },
    { provider: "azure", model: "azure-deployment", env: { AZURE_OPENAI_API_KEY: "test-key", AZURE_OPENAI_ENDPOINT: "https://azure.invalid/", AZURE_OPENAI_DEPLOYMENT_NAME: "azure-deployment", AZURE_OPENAI_MODEL: "gpt-5-test", AZURE_OPENAI_API_VERSION: "2025-03-01-preview" }, fast: { reasoning_effort: "low", verbosity: "low" }, expert: { reasoning_effort: "high", verbosity: "high" } },
    { provider: "openai-compatible", model: "custom-deployment", env: { OPENAI_COMPATIBLE_BASE_URL: "https://custom.invalid/v1", OPENAI_COMPATIBLE_API_KEY: "test-key", OPENAI_COMPATIBLE_MODEL: "custom-deployment" }, fast: { reasoning_effort: "low" }, expert: { reasoning_effort: "high" } },
    { provider: "anthropic", model: "claude-test", env: { ANTHROPIC_API_KEY: "test-key", ANTHROPIC_MODEL: "claude-test", ANTHROPIC_MAX_TOKENS: "8192" }, fast: { thinking: { type: "disabled" }, output_config: { effort: "low" } }, expert: { thinking: { type: "adaptive" }, output_config: { effort: "high" } } },
    { provider: "ollama", model: "local-test", env: { OLLAMA_BASE_URL: "https://ollama.invalid", OLLAMA_MODEL: "local-test" }, fast: { think: false }, expert: { think: true } },
    { provider: "gemini", model: "gemini-test", env: { GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-test" }, fast: { thinkingConfig: { thinkingLevel: "LOW" } }, expert: { thinkingConfig: { thinkingLevel: "HIGH" } } },
  ];
  for (const fixture of providers) await t.test(fixture.provider, async sub => {
    environment(sub, { AI_PROVIDER: fixture.provider, ...fixture.env });
    let captured: Record<string, any> | undefined;
    sub.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      if (fixture.provider === "anthropic") return new Response(JSON.stringify({ id: "msg-1", type: "message", role: "assistant", model: fixture.model,
        content: [{ type: "tool_use", id: "call-1", name: "respond", input: {} }], stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } }), { headers: { "content-type": "application/json" } });
      if (fixture.provider === "gemini") return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "respond", args: {} } }] }, finishReason: "STOP" }] }), { headers: { "content-type": "application/json" } });
      if (fixture.provider === "ollama") return new Response(`${JSON.stringify({ model: fixture.model, message: { role: "assistant", content: "", tool_calls: [{ function: { name: "respond", arguments: {} } }] }, done: true })}\n`, { headers: { "content-type": "application/x-ndjson" } });
      return new Response(JSON.stringify({ id: "completion-1", object: "chat.completion", model: fixture.model, choices: [{ index: 0, finish_reason: "tool_calls", message: {
        role: "assistant", content: "", tool_calls: [{ id: "call-1", type: "function", function: { name: "respond", arguments: "{}" } }],
      } }] }), { headers: { "content-type": "application/json" } });
    });
    for (const mode of ["fast", "expert"] as const) {
      const adapter = createSparrowModel(mode, JSON.stringify({ provider: fixture.provider, model: fixture.model, fast: fixture.fast, expert: fixture.expert }));
      const response = await bindSparrowTools(adapter, [tool]).invoke("Respond using this evidence.");
      assert.equal(response.tool_calls?.[0].name, "respond");
      assert.equal(adapter.modeStrategy, "application+native");
      assert.ok(captured);
      const actual = fixture.provider === "gemini" ? captured.generationConfig : captured;
      for (const [key, value] of Object.entries(fixture[mode])) assert.deepEqual(actual[key], value, `${fixture.provider} must forward ${key}`);
      if ("reasoning_effort" in fixture[mode]) assert.equal(actual.temperature, undefined, "Native reasoning must not inherit legacy fixed temperature.");
      const structured = await adapter.model.withStructuredOutput(z.object({}), { name: "respond", method: "functionCalling" }).invoke("Call respond with the structured result.");
      assert.deepEqual(structured, {});
      const structuredRequest = fixture.provider === "gemini" ? captured.generationConfig : captured;
      for (const [key, value] of Object.entries(fixture[mode])) assert.deepEqual(structuredRequest[key], value, `${fixture.provider} structured output must retain ${key}`);
      if ("reasoning_effort" in fixture[mode]) assert.equal(structuredRequest.temperature, undefined);
    }
  });
});

test("concurrent response modes stay inside their own asynchronous request context", async () => {
  const seen: string[] = [];
  await Promise.all((["expert", "fast"] as const).map(chatMode => sparrowRunContext.run({
    projectId: "p1", conversationId: chatMode, requestId: chatMode,
    chatMode, signal: new AbortController().signal, thinking: [],
  }, async () => {
    await Promise.resolve();
    seen.push(sparrowRunContext.getStore()!.chatMode!);
  })));
  assert.deepEqual(seen.sort(), ["expert", "fast"]);
  assert.equal(sparrowRunContext.getStore(), undefined);
});
