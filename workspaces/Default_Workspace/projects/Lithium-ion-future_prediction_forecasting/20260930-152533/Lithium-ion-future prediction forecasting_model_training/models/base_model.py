"""
Base Model Trainer Interface.
Provides abstract blueprint for candidate model trainers.
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
import os
import joblib
import numpy as np


class BaseModelTrainer(ABC):
    """Abstract base class for all candidate model trainers."""

    def __init__(self, config: Dict[str, Any], model_id: str):
        self.config = config
        self.model_id = model_id
        self.model = None
        self.is_fitted = False

    @abstractmethod
    def train(
        self,
        X_train: np.ndarray,
        y_train: np.ndarray,
        X_val: Optional[np.ndarray] = None,
        y_val: Optional[np.ndarray] = None,
    ) -> Dict[str, Any]:
        """
        Fits the candidate estimator on training data with validation callback.
        Returns training metadata and execution timing.
        """
        pass

    @abstractmethod
    def predict(self, X: np.ndarray) -> np.ndarray:
        """Generates continuous regression/forecast predictions."""
        pass

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        """
        Raises NotImplementedError for regression and forecasting tasks.
        """
        raise NotImplementedError("Probability prediction is not applicable for forecasting/regression tasks.")

    def save(self, filepath: str) -> None:
        """Serializes the trained model object to disk using joblib."""
        if self.model is None:
            raise ValueError(f"Cannot save unfitted model: {self.model_id}")
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        joblib.dump(self.model, filepath)

    def load(self, filepath: str) -> None:
        """Loads serialized model object from disk."""
        if not os.path.exists(filepath):
            raise FileNotFoundError(f"Model artifact not found at {filepath}")
        self.model = joblib.load(filepath)
        self.is_fitted = True

    def get_feature_importances(self) -> Optional[np.ndarray]:
        """Returns feature importances if available on estimator."""
        if self.model is None:
            return None
        if hasattr(self.model, "feature_importances_"):
            return self.model.feature_importances_
        elif hasattr(self.model, "coef_"):
            return np.abs(self.model.coef_)
        return None
