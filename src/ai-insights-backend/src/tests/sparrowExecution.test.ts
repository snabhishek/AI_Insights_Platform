import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SparrowExecutionService, SparrowScriptAgent, insideProject, inspectScriptArtifacts } from "../services/ai/sparrow-execution/sparrowExecution.service";
import { executeProcess, ensureDockerCompose } from "../agents/tools/helpers/pythonExecutor";
import yaml from "js-yaml";
import { createExecuteProjectScriptTool } from "../agents/sparrow/tools/scriptExecution.tools";

const prediction = { predictionObjectiveStartDate: "2026-11-01", predictionHorizon: 2, predictionFrequency: "Monthly", selectedModels: ["m1"] };
const output = { success: true, targetColumn: "units", modelResults: [{ modelId: "m1", periods: [{ period: "2026-11-01", predicted: 10 }, { period: "2026-12-01", predicted: 12 }] }] };

test("generic Python delegation passes the actual task, evidence and live worker progress", async () => {
  let received: any; const updates: string[] = [];
  const tool = createExecuteProjectScriptTool("p1", { execute: async (request, report) => {
    received = request; report?.("Running analytical script");
    return { success: true, output: { success: true, results: { median: 7 } }, artifacts: { result: "run/sparrow/task/result.json" } };
  } });
  const state = { userQuery: "Compute the median using Python", queryUnderstanding: { intent: "ANALYZE" },
    toolResults: [{ toolName: "queryProjectData", success: true, data: { rows: [{ value: 7 }] } }], clarificationHistory: [] } as any;
  const result = await tool.invokeWithContext({ task: "Compute median from the evidenced values" }, state, { onProgress: text => updates.push(text) });
  assert.equal(received.task, "Compute median from the evidenced values"); assert.equal(received.evidence.userQuery, state.userQuery);
  assert.deepEqual(received.evidence.toolResults, state.toolResults); assert.equal(received.prediction, undefined);
  assert.ok("results" in result); assert.equal(result.results.results.median, 7); assert.deepEqual(updates, ["Running analytical script"]);
});
function fixture(t: any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sparrow-execution-"));
  // Exact temporary directory generated here, never a computed project directory.
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "run", "model_validation"), { recursive: true });
  const source = path.join(root, "run", "model_validation", "predict.py");
  fs.writeFileSync(source, "# existing saved-model inference contract\n");
  const projectService = { getById: async () => ({ name: "Fixture", agentState: { runTimestamp: "run" } }),
    getProjectWithWorkspace: async () => ({ workspaceName: "Fixture", project: { name: "Fixture" } }),
    update: () => { throw new Error("Prediction must not update training/validation state."); } } as any;
  return { root, source, projectService };
}

test("independent execution reuses a copy, forwards isolation/logging, and keeps original state intact", async t => {
  const f = fixture(t); const updates: string[] = []; const dirs: string[] = [];
  const service = new SparrowExecutionService(f.projectService, { resolveRoot: () => f.root,
    prepare: async (_context, read, report) => {
      assert.match(read("run/model_validation/predict.py"), /existing saved-model/);
      report("Adapting existing prediction code.");
      return { script: "# adapted runner", requirements: ["statsmodels"], reusedSources: ["run/model_validation/predict.py"], explanation: "Reuse" };
    },
    execute: async (script, code, project, run, services, connectors, requirements, args, limits, options) => {
      assert.equal(options?.isolated, true); assert.equal(options?.projectRootDir, f.root);
      assert.equal(run, "run"); assert.equal(code, "# adapted runner"); assert.deepEqual(requirements, ["statsmodels"]);
      const dir = path.dirname(script); dirs.push(dir);
      options?.onLog?.("[2026-10-09 16:00:00.001] [stdout] prediction started");
      fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify(output));
      return { success: true, stdout: "prediction started", stderr: "" };
    },
  });
  for (let i = 0; i < 2; i++) {
    const result = await service.execute({ projectId: "p1", task: "Predict units", prediction }, text => updates.push(text));
    assert.equal(result.success, true); assert.deepEqual(result.output, output);
    assert.match(result.artifacts!.script, /run\/sparrow\/[a-z0-9-]+\/runner.py/);
    const events = fs.readFileSync(path.join(f.root, result.artifacts!.events), "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.ok(events.every(event => Number.isFinite(Date.parse(event.timestamp))));
  }
  assert.notEqual(dirs[0], dirs[1]); assert.ok(updates.some(text => /prediction started/.test(text)));
  assert.equal(fs.readFileSync(f.source, "utf8"), "# existing saved-model inference contract\n");
});

test("worker repairs the actual failure once and never accepts stale or duplicate forecast output", async t => {
  const f = fixture(t); const failures: Array<string | undefined> = []; let runs = 0;
  const service = new SparrowExecutionService(f.projectService, { resolveRoot: () => f.root,
    prepare: async (_context, _read, _report, failure) => { failures.push(failure); return { script: "# runner", requirements: [], reusedSources: [], explanation: "Fix" }; },
    execute: async script => {
      runs++; const resultFile = path.join(path.dirname(script), "result.json");
      assert.equal(fs.existsSync(resultFile), false);
      fs.writeFileSync(resultFile, JSON.stringify(runs === 1 ? { ...output, modelResults: [{ modelId: "m1", periods: [output.modelResults[0].periods[0], output.modelResults[0].periods[0]] }] } : output));
      return { success: true, stdout: "", stderr: "" };
    },
  });
  const result = await service.execute({ projectId: "p1", task: "Predict", prediction });
  assert.equal(result.success, true); assert.equal(runs, 2); assert.match(failures[1]!, /duplicate forecast dates/);
});

