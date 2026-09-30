"""
Visualization and Diagnostic Plotting for Forecasting Models.
Generates diagnostic charts and cross-model comparison plots.
All functions are safe and non-blocking with try-except wrappers.
"""

import os
import logging
from typing import Dict, Any, List, Optional
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns

logger = logging.getLogger(__name__)

# Set default clean style
plt.style.use("seaborn-v0_8-whitegrid" if "seaborn-v0_8-whitegrid" in plt.style.available else "default")


def plot_actual_vs_predicted(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    model_id: str,
    output_dir: str = "artifacts/plots",
    split_name: str = "Test",
) -> Optional[str]:
    """Generates Actual vs Predicted scatter & diagonal line plot."""
    try:
        os.makedirs(output_dir, exist_ok=True)
        filepath = os.path.join(output_dir, f"{model_id}_actual_vs_predicted.png")

        fig, ax = plt.subplots(figsize=(8, 6))
        ax.scatter(y_true, y_pred, alpha=0.8, color="#1f77b4", edgecolors="k", label=f"{split_name} Samples")

        # Identity reference line
        all_vals = np.concatenate([np.asarray(y_true).ravel(), np.asarray(y_pred).ravel()])
        if len(all_vals) > 0:
            min_val = float(np.min(all_vals))
            max_val = float(np.max(all_vals))
            ax.plot([min_val, max_val], [min_val, max_val], "r--", lw=2, label="Perfect Forecast (y = x)")

        ax.set_title(f"{model_id} - Actual vs Predicted ({split_name})", fontsize=13, pad=12)
        ax.set_xlabel("Actual Price ($/kWh)", fontsize=11)
        ax.set_ylabel("Predicted Price ($/kWh)", fontsize=11)
        ax.legend(frameon=True)
        ax.grid(True, linestyle="--", alpha=0.5)

        fig.tight_layout()
        fig.savefig(filepath, dpi=200)
        plt.close(fig)
        logger.info(f"Saved actual vs predicted plot to {filepath}")
        return filepath
    except Exception as e:
        logger.warning(f"Failed to generate actual vs predicted plot for {model_id}: {e}")
        return None


def plot_residuals(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    model_id: str,
    output_dir: str = "artifacts/plots",
) -> Optional[str]:
    """Generates Residuals distribution and scatter plot."""
    try:
        os.makedirs(output_dir, exist_ok=True)
        filepath = os.path.join(output_dir, f"{model_id}_residuals.png")

        residuals = np.asarray(y_true).ravel() - np.asarray(y_pred).ravel()

        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))

        # Residuals vs Predicted
        ax1.scatter(y_pred, residuals, alpha=0.8, color="#2ca02c", edgecolors="k")
        ax1.axhline(0, color="red", linestyle="--", lw=1.5)
        ax1.set_title(f"{model_id} - Residuals vs Predicted", fontsize=12)
        ax1.set_xlabel("Predicted Price", fontsize=10)
        ax1.set_ylabel("Residual (Actual - Predicted)", fontsize=10)
        ax1.grid(True, linestyle="--", alpha=0.5)

        # Residual distribution
        sns.histplot(residuals, kde=True, ax=ax2, color="#ff7f0e", bins=10)
        ax2.set_title(f"{model_id} - Residuals Distribution", fontsize=12)
        ax2.set_xlabel("Residual Value", fontsize=10)
        ax2.set_ylabel("Frequency", fontsize=10)
        ax2.grid(True, linestyle="--", alpha=0.5)

        fig.tight_layout()
        fig.savefig(filepath, dpi=200)
        plt.close(fig)
        logger.info(f"Saved residuals plot to {filepath}")
        return filepath
    except Exception as e:
        logger.warning(f"Failed to generate residuals plot for {model_id}: {e}")
        return None


