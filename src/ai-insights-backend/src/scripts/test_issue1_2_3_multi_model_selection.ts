import fs from "fs";
import yaml from "js-yaml";
import {
  saveModularTrainingJobContract,
  ensureProjectRunFolder,
  createProjectSchemaFile,
  generateDateTimeStamp,
  sanitizeName,
} from "../agents/tools/helpers";
import { TrainingConfigService } from "../services/ai/training-config/trainingConfig.service";

async function runIssue123Verification() {
  console.log("==================================================================");
  console.log(" VERIFICATION: Issues 1, 2, 3 Multi-Model Selection & Customization");
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

  const workspaceName = "TestMultiModelWS";
  const projectName = "Store Demand Forecasting";
  const runTimestamp = generateDateTimeStamp();

  await createProjectSchemaFile(workspaceName, {
    name: projectName,
    domain: "Retail",
    subDomain: "Demand",
    useCase: "Store level sales demand prediction",
  });

  await ensureProjectRunFolder(workspaceName, projectName, runTimestamp);

  // 1. Initial agent decision with 4 candidate models
  const initialDecision = {
    target_entity: {
      name: "WeeklySales",
      datatype: "numeric",
      description: "Weekly store sales",
    },
    recommended_model: {
      model_id: "lightgbm_regressor",
      suitability_score: 0.95,
      framework: "lightgbm",
    },
    candidates: [
      { model_id: "lightgbm_regressor", rank: 1, suitability_score: 0.95, framework: "lightgbm", algorithm: "LightGBM Regressor" },
      { model_id: "xgboost_regressor", rank: 2, suitability_score: 0.92, framework: "xgboost", algorithm: "XGBoost Regressor" },
      { model_id: "catboost_regressor", rank: 3, suitability_score: 0.89, framework: "catboost", algorithm: "CatBoost Regressor" },
      { model_id: "random_forest_regressor", rank: 4, suitability_score: 0.84, framework: "sklearn", algorithm: "RandomForestRegressor" },
    ],
  };

  // User selects ALL 4 candidate models (Issue 1 & 2 verification)
  const selected4Models = ["lightgbm_regressor", "xgboost_regressor", "catboost_regressor", "random_forest_regressor"];

  console.log("--- TEST A: User selects 4 models ---");
  const userConfirmedDecision = {
    ...initialDecision,
    userSelection: {
      selectedModelIds: selected4Models,
      confirmedAt: new Date().toISOString(),
    },
    selectedModelIds: selected4Models,
    models: initialDecision.candidates.map((c) => ({
      model_id: c.model_id,
      framework: c.framework,
      algorithm: c.algorithm,
      suitability_score: c.suitability_score,
      enabled: true,
      parameters: {},
    })),
  };

  const saveRes = await saveModularTrainingJobContract(workspaceName, projectName, userConfirmedDecision, runTimestamp);
  console.log(`Saved contract to: ${saveRes.contractPath}`);

  // Read back contract YAML from file system
  const writtenContent = fs.readFileSync(saveRes.contractPath, "utf-8");
  const parsedYaml: any = yaml.load(writtenContent);
  const persistedModels = parsedYaml?.model_selection?.models || [];
  const persistedModelIds = persistedModels.map((m: any) => m.model_id);

  console.log("Persisted Model IDs in YAML contract:", persistedModelIds);
  assert(persistedModelIds.length === 4, `All 4 models persisted in contract (got ${persistedModelIds.length})`);
  assert(persistedModelIds.includes("lightgbm_regressor"), "lightgbm_regressor is persisted");
  assert(persistedModelIds.includes("xgboost_regressor"), "xgboost_regressor is persisted");
  assert(persistedModelIds.includes("catboost_regressor"), "catboost_regressor is persisted");
  assert(persistedModelIds.includes("random_forest_regressor"), "random_forest_regressor is persisted");

  // 2. Issue 3: In-place update from Training Configuration (e.g. user toggles off random_forest, now 3 models)
  console.log("\n--- TEST B: Re-select models inside Training Configuration (Issue 3 enhancement) ---");
  const reSelected3Models = ["lightgbm_regressor", "xgboost_regressor", "catboost_regressor"];
  const updatedDecision = {
    ...initialDecision,
    userSelection: {
      selectedModelIds: reSelected3Models,
      confirmedAt: new Date().toISOString(),
    },
    selectedModelIds: reSelected3Models,
    models: initialDecision.candidates
      .filter((c) => reSelected3Models.includes(c.model_id))
      .map((c) => ({
        model_id: c.model_id,
        framework: c.framework,
        algorithm: c.algorithm,
        suitability_score: c.suitability_score,
        enabled: true,
        parameters: {},
      })),
  };

  const saveRes2 = await saveModularTrainingJobContract(workspaceName, projectName, updatedDecision, runTimestamp);
  const writtenContent2 = fs.readFileSync(saveRes2.contractPath, "utf-8");
  const parsedYaml2: any = yaml.load(writtenContent2);
  const persistedModels2 = parsedYaml2?.model_selection?.models || [];
  const persistedModelIds2 = persistedModels2.map((m: any) => m.model_id);

  console.log("Updated Model IDs in YAML contract:", persistedModelIds2);
  assert(persistedModelIds2.length === 3, `3 models persisted in contract after in-place customization (got ${persistedModelIds2.length})`);
  assert(!persistedModelIds2.includes("random_forest_regressor"), "Deselected model random_forest_regressor was excluded from contract");

  if (allPassed) {
    console.log("\n==================================================================");
    console.log(" ALL 4 ISSUES AND ENHANCEMENTS VERIFIED SUCCESSFULLY! ✓");
    console.log("==================================================================");
  } else {
    process.exit(1);
  }
}

runIssue123Verification().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
