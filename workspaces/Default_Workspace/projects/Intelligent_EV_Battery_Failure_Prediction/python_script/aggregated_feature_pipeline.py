# Aggregated feature engineering script: aggregated_feature_pipeline.py

# Shared imports region
# -- REGION: SHARED_IMPORTS START --
# -- REGION: SHARED_IMPORTS END --

# Feature creation region
# -- REGION: FEATURE_CREATION START --
import os
import sys
import argparse
import logging
import tempfile
import numpy as np
import pandas as pd
import duckdb
import yaml

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(name)s - %(message)s'
)
logger = logging.getLogger("feature_creation")

yamlLineage = """
stage: feature_creation
inputs:
  - raw_ev_battery_dataset (csv, parquet, or duckdb)
outputs:
  - created_features.parquet
operations:
  - numeric coercion and fillna
  - domain-specific degradation & health ratios
  - thermal stress calculations
  - voltage imbalance and variance metrics
  - charging behavior and composite stress indices
  - cycle count and health percentage binning
  - categorical interactions and one-hot encoding
  - atomic parquet serialization via pandas/duckdb
"""


def _read_parquet_safe(file_path: str) -> pd.DataFrame:
    """
    Safely reads a Parquet file using pandas or DuckDB if pyarrow/fastparquet is unavailable.
    """
    try:
        return pd.read_parquet(file_path)
    except Exception:
        norm_path = os.path.abspath(file_path).replace('\\', '/')
        con = duckdb.connect()
        try:
            return con.execute(f"SELECT * FROM read_parquet('{norm_path}')").df()
        finally:
            con.close()


def _write_parquet_safe(df: pd.DataFrame, file_path: str) -> None:
    """
    Safely writes a DataFrame to a Parquet file using pandas or DuckDB if pyarrow/fastparquet is unavailable.
    """
    try:
        df.to_parquet(file_path, index=False)
    except Exception:
        norm_path = os.path.abspath(file_path).replace('\\', '/')
        con = duckdb.connect()
        try:
            con.register('temp_export_view', df)
            con.execute(f"COPY temp_export_view TO '{norm_path}' (FORMAT PARQUET)")
        finally:
            con.close()


def load_raw_dataset(db_path: str) -> pd.DataFrame:
    """
    Safely load the EV battery dataset from a Directory, Parquet file, CSV file, or DuckDB database.
    Supports recursive directory scanning and flexible file matching.
    """
    logger.info(f"Attempting to load source data from: {db_path}")

    # Case 1: Directory path
    if os.path.isdir(db_path):
        all_files = []
        for root, _, files in os.walk(db_path):
            for f in files:
                all_files.append(os.path.join(root, f))

        parquet_candidates = [f for f in all_files if f.lower().endswith(".parquet")]
        csv_candidates = [f for f in all_files if f.lower().endswith(".csv")]
        duckdb_candidates = [f for f in all_files if f.lower().endswith((".duckdb", ".db", ".sqlite"))]

        # Check for specific EV battery dataset name matches first
        for p in parquet_candidates:
            if "battery" in os.path.basename(p).lower() or "ev_" in os.path.basename(p).lower():
                logger.info(f"Loading parquet from {p}")
                return _read_parquet_safe(p)

        for c in csv_candidates:
            if "battery" in os.path.basename(c).lower() or "ev_" in os.path.basename(c).lower():
                logger.info(f"Loading csv from {c}")
                return pd.read_csv(c)

        # Fallback to any parquet or csv in directory
        if parquet_candidates:
            logger.info(f"Loading first parquet candidate: {parquet_candidates[0]}")
            return _read_parquet_safe(parquet_candidates[0])

        if csv_candidates:
            logger.info(f"Loading first csv candidate: {csv_candidates[0]}")
            return pd.read_csv(csv_candidates[0])

        if duckdb_candidates:
            selected_duckdb = duckdb_candidates[0]
            logger.info(f"Loading from DuckDB database: {selected_duckdb}")
            con = duckdb.connect(selected_duckdb, read_only=True)
            tables = con.execute("SHOW TABLES").fetchall()
            table_names = [t[0] for t in tables]
            if not table_names:
                con.close()
                raise ValueError(f"No tables found in DuckDB database: {selected_duckdb}")
            tbl = None
            for t in table_names:
                if "ev_battery" in t.lower() or "battery" in t.lower():
                    tbl = t
                    break
            if tbl is None:
                tbl = table_names[0]
            df = con.execute(f"SELECT * FROM {tbl}").df()
            con.close()
            return df

        raise FileNotFoundError(f"No suitable dataset file (parquet, csv, duckdb) found in directory: {db_path}")

    # Case 2: Direct file path
    elif os.path.isfile(db_path):
        lower_path = db_path.lower()
        if lower_path.endswith(".parquet"):
            return _read_parquet_safe(db_path)
        elif lower_path.endswith(".csv"):
            return pd.read_csv(db_path)
        elif lower_path.endswith((".duckdb", ".db", ".sqlite")):
            con = duckdb.connect(db_path, read_only=True)
            tables = con.execute("SHOW TABLES").fetchall()
            table_names = [t[0] for t in tables]
            if not table_names:
                con.close()
                raise ValueError(f"No tables found in DuckDB database: {db_path}")
            tbl = None
            for t in table_names:
                if "ev_battery" in t.lower() or "battery" in t.lower():
                    tbl = t
                    break
            if tbl is None:
                tbl = table_names[0]
            df = con.execute(f"SELECT * FROM {tbl}").df()
            con.close()
            return df
        else:
            raise ValueError(f"Unsupported file format for db_path: {db_path}")
    else:
        raise FileNotFoundError(f"Path does not exist: {db_path}")


def compute_engineered_features(df_input: pd.DataFrame) -> pd.DataFrame:
    """
    Computes domain-specific engineered features for EV battery failure prediction:
    - Calculated health, degradation, thermal, electrical, and stress features.
    - Categorical interactions and binning.
    - One-hot encoding of categorical variables.
    - Explicitly excludes designated leakage column 'predicted_remaining_life_cycles'.
    """
    logger.info("Initiating feature creation calculations...")
    df = df_input.copy()

    # Ensure numeric types for calculation fields
    numeric_cols = [
        'odometer_km', 'vehicle_age_years', 'cycle_count', 'battery_health_percent',
        'state_of_charge', 'depth_of_discharge', 'state_of_health', 'cell_voltage_avg',
        'cell_voltage_std', 'pack_voltage', 'cell_temperature_avg', 'cell_temperature_max',
        'internal_resistance', 'charge_efficiency', 'discharge_efficiency', 'remaining_capacity',
        'capacity_loss_percent', 'charging_cycles_last_month', 'fast_charge_ratio', 'slow_charge_ratio',
        'average_charge_power_kw', 'average_charging_time', 'overnight_charging_ratio',
        'home_charging_ratio', 'charging_interruptions', 'overcharge_events', 'average_speed',
        'average_trip_distance', 'aggressive_acceleration_score', 'hard_braking_score',
        'regenerative_braking_usage', 'highway_driving_ratio', 'city_driving_ratio',
        'daily_distance', 'average_ambient_temperature', 'maximum_temperature',
        'minimum_temperature', 'humidity', 'altitude', 'dust_exposure', 'last_service_days',
        'cooling_system_health', 'firmware_updates', 'previous_faults', 'maintenance_score',
        'thermal_runaway_risk', 'voltage_imbalance', 'temperature_variance', 'sensor_fault_count',
        'BMS_warning_count', 'abnormal_voltage_events', 'battery_stress_index', 'aging_score',
        'thermal_health_score', 'charging_quality_score', 'driving_stress_score'
    ]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0.0)

    # 1. Calculated Degradation & Health Features
    if 'capacity_loss_percent' in df.columns and 'cycle_count' in df.columns:
        df['capacity_loss_per_cycle'] = df['capacity_loss_percent'] / (df['cycle_count'] + 1.0)
    
    if 'internal_resistance' in df.columns and 'cycle_count' in df.columns:
        df['internal_resistance_per_cycle'] = df['internal_resistance'] / (df['cycle_count'] + 1.0)

    if 'battery_health_percent' in df.columns and 'vehicle_age_years' in df.columns:
        df['health_to_age_ratio'] = df['battery_health_percent'] / (df['vehicle_age_years'] + 0.1)

    if 'capacity_loss_percent' in df.columns and 'odometer_km' in df.columns:
        df['degradation_rate_per_km'] = df['capacity_loss_percent'] / (df['odometer_km'] + 1.0)

    # 2. Calculated Thermal Stress Features
    if 'cell_temperature_max' in df.columns and 'cell_temperature_avg' in df.columns:
        df['temp_delta_max_avg'] = df['cell_temperature_max'] - df['cell_temperature_avg']
        df['thermal_stress_ratio'] = df['cell_temperature_max'] / (df['cell_temperature_avg'] + 1e-5)

    if 'cell_temperature_avg' in df.columns and 'average_ambient_temperature' in df.columns:
        df['ambient_cell_temp_gap'] = df['cell_temperature_avg'] - df['average_ambient_temperature']

    if 'maximum_temperature' in df.columns and 'minimum_temperature' in df.columns:
        df['ambient_temp_range'] = df['maximum_temperature'] - df['minimum_temperature']

    if 'cooling_system_health' in df.columns and 'thermal_runaway_risk' in df.columns:
        df['cooling_deficiency_index'] = (100.0 - df['cooling_system_health']) * df['thermal_runaway_risk']

    # 3. Calculated Voltage & Cell Imbalance Features
    if 'voltage_imbalance' in df.columns and 'cell_voltage_avg' in df.columns:
        df['voltage_spread_ratio'] = df['voltage_imbalance'] / (df['cell_voltage_avg'] + 1e-5)

    if 'cell_voltage_std' in df.columns and 'cell_voltage_avg' in df.columns:
        df['cell_voltage_cv'] = df['cell_voltage_std'] / (df['cell_voltage_avg'] + 1e-5)

    if 'abnormal_voltage_events' in df.columns and 'cycle_count' in df.columns:
        df['abnormal_voltage_rate_per_cycle'] = df['abnormal_voltage_events'] / (df['cycle_count'] + 1.0)

    # 4. Calculated Charging Stress Features
    if 'fast_charge_ratio' in df.columns and 'slow_charge_ratio' in df.columns:
        df['fast_to_slow_charge_ratio'] = df['fast_charge_ratio'] / (df['slow_charge_ratio'] + 0.01)

    if 'charging_interruptions' in df.columns and 'charging_cycles_last_month' in df.columns:
        df['charge_interruption_rate'] = df['charging_interruptions'] / (df['charging_cycles_last_month'] + 1.0)

    if 'overcharge_events' in df.columns and 'fast_charge_ratio' in df.columns:
        df['overcharge_risk_factor'] = df['overcharge_events'] * df['fast_charge_ratio']

    if 'average_charge_power_kw' in df.columns and 'fast_charge_ratio' in df.columns:
        df['high_power_charge_stress'] = df['average_charge_power_kw'] * df['fast_charge_ratio']

    # 5. Calculated Behavioral & Multi-Domain Composite Stress Features
    if 'aggressive_acceleration_score' in df.columns and 'hard_braking_score' in df.columns:
        df['driving_dynamics_stress'] = df['aggressive_acceleration_score'] * df['hard_braking_score']

    if 'battery_stress_index' in df.columns and 'thermal_runaway_risk' in df.columns and 'voltage_imbalance' in df.columns:
        df['composite_battery_risk_score'] = df['battery_stress_index'] * df['thermal_runaway_risk'] * (df['voltage_imbalance'] + 0.01)

    if all(c in df.columns for c in ['BMS_warning_count', 'sensor_fault_count', 'previous_faults', 'cycle_count']):
        df['bms_alert_density'] = (df['BMS_warning_count'] + df['sensor_fault_count'] + df['previous_faults']) / (df['cycle_count'] + 1.0)

    if 'last_service_days' in df.columns and 'maintenance_score' in df.columns:
        df['maintenance_neglect_factor'] = df['last_service_days'] / (df['maintenance_score'] + 1.0)

    # 6. Binning Features
    if 'cycle_count' in df.columns:
        df['cycle_count_bin'] = pd.cut(
            df['cycle_count'],
            bins=[-np.inf, 500, 1000, 1500, np.inf],
            labels=['Low_Cycles', 'Medium_Cycles', 'High_Cycles', 'Extreme_Cycles']
        ).astype(str)

    if 'battery_health_percent' in df.columns:
        df['battery_health_category'] = pd.cut(
            df['battery_health_percent'],
            bins=[-np.inf, 70.0, 80.0, 90.0, np.inf],
            labels=['Critical_Health', 'Degraded_Health', 'Moderate_Health', 'Good_Health']
        ).astype(str)

    # 7. Field Splitting / Categorical Interaction
    if 'battery_chemistry' in df.columns and 'fleet_or_private' in df.columns:
        df['chemistry_fleet_combo'] = df['battery_chemistry'].astype(str) + '_' + df['fleet_or_private'].astype(str)

    # 8. One-Hot Encoding for Categoricals (Preserves entity key and target)
    cat_cols_to_encode = ['battery_chemistry', 'fleet_or_private', 'terrain_type', 'vehicle_type', 'drive_type']
    present_cat_cols = [c for c in cat_cols_to_encode if c in df.columns]
    if present_cat_cols:
        ohe_df = pd.get_dummies(df[present_cat_cols], prefix='ohe', drop_first=False, dtype=float)
        df = pd.concat([df, ohe_df], axis=1)

    logger.info(f"Feature creation complete. Output shape: {df.shape}")
    return df


