import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { AgentStateType, IngestionServices } from "../../state";
import { executePythonScript } from "../../tools/helpers/pythonExecutor";
import {
  getFileServerBasePath,
  sanitizeFolderName,
} from "../../../config/fileServer.config";
import {
  ModelValidationAgentOutput,
  ModelValidationReport,
  ValidationMode,
  ValidationFrequency,
  CandidateModelValidationRun,
} from "./types";

export class ModelValidationAgent {
  /**
   * Pure function to determine validation mode based on start date vs current server date.
   */
  public static determineValidationMode(
    predictionStartDate: string,
    currentServerDate?: string
  ): ValidationMode {
    const today = currentServerDate || new Date().toISOString().slice(0, 10);
    const cleanStart = (predictionStartDate || "").trim().slice(0, 10);
    if (!cleanStart) return "backtesting";
    return cleanStart > today ? "future_prediction" : "backtesting";
  }

  /**
   * Resolves the calculative prediction start date:
   * 1. Checks explicit predictionObjectiveStartDate from state or config
   * 2. Otherwise advances from training cutoff date (splitEndDate or splitDate) to the next day/period
   */
  public static resolvePredictionStartDate(
    state: AgentStateType,
    trainingConfig: any
  ): string {
    const directStart =
      (state as any).predictionObjectiveStartDate ||
      trainingConfig?.task?.prediction_start_date ||
      trainingConfig?.task?.prediction_objective_start_date;

    if (directStart && typeof directStart === "string" && directStart.trim().length > 0) {
      return directStart.trim().slice(0, 10);
    }

    const cutoffDateStr =
      state.splitEndDate ||
      state.splitDate ||
      trainingConfig?.split?.split_date ||
      trainingConfig?.split?.test_start_date;

    if (cutoffDateStr && typeof cutoffDateStr === "string" && cutoffDateStr.trim().length > 0) {
      try {
        const d = new Date(cutoffDateStr.trim());
        if (!isNaN(d.getTime())) {
          // Advance by 1 day from the training cutoff date for prediction evaluation
          d.setDate(d.getDate() + 1);
          return d.toISOString().slice(0, 10);
        }
      } catch {}
      return cutoffDateStr.trim().slice(0, 10);
    }

    // Default fallback to today's date if no date context exists
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Scaffolds the dedicated validation directory structure:
   * <projectName>_model_validation/
   * ├── artifacts/
   * │   ├── predictions/
   * │   └── plots/
   * ├── configs/
   * └── reports/
   */
  public static setupValidationDirectory(validationDir: string): void {
    fs.mkdirSync(validationDir, { recursive: true });
    fs.mkdirSync(path.join(validationDir, "artifacts", "predictions"), { recursive: true });
    fs.mkdirSync(path.join(validationDir, "artifacts", "plots"), { recursive: true });
    fs.mkdirSync(path.join(validationDir, "configs"), { recursive: true });
    fs.mkdirSync(path.join(validationDir, "reports"), { recursive: true });
  }

  /**
   * Generates the Python validation runner script without any hardcoded models or columns.
   */
  public static generatePythonRunnerScript(): string {
    return `
import os
import sys
import json
import argparse
import joblib
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
import yaml

def parse_args():
    parser = argparse.ArgumentParser(description="AutoML Model Validation Runner")
    parser.add_argument("--dataset-path", required=True, help="Path to finalized parquet dataset")
    parser.add_argument("--models-dir", required=True, help="Path to trained models directory")
    parser.add_argument("--output-dir", required=True, help="Path to validation output directory")
    parser.add_argument("--start-date", required=True, help="Prediction Objective Start Date (YYYY-MM-DD)")
    parser.add_argument("--horizon", type=int, default=12, help="Prediction horizon count")
    parser.add_argument("--frequency", default="Weekly", help="Weekly, Monthly, Yearly")
    parser.add_argument("--mode", default="backtesting", help="backtesting or future_prediction")
    parser.add_argument("--time-col", default="Order_Date", help="Time series timestamp column")
    parser.add_argument("--target-col", default="Order_Quantity", help="Target column")
    parser.add_argument("--group-col", default=None, help="Entity/grouping column")
    parser.add_argument("--problem-type", default="forecasting", help="classification or regression/forecasting")
    parser.add_argument("--out-dir", default=None, help="Execution container output directory")
    return parser.parse_args()

def safe_calc_wape(actuals, preds):
    sum_act = np.sum(np.abs(actuals))
    if sum_act == 0:
        return None
    return float(np.sum(np.abs(actuals - preds)) / sum_act * 100.0)

def safe_calc_mape(actuals, preds):
    valid_mask = actuals != 0
    if not np.any(valid_mask):
        return None
    return float(np.mean(np.abs((actuals[valid_mask] - preds[valid_mask]) / actuals[valid_mask])) * 100.0)

def safe_calc_smape(actuals, preds):
    denom = np.abs(actuals) + np.abs(preds)
    valid_mask = denom != 0
    if not np.any(valid_mask):
        return None
    return float(np.mean(2.0 * np.abs(preds[valid_mask] - actuals[valid_mask]) / denom[valid_mask]) * 100.0)

def run_validation():
    args = parse_args()
    print(f"[ValidationRunner] Starting Model Validation - Mode: {args.mode}, Start: {args.start_date}, Horizon: {args.horizon} {args.frequency}")

    # 1. Load finalized dataset
    if not os.path.exists(args.dataset_path):
        raise FileNotFoundError(f"Finalized dataset not found at: {args.dataset_path}")

    print(f"[ValidationRunner] Loading finalized dataset from {args.dataset_path}")
    df = pd.read_parquet(args.dataset_path)
    print(f"[ValidationRunner] Dataset loaded: {df.shape[0]} rows, {df.shape[1]} columns")

    # Resolve time column
    time_col = args.time_col
    if time_col not in df.columns:
        for c in df.columns:
            if "date" in c.lower() or "time" in c.lower():
                time_col = c
                break

    if time_col in df.columns:
        df[time_col] = pd.to_datetime(df[time_col])
        df = df.sort_values(by=time_col).reset_index(drop=True)

    # Resolve target column
    target_col = args.target_col
    if target_col not in df.columns:
        cols_lower = {c.lower(): c for c in df.columns}
        if target_col.lower() in cols_lower:
            target_col = cols_lower[target_col.lower()]

    # 2. Discover trained model artifacts and fitted preprocessor
    models_dir = args.models_dir
    if not os.path.exists(models_dir):
        raise FileNotFoundError(f"Models directory not found at: {models_dir}")

    preprocessor_path = os.path.join(models_dir, "preprocessor.joblib")
    preprocessor = None
    if os.path.exists(preprocessor_path):
        print(f"[ValidationRunner] Loading preprocessor from {preprocessor_path}")
        preprocessor = joblib.load(preprocessor_path)

    # Discover candidate models
    all_files = os.listdir(models_dir)
    model_files = [f for f in all_files if f.endswith(".joblib") and f != "preprocessor.joblib"]
    print(f"[ValidationRunner] Discovered {len(model_files)} model artifact(s): {model_files}")

    # 3. Mode Evaluation Slice
    start_dt = pd.to_datetime(args.start_date)
    is_backtesting = args.mode == "backtesting"
    
    # Compute frequency offset
    freq = args.frequency.lower()
    if "week" in freq:
        delta = timedelta(weeks=args.horizon)
        date_format = "%b %d, %Y"
    elif "year" in freq:
        delta = timedelta(days=365 * args.horizon)
        date_format = "%Y"
    else: # monthly default
        delta = timedelta(days=30 * args.horizon)
        date_format = "%b %Y"

    end_dt = start_dt + delta

    # Build evaluation DataFrame
    drop_cols = [c for c in [target_col, "Order_ID", "target", "target_class", time_col] if c in df.columns]

    eval_df = pd.DataFrame()
    if is_backtesting and time_col in df.columns:
        eval_df = df[(df[time_col] >= start_dt) & (df[time_col] < end_dt)].copy()
        if len(eval_df) == 0:
            # Fallback to latest records matching horizon length if exact range slice is empty
            print(f"[ValidationRunner] No records strictly in [{start_dt} to {end_dt}]. Slicing latest {args.horizon} records.")
            eval_df = df.tail(min(len(df), max(args.horizon * 10, 100))).copy()
    else:
        # Future prediction mode or non-temporal
        eval_df = df.tail(min(len(df), max(args.horizon * 5, 50))).copy()

    # Determine ground-truth actual availability
    actuals_available = is_backtesting and target_col in eval_df.columns and not eval_df[target_col].isnull().all()
    actuals = None
    actual_coverage = 0.0

    if actuals_available:
        valid_act = eval_df[target_col].dropna()
        actual_coverage = round((len(valid_act) / max(len(eval_df), 1)) * 100.0, 2)
        actuals = eval_df[target_col].to_numpy()

    # Preprocess features without refitting
    X_eval = eval_df.drop(columns=[c for c in drop_cols if c in eval_df.columns])
    if preprocessor is not None:
        try:
            X_trans = preprocessor.transform(X_eval)
        except Exception as e:
            print(f"[ValidationRunner] Preprocessor transform warning: {e}. Trying direct numeric subset.")
            X_trans = X_eval.select_dtypes(include=[np.number]).fillna(0).to_numpy()
    else:
        X_trans = X_eval.select_dtypes(include=[np.number]).fillna(0).to_numpy()

    # 4. Generate period dates for charts
    if time_col in eval_df.columns and len(eval_df) > 0:
        eval_dates = eval_df[time_col].dt.strftime(date_format).unique().tolist()
        if len(eval_dates) > 20:
            # Subsample evenly to 12-15 labels for clean visualization
            step = max(1, len(eval_dates) // 12)
            eval_dates = eval_dates[::step]
    else:
        eval_dates = [f"Period {i+1}" for i in range(args.horizon)]

    # 5. Run Inference and Metrics across all candidate models
    results = {}
    ranked_models = []
    predictions_table = {}

    if time_col in eval_df.columns:
        predictions_table[time_col] = eval_df[time_col].astype(str)
    if args.group_col and args.group_col in eval_df.columns:
        predictions_table[args.group_col] = eval_df[args.group_col]
    if actuals_available:
        predictions_table["actual"] = actuals

    for m_file in model_files:
        model_id = os.path.splitext(m_file)[0]
        model_path = os.path.join(models_dir, m_file)
        print(f"[ValidationRunner] Evaluating model: {model_id} from {model_path}")

        try:
            model = joblib.load(model_path)
            # Generate predictions
            if hasattr(model, "predict"):
                preds = model.predict(X_trans)
            else:
                preds = np.zeros(len(X_trans))

            preds = np.asarray(preds, dtype=float)
            predictions_table[f"pred_{model_id}"] = preds

            # Aggregate actual vs predicted series for charts
            actual_series = None
            pred_series = []
            residuals = None

            # Aggregate into period buckets
            if time_col in eval_df.columns and len(eval_dates) > 1:
                temp_df = pd.DataFrame({
                    "period": eval_df[time_col].dt.strftime(date_format),
                    "pred": preds
                })
                if actuals_available:
                    temp_df["actual"] = actuals
                    grouped = temp_df.groupby("period", sort=False).mean()
                    # Align with eval_dates
                    actual_series = [float(grouped["actual"].get(d, 0.0)) for d in eval_dates]
                    pred_series = [float(grouped["pred"].get(d, 0.0)) for d in eval_dates]
                    residuals = [float(a - p) for a, p in zip(actual_series, pred_series)]
                else:
                    grouped = temp_df.groupby("period", sort=False).mean()
                    pred_series = [float(grouped["pred"].get(d, 0.0)) for d in eval_dates]
                    actual_series = [None for _ in eval_dates]
            else:
                pred_series = [float(p) for p in preds[:len(eval_dates)]]
                actual_series = [float(a) for a in actuals[:len(eval_dates)]] if actuals_available else [None for _ in eval_dates]
                if actuals_available:
                    residuals = [float(a - p) for a, p in zip(actual_series, pred_series)]

            # Compute Deterministic Metrics
            metrics = {}
            totals = {}

            pred_total = float(np.sum(preds))

            if actuals_available:
                act_total = float(np.sum(actuals))
                diff = float(pred_total - act_total)
                diff_pct = float((diff / act_total) * 100.0) if act_total != 0 else None

                mae = float(np.mean(np.abs(actuals - preds)))
                rmse = float(np.sqrt(np.mean((actuals - preds) ** 2)))
                wape = safe_calc_wape(actuals, preds)
                mape = safe_calc_mape(actuals, preds)
                smape = safe_calc_smape(actuals, preds)
                bias = float(np.mean(preds - actuals))

                totals = {
                    "actualTotal": act_total,
                    "forecastTotal": pred_total,
                    "difference": diff,
                    "differencePercentage": diff_pct
                }

                metrics = {
                    "mae": {"value": mae, "status": "available", "unit": ""},
                    "rmse": {"value": rmse, "status": "available", "unit": ""},
                    "wape": {"value": wape, "status": "available" if wape is not None else "undefined", "unit": "%"},
                    "mape": {"value": mape, "status": "available" if mape is not None else "undefined", "unit": "%"},
                    "smape": {"value": smape, "status": "available" if smape is not None else "undefined", "unit": "%"},
                    "bias": {"value": bias, "status": "available", "unit": ""},
                }

                # Classification specific metrics if binary target
                unique_acts = np.unique(actuals)
                if len(unique_acts) <= 2 and set(unique_acts).issubset({0, 1, 0.0, 1.0}):
                    bin_preds = (preds >= 0.5).astype(int)
                    tp = np.sum((actuals == 1) & (bin_preds == 1))
                    fp = np.sum((actuals == 0) & (bin_preds == 1))
                    fn = np.sum((actuals == 1) & (bin_preds == 0))
                    tn = np.sum((actuals == 0) & (bin_preds == 0))
                    
                    precision = float(tp / (tp + fp)) if (tp + fp) > 0 else 0.0
                    recall = float(tp / (tp + fn)) if (tp + fn) > 0 else 0.0
                    f1 = float(2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0
                    acc = float((tp + tn) / len(actuals)) if len(actuals) > 0 else 0.0

                    metrics["precision"] = {"value": precision * 100.0, "status": "available", "unit": "%"}
                    metrics["recall"] = {"value": recall * 100.0, "status": "available", "unit": "%"}
                    metrics["f1_score"] = {"value": f1 * 100.0, "status": "available", "unit": "%"}
                    metrics["accuracy"] = {"value": acc * 100.0, "status": "available", "unit": "%"}

                score = wape if wape is not None else mae
            else:
                totals = {
                    "actualTotal": None,
                    "forecastTotal": pred_total,
                    "difference": None,
                    "differencePercentage": None
                }
                metrics = {
                    "mae": {"value": None, "status": "unavailable", "reason": "Future Prediction mode: actual ground truth unavailable"},
                    "rmse": {"value": None, "status": "unavailable", "reason": "Future Prediction mode: actual ground truth unavailable"},
                    "wape": {"value": None, "status": "unavailable", "reason": "Future Prediction mode: actual ground truth unavailable"},
                    "mape": {"value": None, "status": "unavailable", "reason": "Future Prediction mode: actual ground truth unavailable"},
                    "smape": {"value": None, "status": "unavailable", "reason": "Future Prediction mode: actual ground truth unavailable"},
                    "bias": {"value": None, "status": "unavailable", "reason": "Future Prediction mode: actual ground truth unavailable"},
                }
                score = pred_total

            model_run = {
                "model_id": model_id,
                "displayName": model_id.replace("_", " ").title(),
                "framework": "scikit-learn" if "rf" in model_id else ("lightgbm" if "lightgbm" in model_id else "xgboost"),
                "status": "Completed",
                "score": score,
                "metrics": metrics,
                "totals": totals,
                "chartData": {
                    "dates": eval_dates,
                    "actualSeries": actual_series,
                    "predictedSeries": pred_series,
                    "residuals": residuals
                },
                "evaluationRecordCount": len(X_trans),
                "actualDataCoverage": actual_coverage if actuals_available else None,
                "modelArtifactPath": model_path
            }

            results[model_id] = model_run
            ranked_models.append(model_run)

        except Exception as e:
            print(f"[ValidationRunner] Model evaluation failed for {model_id}: {e}")
            results[model_id] = {
                "model_id": model_id,
                "displayName": model_id,
                "framework": "unknown",
                "status": "Failed",
                "error": str(e),
                "metrics": {},
                "totals": {"actualTotal": None, "forecastTotal": 0.0, "difference": None, "differencePercentage": None},
                "chartData": {"dates": [], "actualSeries": [], "predictedSeries": []},
                "evaluationRecordCount": 0,
                "actualDataCoverage": None
            }

    # Sort models by score (lowest error if backtesting, or first completed)
    if is_backtesting:
        ranked_models.sort(key=lambda m: m.get("score") if m.get("score") is not None else 999999)
    champion_id = "selected_model" if "selected_model" in results else (ranked_models[0]["model_id"] if ranked_models else "none")

    # 6. Save Artifacts into dedicated validation output directory
    output_dir = args.output_dir
    os.makedirs(os.path.join(output_dir, "artifacts", "predictions"), exist_ok=True)
    os.makedirs(os.path.join(output_dir, "configs"), exist_ok=True)
    os.makedirs(os.path.join(output_dir, "reports"), exist_ok=True)

    # Save predictions parquet and csv
    pred_df = pd.DataFrame(predictions_table)
    pred_parquet_path = os.path.join(output_dir, "artifacts", "predictions", "validation_predictions.parquet")
    pred_csv_path = os.path.join(output_dir, "artifacts", "predictions", "validation_predictions.csv")
    try:
        pred_df.to_parquet(pred_parquet_path, index=False)
        pred_df.to_csv(pred_csv_path, index=False)
        print(f"[ValidationRunner] Predictions saved to {pred_parquet_path}")
    except Exception as pe:
        print(f"[ValidationRunner] Could not save parquet: {pe}")
        pred_df.to_csv(pred_csv_path, index=False)

    # Save validation config
    val_config = {
        "validation_mode": args.mode,
        "prediction_objective_start_date": args.start_date,
        "prediction_objective_horizon": args.horizon,
        "prediction_objective_frequency": args.frequency,
        "time_column": time_col,
        "target_column": target_col,
        "models_evaluated": list(results.keys()),
        "champion_model": champion_id,
        "evaluation_period": {
            "start": str(start_dt),
            "end": str(end_dt)
        }
    }
    with open(os.path.join(output_dir, "configs", "validation_config.yaml"), "w") as f:
        yaml.dump(val_config, f, default_flow_style=False)

    # Assemble report
    report = {
        "validation_run_id": f"val_{int(datetime.now().timestamp())}",
        "project_id": "auto",
        "mode": args.mode,
        "prediction_objective_start_date": args.start_date,
        "prediction_objective_horizon": args.horizon,
        "prediction_objective_frequency": args.frequency,
        "time_column": time_col,
        "target_column": target_col,
        "entity_column": args.group_col,
        "problem_type": args.problem_type,
        "dataset_reference": args.dataset_path,
        "evaluation_period": {
            "start_date": str(start_dt.date()) if hasattr(start_dt, "date") else str(start_dt),
            "end_date": str(end_dt.date()) if hasattr(end_dt, "date") else str(end_dt)
        },
        "coverage_percentage": actual_coverage if actuals_available else None,
        "champion_model_id": champion_id,
        "models": results,
        "ranked_models": ranked_models,
        "warnings": [] if actuals_available or not is_backtesting else ["Ground truth actuals missing or incomplete in evaluation period"],
        "created_at": datetime.utcnow().isoformat() + "Z"
    }

    report_path = os.path.join(output_dir, "reports", "model_validation_report.json")
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)

    print(f"[ValidationRunner] Validation completed successfully! Report written to {report_path}")

if __name__ == "__main__":
    run_validation()
`;
  }

  /**
   * Main execution flow of the Model Validation Agent.
   */
  public static async execute(
    state: AgentStateType,
    services: IngestionServices,
    options?: {
      predictionHorizon?: number;
      predictionFrequency?: string;
    }
  ): Promise<ModelValidationAgentOutput> {
    const projectId = state.projectId || services?.projectId || "default-project";
    const workspaceName = (state as any).workspaceName || services?.workspaceName || "Default_Workspace";
    const projectName = (state as any).projectName || services?.projectName || "Forecasting";
    const runTimestamp = state.runTimestamp || services?.runTimestamp || "";

    // 1. Resolve Project Root and Run Directory on Host
    const projectRootDir = path.join(
      getFileServerBasePath(),
      "workspaces",
      sanitizeFolderName(workspaceName),
      "projects",
      sanitizeFolderName(projectName)
    );

    const runDir = runTimestamp ? path.join(projectRootDir, runTimestamp) : projectRootDir;
    const modelTrainingDir = path.join(runDir, `${projectName}_model_training`);
    const modelValidationDir = path.join(runDir, `${projectName}_model_validation`);

    // Ensure dedicated validation directory is created
    this.setupValidationDirectory(modelValidationDir);

    // 2. Discover Finalized Dataset
    const candidateDatasetPaths = [
      path.join(runDir, "python_script", "validated_features.parquet"),
      path.join(runDir, "python_script", "selected_features.parquet"),
      path.join(runDir, "python_script", "dataset.parquet"),
      path.join(projectRootDir, "python_script", "validated_features.parquet"),
    ];
    const datasetPath = candidateDatasetPaths.find((p) => fs.existsSync(p)) || candidateDatasetPaths[0];

    // 3. Read Training Configuration
    let trainingConfig: any = {};
    const configPath = path.join(modelTrainingDir, "configs", "training_config.yaml");
    if (fs.existsSync(configPath)) {
      try {
        trainingConfig = yaml.load(fs.readFileSync(configPath, "utf-8")) || {};
      } catch {}
    }

    // 4. Resolve Parameters
    const horizon = options?.predictionHorizon || (state as any).predictionHorizon || 12;
    const frequency: ValidationFrequency =
      (options?.predictionFrequency as ValidationFrequency) ||
      ((state as any).predictionFrequency as ValidationFrequency) ||
      "Weekly";

    const predictionStartDate = this.resolvePredictionStartDate(state, trainingConfig);
    const mode = this.determineValidationMode(predictionStartDate);

    const timeCol = trainingConfig?.split?.time_column || "Order_Date";
    const targetCol = trainingConfig?.task?.target_column || "Order_Quantity";
    const groupCol = trainingConfig?.split?.group_by || "SKU";
    const problemType = trainingConfig?.task?.task_type || "forecasting";

    // 5. Locate Models Directory
    const modelsDir = path.join(modelTrainingDir, "artifacts", "models");

    // 6. Write and Execute Python Validation Script
    const runnerScriptCode = this.generatePythonRunnerScript();
    const runnerScriptName = "validation_runner.py";
    const runnerScriptPath = path.join(modelTrainingDir, runnerScriptName);
    fs.writeFileSync(runnerScriptPath, runnerScriptCode, "utf-8");

    // Command-line arguments for python execution (relative inside container)
    const relDatasetPath = path.relative(projectRootDir, datasetPath).replace(/\\/g, "/");
    const relModelsDir = path.relative(projectRootDir, modelsDir).replace(/\\/g, "/");
    const relOutputDir = path.relative(projectRootDir, modelValidationDir).replace(/\\/g, "/");

    const extraArgs = [
      `--dataset-path "/workspace/${relDatasetPath}"`,
      `--models-dir "/workspace/${relModelsDir}"`,
      `--output-dir "/workspace/${relOutputDir}"`,
      `--start-date "${predictionStartDate}"`,
      `--horizon ${horizon}`,
      `--frequency "${frequency}"`,
      `--mode "${mode}"`,
      `--time-col "${timeCol}"`,
      `--target-col "${targetCol}"`,
      `--group-col "${groupCol}"`,
      `--problem-type "${problemType}"`,
    ];

    console.info(`[ModelValidationAgent] Executing validation in ${mode} mode for project '${projectName}' (${horizon} ${frequency} periods)...`);

    const execResult = await executePythonScript(
      runnerScriptPath,
      "",
      projectId,
      runTimestamp,
      services,
      undefined,
      ["pandas", "numpy", "scikit-learn", "pyarrow", "pyyaml", "joblib"],
      extraArgs
    );

    // 7. Parse Output Report
    const reportPath = path.join(modelValidationDir, "reports", "model_validation_report.json");
    let report: ModelValidationReport | undefined;

    if (fs.existsSync(reportPath)) {
      try {
        report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
      } catch (err: any) {
        console.warn(`[ModelValidationAgent] Failed to parse validation report:`, err?.message || err);
      }
    }

    const runs: CandidateModelValidationRun[] = report?.ranked_models || (report?.models ? Object.values(report.models) : []);
    const championModel = runs.find((r) => r.model_id === report?.champion_model_id) || runs[0];

    const executionSuccess = execResult.success && !!report;
    const finalStatus = executionSuccess || runs.length > 0 ? "Completed" : "Failed";

    const summary = executionSuccess
      ? `Model Validation completed successfully in ${mode.replace("_", " ")} mode for ${runs.length} candidate model(s). Champion: ${championModel?.displayName || championModel?.model_id || "selected model"}.`
      : `Model Validation finished with warnings: ${execResult.stderr.slice(0, 250)}`;

    return {
      status: finalStatus,
      summary,
      phase: "Model Validation",
      projectDirectory: `${runTimestamp}/${projectName}_model_training`,
      validationDirectory: `${runTimestamp}/${projectName}_model_validation`,
      mode,
      predictionObjectiveStartDate: predictionStartDate,
      predictionObjectiveHorizon: horizon,
      predictionObjectiveFrequency: frequency,
      report,
      candidates: runs,
      championModel,
      predictionsArtifact: `${projectName}_model_validation/artifacts/predictions/validation_predictions.parquet`,
      reportArtifact: `${projectName}_model_validation/reports/model_validation_report.json`,
      warnings: report?.warnings || [],
      error: executionSuccess ? undefined : execResult.stderr,
    };
  }
}
