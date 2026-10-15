import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, TestContext } from "node:test";
import yaml from "js-yaml";
import { StateGraph, START, END } from "@langchain/langgraph";
import { AgentState, IngestionServices } from "../agents/state";
import { trainingConfigurationNode } from "../agents/ModelTrainingValidation/nodes";
import { TrainingConfigurationAgent } from "../agents/ModelTrainingValidation/TrainingConfiguration/trainingConfigurationAgent";
import { TrainingConfigValidator } from "../agents/ModelTrainingValidation/TrainingConfiguration/trainingConfigValidator";
import { TrainingConfigService } from "../services/ai/training-config/trainingConfig.service";
import type { ProjectService } from "../services/project/project.service";
import { PostgresProjectRepository } from "../repositories/project.repository";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/connectors";
import { syncTrainingConfigSplitDate } from "../agents/tools/helpers/schemaHelper";
import { getProjectRunDir, getProjectSchemasDir } from "../config/fileServer.config";
import agentUtils = require("../agents/utils/agentUtils");
import dateRangeHelper = require("../agents/tools/helpers/datasetDateRangeHelper");

const timestamp = "20261010-205732";
const workspaceName = "Training Contract Tests";
const projectName = "Forecasting Project";

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "training-contract-state-"));
  const originalPath = process.env.FILE_SERVER_PATH;
  process.env.FILE_SERVER_PATH = directory;
  t.after(async () => {
    if (originalPath === undefined) delete process.env.FILE_SERVER_PATH;
    else process.env.FILE_SERVER_PATH = originalPath;
    await rm(directory, { recursive: true, force: true });
  });
  const schemas = getProjectSchemasDir(workspaceName, projectName, timestamp);
  await mkdir(schemas, { recursive: true });
  const contractPath = path.join(schemas, `forecasting_project_training_job_contract_${timestamp}.yaml`);
  const configuration = { split: { strategy: "temporal", split_date: "2022-04", temporal: { train_end: "2022-04" } },
    model_selection: { models: [{ model_id: "lightgbm_sota" }] } };
  await writeFile(contractPath, yaml.dump(configuration));
  const output = { status: "Completed", phase: "Training Configuration", summary: "Configured", contractPath, configuration };
  const state = { runTimestamp: timestamp, trainingConfiguration: { status: "Pending", models: ["lightgbm_sota"] },
    stageOutputs: { trainingConfigurationNode: output }, stageStatuses: { trainingConfigurationNode: "Completed" } };
  return { state, output, contractPath, directory };
}

test("split synchronization uses the completed stage output despite a pending top-level payload", async t => {
  const { state, contractPath } = await fixture(t);
  const pythonConfig = path.join(getProjectRunDir(workspaceName, projectName, timestamp), "forecasting_model_training", "configs", "training_config.yaml");
  await mkdir(path.dirname(pythonConfig), { recursive: true });
  await writeFile(pythonConfig, yaml.dump({ split: { split_date: "2022-04" } }));
  const result = await syncTrainingConfigSplitDate(workspaceName, projectName, "2022-05", state, timestamp);
  assert.equal(result.contractPath, contractPath);
  const saved = yaml.load(await readFile(contractPath, "utf8")) as typeof state.stageOutputs.trainingConfigurationNode.configuration;
  assert.equal(saved.split.split_date, "2022-05");
  assert.equal(saved.split.temporal.train_end, "2022-05");
  assert.deepEqual(saved.model_selection.models, [{ model_id: "lightgbm_sota" }]);
  assert.equal(state.trainingConfiguration, state.stageOutputs.trainingConfigurationNode);
  const python = yaml.load(await readFile(pythonConfig, "utf8")) as { split: { split_date: string } };
  assert.equal(python.split.split_date, "2022-05");
});

test("missing canonical contract fails before changing the supplied state", async t => {
  const { state, directory } = await fixture(t);
  state.stageOutputs.trainingConfigurationNode.contractPath = path.join(directory, "missing.yaml");
  const before = structuredClone(state);
  await assert.rejects(syncTrainingConfigSplitDate(workspaceName, projectName, "2022-05", state, timestamp), /contract file is unavailable/);
  assert.deepEqual(state, before);
});

test("contract retrieval and split-date API synchronization use the same persisted contract", async t => {
  const { state, contractPath } = await fixture(t);
  let persisted: unknown;
  const projectService = {
    getProjectWithWorkspace: async () => ({ workspaceName, project: { name: projectName, agentState: state } }),
    updateAgentState: async (_id: string, value: unknown) => { persisted = value; },
  } as unknown as ProjectService;
  const service = new TrainingConfigService(projectService);
  assert.equal((await service.getContract("fixture-project", timestamp)).filePath, contractPath);
  const synced = await service.syncSplitDate("fixture-project", "2022-05", timestamp);
  assert.equal(synced.filePath, contractPath);
  assert.equal(persisted, state);
  assert.equal(synced.parsedConfig.split.split_date, "2022-05");
});

test("training node persists its completed output in the graph's declared state channel", async t => {
  const { output } = await fixture(t);
  t.mock.method(TrainingConfigurationAgent, "execute", async () => output);
  t.mock.method(TrainingConfigValidator, "validate", () => ({ isValid: true, errors: [] }));
  t.mock.method(agentUtils, "getModel", () => undefined);
  t.mock.method(dateRangeHelper, "extractDatasetDateRange", async () => ({ hasTemporalData: false }));
  const graph = new StateGraph(AgentState)
    .addNode("trainingConfigurationNode", trainingConfigurationNode)
    .addEdge(START, "trainingConfigurationNode")
    .addEdge("trainingConfigurationNode", END)
    .compile();
  const result = await graph.invoke({ trainingConfiguration: { status: "Pending" }, runTimestamp: timestamp },
    { configurable: { services: {} as IngestionServices } });
  assert.equal(result.trainingConfiguration.contractPath, output.contractPath);
  assert.equal(result.trainingConfiguration.status, "Completed");
  assert.equal(result.stageOutputs.trainingConfigurationNode?.contractPath, output.contractPath);
});

test("existing saved runs restore the completed configuration from their canonical stage output", async t => {
  const { state, contractPath } = await fixture(t);
  const db = { select: () => ({ from: (table: unknown) => ({ where: () => table === schema.projects
    ? Promise.resolve([{ id: "fixture-project", name: projectName, role: "OWNER", agentState: {} }])
    : { orderBy: () => ({ limit: async () => [{ agentState: state, status: "Awaiting Approval" }] }) },
  }) }) } as unknown as NodePgDatabase<typeof schema>;
  const project = await new PostgresProjectRepository(db).getById("fixture-project");
  assert.equal(project?.agentState?.trainingConfiguration?.contractPath, contractPath);
  assert.equal(project?.agentState?.trainingConfiguration?.status, "Completed");
});

test("training node cannot mark an unsaved contract as completed", async t => {
  const { output } = await fixture(t);
  t.mock.method(TrainingConfigurationAgent, "execute", async () => ({ ...output, contractPath: "" }));
  t.mock.method(TrainingConfigValidator, "validate", () => ({ isValid: true, errors: [] }));
  t.mock.method(agentUtils, "getModel", () => undefined);
  await assert.rejects(trainingConfigurationNode({} as typeof AgentState.State,
    { configurable: { services: {} as IngestionServices } }), /did not complete with a persisted contract/);
});