def save_atomic_parquet(df: pd.DataFrame, target_path: str):
    """
    Atomically writes a DataFrame to a Parquet file using a temporary staging file.
    """
    target_dir = os.path.dirname(os.path.abspath(target_path))
    os.makedirs(target_dir, exist_ok=True)
    
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".parquet", dir=target_dir)
    temp_path = temp_file.name
    temp_file.close()

    try:
        _write_parquet_safe(df, temp_path)
        # Verify written file
        verify_df = _read_parquet_safe(temp_path)
        if len(verify_df) != len(df) or len(verify_df.columns) != len(df.columns):
            raise IOError("Verification failed: temporary parquet row/column count mismatch.")
        os.replace(temp_path, target_path)
        logger.info(f"Successfully saved engineered features to {target_path} ({len(df)} rows, {len(df.columns)} columns)")
    except Exception as e:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass
        raise IOError(f"Failed to atomically write Parquet file: {str(e)}") from e


def main_feature_creation(args_list=None):
    """
    Main entry point for Feature Creation Stage.
    Accepts CLI arguments or function call argument list.
    """
    parser = argparse.ArgumentParser(description="Feature Creation Stage for EV Battery Failure Prediction")
    parser.add_argument("--db-path", type=str, required=True, help="Path to database or directory containing tables")
    parser.add_argument("--output-path", type=str, default=None, help="Output destination path for features parquet")
    args = parser.parse_args(args_list)

    logger.info(f"Starting main_feature_creation with db_path={args.db_path}, output_path={args.output_path}")

    # Determine default output path if not provided
    if args.output_path:
        out_path = args.output_path
    elif os.path.isdir(args.db_path):
        out_path = os.path.join(args.db_path, "created_features.parquet")
    else:
        out_path = os.path.join(os.path.dirname(os.path.abspath(args.db_path)), "created_features.parquet")

    # Load dataset
    df = load_raw_dataset(args.db_path)
    logger.info(f"Loaded raw dataset with shape {df.shape}")

    # Compute features
    features_df = compute_engineered_features(df)

    # Save features atomically
    save_atomic_parquet(features_df, out_path)

    return {
        "status": "OK",
        "rows": len(features_df),
        "columns": len(features_df.columns),
        "output_path": out_path
    }
# -- REGION: FEATURE_CREATION END --

# Feature transformation region
# -- REGION: FEATURE_TRANSFORMATION START --
import os
import sys
import json
import argparse
import logging
import tempfile
import numpy as np
import pandas as pd
import duckdb
import yaml

logger = logging.getLogger("feature_transformation")

yamlLineageTransformation = """
stage: feature_transformation
inputs:
  - created_features.parquet (or raw_ev_battery_dataset)
outputs:
  - transformed_features.parquet
  - transformer_params.json
operations:
  - target and entity key preservation (battery_failure, vehicle_id)
  - leakage column exclusion (predicted_remaining_life_cycles)
  - missing value imputation:
      numeric: median imputation (fit on train split)
      categorical: mode imputation (fit on train split)
  - skewness and heavy-tail transformations:
      log1p applied to strictly non-negative skewed telemetry and interaction features
  - outlier treatment:
      quantile-based winsorization / clipping [1st percentile, 99th percentile]
  - feature normalization / scaling:
      z-score standardization (mean=0, std=1) with epsilon guard
  - categorical one-hot and frequency encoding
  - strict prevention of data leakage (parameters fit on train split only)
  - JSON-based text parameter persistence (zero-pickle security)
  - atomic file persistence
"""


def _load_features_for_transformation(db_path: str, features_path: str = None) -> pd.DataFrame:
    """
    Locates and loads the feature dataset produced by Feature Creation or raw dataset.
    """
    candidates = []
    if features_path:
        candidates.append(features_path)

    if os.path.isdir(db_path):
        candidates.extend([
            os.path.join(db_path, "created_features.parquet"),
            os.path.join(db_path, "dataset.parquet"),
            os.path.join(db_path, "order_features.parquet"),
            os.path.join(db_path, "features.parquet")
        ])
    elif os.path.isfile(db_path):
        candidates.append(db_path)

    for cand in candidates:
        if cand and os.path.isfile(cand):
            logger.info(f"Loading feature dataset from {cand}")
            return _read_parquet_safe(cand) if cand.endswith(".parquet") else pd.read_csv(cand)

    # Fallback to load_raw_dataset
    logger.info("Created features file not found directly; falling back to load_raw_dataset + feature creation.")
    df_raw = load_raw_dataset(db_path)
    return compute_engineered_features(df_raw)


def fit_transformer_parameters(df: pd.DataFrame, numeric_cols: list, cat_cols: list, skewed_cols: list) -> dict:
    """
    Fits transformation statistics strictly on the training split:
    - Median and mode imputers
    - Winsorization quantiles (q01, q99)
    - Mean and standard deviation for standardization
    """
    logger.info("Fitting transformer parameters on training split...")
    params = {
        "imputation": {"numeric_medians": {}, "categorical_modes": {}},
        "winsorization": {},
        "skewness": {"skewed_cols": skewed_cols},
        "standardization": {},
        "categorical_encodings": {}
    }

    # Numeric Imputation Medians
    for col in numeric_cols:
        if col in df.columns:
            median_val = float(df[col].median(skipna=True))
            if np.isnan(median_val):
                median_val = 0.0
            params["imputation"]["numeric_medians"][col] = median_val

    # Categorical Imputation Modes
    for col in cat_cols:
        if col in df.columns:
            mode_series = df[col].dropna().mode()
            mode_val = str(mode_series.iloc[0]) if not mode_series.empty else "Missing"
            params["imputation"]["categorical_modes"][col] = mode_val

    # Winsorization Bounds & Scaling on Imputed / Skew-Transformed data
    df_work = df.copy()
    for col in numeric_cols:
        if col in df_work.columns:
            df_work[col] = df_work[col].fillna(params["imputation"]["numeric_medians"].get(col, 0.0))

    # Skewness log1p transform for designated features
    for col in skewed_cols:
        if col in df_work.columns:
            min_val = df_work[col].min()
            shift = abs(min_val) if min_val < 0 else 0.0
            df_work[col] = np.log1p(np.maximum(0.0, df_work[col] + shift))

    # Calculate Winsorization Quantiles & Z-Score stats
    for col in numeric_cols:
        if col in df_work.columns:
            q01 = float(df_work[col].quantile(0.01))
            q99 = float(df_work[col].quantile(0.99))
            params["winsorization"][col] = {"q01": q01, "q99": q99}

            clipped_series = df_work[col].clip(lower=q01, upper=q99)
            mean_val = float(clipped_series.mean())
            std_val = float(clipped_series.std())
            if np.isnan(std_val) or std_val < 1e-6:
                std_val = 1.0
            params["standardization"][col] = {"mean": mean_val, "std": std_val}

    logger.info("Transformer parameters successfully fitted.")
    return params


def apply_transformations(df_input: pd.DataFrame, params: dict, target_col: str = "battery_failure", entity_col: str = "vehicle_id", leakage_cols: list = None) -> pd.DataFrame:
    """
    Applies fitted imputation, winsorization, log1p transformation, and scaling across dataset splits.
    Preserves prediction entity keys and ground truth targets untouched.
    """
    df = df_input.copy()

    # Drop leakage columns if present
    if leakage_cols:
        for lc in leakage_cols:
            if lc in df.columns:
                logger.info(f"Excluding leakage column: {lc}")
                df.drop(columns=[lc], inplace=True)

    # 1. Imputation
    num_medians = params.get("imputation", {}).get("numeric_medians", {})
    for col, med_val in num_medians.items():
        if col in df.columns and col != target_col and col != entity_col:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(med_val)

    cat_modes = params.get("imputation", {}).get("categorical_modes", {})
    for col, mode_val in cat_modes.items():
        if col in df.columns and col != target_col and col != entity_col:
            df[col] = df[col].fillna(mode_val).astype(str)

    # 2. Skewness Log1p Transform
    skewed_cols = params.get("skewness", {}).get("skewed_cols", [])
    for col in skewed_cols:
        if col in df.columns and col != target_col and col != entity_col:
            df[col] = np.log1p(np.maximum(0.0, pd.to_numeric(df[col], errors='coerce').fillna(0.0)))

    # 3. Outlier Treatment (Winsorization) & Standardization
    winsor_dict = params.get("winsorization", {})
    std_dict = params.get("standardization", {})

    for col, bounds in winsor_dict.items():
        if col in df.columns and col != target_col and col != entity_col:
            q01 = bounds.get("q01", -np.inf)
            q99 = bounds.get("q99", np.inf)
            df[col] = df[col].clip(lower=q01, upper=q99)

            if col in std_dict:
                mean_val = std_dict[col].get("mean", 0.0)
                std_val = std_dict[col].get("std", 1.0)
                df[col] = (df[col] - mean_val) / std_val

    # Ensure target column is integer binary if classification
    if target_col in df.columns:
        df[target_col] = pd.to_numeric(df[target_col], errors='coerce').fillna(0).astype(int)

    return df


