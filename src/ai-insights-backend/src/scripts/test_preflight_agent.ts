import { PreFlightAgent } from "../agents/ModelTrainingValidation/PreFlight/preFlightAgent";
import { PreFlightValidator } from "../agents/ModelTrainingValidation/PreFlight/preFlightValidator";
import { PreFlightDecisionEngine } from "../agents/ModelTrainingValidation/PreFlight/preFlightDecisionEngine";
import { PythonCapabilityAdapter } from "../agents/ModelTrainingValidation/PreFlight/pythonCapabilityAdapter";

async function runTests() {
  console.log("==================================================");
  console.log("   AUTOMATED TEST SUITE: PRE-FLIGHT AGENT (10 STAGES)");
  console.log("==================================================\n");

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, message: string) {
    totalTests++;
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passedTests++;
    } else {
      console.error(`  [FAIL] ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  // TEST 1: PythonCapabilityAdapter
  console.log("[Test 1] PythonCapabilityAdapter System Profiler & Pipeline Execution");
  const adapter = new PythonCapabilityAdapter();
  const pyResult = await adapter.runPreflightPipeline({
    framework: "scikit-learn",
    resource_estimate: { confidence: "low" },
  });

  assert(pyResult.system !== undefined, "System hardware snapshot must be returned");
  assert(pyResult.system.cpu_logical > 0, `Logical CPU cores should be > 0 (found ${pyResult.system.cpu_logical})`);
  assert(pyResult.system.ram_total_gb > 0, `Total RAM should be > 0 GB (found ${pyResult.system.ram_total_gb} GB)`);
  assert(pyResult.system.disk_free_gb > 0, `Free disk space should be > 0 GB (found ${pyResult.system.disk_free_gb} GB)`);
  assert(
    pyResult.status === "online" || pyResult.status === "fallback_cli",
    `Python adapter execution status should be 'online' or 'fallback_cli' (got: ${pyResult.status})`
  );
  console.log(`  Host OS: ${pyResult.system.os_name}, RAM: ${pyResult.system.ram_total_gb} GB, Available: ${pyResult.system.ram_available_gb} GB, Free Disk: ${pyResult.system.disk_free_gb} GB\n`);

  // TEST 2: Stage 2 Configuration Validator - Splits and Metrics
  console.log("[Test 2] PreFlightValidator - Configuration Validation");
  const validator = new PreFlightValidator();

  // 2a. Valid configuration
  const validConfig = {
    task_type: "classification",
    primary_metric: "f1",
    splits: { train: 0.7, validation: 0.15, test: 0.15 },
    models: [{ model_id: "rf_classifier", framework: "scikit-learn" }],
  };
  const checksValid = validator.validateConfiguration(validConfig);
  const splitsCheck = checksValid.find((c) => c.id === "conf_splits_sum");
  const metricCheck = checksValid.find((c) => c.id === "conf_metric_alignment");
  assert(splitsCheck?.status === "PASSED", "Split proportions summing to 1.0 should PASS");
  assert(metricCheck?.status === "PASSED", "Classification metric 'f1' on classification task should PASS");

  // 2b. Invalid metric configuration
  const invalidMetricConfig = {
    task_type: "classification",
    primary_metric: "rmse", // Invalid for classification!
    splits: { train: 0.7, validation: 0.15, test: 0.15 },
  };
  const checksInvalidMetric = validator.validateConfiguration(invalidMetricConfig);
  const badMetricCheck = checksInvalidMetric.find((c) => c.id === "conf_metric_alignment");
  assert(badMetricCheck?.status === "FAILED", "Regression metric 'rmse' on classification task must FAIL");

  // 2c. Invalid splits sum
  const badSplitsConfig = {
    task_type: "regression",
    primary_metric: "rmse",
    splits: { train: 0.9, validation: 0.3, test: 0.1 }, // Sums to 1.3
  };
  const checksBadSplits = validator.validateConfiguration(badSplitsConfig);
  const badSplitCheck = checksBadSplits.find((c) => c.id === "conf_splits_sum");
  assert(badSplitCheck?.status === "WARNING", "Split proportions summing to 1.3 must produce WARNING");
  console.log();

  // TEST 3: Stage 3 Model & Framework Compatibility
  console.log("[Test 3] PreFlightValidator - Model & Framework Compatibility");
  const frameworkChecks = validator.validateModelAndFramework(
    { framework: "xgboost", models: [{ model_id: "xgboost_regressor" }] },
    pyResult.system
  );
  const fwSupport = frameworkChecks.find((c) => c.id === "framework_support");
  assert(fwSupport?.status === "PASSED", "XGBoost framework must be supported");
  console.log();

  // TEST 4: Resource Safety Assessment & Bottleneck Detection
  console.log("[Test 4] PreFlightDecisionEngine - Resource Safety & Gate Assessment");
  const engine = new PreFlightDecisionEngine();

  // 4a. Safe scenario
  const safeSafety = engine.assessResourceSafety(pyResult.system, {
    ram_gb: 2.0,
    vram_gb: null,
    disk_gb: 0.5,
    training_time_seconds: 60,
    model_size_mb: 25,
    confidence: "medium",
    source: "calculated",
    bottleneck: "none",
    warnings: [],
  });
  assert(safeSafety.bottleneck === "none", "Normal resource usage should have bottleneck 'none'");
  assert(safeSafety.criticalFailure === undefined, "Normal resource usage should have no critical failure");

  // 4b. Critical low disk space (< 1 GB)
  const lowDiskSystem = { ...pyResult.system, disk_free_gb: 0.4 };
  const blockedSafety = engine.assessResourceSafety(lowDiskSystem, {
    ram_gb: 2.0,
    vram_gb: null,
    disk_gb: 0.5,
    training_time_seconds: 60,
    model_size_mb: 25,
    confidence: "medium",
    source: "calculated",
    bottleneck: "none",
    warnings: [],
  });
  assert(blockedSafety.bottleneck === "disk", "Low disk space (< 1.0 GB) must detect bottleneck 'disk'");
  assert(Boolean(blockedSafety.criticalFailure), "Low disk space must trigger critical failure");

  const blockedDecision = engine.makeFinalDecision(
    blockedSafety.checks,
    [],
    blockedSafety.criticalFailure,
    blockedSafety.bottleneck
  );
  assert(blockedDecision.decision === "BLOCKED", "Critical storage depletion must result in decision 'BLOCKED'");
  console.log();

  // TEST 5: Full 10-Stage Pipeline End-to-End Execution
  console.log("[Test 5] PreFlightAgent - Full 10-Stage Pipeline Execution");
  const agent = new PreFlightAgent(adapter);

  const fullJobConfig = {
    task_type: "classification",
    primary_metric: "accuracy",
    batch_size: 32,
    epochs: 10,
    splits: { train: 0.7, validation: 0.15, test: 0.15 },
    models: [
      { model_id: "lightgbm_clf", algorithm: "LightGBM Classifier", framework: "lightgbm" },
      { model_id: "rf_clf", algorithm: "Random Forest", framework: "scikit-learn" },
      { model_id: "xgb_clf", algorithm: "XGBoost Classifier", framework: "xgboost" },
    ],
    target_column: "outcome",
  };

  const report = await agent.execute(fullJobConfig, {
    metadata: { targetColumn: "outcome", problemType: "classification" },
  });

  assert(report.modelCount === 3, "Assessed model count should be 3");
  assert(
    report.decision === "APPROVED" || report.decision === "APPROVED_WITH_WARNINGS",
    `Valid training config should be APPROVED or APPROVED_WITH_WARNINGS (got: ${report.decision})`
  );
  assert(report.checks.length >= 8, `Should execute at least 8 checks across stages (got: ${report.checks.length})`);
  assert(report.estimates.ram_gb !== null, "Estimated RAM must not be null");
  assert(report.estimates.training_time_seconds !== null, "Estimated training time must not be null");
  assert(Boolean(report.verifiedAt), "Report must include ISO timestamp verifiedAt");
  console.log(`  Decision: [${report.decision}]`);
  console.log(`  Summary: ${report.summary}`);
  console.log(`  Total Checks: ${report.checks.length} (${report.checks.filter((c) => c.status === "PASSED").length} PASSED, ${report.checks.filter((c) => c.status === "WARNING").length} WARNINGS)`);
  console.log(`  RAM Estimate: ${report.estimates.ram_gb} GB, Est Training Time: ${report.estimates.training_time_seconds}s`);
  console.log();

  // TEST 6: Gate Blocking Test with Invalid Target & Metric
  console.log("[Test 6] PreFlightAgent - Gate Blocking on Unrecoverable Configuration");
  const badJobConfig = {
    task_type: "classification",
    primary_metric: "mse", // Invalid!
    splits: { train: 1.0, validation: 0.0, test: 0.0 }, // No holdout!
    models: [{ model_id: "rf", framework: "scikit-learn" }],
    // No target column!
  };

  const blockedReport = await agent.execute(badJobConfig, {});
  assert(
    blockedReport.decision === "BLOCKED",
    `Configuration with missing target & invalid metrics must be BLOCKED (got: ${blockedReport.decision})`
  );
  assert(blockedReport.status === "Failed", `Status must be 'Failed' when blocked (got: ${blockedReport.status})`);
  console.log(`  Blocked Summary: ${blockedReport.summary}`);
  console.log();

  console.log("==================================================");
  console.log(`   ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
  console.log("==================================================");
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
