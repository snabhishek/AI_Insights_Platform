import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  saveModularTrainingJobContract,
  ensureProjectRunFolder,
  createProjectSchemaFile,
  getPackagesDir,
  getProjectFilesParent,
  resolveProjectFolderName,
  generateDateTimeStamp,
  sanitizeName,
} from "../agents/tools/helpers";

async function testModelSelectionContractPersistence() {
  console.log("===============================================================");
  console.log(" Testing Model Selection Training Job Contract YAML Persistence ");
  console.log("===============================================================\n");

  const workspaceName = "TestContractWorkspace";
  const projectName = "Inventory Forecasting";
  const cleanWsName = sanitizeName(workspaceName);
  const cleanProjName = sanitizeName(projectName);
  const runSlug = cleanProjName.toLowerCase().replace(/[\s-]+/g, "-");
  const useCaseSlug = cleanProjName.toLowerCase().replace(/[\s-]+/g, "_");

  const packagesDir = getPackagesDir();
  const projectFilesParent = getProjectFilesParent(packagesDir);
  const parentFolderName = resolveProjectFolderName(projectFilesParent, projectName, workspaceName);
  const parentProjectDir = path.resolve(projectFilesParent, parentFolderName);

  // 1. Create project schema files
  console.log("[Step 1] Creating project initial schema file...");
  await createProjectSchemaFile(workspaceName, {
    projectName,
    useCaseName: "Forecast store SKU inventory depletion",
    domain: "Retail",
    subDomain: "Inventory",
    useCase: "Forecast store SKU inventory depletion",
  });

  // 2. Initiate run with timestamp
  const runTimestamp = generateDateTimeStamp();
  console.log(`\n[Step 2] Initiating run with timestamp: ${runTimestamp}`);
  const runSchemasDir = await ensureProjectRunFolder(workspaceName, projectName, runTimestamp);
  console.log(`Created run schemas directory: ${runSchemasDir}`);

  // 3. Prepare Model Selection decision payload from agent
  const agentDecisionPayload = {
    target_entity: {
      name: "UnitsSold",
      datatype: "numeric",
      description: "Weekly SKU units sold",
      source: "sales_fact",
    },
    derivation: "sum(sales.quantity)",
    positive_class: null,
    negative_class: null,
    prediction_grain: {
      entity: "store_sku",
      keys: ["store_id", "sku_id"],
      frequency: "weekly",
    },
    recommended_model: {
      model_id: "lightgbm",
      rank: 1,
      suitability_score: 0.93,
      recommendation: "primary",
    },
    candidates: [
      {
        model_id: "lightgbm",
        rank: 1,
        suitability_score: 0.93,
        recommendation: "primary",
        reasoning: {
          strengths: ["Fast training on tabular", "Handles non-linear relationships"],
          weaknesses: ["Hyperparameter sensitive"],
          suitability: ["Best suited for weekly sales forecasting"],
        },
      },
      {
        model_id: "xgboost",
        rank: 2,
        suitability_score: 0.90,
        recommendation: "alternative",
        reasoning: {
          strengths: ["Robust tree boosting"],
          weaknesses: ["Slower training on large grids"],
          suitability: ["Strong candidate"],
        },
      },
      {
        model_id: "random_forest",
        rank: 3,
        suitability_score: 0.85,
        recommendation: "alternative",
        reasoning: {
          strengths: ["Resistant to overfitting"],
          weaknesses: ["High memory usage"],
          suitability: ["Solid baseline"],
        },
      },
    ],
    primary_metric: "RMSE",
    direction: "minimize",
    tie_breakers: ["simplest_model", "fastest_training"],
    constraints: {
      max_latency_ms: 100,
    },
    selection_strategy: "top_k_candidates",
    training: {
      mode: "automl_search",
      baseline_model: "LinearRegression",
      ensemble: {
        enabled: true,
        strategy: "voting",
      },
      random_seed: 42,
      early_stopping: {
        enabled: true,
        patience: 10,
        metric: "RMSE",
      },
    },
    max_training_time: "45m",
    model_selection_strategy: "highest_validation_score",
    models: [
      {
        model_id: "lightgbm",
        framework: "lightgbm",
        algorithm: "LightGBM Regressor",
        enabled: true,
        parameters: { n_estimators: 200, learning_rate: 0.05 },
      },
      {
        model_id: "xgboost",
        framework: "xgboost",
        algorithm: "XGBoost Regressor",
        enabled: true,
        parameters: { n_estimators: 200, max_depth: 6 },
      },
      {
        model_id: "random_forest",
        framework: "sklearn",
        algorithm: "RandomForestRegressor",
        enabled: true,
        parameters: { n_estimators: 150 },
      },
    ],
  };

  // 4. Save Training Job Contract schema
  console.log("\n[Step 3] Saving Training Job Contract schema...");
  const saveResult = await saveModularTrainingJobContract(
    workspaceName,
    projectName,
    agentDecisionPayload,
    runTimestamp
  );
  console.log(`Saved contract to: ${saveResult.trainingJobContractPath}`);

  // 5. Verification 1: File name follows convention <usecasetitle>_training_job_contract_<timestamp>.yaml
  const expectedFileName = `${useCaseSlug}_training_job_contract_${runTimestamp}.yaml`;
  if (!saveResult.trainingJobContractPath.endsWith(expectedFileName)) {
    throw new Error(`File name mismatch! Expected to end with "${expectedFileName}", got: "${saveResult.trainingJobContractPath}"`);
  }

  // Verification 2: File exists in target run folder
  if (!fs.existsSync(saveResult.trainingJobContractPath)) {
    throw new Error(`Contract file not found at ${saveResult.trainingJobContractPath}`);
  }

  // Verification 3: File content checks
  const contractContent = fs.readFileSync(saveResult.trainingJobContractPath, "utf-8");

  // A. Other sections and comments are preserved untouched
  const requiredSectionsAndComments = [
    "TRAINING JOB CONTRACT — AutoML Platform",
    "x-primary-metric-name: &primary_metric_name",
    "training_job:",
    "task:",
    "upstream_artifacts:",
    "split:",
    "imbalance:",
    "hyperparameter_optimization:",
    "search_space:",
    "objective:",
    "evaluation:",
    "thresholding:",
    "compute:",
    "constraints:",
    "validation_gates:",
    "artifacts:",
    "reproducibility:",
  ];

  for (const token of requiredSectionsAndComments) {
    if (!contractContent.includes(token)) {
      throw new Error(`Expected section/comment "${token}" missing from Training Job Contract YAML!`);
    }
  }

  // B. ONLY model_selection contains the agent response fields
  if (!contractContent.includes("model_selection:")) {
    throw new Error("model_selection section missing from Training Job Contract YAML!");
  }
  if (!contractContent.includes("UnitsSold")) {
    throw new Error("Target entity UnitsSold missing from model_selection!");
  }
  if (!contractContent.includes("lightgbm")) {
    throw new Error("lightgbm candidate missing from model_selection!");
  }
  if (!contractContent.includes("Weekly SKU units sold")) {
    throw new Error("Target description missing from model_selection!");
  }

  // C. Verify valid YAML parsing
  const parsedYaml: any = yaml.load(contractContent);
  if (!parsedYaml || !parsedYaml.model_selection) {
    throw new Error("Parsed YAML missing model_selection block!");
  }
  if (parsedYaml.model_selection.target_entity.name !== "UnitsSold") {
    throw new Error(`Unexpected target_entity.name: ${parsedYaml.model_selection.target_entity.name}`);
  }
  if (parsedYaml.model_selection.recommended_model.model_id !== "lightgbm") {
    throw new Error(`Unexpected recommended_model: ${parsedYaml.model_selection.recommended_model.model_id}`);
  }

  // 6. Verification 4: Simulate User Selection update (e.g. user selects only lightgbm and xgboost)
  console.log("\n[Step 4] Simulating user selection update (disabling random_forest)...");
  const userUpdatedDecision = {
    ...agentDecisionPayload,
    models: agentDecisionPayload.models.map((m) => ({
      ...m,
      enabled: m.model_id === "lightgbm" || m.model_id === "xgboost",
    })),
  };

  await saveModularTrainingJobContract(
    workspaceName,
    projectName,
    userUpdatedDecision,
    runTimestamp
  );

  const updatedContractContent = fs.readFileSync(saveResult.trainingJobContractPath, "utf-8");
  const updatedParsed: any = yaml.load(updatedContractContent);
  const rfModel = updatedParsed.model_selection.models.find((m: any) => m.model_id === "random_forest");
  const lgbModel = updatedParsed.model_selection.models.find((m: any) => m.model_id === "lightgbm");

  if (!rfModel || rfModel.enabled !== false) {
    throw new Error("Expected random_forest to have enabled=false after user selection!");
  }
  if (!lgbModel || lgbModel.enabled !== true) {
    throw new Error("Expected lightgbm to have enabled=true after user selection!");
  }

  // Ensure other sections are STILL preserved after the second update
  for (const token of requiredSectionsAndComments) {
    if (!updatedContractContent.includes(token)) {
      throw new Error(`After update, expected section/comment "${token}" missing from Training Job Contract YAML!`);
    }
  }

  console.log("\n[Step 5] Cleaning up test artifacts...");
  try {
    fs.rmSync(parentProjectDir, { recursive: true, force: true });
  } catch {}

  console.log("\n=== ALL MODEL SELECTION TRAINING CONTRACT TESTS PASSED! ===");
}

testModelSelectionContractPersistence().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
