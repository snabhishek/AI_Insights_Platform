import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { z } from "zod";
import { HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ProjectService } from "../../project/project.service";
import { getProjectDir, getLatestProjectTimestamp } from "../../../config/fileServer.config";
import { getModel, getPromptFromFile } from "../../../agents/utils/agentUtils";
import { decisionTransportSchema } from "../../../agents/sparrow/llm";
import { executePythonScript, cleanupRunContainer } from "../../../agents/tools/helpers/pythonExecutor";
import { IngestionServices } from "../../../agents/state";
import { advancePeriod, dateOnly } from "../../../agents/sparrow/forecastWindow";
import { sparrowRunContext, sparrowSignal, throwIfSparrowStopped } from "../../../agents/sparrow/executionContext";

export interface SparrowExecutionRequest {
  projectId: string;
  task: string;
  prediction?: { predictionObjectiveStartDate: string; predictionHorizon: number; predictionFrequency: string; selectedModels: string[] };
  evidence?: unknown;
}
export interface ISparrowExecutionService {
  execute(request: SparrowExecutionRequest, onProgress?: (text: string) => void): Promise<{ success: boolean; output?: any; error?: string; artifacts?: Record<string, string> }>;
}
export interface ScriptArtifact { path: string; bytes: number }
export interface ScriptTaskContext {
  request: SparrowExecutionRequest; projectName: string; runTimestamp: string;
  artifacts: ScriptArtifact[]; requestFile: string; outputFile: string; outputDirectory: string;
  previousScript?: string;
}
const scriptSchema = z.object({
  script: z.string().min(1).max(200000), requirements: z.array(z.string()).max(30),
  reusedSources: z.array(z.string()).max(30), explanation: z.string().min(1),
}).strict();
type GeneratedScript = z.infer<typeof scriptSchema>;

export function insideProject(root: string, relative: string): string {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) throw new Error("Artifact paths must be relative to the current project.");
  const target = path.resolve(root, relative);
  const within = path.relative(fs.realpathSync(root), fs.realpathSync(target));
  if (within.startsWith("..") || path.isAbsolute(within)) throw new Error("Artifact resolves outside the current project.");
  return target;
}

export function inspectScriptArtifacts(root: string, runTimestamp: string): ScriptArtifact[] {
  const runDir = insideProject(root, runTimestamp);
  const artifacts: ScriptArtifact[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > 6) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || ["docker_logs", "sparrow", "node_modules", "__pycache__", ".git"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full, depth + 1);
      else if (/\.(py|json|ya?ml|txt|parquet|joblib|pkl|csv)$/i.test(entry.name)) {
        artifacts.push({ path: path.relative(root, full).replace(/\\/g, "/"), bytes: fs.statSync(full).size });
        if (artifacts.length > 1000) throw new Error("Project artifact inventory exceeds 1000 entries; narrow the training run.");
      }
    }
  };
  visit(runDir, 0);
  // The project database is shared by stages and may sit beside timestamped runs.
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && /\.(duckdb|db|parquet|csv|arrow)$/i.test(entry.name)) {
      artifacts.push({ path: entry.name, bytes: fs.statSync(path.join(root, entry.name)).size });
    }
  }
  return artifacts;
}

