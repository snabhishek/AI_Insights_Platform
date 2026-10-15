# Sparrow reasoning, script execution and streaming

Sparrow owns the analytical method. Its supervisor interprets the request, inspects project evidence, selects one action, reads the actual result, then decides whether to continue, correct a failure, clarify, or answer. Business formulas belong in the agent's selected method; executable tools provide reliable data access and computation. Revenue is not a special tool or a fixed workflow.

## Why Model Validation used to run

`runModelInference` previously called `modelValidationService.validateModels`. That service invoked `ModelValidationAgent`, including the `modelValidationCode` node, and persisted validation state. Setting `future_prediction` changed the validation mode but still launched the validation workflow. Sparrow's inference tool now calls `SparrowExecutionService`; the validation service is used only for its read-only candidate catalog.

## Independent worker

`SparrowScriptAgent` receives a concrete task, the active run's artifact inventory, and request/output paths. Its native actions inspect text artifacts and submit a Python runner. It reads applicable training/validation scripts and fitted model contracts, adapts existing inference logic into a copy, or writes a runner when needed. It never starts the validation agent. Saved-model inference must preserve preprocessing, feature order, target semantics and actual model IDs.

Each task writes to `<run>/sparrow/<execution-id>/`: request.json, runner.py, runner-attempt-N.py, preparation-N.json, result.json, events.jsonl and docker_logs/. This is independent of training/validation reports and project agent state. Execution failures and invalid prediction output allow one repair attempt with the actual error and previous script. The result must cover every requested execution date once per selected model, with finite values and the inspected trained target.

`runModelInference` preserves the existing coverage, model selection, intent and capability checks. It executes all bridge periods after observed history, then trims the displayed window. `executeProjectScript` delegates other Python analysis tasks; the supervisor should use SQL and the general calculator when sufficient. The generic script tool must not bypass inference capability checks.

## Docker and logging

The worker reuses `executePythonScript`, including dependency setup, Docker builds, resource limits, stdout/stderr capture and log files. For Sparrow tasks, the original project is mounted read-only; only the task's output folder and /tmp are writable. The container has no runtime network access. Each execution uses its own Compose project, and cleanup targets that session rather than other training or validation runs.

Python runs unbuffered. The shared subprocess logger buffers complete lines, timestamps stdout/stderr individually, flushes partial final lines, and forwards output while the process is running. MCP filesystem diagnostics previously inherited stderr and bypassed the application's console timestamp wrapper. A dedicated launch wrapper now timestamps diagnostic stderr while preserving MCP protocol stdin/stdout unchanged.

## Live chat

POST `/api/chat/message` with `Accept: text/event-stream` returns SSE activity snapshots, heartbeat comments and a final result event. Existing JSON clients remain supported. Query interpretation, planning, tool starts, script inspection, Docker output and completion emit live progress. Rapid logs are coalesced for transport; durable files retain all execution lines. Disconnecting the browser stops transport writes while the server can finish saving the conversation.

The frontend incrementally decodes SSE, including split UTF-8 characters and CRLF frames, updates the current assistant message, and preserves clarification tokens and final structured output. The activity accordion follows new entries and shows elapsed time with an absolute timestamp tooltip. This is a public decision and execution trace, not private model chain-of-thought or token-level answer streaming.

## Verification

Regression commands from `src/ai-insights-backend`:

```powershell
node -r ts-node/register --test src/tests/sparrowChat.test.ts src/tests/sparrowForecast.test.ts src/tests/sparrowCalculation.test.ts src/tests/sparrowExecution.test.ts src/tests/sparrowStream.test.ts src/tests/sparrowMcpLogging.test.ts
```

Optional real model + Docker fixture:

```powershell
$env:SPARROW_EXECUTOR_DOCKER='1'
node -r ts-node/register --test src/tests/sparrowExecution.test.ts
```

The live fixture adapts an existing saved-model prediction helper, checks that writing the original fails, forecasts two dated periods, and verifies timestamped Docker logs. Fixtures are temporary and do not modify production model state. Both backend and frontend use `npm run build` for compilation verification. Browser visual verification requires an available browser connection.

Verified on 2026-10-09: both application builds passed; 56 regression tests passed (two optional live tests skipped); the separate configured-model/Docker fixture passed, including one observed script repair and read-only input enforcement. Real MCP filesystem reading and timestamped diagnostics passed. No browser was connected, so the UI has compilation and stream-parser evidence but no visual screenshot verification.
