"""
Evaluation Metrics Calculator for Forecasting and Regression.
"""

import logging
from typing import Dict, Any, Union
import numpy as np
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

logger = logging.getLogger(__name__)


def calculate_regression_metrics(
    y_true: Union[np.ndarray, list],
    y_pred: Union[np.ndarray, list],
    primary_metric: str = "MAE",
) -> Dict[str, Any]:
    """
    Computes regression evaluation metrics: MAE, RMSE, WAPE, MAPE, R2.
    Populates primary metric value into 'score'.
    """
    y_t = np.asarray(y_true, dtype=np.float64).ravel()
    y_p = np.asarray(y_pred, dtype=np.float64).ravel()

    if len(y_t) == 0:
        return {
            "score": float("inf"),
            "MAE": float("inf"),
            "RMSE": float("inf"),
            "WAPE": float("inf"),
            "MAPE": float("inf"),
            "R2": 0.0,
            "sample_count": 0
        }

    # Core scikit-learn metrics
    mae = float(mean_absolute_error(y_t, y_p))
    rmse = float(np.sqrt(mean_squared_error(y_t, y_p)))
    
    # R2 score (safely handled if variance is 0 or len < 2)
    if len(y_t) >= 2 and np.var(y_t) > 1e-9:
        r2 = float(r2_score(y_t, y_p))
    else:
        r2 = 1.0 if np.allclose(y_t, y_p) else 0.0

    # WAPE: sum(|y_true - y_pred|) / sum(|y_true|) * 100
    sum_true = float(np.sum(np.abs(y_t)))
    if sum_true > 1e-9:
        wape = float(np.sum(np.abs(y_t - y_p)) / sum_true * 100.0)
    else:
        wape = 0.0 if mae < 1e-9 else float("inf")

    # MAPE: mean(|(y_true - y_pred) / max(|y_true|, 1e-6)|) * 100
    denom = np.where(np.abs(y_t) < 1e-6, 1e-6, np.abs(y_t))
    mape = float(np.mean(np.abs((y_t - y_p) / denom)) * 100.0)

    metrics = {
        "MAE": round(mae, 4),
        "RMSE": round(rmse, 4),
        "WAPE": round(wape, 4),
        "MAPE": round(mape, 4),
        "R2": round(r2, 4),
        "sample_count": int(len(y_t))
    }

    # Populate primary score
    primary_metric_upper = primary_metric.upper()
    if primary_metric_upper in metrics:
        metrics["score"] = metrics[primary_metric_upper]
    else:
        metrics["score"] = metrics["MAE"]

    return metrics