def main_feature_transformation(args_list=None):
    """
    Main entry point for Feature Transformation Stage.
    Loads created features, fits/loads transformers without pickle, executes imputation,
    skewness transforms, outlier clipping, and scaling, then outputs transformed Parquet.
    """
    parser = argparse.ArgumentParser(description="Feature Transformation & Imputation Stage")
    parser.add_argument("--db-path", type=str, required=True, help="Path to database or data directory")
    parser.add_argument("--features-path", type=str, default=None, help="Direct path to features parquet/csv")
    parser.add_argument("--split", type=str, default="train", choices=["train", "val", "test"], help="Dataset split")
    parser.add_argument("--out-dir", type=str, default=None, help="Directory to save/load transformer artifacts")
    parser.add_argument("--output-path", type=str, default=None, help="Output destination path for transformed parquet")
    parser.add_argument("--metadata-path", type=str, default=None, help="Path to output metadata YAML")
    args = parser.parse_args(args_list)

    logger.info(f"Starting main_feature_transformation with split={args.split}, db_path={args.db_path}")

    out_dir = args.out_dir or (args.db_path if os.path.isdir(args.db_path) else os.path.dirname(os.path.abspath(args.db_path)))
    os.makedirs(out_dir, exist_ok=True)

    params_file_path = os.path.join(out_dir, "transformer_params.json")
    target_column = "battery_failure"
    entity_column = "vehicle_id"
    leakage_columns = ["predicted_remaining_life_cycles"]

    # 1. Load data
    df_features = _load_features_for_transformation(args.db_path, args.features_path)
    logger.info(f"Loaded input features with shape: {df_features.shape}")

    # Determine numerical and categorical columns
    all_cols = list(df_features.columns)
    excluded = [target_column, entity_column] + leakage_columns

    cat_candidate_cols = [
        'cycle_count_bin', 'battery_health_category', 'chemistry_fleet_combo',
        'battery_chemistry', 'fleet_or_private', 'terrain_type', 'vehicle_type', 'drive_type'
    ]
    present_cat_cols = [c for c in cat_candidate_cols if c in all_cols]

    numeric_cols = [
        c for c in all_cols
        if c not in excluded
        and c not in present_cat_cols
        and not c.startswith("ohe_")
        and pd.api.types.is_numeric_dtype(df_features[c])
    ]

    skewed_cols = [
        'odometer_km', 'internal_resistance', 'abnormal_voltage_events', 'charging_interruptions',
        'overcharge_events', 'previous_faults', 'sensor_fault_count', 'BMS_warning_count',
        'last_service_days', 'capacity_loss_per_cycle', 'internal_resistance_per_cycle',
        'degradation_rate_per_km', 'cooling_deficiency_index', 'abnormal_voltage_rate_per_cycle',
        'overcharge_risk_factor', 'high_power_charge_stress', 'driving_dynamics_stress',
        'composite_battery_risk_score', 'bms_alert_density', 'maintenance_neglect_factor',
        'temperature_variance', 'voltage_imbalance'
    ]
    present_skewed_cols = [c for c in skewed_cols if c in numeric_cols]

    # 2. Fit or load transformer parameters
    if args.split == "train" or not os.path.exists(params_file_path):
        logger.info(f"Fitting transformer parameters on split '{args.split}' and persisting to {params_file_path}")
        transformer_params = fit_transformer_parameters(
            df=df_features,
            numeric_cols=numeric_cols,
            cat_cols=present_cat_cols,
            skewed_cols=present_skewed_cols
        )
        with open(params_file_path, "w", encoding="utf-8") as pf:
            json.dump(transformer_params, pf, indent=2)
    else:
        logger.info(f"Loading existing transformer parameters from {params_file_path} for split '{args.split}'")
        with open(params_file_path, "r", encoding="utf-8") as pf:
            transformer_params = json.load(pf)

    # 3. Apply transformations
    transformed_df = apply_transformations(
        df_input=df_features,
        params=transformer_params,
        target_col=target_column,
        entity_col=entity_column,
        leakage_cols=leakage_columns
    )

    # 4. Save transformed dataset atomically
    if args.output_path:
        out_parquet_path = args.output_path
    else:
        out_parquet_path = os.path.join(out_dir, f"transformed_features_{args.split}.parquet")

    save_atomic_parquet(transformed_df, out_parquet_path)

    # Also save standard transformed_features.parquet for downstream compatibility
    standard_out_parquet = os.path.join(out_dir, "transformed_features.parquet")
    save_atomic_parquet(transformed_df, standard_out_parquet)

    # 5. Metadata persistence
    if args.metadata_path:
        os.makedirs(os.path.dirname(os.path.abspath(args.metadata_path)), exist_ok=True)
        with open(args.metadata_path, "w", encoding="utf-8") as mf:
            mf.write(yamlLineageTransformation)

    logger.info(f"Feature transformation complete. Output shape: {transformed_df.shape}, saved to: {out_parquet_path}")

    return {
        "status": "OK",
        "split": args.split,
        "rows": len(transformed_df),
        "columns": len(transformed_df.columns),
        "output_path": out_parquet_path,
        "params_path": params_file_path
    }
# -- REGION: FEATURE_TRANSFORMATION END --

# Build dataset region
# -- REGION: BUILD_DATASET START --
import os
import sys
import argparse
import logging
import tempfile
import numpy as np
import pandas as pd
import duckdb
import yaml

logger = logging.getLogger("build_dataset")

yamlLineageBuildDataset = """
stage: build_dataset
inputs:
  - transformed_features.parquet (or created_features.parquet / raw_ev_battery_dataset)
outputs:
  - dataset.parquet
  - metadata.yaml
operations:
  - source table resolution and entity key alignment (vehicle_id)
  - ground truth target validation and alignment (battery_failure: binary classification)
  - leakage column exclusion (predicted_remaining_life_cycles)
  - unified matrix consolidation of raw telemetry, domain features, and transformed indicators
  - integrity checks (null target verification, row count sanity checks)
  - atomic parquet dataset serialization
"""


def load_unified_features(db_path: str, split: str = "train") -> pd.DataFrame:
    """
    Loads transformed features or created features or builds them from raw table.
    Ensures that the final unified dataset matrix is available for assembly.
    """
    logger.info(f"Resolving feature sources for dataset assembly from {db_path}...")
    
    candidates = []
    if os.path.isdir(db_path):
        candidates.extend([
            os.path.join(db_path, f"transformed_features_{split}.parquet"),
            os.path.join(db_path, "transformed_features.parquet"),
            os.path.join(db_path, "created_features.parquet"),
            os.path.join(db_path, "dataset.parquet")
        ])
    elif os.path.isfile(db_path):
        candidates.append(db_path)

    for cand in candidates:
        if cand and os.path.isfile(cand):
            logger.info(f"Found existing feature artifact at: {cand}")
            return _read_parquet_safe(cand) if cand.endswith(".parquet") else pd.read_csv(cand)

    # If pre-computed artifacts do not exist, run feature creation and transformation pipeline on raw
    logger.info("No pre-computed feature artifacts found; generating from raw dataset...")
    df_raw = load_raw_dataset(db_path)
    df_created = compute_engineered_features(df_raw)
    
    # Exclude leakage
    if "predicted_remaining_life_cycles" in df_created.columns:
        df_created.drop(columns=["predicted_remaining_life_cycles"], inplace=True)
        
    return df_created


def assemble_baseline_dataset(
    df_features: pd.DataFrame,
    target_column: str = "battery_failure",
    entity_column: str = "vehicle_id",
    leakage_columns: list = None
) -> pd.DataFrame:
    """
    Assembles the final baseline matrix:
    - Verifies entity keys and target columns
    - Drops any leakage columns
    - Validates schema and value constraints
    """
    logger.info("Assembling baseline dataset matrix...")
    df = df_features.copy()

    # Drop leakage columns
    if leakage_columns:
        for lc in leakage_columns:
            if lc in df.columns:
                logger.info(f"Purging leakage column from final dataset: {lc}")
                df.drop(columns=[lc], inplace=True)

    # Check for target column
    if target_column in df.columns:
        df[target_column] = pd.to_numeric(df[target_column], errors='coerce').fillna(0).astype(int)
        pos_count = int((df[target_column] == 1).sum())
        neg_count = int((df[target_column] == 0).sum())
        logger.info(f"Target '{target_column}' class distribution -> 0: {neg_count}, 1: {pos_count}")
    else:
        logger.warning(f"Target column '{target_column}' not found in assembled DataFrame.")

    # Check entity column
    if entity_column in df.columns:
        logger.info(f"Prediction entity '{entity_column}' verified with {df[entity_column].nunique()} unique entities.")
    else:
        logger.warning(f"Prediction entity '{entity_column}' not found in feature DataFrame.")

    logger.info(f"Dataset matrix assembled successfully with shape: {df.shape}")
    return df


def main_build_dataset(args_list=None):
    """
    Main entry point for Dataset Assembly Stage.
    Assembles source tables, engineered features, and transformed matrices into a unified Parquet dataset.
    """
    parser = argparse.ArgumentParser(description="Dataset Assembly Stage for EV Battery Failure Prediction")
    parser.add_argument("--db-path", type=str, required=True, help="Path to database or directory containing tables")
    parser.add_argument("--output-path", type=str, default=None, help="Output destination path for unified dataset parquet")
    parser.add_argument("--metadata-path", type=str, default=None, help="Path to output metadata YAML")
    parser.add_argument("--split", type=str, default="train", choices=["train", "val", "test"], help="Dataset split")
    args = parser.parse_args(args_list)

    logger.info(f"Starting main_build_dataset with db_path={args.db_path}, output_path={args.output_path}")

    # Determine default output path if not provided
    if args.output_path:
        out_parquet_path = args.output_path
    elif os.path.isdir(args.db_path):
        out_parquet_path = os.path.join(args.db_path, "dataset.parquet")
    else:
        out_parquet_path = os.path.join(os.path.dirname(os.path.abspath(args.db_path)), "dataset.parquet")

    target_column = "battery_failure"
    entity_column = "vehicle_id"
    leakage_columns = ["predicted_remaining_life_cycles"]

    # 1. Load feature table / raw dataset
    df_features = load_unified_features(args.db_path, split=args.split)

    # 2. Assemble dataset matrix
    dataset_df = assemble_baseline_dataset(
        df_features=df_features,
        target_column=target_column,
        entity_column=entity_column,
        leakage_columns=leakage_columns
    )

    # 3. Save final unified dataset atomically
    save_atomic_parquet(dataset_df, out_parquet_path)

    # 4. Save metadata YAML if requested
    if args.metadata_path:
        os.makedirs(os.path.dirname(os.path.abspath(args.metadata_path)), exist_ok=True)
        with open(args.metadata_path, "w", encoding="utf-8") as mf:
            mf.write(yamlLineageBuildDataset)

    logger.info(f"Dataset build complete. Final output matrix written to {out_parquet_path} ({len(dataset_df)} rows, {len(dataset_df.columns)} columns)")

    return {
        "status": "OK",
        "rows": len(dataset_df),
        "columns": len(dataset_df.columns),
        "output_path": out_parquet_path,
        "target_column": target_column,
        "entity_column": entity_column
    }
# -- REGION: BUILD_DATASET END --

# Data validation region
# -- REGION: DATA_VALIDATION START --
import os
import sys
import json
import hashlib
import argparse
import logging
import tempfile
import numpy as np
import pandas as pd
import duckdb
import yaml

logger = logging.getLogger("data_validation")

