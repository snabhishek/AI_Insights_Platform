import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { trainingConfigurationNode } from "../agents/ModelTrainingValidation/nodes";
import { TrainingConfigurationAgent } from "../agents/ModelTrainingValidation/TrainingConfiguration";
import { getProjectSchemasDir } from "../config/fileServer.config";
import { saveModularTrainingJobContract } from "../agents/tools/helpers/schemaHelper";

async function runTest() {
  console.log("=== Testing Upgraded Tool-Driven & Validated Training Configuration Node ===");

  const workspaceName = "DefaultWorkspace";
  const projectName = "Test_Olist_Project";
  const runTimestamp = "20260916-150000";

  // 1. Simulate Phase 3.1 Model Selection contract initialization with multiple & dynamic candidate models
  const modelSelectionDecision = {
    target_entity: {
      name: "late_delivery_risk",
      datatype: "boolean",
      description: "Indicator if an order delivery exceeds estimated delivery timestamp",
      source: "orders",
    },
    derivation: "actual_delivery_date > estimated_delivery_date",
    positive_class: "Late",
    negative_class: "On-Time",
    prediction_grain: {
      entity: "order",
      keys: ["order_id"],
      frequency: "per_order",
    },
    recommended_model: {
      model_id: "lightgbm_classifier",
      rank: 1,
      suitability_score: 0.94,
      recommendation: "primary",
    },
    candidates: [
      {
        model_id: "lightgbm_classifier",
        rank: 1,
        suitability_score: 0.94,
        recommendation: "primary",
        reasoning: {
          strengths: ["Fast gradient boosting on tabular data", "Handles categorical encodings natively"],
          weaknesses: ["Sensitive to extreme hyperparameter overfitting"],
          suitability: ["Top performer on structured e-commerce fulfillment data"],
        },
      },
      {
        model_id: "xgboost_classifier",
        rank: 2,
        suitability_score: 0.91,
        recommendation: "alternative",
      },
      {
        model_id: "catboost_classifier",
        rank: 3,
        suitability_score: 0.89,
        recommendation: "alternative",
        source_type: "external",
        source: "web_search",
      },
      {
        model_id: "random_forest_classifier",
        rank: 4,
        suitability_score: 0.85,
        recommendation: "alternative",
      },
    ],
    primary_metric: "f1_score",
    direction: "maximize",
    selection_strategy: "top_k_candidates",
    models: [
      { model_id: "lightgbm_classifier", framework: "lightgbm", algorithm: "LGBMClassifier", enabled: true, parameters: {} },
      { model_id: "xgboost_classifier", framework: "xgboost", algorithm: "XGBClassifier", enabled: true, parameters: {} },
      { model_id: "catboost_classifier", framework: "catboost", algorithm: "CatBoostClassifier", enabled: true, parameters: {} },
      { model_id: "random_forest_classifier", framework: "sklearn", algorithm: "RandomForestClassifier", enabled: true, parameters: {} },
    ],
  };

  console.log("1. Simulating Phase 3.1 Model Selection contract initialization...");
  const initContractRes = await saveModularTrainingJobContract(
    workspaceName,
    projectName,
    modelSelectionDecision,
    runTimestamp
  );
  console.log("-> Initialized Contract at:", initContractRes.trainingJobContractPath);

  // Write mock profiling_report.json and relationship_schema.json in project schemas folder
  const testSchemasDir = getProjectSchemasDir(workspaceName, projectName, runTimestamp);
  await fs.promises.mkdir(testSchemasDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(testSchemasDir, "profiling_report.json"),
    JSON.stringify({
      tables: [
        {
          tableName: "orders",
          rowCount: 50000,
          columns: [
            { name: "late_delivery_risk", inferredType: "integer" },
            { name: "order_purchase_timestamp", inferredType: "timestamp" },
            { name: "freight_value", inferredType: "float" },
          ],
        },
      ],
    }, null, 2),
    "utf-8"
  );
  await fs.promises.writeFile(
    path.join(testSchemasDir, "relationship_schema.json"),
    JSON.stringify({ nodes: [{ name: "orders" }], relationships: [] }, null, 2),
    "utf-8"
  );

  // 2. Prepare simulated state and mock services for Phase 3.2 Training Configuration
  const mockState: any = {
    projectId: "test-proj-id",
    runTimestamp,
    userPrompt: "Predict whether an order will be delivered late and optimize delivery reliability for Olist marketplace.",
    targetColumn: "late_delivery_risk",
    problemType: "classification",
    schemaResolution: {
      domainKnowledge: {
        tier1: "Supply Chain & Logistics",
        tier2: "Delivery Forecasting & Fulfillment",
        useCase: "Late Delivery Risk Prediction",
      },
    },
    dataProfile: {
      tables: [
        {
          name: "orders",
          rowCount: 50000,
          contentProfile: {
            columns: [
              { name: "late_delivery_risk", inferredType: "integer", topValues: [{ value: 0, count: 46000 }, { value: 1, count: 4000 }] },
              { name: "order_purchase_timestamp", inferredType: "timestamp" },
              { name: "freight_value", inferredType: "float" },
              { name: "product_weight_g", inferredType: "float" },
            ],
          },
        },
      ],
    },
    featureValidator: {
      leakageReport: { leakyFeatures: ["order_delivered_customer_date"], leakageFound: true },
      multicollinearityReport: { highVifFeatures: [], highCorrelationPairs: [] },
      importanceRanking: [
        { feature: "freight_value", importance: 0.35 },
        { feature: "product_weight_g", importance: 0.28 },
        { feature: "seller_customer_distance", importance: 0.22 },
      ],
      validatedFeatureSet: {
        kept: ["freight_value", "product_weight_g", "seller_customer_distance", "order_item_count"],
        dropped: ["order_delivered_customer_date"],
      },
    },
    modelSelection: modelSelectionDecision,
  };

  const mockServices: any = {
    projectId: "test-proj-id",
    projectName,
    workspaceName,
    runTimestamp,
    traceHelper: {
      invokeWithTrace: async (_label: string, _meta: any, fn: any) => fn(),
    },
    projectService: {
      getProjectWithWorkspace: async () => ({
        workspaceName,
        project: { name: projectName },
      }),
    },
  };

  console.log("2. Executing trainingConfigurationNode wrapped with validateWithRetry...");
  const nodeResult = await trainingConfigurationNode(mockState, { configurable: { services: mockServices } });

  console.log("-> Node Status:", nodeResult.status);
  console.log("-> Summary:", nodeResult.summary);
  console.log("-> Stage Status:", nodeResult.stageStatuses?.trainingConfiguration);
  console.log("-> Contract Path:", nodeResult.trainingConfiguration?.contractPath);

  // 3. Inspect generated YAML file on disk
  const contractPath = nodeResult.trainingConfiguration?.contractPath;
  if (contractPath && fs.existsSync(contractPath)) {
    const content = fs.readFileSync(contractPath, "utf-8");
    console.log("\n=== Generated Training Job Contract YAML Sample ===");
    console.log(content.slice(0, 1800) + "\n...\n");

    const parsed: any = yaml.load(content);
    console.log("=== Verification Assertions ===");
    console.log("✓ x-primary-metric-name:", parsed["x-primary-metric-name"]);
    console.log("✓ task.task_type:", parsed.task?.task_type);
    console.log("✓ split.strategy:", parsed.split?.strategy);
    console.log("✓ split ratios:", `${parsed.split?.train_ratio} / ${parsed.split?.validation_ratio} / ${parsed.split?.test_ratio}`);
    console.log("✓ imbalance.detected:", parsed.imbalance?.detected, "(ratio:", parsed.imbalance?.ratio, ")");
    console.log("✓ hyperparameter_optimization.method:", parsed.hyperparameter_optimization?.method);
    console.log("✓ search_space keys:", Object.keys(parsed.search_space || {}));
    console.log("✓ evaluation.secondary_metrics:", parsed.evaluation?.secondary_metrics);
    console.log("✓ validation_gates.maximum_overfitting_gap:", parsed.validation_gates?.maximum_overfitting_gap);
    console.log("✓ preserved model_selection candidate count:", parsed.model_selection?.candidates?.length);
    console.log("✓ preserved recommended model:", parsed.model_selection?.recommended_model?.model_id);

    // Verify all candidate models are present in search_space or model_selection
    const candidateIds = (parsed.model_selection?.candidates || []).map((c: any) => c.model_id);
    console.log("✓ Candidate Model IDs in Contract:", candidateIds);

    const firstCandidate = parsed.model_selection?.candidates?.[0];
    const firstModel = parsed.model_selection?.models?.[0];
    console.log("✓ Candidate Training Steps Import:", firstCandidate?.training_steps?.import_statement);
    console.log("✓ Candidate Training Steps Fit:", firstCandidate?.training_steps?.fit_step);
    console.log("✓ Model Training Steps Import:", firstModel?.training_steps?.import_statement);

    if (
      parsed.model_selection?.candidates?.length === 4 &&
      parsed["x-primary-metric-name"] === "f1_score" &&
      parsed.split?.train_ratio === 0.7 &&
      Object.keys(parsed.search_space || {}).length > 0 &&
      firstCandidate?.training_steps?.import_statement &&
      firstCandidate?.training_steps?.fit_step &&
      firstModel?.training_steps?.import_statement
    ) {
      console.log("\n✅ ALL VERIFICATION CHECKS (INCLUDING MODEL ACCESS & TRAINING STEPS) PASSED SUCCESSFULLY!");
    } else {
      console.error("\n❌ Verification failed: missing required contract fields or model training steps");
    }
  } else {
    console.error("❌ Contract file was not created at", contractPath);
  }
}

runTest().catch((e) => {
  console.error("Test execution failed:", e);
});
