import { ModelValidationAgent } from "../agents/ModelTrainingValidation/ModelValidation/modelValidationAgent";

async function runModelValidationTests() {
  console.log("=== Starting Model Validation Agent Tests ===");
  let passedCount = 0;
  let totalCount = 0;

  function assert(condition: boolean, testName: string) {
    totalCount++;
    if (condition) {
      console.log(`[PASS] Test ${totalCount}: ${testName}`);
      passedCount++;
    } else {
      console.error(`[FAIL] Test ${totalCount}: ${testName}`);
    }
  }

  // 1. Mode Selection: Backtesting when start date is in past
  const mode1 = ModelValidationAgent.determineValidationMode("2024-01-01", "2026-09-24");
  assert(mode1 === "backtesting", "selects backtesting mode when start date is in the past");

  // 2. Mode Selection: Backtesting when start date is today
  const mode2 = ModelValidationAgent.determineValidationMode("2026-09-24", "2026-09-24");
  assert(mode2 === "backtesting", "selects backtesting mode when start date equals current date");

  // 3. Mode Selection: Future Prediction when start date is strictly in future
  const mode3 = ModelValidationAgent.determineValidationMode("2026-10-01", "2026-09-24");
  assert(mode3 === "future_prediction", "selects future_prediction mode when start date is in the future");

  // 4. Default mode: Backtesting when start date is empty
  const mode4 = ModelValidationAgent.determineValidationMode("", "2026-09-24");
  assert(mode4 === "backtesting", "defaults to backtesting when start date is empty");

  // 5. Calculative Date Resolution: Explicit predictionObjectiveStartDate
  const state1: any = { predictionObjectiveStartDate: "2025-06-01" };
  const res1 = ModelValidationAgent.resolvePredictionStartDate(state1, {});
  assert(res1 === "2025-06-01", "resolves explicit predictionObjectiveStartDate when provided");

  // 6. Calculative Date Resolution: Advances 1 day from training cutoff date
  const state2: any = { splitEndDate: "2025-01-31" };
  const res2 = ModelValidationAgent.resolvePredictionStartDate(state2, {});
  assert(res2 === "2025-02-01", "calculates prediction start date as day after training cutoff date");

  // 7. Calculative Date Resolution: From split_date in trainingConfig
  const state3: any = {};
  const config3 = { split: { split_date: "2024-12-31" } };
  const res3 = ModelValidationAgent.resolvePredictionStartDate(state3, config3);
  assert(res3 === "2025-01-01", "calculates prediction start date from split_date in trainingConfig");

  // 8. Python Runner Script: contains necessary safeguards and imports
  const script = ModelValidationAgent.generatePythonRunnerScript();
  assert(
    script.includes("def safe_calc_wape(") &&
    script.includes("def safe_calc_mape(") &&
    script.includes("def safe_calc_smape(") &&
    script.includes("preprocessor.joblib") &&
    script.includes("validation_predictions.parquet") &&
    script.includes("model_validation_report.json"),
    "generates Python runner script with safe metric functions and artifact paths"
  );

  console.log(`=== Tests Complete: ${passedCount}/${totalCount} Passed ===`);
  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

runModelValidationTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
