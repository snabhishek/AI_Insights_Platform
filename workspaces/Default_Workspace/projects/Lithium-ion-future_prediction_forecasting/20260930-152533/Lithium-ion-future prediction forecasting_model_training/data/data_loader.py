"""
Data Loader Module for Lithium-ion Future Prediction Forecasting.
Handles parquet/csv dataset loading, target validation, leakage filtering,
high-cardinality nominal handling, temporal splitting with ratio fallback,
and preprocessor persistence.
"""

import os
import logging
from typing import Dict, Any, Tuple, List, Optional
import numpy as np
import pandas as pd
import joblib
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler, OneHotEncoder

logger = logging.getLogger(__name__)


class DataLoader:
    """Robust data loading and preprocessing pipeline."""

    def __init__(self, config: Dict[str, Any], base_path: str = ".", data_path: Optional[str] = None):
        self.config = config
        self.base_path = base_path
        self.data_path = data_path
        self.target_column = (
            config.get("target", {}).get("target_column")
            or config.get("target", {}).get("name")
            or "Price of lithium-ion battery cells"
        )
        self.time_column = (
            config.get("split", {}).get("time_column")
            or config.get("features", {}).get("time_column")
            or "Year"
        )
        self.split_cutoff = (
            config.get("split", {}).get("split_cutoff_date")
            or config.get("split", {}).get("split_end_date")
            or config.get("split", {}).get("split_date")
            or "1996-01"
        )
        self.preprocessor: Optional[ColumnTransformer] = None
        self.feature_names: List[str] = []

    def find_dataset_file(self) -> str:
        """Search for the dataset file across standard paths."""
        configured_paths = self.config.get("dataset", {}).get("fallback_paths", [])
        primary_path = self.config.get("dataset", {}).get("primary_path")
        
        candidates = []
        if self.data_path:
            if os.path.isfile(self.data_path):
                candidates.append(self.data_path)
            elif os.path.isdir(self.data_path):
                candidates.extend([
                    os.path.join(self.data_path, "dataset.parquet"),
                    os.path.join(self.data_path, "20260930-152533/python_script/dataset.parquet"),
                    os.path.join(self.data_path, "python_script/dataset.parquet"),
                    os.path.join(self.data_path, "price_of_lithium_ion_battery_cells.csv"),
                    os.path.join(self.data_path, "20260930-152533/python_script/price_of_lithium_ion_battery_cells.csv"),
                ])

        if primary_path:
            candidates.append(primary_path)
            candidates.append(os.path.join(self.base_path, os.path.basename(primary_path)))
            candidates.append(os.path.join(self.base_path, primary_path))
        
        candidates.extend(configured_paths)
        candidates.extend([
            os.path.join(self.base_path, "dataset.parquet"),
            os.path.join(self.base_path, "20260930-152533/python_script/dataset.parquet"),
            os.path.join(self.base_path, "../python_script/dataset.parquet"),
            os.path.join(self.base_path, "../../python_script/dataset.parquet"),
            "/workspace/20260930-152533/python_script/dataset.parquet",
            "/workspace/dataset.parquet",
            os.path.join(self.base_path, "20260930-152533/python_script/price_of_lithium_ion_battery_cells.csv"),
            os.path.join(self.base_path, "../python_script/price_of_lithium_ion_battery_cells.csv"),
            os.path.join(self.base_path, "price_of_lithium_ion_battery_cells.csv")
        ])

        for path in candidates:
            if path and os.path.exists(path):
                logger.info(f"Found dataset at: {path}")
                return path

        # Recursive search in base_path if not found
        search_roots = [self.base_path]
        if self.data_path and os.path.exists(self.data_path):
            search_roots.append(self.data_path)
        search_roots.append(".")

        for search_root in search_roots:
            for root, _, files in os.walk(search_root):
                for file in files:
                    if file in ["dataset.parquet", "price_of_lithium_ion_battery_cells.csv"]:
                        found = os.path.join(root, file)
                        logger.info(f"Discovered dataset via search at: {found}")
                        return found

        raise FileNotFoundError(
            f"Could not locate dataset.parquet or price_of_lithium_ion_battery_cells.csv in {candidates}"
        )

    def load_raw_data(self) -> pd.DataFrame:
        """Load DataFrame from Parquet or CSV."""
        dataset_path = self.find_dataset_file()
        logger.info(f"Loading data from {dataset_path}")
        
        if dataset_path.endswith(".parquet"):
            df = pd.read_parquet(dataset_path)
        else:
            df = pd.read_csv(dataset_path)

        logger.info(f"Loaded raw dataset with shape: {df.shape}")
        return df

    def filter_leakage_and_high_cardinality(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Exclude leakage features and high-cardinality nominal identifiers (>50 unique values).
        """
        leakage_patterns = [
            "promotion_type_volume",
            "order_discount_rate",
            "price_discount_amount",
            "target_",
            "discount_tier"
        ]
        
        cols_to_drop = []
        for col in df.columns:
            if col == self.target_column:
                continue
            
            lower_col = col.lower()
            if any(pattern in lower_col for pattern in leakage_patterns):
                cols_to_drop.append(col)
                logger.warning(f"Dropping potential target leakage column: {col}")
                continue

            # Drop high cardinality string/object columns (>50 unique values)
            if df[col].dtype == "object" or df[col].dtype.name == "category" or df[col].dtype == "string":
                if df[col].nunique() > 50:
                    cols_to_drop.append(col)
                    logger.warning(f"Dropping high-cardinality categorical column (>50 unique values): {col}")

        if cols_to_drop:
            df = df.drop(columns=cols_to_drop)

        return df

    def split_data(
        self, df: pd.DataFrame
    ) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        """
        Splits dataset into train, validation, and test subsets.
        Uses temporal splitting when time column and cutoff are available.
        Falls back to 70/15/15 ratio split when needed.
        """
        random_seed = self.config.get("split", {}).get("random_seed", 42)
        train_ratio = self.config.get("split", {}).get("fallback", {}).get("train_ratio", 0.70)
        val_ratio = self.config.get("split", {}).get("fallback", {}).get("validation_ratio", 0.15)

        # Attempt temporal split
        if self.time_column in df.columns and self.split_cutoff:
            try:
                logger.info(f"Attempting temporal split on '{self.time_column}' with cutoff '{self.split_cutoff}'")
                
                # Convert time column to datetime
                if pd.api.types.is_numeric_dtype(df[self.time_column]):
                    time_series = pd.to_datetime(df[self.time_column].astype(str), errors="coerce")
                else:
                    time_series = pd.to_datetime(df[self.time_column], errors="coerce")

                cutoff_dt = pd.to_datetime(self.split_cutoff)

                train_mask = time_series <= cutoff_dt
                post_cutoff_mask = time_series > cutoff_dt

                train_df = df[train_mask].copy()
                post_cutoff_df = df[post_cutoff_mask].copy()

                logger.info(f"Temporal split pre-check: {len(train_df)} train records, {len(post_cutoff_df)} post-cutoff records")

                if len(train_df) >= 2 and len(post_cutoff_df) >= 1:
                    if len(post_cutoff_df) == 1:
                        # With 1 post cutoff record, share between val and test
                        val_df = post_cutoff_df.copy()
                        test_df = post_cutoff_df.copy()
                    else:
                        val_count = max(1, int(len(post_cutoff_df) * 0.5))
                        val_df = post_cutoff_df.iloc[:val_count].copy()
                        test_df = post_cutoff_df.iloc[val_count:].copy()

                    logger.info(
                        f"Temporal split successful: train={len(train_df)}, val={len(val_df)}, test={len(test_df)}"
                    )
                    return train_df, val_df, test_df
                else:
                    logger.warning("Temporal split produced insufficient train/test partition. Falling back to ratio split.")
            except Exception as e:
                logger.warning(f"Temporal splitting encountered an issue: {e}. Falling back to ratio split.")

        # Fallback 70/15/15 ratio split
        logger.info("Executing standard 70/15/15 ratio split fallback.")
        n_samples = len(df)
        if n_samples < 3:
            # Handle tiny dataset edge case gracefully
            train_df = df.copy()
            val_df = df.copy()
            test_df = df.copy()
            return train_df, val_df, test_df

        shuffled_df = df.sample(frac=1.0, random_state=random_seed).reset_index(drop=True)
        train_end = max(1, int(n_samples * train_ratio))
        val_end = max(train_end + 1, int(n_samples * (train_ratio + val_ratio)))
        if val_end >= n_samples:
            val_end = n_samples - 1
            if train_end >= val_end:
                train_end = max(1, val_end - 1)

        train_df = shuffled_df.iloc[:train_end].copy()
        val_df = shuffled_df.iloc[train_end:val_end].copy() if val_end > train_end else shuffled_df.iloc[train_end:].copy()
        test_df = shuffled_df.iloc[val_end:].copy() if len(shuffled_df.iloc[val_end:]) > 0 else val_df.copy()

        logger.info(f"Ratio split completed: train={len(train_df)}, val={len(val_df)}, test={len(test_df)}")
        return train_df, val_df, test_df

    def build_and_fit_preprocessor(
        self, X_train: pd.DataFrame
    ) -> Tuple[np.ndarray, ColumnTransformer, List[str]]:
        """
        Constructs and fits preprocessing transformers strictly on X_train.
        Persists fitted transformer to artifacts/models/preprocessor.joblib.
        """
        numeric_cols = []
        categorical_cols = []

        for col in X_train.columns:
            if pd.api.types.is_numeric_dtype(X_train[col]):
                numeric_cols.append(col)
            else:
                categorical_cols.append(col)

        logger.info(f"Numeric features ({len(numeric_cols)}): {numeric_cols}")
        logger.info(f"Categorical features ({len(categorical_cols)}): {categorical_cols}")

        transformers = []
        if numeric_cols:
            num_pipeline = Pipeline([
                ("imputer", SimpleImputer(strategy="median")),
                ("scaler", StandardScaler())
            ])
            transformers.append(("num", num_pipeline, numeric_cols))

        if categorical_cols:
            cat_pipeline = Pipeline([
                ("imputer", SimpleImputer(strategy="most_frequent")),
                ("ohe", OneHotEncoder(handle_unknown="ignore", sparse_output=False))
            ])
            transformers.append(("cat", cat_pipeline, categorical_cols))

        preprocessor = ColumnTransformer(
            transformers=transformers,
            remainder="drop"
        )

        X_train_trans = preprocessor.fit_transform(X_train)
        
        # Determine feature names after transformation
        feature_names = []
        if numeric_cols:
            feature_names.extend(numeric_cols)
        if categorical_cols and "cat" in preprocessor.named_transformers_:
            try:
                cat_ohe = preprocessor.named_transformers_["cat"].named_steps["ohe"]
                ohe_feature_names = cat_ohe.get_feature_names_out(categorical_cols).tolist()
                feature_names.extend(ohe_feature_names)
            except Exception:
                feature_names.extend(categorical_cols)

        self.preprocessor = preprocessor
        self.feature_names = feature_names

        # MANDATORY PERSISTENCE
        artifacts_dir = os.path.join(self.base_path, "artifacts", "models")
        os.makedirs(artifacts_dir, exist_ok=True)
        preprocessor_path = os.path.join(artifacts_dir, "preprocessor.joblib")
        joblib.dump(preprocessor, preprocessor_path)
        logger.info(f"Saved fitted preprocessor to {preprocessor_path}")

        return X_train_trans, preprocessor, feature_names

    def prepare_data(self) -> Dict[str, Any]:
        """
        Full orchestration of data loading, validation, splitting, and preprocessing.
        """
        df = self.load_raw_data()

        # Validate target column presence and non-null values
        if self.target_column not in df.columns:
            raise KeyError(
                f"Target column '{self.target_column}' not found in dataset columns: {list(df.columns)}"
            )

        df = df.dropna(subset=[self.target_column]).copy()
        if len(df) == 0:
            raise ValueError(f"Dataset has no valid records after dropping nulls in '{self.target_column}'")

        # CRITICAL MANDATE: Continuous target must remain numeric
        df[self.target_column] = pd.to_numeric(df[self.target_column], errors="coerce")
        df = df.dropna(subset=[self.target_column]).copy()

        df = self.filter_leakage_and_high_cardinality(df)

        # Separate target y and features DataFrame
        train_df, val_df, test_df = self.split_data(df)

        y_train = train_df[self.target_column].values.astype(np.float64)
        y_val = val_df[self.target_column].values.astype(np.float64)
        y_test = test_df[self.target_column].values.astype(np.float64)

        X_train_df = train_df.drop(columns=[self.target_column])
        X_val_df = val_df.drop(columns=[self.target_column])
        X_test_df = test_df.drop(columns=[self.target_column])

        # Filter to configured feature list if specified
        configured_features = self.config.get("features", {}).get("features_list", [])
        if configured_features:
            active_features = [f for f in configured_features if f in X_train_df.columns and f != self.target_column]
            if active_features:
                X_train_df = X_train_df[active_features]
                X_val_df = X_val_df[active_features]
                X_test_df = X_test_df[active_features]

        # Fit preprocessor strictly on train set
        X_train_trans, preprocessor, feature_names = self.build_and_fit_preprocessor(X_train_df)
        X_val_trans = preprocessor.transform(X_val_df)
        X_test_trans = preprocessor.transform(X_test_df)

        return {
            "X_train": X_train_trans,
            "y_train": y_train,
            "X_val": X_val_trans,
            "y_val": y_val,
            "X_test": X_test_trans,
            "y_test": y_test,
            "raw_train_df": train_df,
            "raw_val_df": val_df,
            "raw_test_df": test_df,
            "feature_names": feature_names,
            "preprocessor": preprocessor,
            "preprocessor_path": "artifacts/models/preprocessor.joblib",
            "target_column": self.target_column
        }