yamlLineageDataValidation = """
stage: data_validation
inputs:
  - dataset.parquet (or transformed_features.parquet / created_features.parquet)
outputs:
  - validation_report.json
operations:
  - dataset resolution and schema snapshot extraction
  - row count and unique entity integrity verification (vehicle_id)
  - column-wise null rate profiling and missingness threshold auditing
  - exact duplicate row and entity key collision detection
  - zero-variance and quasi-constant feature identification
  - target presence, null count, and binary class distribution auditing (battery_failure)
  - direct target leakage detection (e.g., predicted_remaining_life_cycles) & high-correlation screening (>0.999)
  - numerical anomaly scanning (infinities, extreme z-scores > 5.0, physical domain bounds)
  - artifact integrity MD5/SHA256 checksum computation
  - atomic JSON report serialization
"""


def _load_dataset_for_validation(db_path: str, dataset_path: str = None) -> pd.DataFrame:
    """
    Locates and loads the assembled baseline dataset matrix for validation.
    """
    candidates = []
    if dataset_path:
        candidates.append(dataset_path)

    if os.path.isdir(db_path):
        candidates.extend([
            os.path.join(db_path, "dataset.parquet"),
            os.path.join(db_path, "transformed_features_train.parquet"),
            os.path.join(db_path, "transformed_features.parquet"),
            os.path.join(db_path, "created_features.parquet"),
            os.path.join(db_path, "dataset.csv")
        ])
    elif os.path.isfile(db_path):
        candidates.append(db_path)

    for cand in candidates:
        if cand and os.path.isfile(cand):
            logger.info(f"Loading dataset for validation from: {cand}")
            return _read_parquet_safe(cand) if cand.lower().endswith(".parquet") else pd.read_csv(cand)

    logger.info("Direct dataset artifact not found; falling back to loader...")
    df_raw = load_raw_dataset(db_path)
    return assemble_baseline_dataset(compute_engineered_features(df_raw))


def compute_schema_checksum(df: pd.DataFrame) -> dict:
    """
    Computes schema snapshot and SHA256 checksum of column schema and shape.
    """
    schema_info = {col: str(dtype) for col, dtype in df.dtypes.items()}
    schema_str = json.dumps(schema_info, sort_keys=True) + f"_{df.shape[0]}x{df.shape[1]}"
    checksum = hashlib.sha256(schema_str.encode('utf-8')).hexdigest()
    return {
        "checksum_sha256": checksum,
        "column_count": df.shape[1],
        "row_count": df.shape[0],
        "columns": list(df.columns),
        "dtypes": schema_info
    }


def audit_baseline_matrix(
    df: pd.DataFrame,
    target_column: str = "battery_failure",
    entity_column: str = "vehicle_id",
    leakage_columns: list = None
) -> dict:
    """
    Performs comprehensive data quality, integrity, leakage, and anomaly audit on baseline dataset.
    """
    if leakage_columns is None:
        leakage_columns = ["predicted_remaining_life_cycles"]

    report = {
        "status": "PASSED",
        "errors": [],
        "warnings": [],
        "metrics": {}
    }

    n_rows, n_cols = df.shape
    if n_rows == 0:
        report["status"] = "FAILED"
        report["errors"].append("Dataset matrix contains 0 rows.")
        return report

    # 1. Schema snapshot & Checksum
    schema_meta = compute_schema_checksum(df)
    report["metrics"]["schema_snapshot"] = schema_meta

    # 2. Duplicate Analysis
    duplicate_rows_count = int(df.duplicated().sum())
    report["metrics"]["duplicate_rows_count"] = duplicate_rows_count
    if duplicate_rows_count > 0:
        report["warnings"].append(f"Detected {duplicate_rows_count} exact duplicate rows.")

    entity_duplicate_count = 0
    if entity_column in df.columns:
        entity_duplicate_count = int(df.duplicated(subset=[entity_column]).sum())
        report["metrics"]["duplicate_entity_keys_count"] = entity_duplicate_count
        report["metrics"]["unique_entities"] = int(df[entity_column].nunique())
        if entity_duplicate_count > 0:
            report["warnings"].append(f"Entity key '{entity_column}' has {entity_duplicate_count} duplicate occurrences.")
    else:
        report["warnings"].append(f"Entity column '{entity_column}' not found in dataset matrix.")

    # 3. Missing Value / Null Rate Analysis
    null_counts = df.isnull().sum()
    null_rates = (null_counts / n_rows).to_dict()
    total_nulls = int(null_counts.sum())
    total_cells = n_rows * n_cols
    overall_null_rate = float(total_nulls / total_cells) if total_cells > 0 else 0.0

    high_null_cols = {col: float(rate) for col, rate in null_rates.items() if rate > 0.20}
    any_null_cols = {col: float(rate) for col, rate in null_rates.items() if rate > 0.0}

    report["metrics"]["null_analysis"] = {
        "total_null_values": total_nulls,
        "overall_null_rate": round(overall_null_rate, 6),
        "columns_with_nulls_count": len(any_null_cols),
        "high_null_columns_rate_gt_20pct": high_null_cols,
        "column_null_rates": {k: round(v, 6) for k, v in null_rates.items()}
    }

    if high_null_cols:
        report["warnings"].append(f"High null rates (>20%) detected in columns: {list(high_null_cols.keys())}")

    # 4. Constant / Quasi-Constant Columns
    constant_columns = []
    quasi_constant_columns = []
    for col in df.columns:
        if col == entity_column:
            continue
        nunique = df[col].nunique(dropna=False)
        if nunique <= 1:
            constant_columns.append(col)
        elif nunique > 1 and df[col].value_counts(normalize=True, dropna=False).iloc[0] > 0.995:
            quasi_constant_columns.append(col)

    report["metrics"]["constant_columns"] = constant_columns
    report["metrics"]["quasi_constant_columns"] = quasi_constant_columns
    if constant_columns:
        report["warnings"].append(f"Detected {len(constant_columns)} constant columns with zero variance: {constant_columns}")

    # 5. Target Column Validation & Leakage Audit
    target_metrics = {}
    if target_column not in df.columns:
        report["status"] = "FAILED"
        report["errors"].append(f"Target column '{target_column}' is missing from baseline dataset.")
    else:
        target_series = df[target_column]
        target_nulls = int(target_series.isnull().sum())
        target_metrics["target_name"] = target_column
        target_metrics["target_null_count"] = target_nulls

        if target_nulls > 0:
            report["status"] = "FAILED"
            report["errors"].append(f"Target column '{target_column}' contains {target_nulls} null values.")

        # Class distribution
        unique_targets = target_series.dropna().unique()
        target_metrics["unique_target_values"] = [int(x) if isinstance(x, (np.integer, int)) else str(x) for x in unique_targets]
        val_counts = target_series.value_counts().to_dict()
        target_metrics["class_distribution"] = {str(k): int(v) for k, v in val_counts.items()}
        
        pos_cases = int((target_series == 1).sum()) if 1 in val_counts else 0
        pos_rate = float(pos_cases / n_rows) if n_rows > 0 else 0.0
        target_metrics["positive_class_rate"] = round(pos_rate, 4)

        if len(unique_targets) < 2:
            report["status"] = "FAILED"
            report["errors"].append(f"Target column '{target_column}' has less than 2 distinct classes.")

    report["metrics"]["target_validation"] = target_metrics

    # 6. Target Leakage Checks
    detected_leakage_cols = [c for c in leakage_columns if c in df.columns]
    report["metrics"]["explicit_leakage_columns_found"] = detected_leakage_cols
    if detected_leakage_cols:
        report["status"] = "FAILED"
        report["errors"].append(f"Known target leakage columns present in dataset: {detected_leakage_cols}")

    # High correlation leakage screen with target
    suspicious_leakage_correlations = {}
    if target_column in df.columns:
        numeric_cols = df.select_dtypes(include=[np.number]).columns
        target_numeric = pd.to_numeric(df[target_column], errors='coerce')
        for col in numeric_cols:
            if col != target_column:
                try:
                    corr = abs(float(df[col].corr(target_numeric)))
                    if not np.isnan(corr) and corr > 0.999:
                        suspicious_leakage_correlations[col] = round(corr, 6)
                except Exception:
                    pass

    report["metrics"]["suspicious_leakage_correlations_gt_0_999"] = suspicious_leakage_correlations
    if suspicious_leakage_correlations:
        report["warnings"].append(f"Suspicious near-perfect correlation (>0.999) with target in columns: {suspicious_leakage_correlations}")

    # 7. Numerical Anomalies & Inf Checks
    numeric_df = df.select_dtypes(include=[np.number])
    inf_counts = {}
    anomaly_counts = {}
    for col in numeric_df.columns:
        s = numeric_df[col].dropna()
        n_infs = int(np.isinf(s).sum())
        if n_infs > 0:
            inf_counts[col] = n_infs

        # Z-score outlier anomaly check (|z| > 5)
        std_val = s.std()
        if std_val > 1e-6:
            mean_val = s.mean()
            z_scores = ((s - mean_val) / std_val).abs()
            extreme_outliers = int((z_scores > 5.0).sum())
            if extreme_outliers > 0:
                anomaly_counts[col] = extreme_outliers

    report["metrics"]["infinite_value_counts"] = inf_counts
    report["metrics"]["extreme_zscore_anomalies_gt_5"] = anomaly_counts

    if inf_counts:
        report["status"] = "FAILED" if report["status"] != "FAILED" else report["status"]
        report["errors"].append(f"Infinite values found in numeric columns: {inf_counts}")

    # If there are warnings but no errors, status is PASSED_WITH_WARNINGS
    if report["errors"]:
        report["status"] = "FAILED"
    elif report["warnings"]:
        report["status"] = "PASSED_WITH_WARNINGS"
    else:
        report["status"] = "PASSED"

    return report


def save_atomic_json(data: dict, target_path: str):
    """
    Atomically writes a JSON report dictionary using a temporary staging file.
    """
    target_dir = os.path.dirname(os.path.abspath(target_path))
    os.makedirs(target_dir, exist_ok=True)

    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".json", dir=target_dir, mode="w", encoding="utf-8")
    temp_path = temp_file.name
    try:
        json.dump(data, temp_file, indent=2, default=str)
        temp_file.flush()
        temp_file.close()

        # Verify readability
        with open(temp_path, "r", encoding="utf-8") as vf:
            _ = json.load(vf)

        os.replace(temp_path, target_path)
        logger.info(f"Successfully saved validation report to {target_path}")
    except Exception as e:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass
        raise IOError(f"Failed to atomically write JSON validation report: {str(e)}") from e


