import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  saveModularTrainingJobContract,
  ensureProjectRunFolder,
  createProjectSchemaFile,
  generateDateTimeStamp,
  sanitizeName,
} from "../agents/tools/helpers";
import { createAgentGraph } from "../agents/graph";
import { MemorySaver } from "@langchain/langgraph";
import { TrainingConfigService } from "../services/ai/training-config/trainingConfig.service";
import { getProjectSchemasDir } from "../config/fileServer.config";

async function runVerificationTests() {
  console.log("==================================================================");
  console.log(" VERIFICATION: Training Config & Model Selection Confirmation Gate");
  console.log("==================================================================\n");

  let allPassed = true;
  const assert = (condition: boolean, msg: string) => {
    if (condition) {
      console.log(`[PASS] ${msg}`);
    } else {
      console.error(`[FAIL] ${msg}`);
      allPassed = false;
    }
  };

  // Test 1: Verify Graph Interrupt Gates
  console.log("\n--- TEST 1: LangGraph Interrupt Gates ---");
  const checkpointer = new MemorySaver();
  const graph = createAgentGraph(checkpointer);
  const interruptNodes = (graph as any)?.interruptBefore || (graph as any)?.config?.interruptBefore || [];
  console.log("Graph interruptBefore nodes:", interruptNodes);
  assert(
    interruptNodes.includes("trainingConfigurationNode"),
    "trainingConfigurationNode is included in interruptBefore"
  );
  assert(
    interruptNodes.includes("hierarchyMapperNode"),
    "hierarchyMapperNode is included in interruptBefore"
  );
  assert(
    !interruptNodes.includes("modelSelectionNode"),
    "modelSelectionNode is NOT in interruptBefore (executes automatically to produce candidate models before training configuration pause)"
  );


  // Test 2: Model Selection Confirmation & Only Selected Models in Contract
  console.log("\n--- TEST 2: Only Selected Models Saved to Contract on File Server ---");
  const workspaceName = "TestTrainingConfigWS";
  const projectName = "Churn Prediction Pipeline";
  const cleanWsName = sanitizeName(workspaceName);
  const cleanProjName = sanitizeName(projectName);
  const useCaseSlug = cleanProjName.toLowerCase().replace(/[\s-]+/g, "_");
  const runTimestamp = generateDateTimeStamp();

  await createProjectSchemaFile(workspaceName, {
    name: projectName,
    domain: "Telecom",
    subDomain: "Churn",
    useCase: "Predict customer churn probability",
  });

  await ensureProjectRunFolder(workspaceName, projectName, runTimestamp);

  // Initial Model Selection recommendation with 3 candidates
  const initialDecision = {
    target_entity: {
      name: "churn_flag",
      datatype: "binary",
      description: "Whether customer churns in next 30 days",
    },
    recommended_model: {
      model_id: "lightgbm_classifier",
      suitability_score: 0.94,
      framework: "lightgbm",
    },
    candidates: [
      { model_id: "lightgbm_classifier", rank: 1, suitability_score: 0.94, framework: "lightgbm", algorithm: "LGBMClassifier" },
      { model_id: "xgboost_classifier", rank: 2, suitability_score: 0.91, framework: "xgboost", algorithm: "XGBClassifier" },
      { model_id: "logistic_regression", rank: 3, suitability_score: 0.78, framework: "sklearn", algorithm: "LogisticRegression" },
    ],
  };

  // Save initial decision
  await saveModularTrainingJobContract(workspaceName, projectName, initialDecision, runTimestamp);

  // User confirms ONLY 2 models: lightgbm_classifier and xgboost_classifier
  const selectedModelIds = ["lightgbm_classifier", "xgboost_classifier"];
  const userConfirmedDecision = {
    ...initialDecision,
    models: initialDecision.candidates
      .filter((c) => selectedModelIds.includes(c.model_id))
      .map((c) => ({
        model_id: c.model_id,
        framework: c.framework,
        algorithm: c.algorithm,
        enabled: true,
        parameters: {},
      })),
  };

  const saveRes = await saveModularTrainingJobContract(workspaceName, projectName, userConfirmedDecision, runTimestamp);
  console.log(`Saved contract to: ${saveRes.contractPath}`);

  // Inspect the written YAML on disk
  const writtenContent = fs.readFileSync(saveRes.contractPath, "utf-8");
  const parsedYaml: any = yaml.load(writtenContent);

  const persistedModels = parsedYaml?.model_selection?.models || [];
  console.log("Persisted models in contract YAML:", persistedModels.map((m: any) => m.model_id));

  assert(persistedModels.length === 2, `Expected 2 models in contract, found ${persistedModels.length}`);
  assert(
    persistedModels.some((m: any) => m.model_id === "lightgbm_classifier"),
    "lightgbm_classifier is included in models"
  );
  assert(
    persistedModels.some((m: any) => m.model_id === "xgboost_classifier"),
    "xgboost_classifier is included in models"
  );
  assert(
    !persistedModels.some((m: any) => m.model_id === "logistic_regression"),
    "Unselected logistic_regression is NOT included in models"
  );

  // Test 3: TrainingConfigService File Server Read & Write
  console.log("\n--- TEST 3: TrainingConfigService Read and Edit Persistence ---");
  const mockProjectService: any = {
    getProjectWithWorkspace: async (_id: string) => ({
      workspaceName,
      project: {
        id: "mock-proj-123",
        name: projectName,
        agentState: { runTimestamp },
      },
    }),
    updateAgentState: async (_id: string, _state: any) => {},
  };

  const trainingConfigService = new TrainingConfigService(mockProjectService);

  // Read contract
  const contractRes = await trainingConfigService.getContract("mock-proj-123", runTimestamp);
  assert(Boolean(contractRes.yamlContent), "Contract YAML content successfully read from file server");
  assert(contractRes.filename.includes("_training_job_contract_"), `Filename matches convention: ${contractRes.filename}`);

  // Modify contract YAML (e.g. update max_trials to 77 and train_ratio to 0.80)
  const modifiedYaml = contractRes.yamlContent
    .replace(/max_trials:\s*\d+/g, "max_trials: 77")
    .replace(/train_ratio:\s*[\d.]+/g, "train_ratio: 0.80");

  const saveEditedRes = await trainingConfigService.saveContract("mock-proj-123", modifiedYaml, runTimestamp);
  assert(saveEditedRes.success === true, "saveContract returned success");

  // Re-read file directly from disk to ensure persistence
  const reReadDiskContent = fs.readFileSync(saveEditedRes.filePath, "utf-8");
  const reParsed: any = yaml.load(reReadDiskContent);

  assert(
    reParsed.hyperparameter_optimization?.max_trials === 77 || reReadDiskContent.includes("max_trials: 77"),
    "Edited max_trials (77) correctly persisted to file server"
  );
  assert(
    reParsed.split?.train_ratio === 0.8 || reReadDiskContent.includes("train_ratio: 0.8"),
    "Edited train_ratio (0.80) correctly persisted to file server"
  );

  // Test 4: Invalid YAML Rejection
  console.log("\n--- TEST 4: Invalid YAML Syntax Rejection ---");
  const badYaml = "task:\n  task_type: [unclosed bracket";
  let rejected = false;
  try {
    await trainingConfigService.saveContract("mock-proj-123", badYaml, runTimestamp);
  } catch (err: any) {
    rejected = true;
    console.log(`[PASS] Correctly rejected invalid YAML: ${err.message}`);
  }
  assert(rejected, "Invalid YAML syntax was rejected by service");

  console.log("\n==================================================================");
  if (allPassed) {
    console.log(" ALL VERIFICATION TESTS PASSED SUCCESSFULLY! ✓");
  } else {
    console.error(" SOME TESTS FAILED!");
  }
  console.log("==================================================================");

  // Clean up test folder
  try {
    const schemasDir = getProjectSchemasDir(workspaceName, projectName, runTimestamp);
    fs.rmSync(path.dirname(schemasDir), { recursive: true, force: true });
  } catch {}
}

runVerificationTests().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
