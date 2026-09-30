"""
LightGBM Candidate Model Trainer for Price Forecasting.
"""

import time
import logging
from typing import Dict, Any, Optional
import numpy as np
import lightgbm as lgb
from .base_model import BaseModelTrainer

logger = logging.getLogger(__name__)


class LightGBMTrainer(BaseModelTrainer):
    """Concrete trainer for LightGBM Regressor candidate model."""

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config, model_id="lightgbm_regressor")
        self.display_name = "LightGBM Gradient Boosted Forecaster"
        self.framework = "lightgbm"
        
        # Load hyperparameters from config
        model_params = config.get("models", {}).get("lightgbm_regressor", {}).get("parameters", {})
        
        self.params = {
            "objective": model_params.get("objective", "regression_l1"),
            "n_estimators": int(model_params.get("n_estimators", 100)),
            "learning_rate": float(model_params.get("learning_rate", 0.05)),
            "max_depth": int(model_params.get("max_depth", 4)),
            "num_leaves": int(model_params.get("num_leaves", 15)),
            "random_state": int(model_params.get("random_state", 42)),
            "verbose": int(model_params.get("verbose", -1)),
            "min_child_samples": 1,  # Ensure execution even on very small dataset slices
            "n_jobs": -1
        }

    def train(
        self,
        X_train: np.ndarray,
        y_train: np.ndarray,
        X_val: Optional[np.ndarray] = None,
        y_val: Optional[np.ndarray] = None,
    ) -> Dict[str, Any]:
        """Fits LightGBM Regressor model."""
        logger.info(f"Initializing and training {self.display_name} on {X_train.shape[0]} samples")
        
        self.model = lgb.LGBMRegressor(**self.params)
        
        start_time = time.time()
        if X_val is not None and y_val is not None and len(X_val) > 0:
            eval_set = [(X_val, y_val)]
            self.model.fit(
                X_train,
                y_train,
                eval_set=eval_set,
                callbacks=[lgb.early_stopping(stopping_rounds=15, verbose=False)] if len(y_train) >= 10 else []
            )
        else:
            self.model.fit(X_train, y_train)

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
        """Generates point price predictions."""
        if not self.is_fitted or self.model is None:
            raise ValueError("Model is not fitted yet.")
        return np.asarray(self.model.predict(X), dtype=np.float64)