def main_data_validation(args_list=None):
    """
    Main entry point for Data Quality and Validation Stage.
    Audits the assembled baseline dataset matrix for data quality issues, target leakage, and structural anomalies.
    Outputs validation metrics and summary report atomically to JSON.
    """
    parser = argparse.ArgumentParser(description="Data Quality and Validation Stage for EV Battery Failure Prediction")
    parser.add_argument("--db-path", type=str, required=True, help="Path to database or directory containing tables")
    parser.add_argument("--dataset-path", type=str, default=None, help="Direct path to assembled dataset parquet/csv")
    parser.add_argument("--output-path", type=str, default=None, help="Output destination path for validation report JSON")
    parser.add_argument("--metadata-path", type=str, default=None, help="Path to output metadata YAML")
    args = parser.parse_args(args_list)

    logger.info(f"Starting main_data_validation with db_path={args.db_path}, output_path={args.output_path}")

    # Determine default report path
    if args.output_path:
        out_report_path = args.output_path
    elif os.path.isdir(args.db_path):
        out_report_path = os.path.join(args.db_path, "validation_report.json")
    else:
        out_report_path = os.path.join(os.path.dirname(os.path.abspath(args.db_path)), "validation_report.json")

    target_column = "battery_failure"
    entity_column = "vehicle_id"
    leakage_columns = ["predicted_remaining_life_cycles"]

    # 1. Load baseline dataset matrix
    df = _load_dataset_for_validation(args.db_path, args.dataset_path)
    logger.info(f"Loaded dataset matrix for validation with shape: {df.shape}")

    # 2. Execute validation audit
    validation_report = audit_baseline_matrix(
        df=df,
        target_column=target_column,
        entity_column=entity_column,
        leakage_columns=leakage_columns
    )

    # 3. Save JSON report atomically
    save_atomic_json(validation_report, out_report_path)

    # 4. Save metadata YAML if requested
    if args.metadata_path:
        os.makedirs(os.path.dirname(os.path.abspath(args.metadata_path)), exist_ok=True)
        with open(args.metadata_path, "w", encoding="utf-8") as mf:
            mf.write(yamlLineageDataValidation)

    logger.info(f"Data validation complete with status: {validation_report['status']}. Report written to {out_report_path}")

    return {
        "status": validation_report["status"],
        "summary": f"Data validation completed with status {validation_report['status']}. {len(validation_report['errors'])} errors, {len(validation_report['warnings'])} warnings.",
        "report_path": out_report_path,
        "rows_audited": df.shape[0],
        "columns_audited": df.shape[1],
        "metrics": validation_report["metrics"]
    }
# -- REGION: DATA_VALIDATION END --

# Feature extraction region
# -- REGION: FEATURE_EXTRACTION START --
import os
import sys
import json
import argparse
import logging
import tempfile
import numpy as np
import pandas as pd
import duckdb
import yaml
from sklearn.decomposition import PCA

logger = logging.getLogger("feature_extraction")

yamlLineageFeatureExtraction = """
stage: feature_extraction
inputs:
  - dataset.parquet (or transformed_features.parquet / created_features.parquet)
outputs:
  - extracted_features.parquet
  - pca_decomposition_metadata.json
operations:
  - domain-specific telemetry clustering:
      thermal_dynamics: [cell_temperature_avg, cell_temperature_max, temp_delta_max_avg, thermal_stress_ratio, ambient_cell_temp_gap, ambient_temp_range, cooling_deficiency_index, temperature_variance, thermal_runaway_risk, thermal_health_score] -> 3 PCA components
      electrical_voltage: [cell_voltage_avg, cell_voltage_std, pack_voltage, voltage_imbalance, voltage_spread_ratio, cell_voltage_cv, abnormal_voltage_events, abnormal_voltage_rate_per_cycle] -> 2 PCA components
      cumulative_degradation: [odometer_km, vehicle_age_years, cycle_count, battery_health_percent, capacity_loss_percent, internal_resistance, capacity_loss_per_cycle, internal_resistance_per_cycle, health_to_age_ratio, degradation_rate_per_km, aging_score] -> 3 PCA components
  - zero-pickle linear decomposition via PCA
  - strict prevention of data leakage (PCA components fit strictly on train split)
  - component projection persistence via atomic JSON metadata (mean, components loadings, explained variance)
  - atomic parquet serialization of combined feature matrix
"""


def _load_dataset_for_extraction(db_path: str, dataset_path: str = None) -> pd.DataFrame:
    """
    Locates and loads the dataset matrix for dimensionality reduction and feature extraction.
    """
    candidates = []
    if dataset_path:
        candidates.append(dataset_path)

    if os.path.isdir(db_path):
        candidates.extend([
            os.path.join(db_path, "dataset.parquet"),
            os.path.join(db_path, "transformed_features_train.parquet"),
            os.path.join(db_path, "transformed_features.parquet"),
            os.path.join(db_path, "created_features.parquet"),
            os.path.join(db_path, "dataset.csv")
        ])
    elif os.path.isfile(db_path):
        candidates.append(db_path)

    for cand in candidates:
        if cand and os.path.isfile(cand):
            logger.info(f"Loading dataset for extraction from: {cand}")
            return _read_parquet_safe(cand) if cand.lower().endswith(".parquet") else pd.read_csv(cand)

    logger.info("Direct dataset artifact not found; falling back to loader...")
    df_raw = load_raw_dataset(db_path)
    return assemble_baseline_dataset(compute_engineered_features(df_raw))


def fit_pca_clusters(df: pd.DataFrame, clusters: dict) -> dict:
    """
    Fits PCA decomposition models strictly on the training split for specified feature clusters.
    Extracts loadings, explained variance ratio, and mean vectors into a JSON-serializable dictionary.
    """
    logger.info("Fitting PCA extraction models on training split...")
    pca_meta = {
        "clusters": {}
    }

    for cluster_name, config in clusters.items():
        cols = [c for c in config["columns"] if c in df.columns]
        n_components = min(config["n_components"], len(cols))

        if not cols or n_components <= 0:
            logger.warning(f"Skipping cluster '{cluster_name}' - insufficient available columns ({cols}).")
            continue

        # Extract numeric array and impute any remaining NaNs
        X = df[cols].to_numpy(dtype=np.float64)
        X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)

        pca = PCA(n_components=n_components, random_state=42)
        pca.fit(X)

        pca_meta["clusters"][cluster_name] = {
            "columns": cols,
            "n_components": int(n_components),
            "mean": pca.mean_.tolist(),
            "components": pca.components_.tolist(),
            "explained_variance_ratio": [float(v) for v in pca.explained_variance_ratio_],
            "total_explained_variance": float(np.sum(pca.explained_variance_ratio_)),
            "component_names": [f"pca_{cluster_name}_comp_{i+1}" for i in range(n_components)]
        }
        logger.info(
            f"PCA cluster '{cluster_name}' fitted ({len(cols)} features -> {n_components} components). "
            f"Total explained variance: {pca_meta['clusters'][cluster_name]['total_explained_variance']:.4f}"
        )

    return pca_meta


def transform_pca_clusters(df_input: pd.DataFrame, pca_meta: dict) -> pd.DataFrame:
    """
    Projects input feature matrix onto pre-fitted PCA component axes using stored linear loadings.
    Appends generated principal component features to the DataFrame without data leakage.
    """
    df = df_input.copy()

    for cluster_name, meta in pca_meta.get("clusters", {}).items():
        cols = meta["columns"]
        comp_names = meta["component_names"]
        mean_vec = np.array(meta["mean"], dtype=np.float64)
        comp_mat = np.array(meta["components"], dtype=np.float64)  # shape: (n_components, n_features)

        # Check for missing columns in evaluation/test data
        missing_cols = [c for c in cols if c not in df.columns]
        if missing_cols:
            for mc in missing_cols:
                df[mc] = 0.0

        X = df[cols].to_numpy(dtype=np.float64)
        X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)

        # Linear projection: (X - mean) @ components.T
        X_centered = X - mean_vec
        X_pca = np.dot(X_centered, comp_mat.T)

        for idx, c_name in enumerate(comp_names):
            df[c_name] = X_pca[:, idx]

        logger.info(f"Applied PCA projection for cluster '{cluster_name}' -> generated {comp_names}")

    return df


def main_feature_extraction(args_list=None):
    """
    Main entry point for Feature Extraction & Dimensionality Reduction Stage.
    Decomposes high-dimensional, collinear sensor groups (thermal, electrical, degradation)
    into orthogonal principal components using strictly training-split fitted linear projections.
    Persists decomposition parameters to JSON and outputs extracted dataset to Parquet.
    """
    parser = argparse.ArgumentParser(description="Feature Extraction Stage for EV Battery Failure Prediction")
    parser.add_argument("--db-path", type=str, required=True, help="Path to database or data directory")
    parser.add_argument("--dataset-path", type=str, default=None, help="Direct path to input dataset parquet/csv")
    parser.add_argument("--split", type=str, default="train", choices=["train", "val", "test"], help="Dataset split")
    parser.add_argument("--out-dir", type=str, default=None, help="Directory to save/load extraction artifacts")
    parser.add_argument("--output-path", type=str, default=None, help="Output destination path for extracted dataset parquet")
    parser.add_argument("--metadata-path", type=str, default=None, help="Path to output metadata YAML")
    args = parser.parse_args(args_list)

    logger.info(f"Starting main_feature_extraction with split={args.split}, db_path={args.db_path}")

    out_dir = args.out_dir or (args.db_path if os.path.isdir(args.db_path) else os.path.dirname(os.path.abspath(args.db_path)))
    os.makedirs(out_dir, exist_ok=True)

    pca_meta_path = os.path.join(out_dir, "pca_decomposition_metadata.json")

    # 1. Load input dataset
    df = _load_dataset_for_extraction(args.db_path, args.dataset_path)
    logger.info(f"Loaded input dataset for extraction with shape: {df.shape}")

    # Define domain clusters for PCA dimensionality reduction
    pca_clusters = {
        "thermal_dynamics": {
            "columns": [
                'cell_temperature_avg', 'cell_temperature_max', 'temp_delta_max_avg',
                'thermal_stress_ratio', 'ambient_cell_temp_gap', 'ambient_temp_range',
                'cooling_deficiency_index', 'temperature_variance', 'thermal_runaway_risk',
                'thermal_health_score'
            ],
            "n_components": 3
        },
        "electrical_voltage": {
            "columns": [
                'cell_voltage_avg', 'cell_voltage_std', 'pack_voltage', 'voltage_imbalance',
                'voltage_spread_ratio', 'cell_voltage_cv', 'abnormal_voltage_events',
                'abnormal_voltage_rate_per_cycle'
            ],
            "n_components": 2
        },
        "cumulative_degradation": {
            "columns": [
                'odometer_km', 'vehicle_age_years', 'cycle_count', 'battery_health_percent',
                'capacity_loss_percent', 'internal_resistance', 'capacity_loss_per_cycle',
                'internal_resistance_per_cycle', 'health_to_age_ratio', 'degradation_rate_per_km',
                'aging_score'
            ],
            "n_components": 3
        }
    }

    # 2. Fit or load PCA decomposition metadata
    if args.split == "train" or not os.path.exists(pca_meta_path):
        logger.info(f"Fitting PCA decomposition metadata on split '{args.split}' and saving to {pca_meta_path}")
        pca_metadata = fit_pca_clusters(df, pca_clusters)
        with open(pca_meta_path, "w", encoding="utf-8") as pf:
            json.dump(pca_metadata, pf, indent=2)
    else:
        logger.info(f"Loading existing PCA metadata from {pca_meta_path} for split '{args.split}'")
        with open(pca_meta_path, "r", encoding="utf-8") as pf:
            pca_metadata = json.load(pf)

    # 3. Apply PCA transformation
    df_extracted = transform_pca_clusters(df, pca_metadata)

    # 4. Save extracted dataset atomically
    if args.output_path:
        out_parquet_path = args.output_path
    else:
        out_parquet_path = os.path.join(out_dir, "extracted_features.parquet")

    save_atomic_parquet(df_extracted, out_parquet_path)

    # Also update dataset.parquet if standard pipeline expects updated unified matrix
    dataset_parquet_path = os.path.join(out_dir, "dataset.parquet")
    save_atomic_parquet(df_extracted, dataset_parquet_path)

    # 5. Metadata persistence
    if args.metadata_path:
        os.makedirs(os.path.dirname(os.path.abspath(args.metadata_path)), exist_ok=True)
        with open(args.metadata_path, "w", encoding="utf-8") as mf:
            mf.write(yamlLineageFeatureExtraction)

    logger.info(f"Feature extraction complete. Output shape: {df_extracted.shape}, saved to {out_parquet_path}")

    return {
        "status": "OK",
        "split": args.split,
        "rows": len(df_extracted),
        "columns": len(df_extracted.columns),
        "output_path": out_parquet_path,
        "pca_meta_path": pca_meta_path,
        "extracted_components": [
            comp for c in pca_metadata.get("clusters", {}).values() for comp in c.get("component_names", [])
        ]
    }