def plot_feature_importance(
    feature_importances: np.ndarray,
    feature_names: List[str],
    model_id: str,
    output_dir: str = "artifacts/plots",
    top_n: int = 15,
) -> Optional[str]:
    """Generates horizontal Feature Importance bar chart."""
    try:
        if feature_importances is None or len(feature_importances) == 0:
            return None

        os.makedirs(output_dir, exist_ok=True)
        filepath = os.path.join(output_dir, f"{model_id}_feature_importance.png")

        # Normalize lengths
        n_feats = min(len(feature_importances), len(feature_names))
        importances = np.asarray(feature_importances[:n_feats])
        names = feature_names[:n_feats]

        # Sort
        indices = np.argsort(importances)[::-1][:top_n]
        top_importances = importances[indices]
        top_names = [names[i] for i in indices]

        fig, ax = plt.subplots(figsize=(10, max(4, len(top_names) * 0.4)))
        y_pos = np.arange(len(top_names))
        ax.barh(y_pos, top_importances, align="center", color="#4e79a7", edgecolor="black")
        ax.set_yticks(y_pos)
        ax.set_yticklabels(top_names)
        ax.invert_yaxis()
        ax.set_xlabel("Relative Importance Score", fontsize=10)
        ax.set_title(f"{model_id} - Feature Importances", fontsize=12)
        ax.grid(True, linestyle="--", alpha=0.5)

        fig.tight_layout()
        fig.savefig(filepath, dpi=200)
        plt.close(fig)
        logger.info(f"Saved feature importance plot to {filepath}")
        return filepath
    except Exception as e:
        logger.warning(f"Failed to generate feature importance plot for {model_id}: {e}")
        return None


def plot_model_comparison(
    models_evaluated: List[Dict[str, Any]],
    output_dir: str = "artifacts/plots",
    metric_keys: Optional[List[str]] = None,
) -> Optional[str]:
    """Generates multi-metric side-by-side bar chart comparison across candidate models."""
    try:
        if not models_evaluated:
            return None

        if metric_keys is None:
            metric_keys = ["MAE", "RMSE", "WAPE", "R2"]

        os.makedirs(output_dir, exist_ok=True)
        filepath = os.path.join(output_dir, "model_comparison.png")

        model_ids = [m["model_id"] for m in models_evaluated]
        
        # Prepare subplots for each metric
        fig, axes = plt.subplots(1, len(metric_keys), figsize=(4 * len(metric_keys), 5), sharey=False)
        if len(metric_keys) == 1:
            axes = [axes]

        colors = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2"]

        for idx, metric_name in enumerate(metric_keys):
            ax = axes[idx]
            val_scores = []
            test_scores = []

            for m in models_evaluated:
                test_val = m.get("metrics", {}).get("test", {}).get(metric_name, 0.0)
                val_val = m.get("metrics", {}).get("validation", {}).get(metric_name, 0.0)
                test_scores.append(test_val)
                val_scores.append(val_val)

            x = np.arange(len(model_ids))
            width = 0.35

            ax.bar(x - width/2, val_scores, width, label="Validation", color=colors[idx % len(colors)], alpha=0.7)
            ax.bar(x + width/2, test_scores, width, label="Test", color=colors[idx % len(colors)], edgecolor="black")

            ax.set_title(f"Comparison: {metric_name}", fontsize=12, fontweight="bold")
            ax.set_xticks(x)
            ax.set_xticklabels(model_ids, rotation=15, ha="right", fontsize=9)
            ax.grid(True, linestyle="--", alpha=0.5)
            ax.legend(fontsize=8)

        fig.suptitle("Candidate Model Benchmark Comparison", fontsize=14, y=1.02)
        fig.tight_layout()
        fig.savefig(filepath, dpi=200, bbox_inches="tight")
        plt.close(fig)
        logger.info(f"Saved model comparison plot to {filepath}")
        return filepath
    except Exception as e:
        logger.warning(f"Failed to generate model comparison plot: {e}")
        return None
