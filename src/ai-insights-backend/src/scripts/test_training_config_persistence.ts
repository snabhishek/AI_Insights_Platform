import fs from "fs";
import yaml from "js-yaml";
import {
  saveModularTrainingJobContract,
  ensureProjectRunFolder,
  createProjectSchemaFile,
  generateDateTimeStamp,
} from "../agents/tools/helpers";
import { createTrainingConfigGraph } from "../agents/ModelTrainingValidation/TrainingConfiguration/trainingConfigGraph";

async function runPersistenceTest() {
  console.log("==================================================================");
  console.log(" AUTOMATED TEST: 4-Model Selection & Training Config Persistence");
  console.log("==================================================================\n");

  let allPassed = true;
  const assert = (cond: boolean, msg: string) => {
    if (cond) {
      console.log(`[PASS] ${msg}`);
    } else {
      console.error(`[FAIL] ${msg}`);
      allPassed = false;
    }
  };

  const workspaceName = "TestPersistenceWS";
  const projectName = "Customer Churn Prediction";
  const runTimestamp = generateDateTimeStamp();

  await createProjectSchemaFile(workspaceName, {
    name: projectName,
    domain: "Telecom",
    subDomain: "Retention",
    useCase: "Customer churn prediction",
  });
  await ensureProjectRunFolder(workspaceName, projectName, runTimestamp);

  // 1. Initial 6 candidate models from Model Selection
  const initialCandidates = [
    { model_id: "lightgbm_classifier", rank: 1, suitability_score: 0.96, framework: "lightgbm", algorithm: "LGBMClassifier" },
    { model_id: "xgboost_classifier", rank: 2, suitability_score: 0.94, framework: "xgboost", algorithm: "XGBClassifier" },
    { model_id: "catboost_classifier", rank: 3, suitability_score: 0.91, framework: "catboost", algorithm: "CatBoostClassifier" },
    { model_id: "random_forest_classifier", rank: 4, suitability_score: 0.87, framework: "sklearn", algorithm: "RandomForestClassifier" },
    { model_id: "logistic_regression", rank: 5, suitability_score: 0.81, framework: "sklearn", algorithm: "LogisticRegression" },
    { model_id: "mlp_classifier", rank: 6, suitability_score: 0.78, framework: "sklearn", algorithm: "MLPClassifier" },
  ];

  // User specifically selects 4 models: LightGBM, XGBoost, CatBoost, RandomForest
  const userSelected4 = ["lightgbm_classifier", "xgboost_classifier", "catboost_classifier", "random_forest_classifier"];

  console.log("--- TEST 1: User selects 4 models and saves contract ---");
  const decisionPayload = {
    target_entity: { name: "Churn" },
    candidates: initialCandidates,
    recommended_model: initialCandidates[0],
    userSelection: {
      selectedModelIds: userSelected4,
      confirmedAt: new Date().toISOString(),
    },
    selectedModelIds: userSelected4,
    // Pass as string IDs to test string normalization in schemaHelper
    models: userSelected4,
  };

  const saveRes = await saveModularTrainingJobContract(workspaceName, projectName, decisionPayload, runTimestamp);
  const content = fs.readFileSync(saveRes.contractPath, "utf-8");
  const parsed: any = yaml.load(content);

  const modelsInYaml = parsed?.model_selection?.models || [];
  assert(modelsInYaml.length === 4, `YAML contract has exactly 4 models (got ${modelsInYaml.length})`);
  assert(modelsInYaml.every((m: any) => m.enabled === true), "All 4 models have enabled: true");
  assert(
    userSelected4.every((id) => modelsInYaml.some((m: any) => m.model_id === id)),
    "All 4 selected IDs match in contract"
  );
  assert(
    parsed?.model_selection?.userSelection?.selectedModelIds?.length === 4,
    "userSelection.selectedModelIds is preserved in contract"
  );

  console.log("\n--- TEST 2: LangGraph synthesis strictly enforces all 4 user models ---");
  // Execute trainingConfigGraph with userSelectedIds and mock LLM returning fallback/fewer models
  const graph = createTrainingConfigGraph();
  const graphResult = await graph.invoke({
    messages: [],
    turnCount: 1, // Turn 1 triggers synthesis node directly without re-asking dataset analyser
    isComplete: false,
    datasetAnalysisExplanation: "Dataset contains 10,000 churn records with 15 numerical features and binary target 'Churn'.",
    configuration: {},
    contractPath: "",
    summary: "",
    services: {} as any,
    parentState: { problemType: "classification", targetColumn: "Churn" },
    modelSelection: {
      candidates: initialCandidates,
      userSelection: { selectedModelIds: userSelected4 },
    },
    allCandidates: initialCandidates,
    userSelectedIds: userSelected4,
    projectId: "test-proj",
    runTimestamp,
  });

  const finalModels = graphResult?.configuration?.model_selection?.models || [];
  const finalModelIds = finalModels.map((m: any) => m.model_id);
  console.log("Graph synthesized models:", finalModelIds);

  assert(finalModelIds.length === 4, `Synthesized config has exactly 4 models (got ${finalModelIds.length})`);
  assert(finalModelIds.includes("lightgbm_classifier"), "lightgbm_classifier is included");
  assert(finalModelIds.includes("xgboost_classifier"), "xgboost_classifier is included");
  assert(finalModelIds.includes("catboost_classifier"), "catboost_classifier is included");
  assert(finalModelIds.includes("random_forest_classifier"), "random_forest_classifier is included");
  assert(finalModels.every((m: any) => m.enabled === true), "All 4 synthesized models are enabled");

  if (allPassed) {
    console.log("\n==================================================================");
    console.log(" ALL PERSISTENCE AND GRAPH ENFORCEMENT TESTS PASSED! ✓");
    console.log("==================================================================");
  } else {
    process.exit(1);
  }
}

runPersistenceTest().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