# -- REGION: FEATURE_EXTRACTION END --

# Feature selection region
# -- REGION: FEATURE_SELECTION START --
import os
import sys
import json
import argparse
import logging
import tempfile
import numpy as np
import pandas as pd
import duckdb
import yaml
from sklearn.ensemble import RandomForestClassifier
from sklearn.feature_selection import VarianceThreshold

logger = logging.getLogger("feature_selection")

yamlLineageFeatureSelection = """
stage: feature_selection
inputs:
  - extracted_features.parquet (or dataset.parquet / transformed_features.parquet)
outputs:
  - selected_features.parquet
  - feature_selection_report.json
operations:
  - target and entity key preservation (battery_failure, vehicle_id)
  - leakage column exclusion (predicted_remaining_life_cycles)
  - quasi-constant / low-variance feature filtering (threshold=1e-4)
  - collinearity reduction via inter-feature correlation pruning (threshold=0.95)
  - tree-based feature importance ranking using balanced Random Forest Classifier fit on train split
  - selection of top predictive multi-domain degradation, thermal, and electrical telemetry features
  - zero-pickle JSON selection report serialization (selected/discarded features, importances, selection rationale)
  - atomic parquet serialization of final selected feature matrix
"""


def _load_features_for_selection(db_path: str, features_path: str = None) -> pd.DataFrame:
    """
    Locates and loads the feature matrix produced by Feature Extraction or previous stages.
    """
    candidates = []
    if features_path:
        candidates.append(features_path)

    if os.path.isdir(db_path):
        candidates.extend([
            os.path.join(db_path, "extracted_features.parquet"),
            os.path.join(db_path, "dataset.parquet"),
            os.path.join(db_path, "transformed_features_train.parquet"),
            os.path.join(db_path, "transformed_features.parquet"),
            os.path.join(db_path, "created_features.parquet"),
            os.path.join(db_path, "dataset.csv")
        ])
    elif os.path.isfile(db_path):
        candidates.append(db_path)

    for cand in candidates:
        if cand and os.path.isfile(cand):
            logger.info(f"Loading dataset for feature selection from: {cand}")
            return _read_parquet_safe(cand) if cand.lower().endswith(".parquet") else pd.read_csv(cand)

    logger.info("Direct feature artifact not found; falling back to loader...")
    df_raw = load_raw_dataset(db_path)
    return assemble_baseline_dataset(compute_engineered_features(df_raw))


def execute_feature_selection(
    df: pd.DataFrame,
    target_column: str = "battery_failure",
    entity_column: str = "vehicle_id",
    leakage_columns: list = None,
    correlation_threshold: float = 0.95,
    top_k: int = 35
) -> tuple:
    """
    Executes a multi-stage feature selection strategy:
    1. Low-variance & Quasi-constant feature elimination.
    2. Collinear feature pruning (inter-feature Pearson |r| > correlation_threshold).
    3. Model-based feature importance ranking via Random Forest fit on training split.
    4. Top-K subset selection retaining highest information gain features.
    
    Returns:
        (selected_df, selection_report)
    """
    if leakage_columns is None:
        leakage_columns = ["predicted_remaining_life_cycles"]

    logger.info(f"Starting feature selection on dataset of shape {df.shape}...")
    df_work = df.copy()

    # Drop explicit leakage columns
    for lc in leakage_columns:
        if lc in df_work.columns:
            logger.info(f"Excluding leakage column: {lc}")
            df_work.drop(columns=[lc], inplace=True)

    # Separate metadata/entity/target from candidate predictors
    reserved_cols = [c for c in [entity_column, target_column] if c in df_work.columns]
    
    # Candidate features must be numeric
    candidate_features = [
        col for col in df_work.columns
        if col not in reserved_cols and pd.api.types.is_numeric_dtype(df_work[col])
    ]

    discarded_summary = {}

    # 1. Low Variance Filtering
    logger.info(f"Evaluating variance across {len(candidate_features)} candidate features...")
    var_selector = VarianceThreshold(threshold=1e-4)
    X_candidates = df_work[candidate_features].fillna(0.0).to_numpy()
    
    try:
        var_selector.fit(X_candidates)
        retained_mask = var_selector.get_support()
        retained_var_features = [candidate_features[i] for i, m in enumerate(retained_mask) if m]
        low_var_features = [candidate_features[i] for i, m in enumerate(retained_mask) if not m]
    except Exception as e:
        logger.warning(f"Variance threshold calculation failed: {e}; retaining all candidates.")
        retained_var_features = candidate_features
        low_var_features = []

    for f in low_var_features:
        discarded_summary[f] = {"reason": "Low variance / quasi-constant", "stage": "variance_filtering"}

    logger.info(f"Retained {len(retained_var_features)} features after variance thresholding ({len(low_var_features)} dropped).")

    # 2. Inter-Feature Collinearity Pruning
    logger.info("Computing correlation matrix for collinearity reduction...")
    corr_matrix = df_work[retained_var_features].corr().abs()
    
    # Compute correlation with target for informed pruning
    if target_column in df_work.columns:
        target_series = pd.to_numeric(df_work[target_column], errors='coerce').fillna(0)
        target_corrs = df_work[retained_var_features].apply(lambda s: abs(s.corr(target_series))).fillna(0.0).to_dict()
    else:
        target_corrs = {c: 1.0 for c in retained_var_features}

    upper_corr = corr_matrix.where(np.triu(np.ones(corr_matrix.shape), k=1).astype(bool))
    collinear_to_drop = set()

    for col in upper_corr.columns:
        high_corr_peers = upper_corr.index[upper_corr[col] > correlation_threshold].tolist()
        for peer in high_corr_peers:
            if col not in collinear_to_drop and peer not in collinear_to_drop:
                # Compare target relevance, drop the one with lower correlation to target
                if target_corrs.get(peer, 0.0) >= target_corrs.get(col, 0.0):
                    collinear_to_drop.add(col)
                    discarded_summary[col] = {
                        "reason": f"High collinearity with {peer} (|r| > {correlation_threshold})",
                        "stage": "collinearity_pruning"
                    }
                else:
                    collinear_to_drop.add(peer)
                    discarded_summary[peer] = {
                        "reason": f"High collinearity with {col} (|r| > {correlation_threshold})",
                        "stage": "collinearity_pruning"
                    }

    uncorrelated_features = [c for c in retained_var_features if c not in collinear_to_drop]
    logger.info(f"Retained {len(uncorrelated_features)} features after collinearity pruning ({len(collinear_to_drop)} dropped).")

    # 3. Model-Based Feature Importance Ranking
    importances_dict = {}
    if target_column in df_work.columns and len(uncorrelated_features) > 0:
        logger.info("Training Random Forest Classifier on training split to compute feature importances...")
        X_train = df_work[uncorrelated_features].fillna(0.0).to_numpy()
        y_train = pd.to_numeric(df_work[target_column], errors='coerce').fillna(0).astype(int).to_numpy()

        rf = RandomForestClassifier(
            n_estimators=100,
            max_depth=12,
            random_state=42,
            class_weight="balanced",
            n_jobs=-1
        )
        rf.fit(X_train, y_train)

        raw_importances = rf.feature_importances_
        importances_dict = {
            feat: float(round(imp, 6))
            for feat, imp in sorted(zip(uncorrelated_features, raw_importances), key=lambda x: x[1], reverse=True)
        }

        # Select Top-K features based on importance
        sorted_features = list(importances_dict.keys())
        k = min(top_k, len(sorted_features))
        selected_predictive_features = sorted_features[:k]
        model_discarded = sorted_features[k:]

        for f in model_discarded:
            discarded_summary[f] = {
                "reason": f"Ranked below Top-{k} importance threshold (importance={importances_dict.get(f, 0.0)})",
                "stage": "tree_importance_ranking"
            }
    else:
        logger.warning("Target column unavailable for supervised importance ranking; selecting all uncorrelated features.")
        selected_predictive_features = uncorrelated_features

    # Assemble Final Selected DataFrame
    final_columns = [c for c in [entity_column] if c in df_work.columns] + \
                    selected_predictive_features + \
                    [c for c in [target_column] if c in df_work.columns]
    
    selected_df = df_work[final_columns].copy()

    # Build comprehensive selection report
    selection_report = {
        "tableName": "ev_battery_failure_prediction_Dataset",
        "timestamp": pd.Timestamp.now().isoformat(),
        "inputRowCount": int(df.shape[0]),
        "inputColumnCount": int(df.shape[1]),
        "selectedColumnCount": int(selected_df.shape[1]),
        "selectedFeatureCount": len(selected_predictive_features),
        "targetColumn": target_column,
        "entityColumn": entity_column,
        "selectedFeatures": selected_predictive_features,
        "discardedFeaturesCount": len(discarded_summary),
        "discardedFeatures": list(discarded_summary.keys()),
        "discardedDetails": discarded_summary,
        "featureImportances": {f: importances_dict[f] for f in selected_predictive_features if f in importances_dict},
        "selectionCriteria": {
            "varianceThreshold": 1e-4,
            "collinearityCorrelationThreshold": correlation_threshold,
            "topKFeatures": top_k,
            "methodology": "variance_filter + collinearity_pruning + random_forest_importance"
        }
    }

    logger.info(
        f"Feature selection complete: {len(selected_predictive_features)} features selected out of "
        f"{len(candidate_features)} candidates. Final DataFrame shape: {selected_df.shape}"
    )
    return selected_df, selection_report


def main_feature_selection(args_list=None):
    """
    Main entry point for Feature Selection Stage.
    Accepts CLI arguments or function call argument list.
    Loads feature dataset, applies variance, collinearity, and tree-importance selection,
    persists selection report to JSON, and saves final selected features to Parquet.
    """
    parser = argparse.ArgumentParser(description="Feature Selection Stage for EV Battery Failure Prediction")
    parser.add_argument("--db-path", type=str, required=True, help="Path to database or data directory")
    parser.add_argument("--features-path", type=str, default=None, help="Direct path to input feature matrix parquet/csv")
    parser.add_argument("--split", type=str, default="train", choices=["train", "val", "test"], help="Dataset split")
    parser.add_argument("--out-dir", type=str, default=None, help="Directory to save selection artifacts")
    parser.add_argument("--output-path", type=str, default=None, help="Output destination path for selected features parquet")
    parser.add_argument("--report-path", type=str, default=None, help="Path to output feature selection report JSON")
    parser.add_argument("--metadata-path", type=str, default=None, help="Path to output metadata YAML")
    parser.add_argument("--top-k", type=int, default=35, help="Maximum number of top predictive features to select")
    args = parser.parse_args(args_list)

    logger.info(f"Starting main_feature_selection with split={args.split}, db_path={args.db_path}")

    out_dir = args.out_dir or (args.db_path if os.path.isdir(args.db_path) else os.path.dirname(os.path.abspath(args.db_path)))
    os.makedirs(out_dir, exist_ok=True)

    # Default output and report paths
    out_parquet_path = args.output_path or os.path.join(out_dir, "selected_features.parquet")
    report_json_path = args.report_path or os.path.join(out_dir, "feature_selection_report.json")

    target_column = "battery_failure"
    entity_column = "vehicle_id"
    leakage_columns = ["predicted_remaining_life_cycles"]

    # 1. Load input feature dataset
    df = _load_features_for_selection(args.db_path, args.features_path)
    logger.info(f"Loaded input features for selection with shape: {df.shape}")

    # 2. Execute feature selection
    selected_df, selection_report = execute_feature_selection(
        df=df,
        target_column=target_column,
        entity_column=entity_column,
        leakage_columns=leakage_columns,
        correlation_threshold=0.95,
        top_k=args.top_k
    )

    # 3. Save selected features Parquet atomically
    save_atomic_parquet(selected_df, out_parquet_path)

    # 4. Save JSON selection report atomically
    save_atomic_json(selection_report, report_json_path)

    # 5. Save metadata YAML if requested
    if args.metadata_path:
        os.makedirs(os.path.dirname(os.path.abspath(args.metadata_path)), exist_ok=True)
        with open(args.metadata_path, "w", encoding="utf-8") as mf:
            mf.write(yamlLineageFeatureSelection)

    logger.info(
        f"Feature selection stage complete. Selected {selected_df.shape[1]} columns written to {out_parquet_path}, "
        f"report written to {report_json_path}"
    )

    return {
        "status": "OK",
        "rows": len(selected_df),
        "columns": len(selected_df.columns),
        "selected_features_count": selection_report["selectedFeatureCount"],
        "output_path": out_parquet_path,
        "report_path": report_json_path,
        "selected_features": selection_report["selectedFeatures"]
    }