test("script exceptions are bounded to two attempts and returned as failures", async t => {
  const f = fixture(t); let attempts = 0;
  const service = new SparrowExecutionService(f.projectService, { resolveRoot: () => f.root,
    prepare: async () => ({ script: "# runner", requirements: [], reusedSources: [], explanation: "Run" }),
    execute: async () => { attempts++; throw new Error("Missing fitted preprocessor"); },
  });
  const result = await service.execute({ projectId: "p1", task: "Predict", prediction });
  assert.equal(result.success, false); assert.match(result.error!, /Missing fitted preprocessor/); assert.equal(attempts, 2);
});

test("artifact access stays within the current run and rejects traversal", t => {
  const f = fixture(t);
  assert.throws(() => insideProject(f.root, "../outside"), /relative/);
  assert.throws(() => insideProject(f.root, f.source), /relative/);
  assert.deepEqual(inspectScriptArtifacts(f.root, "run").map(item => item.path), ["run/model_validation/predict.py"]);
});

test("isolated Docker compose preserves read-only inputs and confines writable output", t => {
  const f = fixture(t);
  const file = ensureDockerCompose(path.dirname(f.source), "app", undefined, { writableRelativePath: "run/sparrow/id" });
  const compose: any = yaml.load(fs.readFileSync(file, "utf8")); const config = compose.services.app;
  assert.equal(config.read_only, true); assert.equal(config.network_mode, "none");
  assert.deepEqual(config.cap_drop, ["ALL"]); assert.ok(config.volumes.includes("${HOST_PROJECT_ROOT:-.}:/workspace:ro"));
  assert.ok(config.volumes.includes("${HOST_EXECUTION_DIR}:/workspace/run/sparrow/id:rw"));
});

test("subprocess logs stream complete timestamped lines before completion, including partial final lines", async t => {
  const f = fixture(t); const script = path.join(f.root, "log-fixture.cjs"); const log = path.join(f.root, "log.txt");
  fs.writeFileSync(script, "process.stdout.write('fir'); setTimeout(()=>process.stdout.write('st\\n'),40); setTimeout(()=>process.stderr.write('tail'),80); setTimeout(()=>{},250);");
  const lines: string[] = []; let completed = false; let live = false;
  const pending = executeProcess(`node "${script}"`, { cwd: f.root, logFilePath: log, onLog: line => { lines.push(line); if (line.endsWith("first")) live = !completed; } });
  const result = await pending; completed = true;
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, "first\n"); assert.equal(result.stderr, "tail"); assert.equal(live, true);
  assert.equal(lines.length, 2); assert.ok(lines.every(line => /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] \[(stdout|stderr)\]/.test(line)));
  assert.equal(fs.readFileSync(log, "utf8"), lines.join("\n") + "\n");
});

test("actual configured script worker inspects and reuses existing prediction source", { skip: process.env.SPARROW_EXECUTOR_LIVE !== "1", timeout: 180000 }, async () => {
  const context = { request: { projectId: "fixture", task: "Adapt this saved prediction helper to forecast the requested dates", prediction }, projectName: "Fixture", runTimestamp: "run",
    artifacts: [{ path: "run/model_training/predict.py", bytes: 200 }], requestFile: "/workspace/run/sparrow/id/request.json", outputFile: "/workspace/run/sparrow/id/result.json", outputDirectory: "/workspace/run/sparrow/id" };
  const reads: string[] = [];
  const result = await SparrowScriptAgent.prepare(context, file => { reads.push(file); return "import joblib\ndef predict_periods(periods):\n    model = joblib.load('/workspace/run/model_training/model.joblib')\n    return model.predict([[period.year, period.month] for period in periods]).tolist()\n"; }, console.log);
  assert.ok(reads.length); assert.ok(result.reusedSources.includes("run/model_training/predict.py"));
  assert.match(result.script, /joblib|predict_periods/); assert.ok(result.script.length > 100);
});

test("actual worker and Docker reuse a saved fixture model with read-only project inputs", { skip: process.env.SPARROW_EXECUTOR_DOCKER !== "1", timeout: 600000 }, async t => {
  const f = fixture(t);
  const source = "import json\nfrom pathlib import Path\ndef predict_periods(periods):\n    parameters = json.loads(Path('/workspace/run/model_validation/model.json').read_text())\n    return [parameters['intercept'] + parameters['slope'] * (period.year * 12 + period.month - parameters['origin_month']) for period in periods]\n";
  fs.writeFileSync(f.source, source);
  fs.writeFileSync(path.join(path.dirname(f.source), "model.json"), JSON.stringify({ modelId: "m1", targetColumn: "units", intercept: 10, slope: 2, origin_month: 2026 * 12 + 11 }));
  const service = new SparrowExecutionService(f.projectService, { resolveRoot: () => f.root });
  const result = await service.execute({ projectId: "fixture", task: "Forecast units with saved model m1. Inspect and adapt predict.py, loading its saved parameters from model.json. Preserve the existing inference function. In the runner verify attempting to write /workspace/run/model_validation/predict.py fails (read-only filesystem), and print INPUTS_READ_ONLY after this check. Save the requested dated prediction contract.", prediction }, console.log);
  assert.equal(result.success, true, result.error);
  assert.deepEqual(result.output.modelResults[0].periods, output.modelResults[0].periods);
  assert.equal(fs.readFileSync(f.source, "utf8"), source);
  const log = fs.readFileSync(path.join(f.root, result.artifacts!.dockerLog), "utf8");
  assert.match(log, /INPUTS_READ_ONLY/); assert.match(log, /\[\d{4}-\d{2}-\d{2} .*\] \[stdout\]/);
});
