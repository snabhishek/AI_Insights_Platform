"""
Training Pipeline Orchestrator.
Executes candidate models sequentially, evaluates regression metrics,
generates diagnostic visualizations, and persists champion artifacts and report.
"""

import os
import json
import time
import shutil
import logging
from typing import Dict, Any, List, Optional
import joblib

from data.data_loader import DataLoader
from models.lightgbm_trainer import LightGBMTrainer
from models.xgboost_trainer import XGBoostTrainer
from evaluation.metrics import calculate_regression_metrics
from evaluation.visualizer import (
    plot_actual_vs_predicted,
    plot_residuals,
    plot_feature_importance,
    plot_model_comparison
)

logger = logging.getLogger(__name__)


class ModelTrainingPipeline:
    """Sequential training and evaluation pipeline."""

    TRAINER_MAP = {
        "lightgbm_regressor": LightGBMTrainer,
        "xgboost_regressor": XGBoostTrainer
    }

    def __init__(self, config: Dict[str, Any], base_path: str = ".", data_path: Optional[str] = None):
        self.config = config
        self.base_path = base_path
        self.data_path = data_path
        self.artifacts_dir = os.path.join(self.base_path, "artifacts")
        self.models_dir = os.path.join(self.artifacts_dir, "models")
        self.plots_dir = os.path.join(self.artifacts_dir, "plots")
        
        os.makedirs(self.models_dir, exist_ok=True)
        os.makedirs(self.plots_dir, exist_ok=True)

        self.project_name = config.get("project", {}).get("name", "Lithium-ion-future prediction forecasting")
        self.target_column = config.get("target", {}).get("target_column", "Price of lithium-ion battery cells")
        self.primary_metric = config.get("metrics", {}).get("primary_metric", "MAE")
        self.direction = config.get("metrics", {}).get("direction", "minimize").lower()

    def run(self, selected_models: Optional[List[str]] = None) -> Dict[str, Any]:
        """
        Executes full data loading, sequential candidate model training,
        benchmarking, and report serialization.
        """
        logger.info(f"Starting Training Pipeline for '{self.project_name}'")
        total_start_time = time.time()

        # Step 1: Load and Preprocess Data
        data_loader = DataLoader(self.config, base_path=self.base_path, data_path=self.data_path)
        data_bundle = data_loader.prepare_data()

        X_train = data_bundle["X_train"]
        y_train = data_bundle["y_train"]
        X_val = data_bundle["X_val"]
        y_val = data_bundle["y_val"]
        X_test = data_bundle["X_test"]
        y_test = data_bundle["y_test"]
        feature_names = data_bundle["feature_names"]
        preprocessor = data_bundle["preprocessor"]

        # Ensure preprocessor is persisted in artifacts/models/
        preprocessor_dest = os.path.join(self.models_dir, "preprocessor.joblib")
        joblib.dump(preprocessor, preprocessor_dest)
        logger.info(f"Persisted preprocessor artifact to {preprocessor_dest}")

        # Step 2: Determine Candidate Models to Train
        candidate_ids = self.config.get("models", {}).get("candidate_model_ids", ["lightgbm_regressor", "xgboost_regressor"])
        if selected_models:
            active_model_ids = [m for m in selected_models if m in self.TRAINER_MAP]
            if not active_model_ids:
                logger.warning(f"None of selected_models {selected_models} found in available trainers. Using all candidates.")
                active_model_ids = [m for m in candidate_ids if m in self.TRAINER_MAP]
        else:
            active_model_ids = [m for m in candidate_ids if m in self.TRAINER_MAP]

        logger.info(f"Candidate models selected for training: {active_model_ids}")

        models_evaluated = []
        model_results = {}
        best_model_id = None
        best_score = float("inf") if self.direction == "minimize" else float("-inf")
        best_trainer = None

        # Step 3: Sequential Execution of Candidate Models
        for model_id in active_model_ids:
            logger.info(f"--- Training candidate model: {model_id} ---")
            trainer_cls = self.TRAINER_MAP[model_id]
            trainer = trainer_cls(self.config)

            model_start = time.time()
            try:
                # Train
                train_meta = trainer.train(X_train, y_train, X_val=X_val, y_val=y_val)
                fit_duration = train_meta.get("fit_time_seconds", 0.0)

                # Predict Validation
                val_pred_start = time.time()
                y_val_pred = trainer.predict(X_val)
                val_predict_duration = time.time() - val_pred_start

                # Predict Test
                test_pred_start = time.time()
                y_test_pred = trainer.predict(X_test)
                test_predict_duration = time.time() - test_pred_start

                # Compute Metrics
                val_metrics = calculate_regression_metrics(y_val, y_val_pred, primary_metric=self.primary_metric)
                test_metrics = calculate_regression_metrics(y_test, y_test_pred, primary_metric=self.primary_metric)

                # Persist Individual Candidate Model Artifact
                model_artifact_filename = f"{model_id}.joblib"
                model_artifact_path = os.path.join(self.models_dir, model_artifact_filename)
                trainer.save(model_artifact_path)
                logger.info(f"Saved model artifact for {model_id} to {model_artifact_path}")

                # Generate Per-Model Visualizations safely
                model_plots = []
                p1 = plot_actual_vs_predicted(y_test, y_test_pred, model_id, output_dir=self.plots_dir, split_name="Test")
                if p1:
                    model_plots.append(os.path.relpath(p1, self.base_path).replace("\\", "/"))

                p2 = plot_residuals(y_test, y_test_pred, model_id, output_dir=self.plots_dir)
                if p2:
                    model_plots.append(os.path.relpath(p2, self.base_path).replace("\\", "/"))

                importances = trainer.get_feature_importances()
                if importances is not None:
                    p3 = plot_feature_importance(importances, feature_names, model_id, output_dir=self.plots_dir)
                    if p3:
                        model_plots.append(os.path.relpath(p3, self.base_path).replace("\\", "/"))

                primary_test_score = test_metrics.get("score", float("inf"))

                # Evaluate Champion Selection
                is_better = (
                    (primary_test_score < best_score)
                    if self.direction == "minimize"
                    else (primary_test_score > best_score)
                )

                if is_better or best_model_id is None:
                    best_score = primary_test_score
                    best_model_id = model_id
                    best_trainer = trainer

                eval_record = {
                    "model_id": model_id,
                    "displayName": getattr(trainer, "display_name", model_id),
                    "framework": getattr(trainer, "framework", "scikit-learn"),
                    "status": "Completed",
                    "metrics": {
                        "validation": val_metrics,
                        "test": test_metrics
                    },
                    "timing": {
                        "fit_time_seconds": fit_duration,
                        "predict_time_seconds": round(test_predict_duration + val_predict_duration, 4)
                    },
                    "artifact_path": f"artifacts/models/{model_artifact_filename}",
                    "plots": model_plots
                }

                models_evaluated.append(eval_record)
                model_results[model_id] = {
                    "model_id": model_id,
                    "displayName": getattr(trainer, "display_name", model_id),
                    "framework": getattr(trainer, "framework", "scikit-learn"),
                    "status": "Completed",
                    "score": primary_test_score,
                    "validation_metrics": val_metrics,
                    "test_metrics": test_metrics,
                    "duration_seconds": round(time.time() - model_start, 4),
                    "model_path": f"artifacts/models/{model_artifact_filename}",
                    "plots": model_plots
                }

                logger.info(
                    f"Candidate {model_id} finished. Test {self.primary_metric}: {primary_test_score:.4f} "
                    f"(Val {self.primary_metric}: {val_metrics.get('score', 0.0):.4f})"
                )

            except Exception as e:
                logger.error(f"Error evaluating candidate {model_id}: {e}", exc_info=True)
                model_results[model_id] = {
                    "model_id": model_id,
                    "displayName": getattr(trainer, "display_name", model_id),
                    "framework": getattr(trainer, "framework", "unknown"),
                    "status": "Failed",
                    "error": str(e),
                    "duration_seconds": round(time.time() - model_start, 4)
                }

        # Step 4: Finalize Champion Model
        selected_model_path = os.path.join(self.models_dir, "selected_model.joblib")
        if best_model_id and best_trainer:
            best_trainer.save(selected_model_path)
            logger.info(f"Promoted {best_model_id} as selected model at {selected_model_path}")
        elif len(active_model_ids) > 0 and os.path.exists(os.path.join(self.models_dir, f"{active_model_ids[0]}.joblib")):
            shutil.copyfile(
                os.path.join(self.models_dir, f"{active_model_ids[0]}.joblib"),
                selected_model_path
            )
            best_model_id = active_model_ids[0]

        # Step 5: Cross-Model Comparison Visualization
        comparison_plot_path = plot_model_comparison(models_evaluated, output_dir=self.plots_dir)
        rel_comp_plot = os.path.relpath(comparison_plot_path, self.base_path).replace("\\", "/") if comparison_plot_path else None

        # Step 6: Assemble Comprehensive Report
        report = {
            "status": "Completed",
            "project_name": self.project_name,
            "target_column": self.target_column,
            "primary_metric": self.primary_metric,
            "primary_metric_direction": self.direction,
            "best_model_id": best_model_id,
            "best_model": {
                "model_id": best_model_id,
                "score": best_score,
                "model_path": "artifacts/models/selected_model.joblib"
            },
            "selected_model": best_model_id,
            "selected_model_path": "artifacts/models/selected_model.joblib",
            "preprocessor_path": "artifacts/models/preprocessor.joblib",
            "candidate_models_evaluated": [m["model_id"] for m in models_evaluated],
            "models_evaluated": models_evaluated,
            "model_results": model_results,
            "comparison_plot": rel_comp_plot or "artifacts/plots/model_comparison.png",
            "total_execution_time_seconds": round(time.time() - total_start_time, 4)
        }

        # Step 7: Persist Report JSON
        report_path = os.path.join(self.base_path, "model_training_report.json")
        with open(report_path, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)
        logger.info(f"Model training report saved to {report_path}")

        return report