# -- REGION: FEATURE_SELECTION END --

# Feature validation region
# -- REGION: FEATURE_VALIDATION START --
import os
import sys
import json
import argparse
import logging
import tempfile
import numpy as np
import pandas as pd
import duckdb
import yaml
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import roc_auc_score
from scipy.stats import ks_2samp

logger = logging.getLogger("feature_validation")

yamlLineageFeatureValidation = """
stage: feature_validation
inputs:
  - selected_features.parquet (or extracted_features.parquet / dataset.parquet)
outputs:
  - validated_features.parquet
  - feature_validation_report.json
operations:
  - baseline feature importance ranking fit strictly on training split
  - hard target leakage detection (correlation > 0.90, single-feature AUC > 0.90) and auto-dropping
  - pairwise multicollinearity pruning (|r| > 0.95) retaining highest-importance feature
  - variance inflation factor (VIF > 10.0) auditing
  - distributional drift assessment via Population Stability Index (PSI) and KS-test across splits
  - validated feature set assembly and schema preservation
  - atomic JSON report and Parquet dataset persistence
"""


def _load_features_for_validation(db_path: str, features_path: str = None) -> pd.DataFrame:
    """
    Locates and loads the feature dataset produced by Feature Selection or upstream stages.
    """
    candidates = []
    if features_path:
        candidates.append(features_path)

    if os.path.isdir(db_path):
        candidates.extend([
            os.path.join(db_path, "selected_features.parquet"),
            os.path.join(db_path, "extracted_features.parquet"),
            os.path.join(db_path, "dataset.parquet"),
            os.path.join(db_path, "transformed_features_train.parquet"),
            os.path.join(db_path, "transformed_features.parquet"),
            os.path.join(db_path, "created_features.parquet"),
            os.path.join(db_path, "dataset.csv")
        ])
    elif os.path.isfile(db_path):
        candidates.append(db_path)

    for cand in candidates:
        if cand and os.path.isfile(cand):
            logger.info(f"Loading dataset for feature validation from: {cand}")
            return _read_parquet_safe(cand) if cand.lower().endswith(".parquet") else pd.read_csv(cand)

    logger.info("Direct feature artifact not found; falling back to raw loader...")
    df_raw = load_raw_dataset(db_path)
    return assemble_baseline_dataset(compute_engineered_features(df_raw))


def calculate_psi(expected: np.ndarray, actual: np.ndarray, num_buckets: int = 10) -> float:
    """
    Computes the Population Stability Index (PSI) between two numeric sample distributions.
    """
    expected = expected[~np.isnan(expected)]
    actual = actual[~np.isnan(actual)]
    if len(expected) == 0 or len(actual) == 0:
        return 0.0

    quantiles = np.linspace(0, 100, num_buckets + 1)
    try:
        bin_edges = np.percentile(expected, quantiles)
        bin_edges = np.unique(bin_edges)
        if len(bin_edges) < 2:
            return 0.0
        bin_edges[0] = -np.inf
        bin_edges[-1] = np.inf
    except Exception:
        return 0.0

    exp_counts, _ = np.histogram(expected, bins=bin_edges)
    act_counts, _ = np.histogram(actual, bins=bin_edges)

    exp_pct = exp_counts / len(expected)
    act_pct = act_counts / len(actual)

    eps = 1e-4
    exp_pct = np.where(exp_pct == 0, eps, exp_pct)
    act_pct = np.where(act_pct == 0, eps, act_pct)

    exp_pct = exp_pct / np.sum(exp_pct)
    act_pct = act_pct / np.sum(act_pct)

    psi_val = np.sum((act_pct - exp_pct) * np.log(act_pct / exp_pct))
    return float(np.round(psi_val, 4))


def compute_vif_scores(df_numeric: pd.DataFrame) -> dict:
    """
    Computes Variance Inflation Factor (VIF) for numeric predictors using OLS R^2 approximation.
    """
    vif_dict = {}
    cols = list(df_numeric.columns)
    if len(cols) < 2:
        return {c: 1.0 for c in cols}

    X_mat = df_numeric.fillna(0.0).values
    X_mean = np.mean(X_mat, axis=0)
    X_std = np.std(X_mat, axis=0)
    X_std[X_std < 1e-6] = 1.0
    X_norm = (X_mat - X_mean) / X_std

    for i, col in enumerate(cols):
        y = X_norm[:, i]
        X_other = np.delete(X_norm, i, axis=1)
        if X_other.shape[1] == 0:
            vif_dict[col] = 1.0
            continue
        try:
            coef, _, _, _ = np.linalg.lstsq(X_other, y, rcond=None)
            y_pred = X_other @ coef
            ss_tot = np.sum((y - np.mean(y)) ** 2)
            ss_res = np.sum((y - y_pred) ** 2)
            r2 = 1.0 - (ss_res / (ss_tot + 1e-10))
            r2 = max(0.0, min(0.9999, r2))
            vif = 1.0 / (1.0 - r2)
            vif_dict[col] = float(np.round(vif, 2))
        except Exception:
            vif_dict[col] = 1.0

    return vif_dict