export class SparrowScriptAgent {
  static async prepare(context: ScriptTaskContext, read: (relative: string) => string,
    report: (text: string) => void, failure?: string): Promise<GeneratedScript> {
    const model = getModel();
    if (!model) throw new Error("Configure an LLM provider before preparing a Sparrow script.");
    const prompt = await getPromptFromFile("sparrow-executor/scriptExecutor.md", "");
    if (!prompt.trim()) throw new Error("Sparrow script executor prompt is missing.");
    const readSchema = z.object({ path: z.string().min(1) }).strict();
    const llm = model.bindTools([
      { type: "function", function: { name: "readProjectArtifact", description: "Read a listed text artifact from the active project run. Model binaries and data files are loaded only inside Docker.", parameters: decisionTransportSchema(readSchema) } },
      { type: "function", function: { name: "submitScript", description: "Submit the isolated Python runner and required packages after inspecting applicable existing scripts and contracts.", parameters: decisionTransportSchema(scriptSchema) } },
    ], { tool_choice: "any" });
    const messages: any[] = [new SystemMessage(prompt), new HumanMessage(JSON.stringify({ ...context, executionFailure: failure }))];
    const inspected = new Set<string>();
    for (let step = 0; step < 16; step++) {
      throwIfSparrowStopped();
      const message = await llm.invoke(messages, { signal: sparrowSignal(120000) });
      throwIfSparrowStopped();
      if (message.invalid_tool_calls?.length || message.tool_calls?.length !== 1) throw new Error("Sparrow script worker must select one valid action at a time.");
      messages.push(message);
      const call = message.tool_calls[0];
      if (call.name === "submitScript") {
        const result = scriptSchema.parse(call.args);
        if (!inspected.size) throw new Error("Inspect the existing scripts or training contract before submitting a runner.");
        if (result.reusedSources.some(source => !inspected.has(source))) throw new Error("Reused source must refer to an artifact actually inspected by the script worker.");
        if (result.requirements.some(pkg => !/^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\[[A-Za-z0-9_,.-]+\])?(?:[<>=!~]+[A-Za-z0-9.*+-]+(?:,[<>=!~]+[A-Za-z0-9.*+-]+)*)?$/.test(pkg))) {
          throw new Error("Package requirements must be package names/version constraints, without URLs or installer options.");
        }
        report(result.explanation);
        return result;
      }
      if (call.name !== "readProjectArtifact") throw new Error(`Unknown script worker action '${call.name}'.`);
      const args = readSchema.parse(call.args);
      report(`Inspecting reusable artifact: ${args.path}`);
      let content: string;
      try { content = read(args.path); inspected.add(args.path); }
      catch (error) { content = JSON.stringify({ error: error instanceof Error ? error.message : String(error) }); }
      messages.push(new ToolMessage({ tool_call_id: call.id!, content }));
    }
    throw new Error("Sparrow script preparation exceeded its inspection budget.");
  }
}

export class SparrowExecutionService implements ISparrowExecutionService {
  constructor(private readonly projectService: ProjectService, private readonly deps: {
    prepare?: typeof SparrowScriptAgent.prepare; execute?: typeof executePythonScript;
    resolveRoot?: (project: any, workspace: string) => string;
  } = {}) {}

