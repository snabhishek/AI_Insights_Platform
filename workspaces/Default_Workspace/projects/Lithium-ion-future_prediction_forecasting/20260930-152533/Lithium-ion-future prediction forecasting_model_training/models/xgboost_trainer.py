"""
XGBoost Candidate Model Trainer for Price Forecasting.
"""

import time
import logging
from typing import Dict, Any, Optional
import numpy as np
import xgboost as xgb
from .base_model import BaseModelTrainer

logger = logging.getLogger(__name__)


class XGBoostTrainer(BaseModelTrainer):
    """Concrete trainer for XGBoost Regressor candidate model."""

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config, model_id="xgboost_regressor")
        self.display_name = "XGBoost Regressor"
        self.framework = "xgboost"

        # Load hyperparameters from config
        model_params = config.get("models", {}).get("xgboost_regressor", {}).get("parameters", {})

        self.params = {
            "objective": model_params.get("objective", "reg:absoluteerror"),
            "n_estimators": int(model_params.get("n_estimators", 100)),
            "learning_rate": float(model_params.get("learning_rate", 0.05)),
            "max_depth": int(model_params.get("max_depth", 3)),
            "subsample": float(model_params.get("subsample", 0.8)),
            "colsample_bytree": float(model_params.get("colsample_bytree", 0.8)),
            "random_state": int(model_params.get("random_state", 42)),
            "verbosity": int(model_params.get("verbosity", 0)),
            "n_jobs": -1
        }

    def train(
        self,
        X_train: np.ndarray,
        y_train: np.ndarray,
        X_val: Optional[np.ndarray] = None,
        y_val: Optional[np.ndarray] = None,
    ) -> Dict[str, Any]:
        """Fits XGBoost Regressor model."""
        logger.info(f"Initializing and training {self.display_name} on {X_train.shape[0]} samples")

        self.model = xgb.XGBRegressor(**self.params)

        start_time = time.time()
        if X_val is not None and y_val is not None and len(X_val) > 0 and len(y_train) >= 10:
            self.model.fit(
                X_train,
                y_train,
                eval_set=[(X_val, y_val)],
                verbose=False
            )
        else:
            self.model.fit(X_train, y_train, verbose=False)

        fit_duration = time.time() - start_time
        self.is_fitted = True
        logger.info(f"{self.display_name} training completed in {fit_duration:.4f}s")

        return {
            "model_id": self.model_id,
            "status": "Completed",
            "fit_time_seconds": round(fit_duration, 4),
            "n_train_samples": len(X_train)
        }

    def predict(self, X: np.ndarray) -> np.ndarray:
        """Generates continuous predictions."""
        if not self.is_fitted or self.model is None:
            raise ValueError("Model is not fitted yet.")
        return np.asarray(self.model.predict(X), dtype=np.float64)