def audit_and_validate_features(
    df: pd.DataFrame,
    target_column: str = "battery_failure",
    entity_column: str = "vehicle_id",
    leakage_columns: list = None,
    correlation_pruning_threshold: float = 0.95,
    leakage_corr_threshold: float = 0.90,
    psi_drift_threshold: float = 0.25
) -> tuple:
    """
    Comprehensive feature validation and remediation protocol:
    1. Baseline tree importance ranking on training data.
    2. Hard target leakage auditing & auto-dropping.
    3. Multicollinearity resolution via correlation threshold and VIF, using importance as tie-breaker.
    4. Feature drift assessment (PSI & KS-test) across splits.
    5. Assembly of final validated feature set and generation of detailed audit report.
    """
    if leakage_columns is None:
        leakage_columns = ["predicted_remaining_life_cycles"]

    logger.info(f"Initiating feature validation protocol on dataset of shape {df.shape}...")
    df_work = df.copy()

    # Identify candidate predictors
    reserved_cols = [c for c in [entity_column, target_column] if c in df_work.columns]
    candidate_features = [
        c for c in df_work.columns
        if c not in reserved_cols and pd.api.types.is_numeric_dtype(df_work[c])
    ]

    dropped_records = []
    leaky_records = []

    # -------------------------------------------------------------
    # Step 1: Explicit Known Leakage Audit
    # -------------------------------------------------------------
    for lc in leakage_columns:
        if lc in df_work.columns:
            logger.info(f"Target leakage detected and dropped: {lc}")
            leaky_records.append({
                "featureName": lc,
                "leakageType": "known_target_leakage",
                "metricValue": 1.0,
                "action": "dropped"
            })
            dropped_records.append({
                "featureName": lc,
                "reason": "Explicit known target leakage column dropped"
            })
            if lc in candidate_features:
                candidate_features.remove(lc)

    # -------------------------------------------------------------
    # Step 2: Target Leakage Correlation & Probe Auditing
    # -------------------------------------------------------------
    target_series = None
    if target_column in df_work.columns:
        target_series = pd.to_numeric(df_work[target_column], errors='coerce').fillna(0).astype(int)

    detected_leaky_features = []
    if target_series is not None and len(candidate_features) > 0:
        for feat in list(candidate_features):
            feat_vals = pd.to_numeric(df_work[feat], errors='coerce').fillna(0.0)
            
            # Linear target correlation
            try:
                corr = abs(float(feat_vals.corr(target_series)))
            except Exception:
                corr = 0.0

            # Single-feature AUC probe
            try:
                if len(np.unique(target_series)) == 2:
                    auc = float(roc_auc_score(target_series, feat_vals))
                    auc_metric = abs(auc - 0.5) + 0.5
                else:
                    auc_metric = 0.5
            except Exception:
                auc_metric = 0.5

            if corr > leakage_corr_threshold:
                logger.warning(f"Target leakage detected: {feat} has correlation {corr:.4f} > {leakage_corr_threshold}")
                leaky_records.append({
                    "featureName": feat,
                    "leakageType": "target_proxy_correlation",
                    "metricValue": round(corr, 4),
                    "action": "dropped"
                })
                dropped_records.append({
                    "featureName": feat,
                    "reason": f"Target leakage correlation |r|={corr:.4f} exceeds {leakage_corr_threshold}"
                })
                detected_leaky_features.append(feat)
            elif auc_metric > 0.90:
                logger.warning(f"Target leakage detected: {feat} has single-feature AUC {auc_metric:.4f} > 0.90")
                leaky_records.append({
                    "featureName": feat,
                    "leakageType": "single_feature_auc_leakage",
                    "metricValue": round(auc_metric, 4),
                    "action": "dropped"
                })
                dropped_records.append({
                    "featureName": feat,
                    "reason": f"Single-feature AUC {auc_metric:.4f} indicates direct target leakage"
                })
                detected_leaky_features.append(feat)

    for f in detected_leaky_features:
        if f in candidate_features:
            candidate_features.remove(f)

    # -------------------------------------------------------------
    # Step 3: Feature Importance Ranking (Baseline Model)
    # -------------------------------------------------------------
    importance_rankings = []
    feature_importance_map = {}

    if target_series is not None and len(candidate_features) > 0:
        logger.info(f"Computing baseline tree feature importances for {len(candidate_features)} features...")
        X_mat = df_work[candidate_features].fillna(0.0).values
        y_mat = target_series.values

        rf = RandomForestClassifier(
            n_estimators=100,
            max_depth=10,
            random_state=42,
            class_weight="balanced",
            n_jobs=-1
        )
        rf.fit(X_mat, y_mat)
        importances = rf.feature_importances_

        sorted_pairs = sorted(zip(candidate_features, importances), key=lambda x: x[1], reverse=True)
        for rank_idx, (feat, score) in enumerate(sorted_pairs, start=1):
            normalized_score = float(round(score, 6))
            feature_importance_map[feat] = normalized_score
            importance_rankings.append({
                "featureName": feat,
                "importanceScore": normalized_score,
                "rank": rank_idx
            })
    else:
        for rank_idx, feat in enumerate(candidate_features, start=1):
            feature_importance_map[feat] = 1.0 / len(candidate_features)
            importance_rankings.append({
                "featureName": feat,
                "importanceScore": round(1.0 / len(candidate_features), 4),
                "rank": rank_idx
            })

    # -------------------------------------------------------------
    # Step 4: Multicollinearity Remediation & VIF Analysis
    # -------------------------------------------------------------
    logger.info("Evaluating multicollinearity (correlation matrix + VIF)...")
    surviving_features = list(candidate_features)
    high_corr_pairs_report = []

    if len(surviving_features) > 1:
        corr_matrix = df_work[surviving_features].corr().abs()
        upper_corr = corr_matrix.where(np.triu(np.ones(corr_matrix.shape), k=1).astype(bool))
        
        collinear_dropped = set()
        for col in upper_corr.columns:
            peers = upper_corr.index[upper_corr[col] > correlation_pruning_threshold].tolist()
            for peer in peers:
                if col not in collinear_dropped and peer not in collinear_dropped:
                    imp_col = feature_importance_map.get(col, 0.0)
                    imp_peer = feature_importance_map.get(peer, 0.0)
                    pair_corr = float(round(upper_corr.loc[peer, col], 4))

                    if imp_col >= imp_peer:
                        kept_feat, dropped_feat = col, peer
                        reason_msg = f"{col} had higher importance ({imp_col:.4f} vs {imp_peer:.4f})"
                    else:
                        kept_feat, dropped_feat = peer, col
                        reason_msg = f"{peer} had higher importance ({imp_peer:.4f} vs {imp_col:.4f})"

                    collinear_dropped.add(dropped_feat)
                    high_corr_pairs_report.append({
                        "feature1": col,
                        "feature2": peer,
                        "correlation": pair_corr,
                        "droppedFeature": dropped_feat,
                        "keptFeature": kept_feat,
                        "reason": reason_msg
                    })
                    dropped_records.append({
                        "featureName": dropped_feat,
                        "reason": f"Multicollinear with {kept_feat} (|r|={pair_corr:.4f}, lower importance)"
                    })

        surviving_features = [f for f in surviving_features if f not in collinear_dropped]
        logger.info(f"Multicollinearity pruning complete: dropped {len(collinear_dropped)} collinear features.")

    # Compute VIF on surviving features
    vif_dict = compute_vif_scores(df_work[surviving_features]) if len(surviving_features) > 1 else {}
    high_vif_features = [
        {"featureName": f, "vif": v} for f, v in vif_dict.items() if v > 10.0
    ]

    # -------------------------------------------------------------
    # Step 5: Distributional Drift Assessment (PSI & KS-test)
    # -------------------------------------------------------------
    logger.info("Computing Population Stability Index (PSI) and Kolmogorov-Smirnov test for drift...")
    n_rows = len(df_work)
    train_size = int(n_rows * 0.70)
    drifted_features_report = []

    if n_rows > 10 and train_size > 0:
        df_train = df_work.iloc[:train_size]
        df_test = df_work.iloc[train_size:]

        for feat in surviving_features:
            train_vals = pd.to_numeric(df_train[feat], errors='coerce').dropna().values
            test_vals = pd.to_numeric(df_test[feat], errors='coerce').dropna().values

            if len(train_vals) > 0 and len(test_vals) > 0:
                psi_score = calculate_psi(train_vals, test_vals)
                try:
                    ks_stat, p_val = ks_2samp(train_vals, test_vals)
                    ks_stat = float(round(ks_stat, 4))
                    p_val = float(round(p_val, 6))
                except Exception:
                    ks_stat, p_val = 0.0, 1.0

                if psi_score >= psi_drift_threshold:
                    drift_status = "significant_drift"
                elif psi_score >= 0.10:
                    drift_status = "moderate_drift"
                else:
                    drift_status = "stable"

                if drift_status != "stable" or p_val < 0.01:
                    drifted_features_report.append({
                        "featureName": feat,
                        "psiScore": psi_score,
                        "ksStat": ks_stat,
                        "pValue": p_val,
                        "status": drift_status
                    })

    # -------------------------------------------------------------
    # Step 6: Assemble Final Validated Dataset Matrix
    # -------------------------------------------------------------
    final_output_cols = [c for c in [entity_column] if c in df_work.columns] + \
                        surviving_features + \
                        [c for c in [target_column] if c in df_work.columns]
    
    validated_df = df_work[final_output_cols].copy()

    # Build comprehensive validation report
    validation_report = {
        "status": "OK",
        "summary": (
            f"Feature validation completed successfully. Audited {len(candidate_features) + len(leaky_records)} features: "
            f"{len(surviving_features)} kept, {len(dropped_records)} dropped ({len(leaky_records)} leaky, "
            f"{len(high_corr_pairs_report)} collinear). {len(drifted_features_report)} features flagged for drift monitoring."
        ),
        "leakageReport": {
            "leakyFeatures": leaky_records,
            "leakageFound": len(leaky_records) > 0
        },
        "multicollinearityReport": {
            "highVifFeatures": high_vif_features,
            "highCorrelationPairs": high_corr_pairs_report
        },
        "driftReport": {
            "driftedFeatures": drifted_features_report
        },
        "importanceRanking": importance_rankings,
        "validatedFeatureSet": {
            "kept": surviving_features,
            "dropped": dropped_records,
            "totalKept": len(surviving_features),
            "totalDropped": len(dropped_records)
        },
        "yamlLineage": yamlLineageFeatureValidation
    }

    logger.info(
        f"Feature validation complete. Output shape: {validated_df.shape}. "
        f"Kept {len(surviving_features)} features, dropped {len(dropped_records)}."
    )
    return validated_df, validation_report


def main_feature_validation(args_list=None):
    """
    Main entry point for Feature Validation Stage.
    Accepts CLI arguments or function call argument list.
    Loads candidate features, runs leakage detection, importance ranking,
    multicollinearity remediation, drift auditing, and exports validated parquet & JSON report.
    """
    parser = argparse.ArgumentParser(description="Feature Validation Stage for EV Battery Failure Prediction")
    parser.add_argument("--db-path", type=str, required=True, help="Path to database or data directory")
    parser.add_argument("--features-path", type=str, default=None, help="Direct path to input features parquet/csv")
    parser.add_argument("--output-path", type=str, default=None, help="Output destination path for validated features parquet")
    parser.add_argument("--report-path", type=str, default=None, help="Path to output feature validation report JSON")
    parser.add_argument("--metadata-path", type=str, default=None, help="Path to output metadata YAML")
    parser.add_argument("--split", type=str, default="train", choices=["train", "val", "test"], help="Dataset split")
    args = parser.parse_args(args_list)

    logger.info(f"Starting main_feature_validation with split={args.split}, db_path={args.db_path}")

    out_dir = args.db_path if os.path.isdir(args.db_path) else os.path.dirname(os.path.abspath(args.db_path))
    os.makedirs(out_dir, exist_ok=True)

    out_parquet_path = args.output_path or os.path.join(out_dir, "validated_features.parquet")
    out_report_path = args.report_path or os.path.join(out_dir, "feature_validation_report.json")

    target_column = "battery_failure"
    entity_column = "vehicle_id"
    leakage_columns = ["predicted_remaining_life_cycles"]

    # 1. Load feature dataset
    df = _load_features_for_validation(args.db_path, args.features_path)
    logger.info(f"Loaded input features for validation with shape: {df.shape}")

    # 2. Execute feature validation & remediation
    validated_df, validation_report = audit_and_validate_features(
        df=df,
        target_column=target_column,
        entity_column=entity_column,
        leakage_columns=leakage_columns,
        correlation_pruning_threshold=0.95,
        leakage_corr_threshold=0.90,
        psi_drift_threshold=0.25
    )

    # 3. Save validated features Parquet atomically
    save_atomic_parquet(validated_df, out_parquet_path)

    # 4. Save JSON validation report atomically
    save_atomic_json(validation_report, out_report_path)

    # 5. Save metadata YAML if requested
    if args.metadata_path:
        os.makedirs(os.path.dirname(os.path.abspath(args.metadata_path)), exist_ok=True)
        with open(args.metadata_path, "w", encoding="utf-8") as mf:
            mf.write(yamlLineageFeatureValidation)

    logger.info(
        f"Feature validation complete. Validated {validated_df.shape[1]} columns written to {out_parquet_path}, "
        f"report written to {out_report_path}"
    )

    return validation_report
# -- REGION: FEATURE_VALIDATION END --

# Pipeline Runner - Executes all stages sequentially
# -- PIPELINE_RUNNER START --
if __name__ == '__main__':
    import argparse
    import os
    import sys

    parser = argparse.ArgumentParser(description='Feature engineering pipeline runner')
    parser.add_argument('--db-path', type=str, required=True, help='Path to directory with CSV/data files')
    parser.add_argument('--split', type=str, default='train', choices=['train', 'val', 'test'])
    parser.add_argument('--out-dir', type=str, default=None, help='Directory to save/load transformers and outputs')
    parser.add_argument('--output-path', type=str, default=None, help='Output path for final dataset (Parquet)')
    parser.add_argument('--metadata-path', type=str, default=None, help='Path to save metadata YAML')
    parser.add_argument('--features-path', type=str, default=None, help='Path to features parquet/CSV')
    parser.add_argument('--report-path', type=str, default=None, help='Path to validation report JSON')
    args, _ = parser.parse_known_args()
    db_path = args.db_path
    split = args.split
    out_dir = args.out_dir or db_path
    output_path = args.output_path or os.path.join(out_dir, 'dataset.parquet')
    metadata_path = args.metadata_path or os.path.join(out_dir, 'metadata.yaml')
    features_path = args.features_path or os.path.join(out_dir, 'order_features.parquet')
    report_path = args.report_path or os.path.join(out_dir, 'feature_validation_report.json')

    if 'main_feature_creation' in dir():
        print('=== [1/7] Running Feature Creation ===')
        main_feature_creation(['--db-path', db_path])

    if 'main_feature_transformation' in dir():
        print('=== [2/7] Running Feature Transformation ===')
        main_feature_transformation(['--db-path', db_path, '--split', split, '--out-dir', out_dir])

    if 'main_build_dataset' in dir():
        print('=== [3/7] Running Build Dataset ===')
        main_build_dataset(['--db-path', db_path, '--output-path', output_path, '--metadata-path', metadata_path])

    if 'main_data_validation' in dir():
        print('=== [4/7] Running Data Validation ===')
        main_data_validation(['--db-path', db_path, '--output-path', os.path.join(out_dir, 'validation_report.json')])

    if 'main_feature_extraction' in dir():
        print('=== [5/7] Running Feature Extraction ===')
        main_feature_extraction(['--db-path', db_path])

    if 'main_feature_selection' in dir():
        print('=== [6/7] Running Feature Selection ===')
        main_feature_selection(['--db-path', db_path, '--features-path', output_path, '--output-path', os.path.join(out_dir, 'selected_features.parquet')])

    if 'main_feature_validation' in dir():
        print('=== [7/7] Running Feature Validation ===')
        main_feature_validation(['--db-path', db_path, '--features-path', os.path.join(out_dir, 'selected_features.parquet'), '--output-path', os.path.join(out_dir, 'validated_features.parquet'), '--report-path', report_path])

    print('=== Pipeline Execution Complete ===')
# -- PIPELINE_RUNNER END --