  async execute(request: SparrowExecutionRequest, onProgress?: (text: string) => void): ReturnType<ISparrowExecutionService["execute"]> {
    throwIfSparrowStopped();
    const project = await this.projectService.getById(request.projectId);
    if (!project) throw new Error("Execution project does not exist.");
    const workspace = await this.projectService.getProjectWithWorkspace(request.projectId);
    if (!workspace?.workspaceName) throw new Error("Resolve the project's workspace before script execution.");
    const projectName = project.projectName || project.name;
    const root = this.deps.resolveRoot?.(project, workspace.workspaceName) || getProjectDir(workspace.workspaceName, projectName);
    const runTimestamp = project.agentState?.runTimestamp || getLatestProjectTimestamp(workspace.workspaceName, projectName);
    if (!runTimestamp) throw new Error("The project has no training/data run available for script execution.");
    const artifacts = inspectScriptArtifacts(root, runTimestamp);
    if (!artifacts.length) throw new Error("The current project run has no usable artifacts.");
    const executionId = randomUUID();
    const relativeDir = `${runTimestamp}/sparrow/${executionId}`;
    const runRoot = insideProject(root, runTimestamp);
    // Do not follow a pre-existing junction/symlink into another project.
    if (fs.existsSync(path.join(runRoot, "sparrow"))) insideProject(root, `${runTimestamp}/sparrow`);
    const outputDir = path.join(root, relativeDir);
    fs.mkdirSync(outputDir, { recursive: true });
    const scriptFile = path.join(outputDir, "runner.py");
    const requestFile = path.join(outputDir, "request.json");
    const resultFile = path.join(outputDir, "result.json");
    const eventsFile = path.join(outputDir, "events.jsonl");
    const report = (text: string) => {
      if (sparrowRunContext.getStore()?.signal.aborted) return;
      const event = { timestamp: new Date().toISOString(), text };
      fs.appendFileSync(eventsFile, `${JSON.stringify(event)}\n`);
      onProgress?.(text);
    };
    fs.writeFileSync(requestFile, JSON.stringify(request, null, 2));
    const context: ScriptTaskContext = { request, projectName, runTimestamp, artifacts,
      requestFile: `/workspace/${relativeDir}/request.json`, outputFile: `/workspace/${relativeDir}/result.json`, outputDirectory: `/workspace/${relativeDir}` };
    const listed = new Set(artifacts.map(artifact => artifact.path));
    let readBytes = 0;
    const read = (relative: string) => {
      if (!listed.has(relative) || !/\.(py|json|ya?ml|txt)$/i.test(relative)) throw new Error("Choose a listed text artifact from the active project run.");
      const full = insideProject(root, relative);
      const bytes = fs.statSync(full).size;
      if (bytes > 200000 || (readBytes += bytes) > 800000) throw new Error("Artifact read exceeds the worker's context budget.");
      return fs.readFileSync(full, "utf8");
    };
    let failure: string | undefined;
    let logFilePath = "";
    try {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          report(`${attempt === 1 ? "Preparing" : "Repairing"} an independent Sparrow script (${attempt}/2), using the active run's artifacts.`);
          const generated = await (this.deps.prepare || SparrowScriptAgent.prepare)(context, read, report, failure);
          throwIfSparrowStopped();
          context.previousScript = generated.script;
          fs.writeFileSync(scriptFile, generated.script);
          fs.writeFileSync(path.join(outputDir, `runner-attempt-${attempt}.py`), generated.script);
          fs.writeFileSync(path.join(outputDir, `preparation-${attempt}.json`), JSON.stringify({ ...generated, script: undefined }, null, 2));
          if (fs.existsSync(resultFile)) fs.unlinkSync(resultFile);
          report("Executing the Sparrow runner in Docker; project inputs are read-only and outputs stay in this execution folder.");
          const result = await (this.deps.execute || executePythonScript)(scriptFile, generated.script, request.projectId, runTimestamp,
            { projectService: this.projectService } as IngestionServices, undefined, generated.requirements, [], undefined,
            { projectRootDir: root, effectiveTimestamp: runTimestamp, sessionId: executionId, isolated: true, onLog: report, signal: sparrowRunContext.getStore()?.signal });
          throwIfSparrowStopped();
          logFilePath = result.logFilePath || "";
          if (!result.success) throw new Error((result.stderr || result.stdout || "Docker execution failed.").slice(-16000));
          if (!fs.existsSync(resultFile) || fs.statSync(resultFile).size > 2000000) throw new Error("Runner must produce a bounded result.json in its output folder.");
          const output = JSON.parse(fs.readFileSync(resultFile, "utf8"));
          if (!output || typeof output !== "object" || Array.isArray(output) || output.success === false || output.error) throw new Error(output?.error || "Runner reported invalid output.");
          if (request.prediction) {
            const prediction = z.object({ targetColumn: z.string().min(1), modelResults: z.array(z.object({ modelId: z.string().min(1),
              periods: z.array(z.object({ period: z.string(), predicted: z.number().finite() })).min(1).max(1000) })).min(1) }).parse(output);
            for (const modelId of request.prediction.selectedModels) {
              const matches = prediction.modelResults.filter(model => model.modelId === modelId);
              if (matches.length !== 1 || matches[0].periods.length !== request.prediction.predictionHorizon) throw new Error(`Runner did not return exactly one complete prediction series for '${modelId}'.`);
              const expected = Array.from({ length: request.prediction.predictionHorizon }, (_, index) => advancePeriod(dateOnly(request.prediction!.predictionObjectiveStartDate), request.prediction!.predictionFrequency, index).toISOString().slice(0, 10));
              if (expected.some(period => matches[0].periods.filter(row => row.period === period).length !== 1)) throw new Error(`Runner returned missing or duplicate forecast dates for '${modelId}'.`);
            }
          }
          report("Sparrow script completed; verified the execution result.");
          return { success: true, output, artifacts: { directory: relativeDir, script: `${relativeDir}/runner.py`, request: `${relativeDir}/request.json`,
            result: `${relativeDir}/result.json`, events: `${relativeDir}/events.jsonl`, dockerLog: logFilePath ? path.relative(root, logFilePath).replace(/\\/g, "/") : "" } };
        } catch (error) {
          throwIfSparrowStopped();
          failure = error instanceof Error ? error.message : String(error);
          report(`Sparrow execution needs correction: ${failure.slice(0, 1200)}`);
        }
      }
      return { success: false, error: failure || "Sparrow script execution failed.", artifacts: { directory: relativeDir, dockerLog: logFilePath } };
    } finally { await cleanupRunContainer(request.projectId, executionId); }
  }
}
