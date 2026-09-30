"""
CLI Entrypoint for Lithium-ion Future Prediction Forecasting Model Training.
Handles configuration ingestion, CLI parameter overrides, and pipeline execution.
"""

import os
import sys
import json
import shutil
import argparse
import logging
import yaml

from pipeline import ModelTrainingPipeline

# Setup root logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("model_training_main")


def parse_args():
    """Parses command line arguments with graceful handling of runner variants."""
    parser = argparse.ArgumentParser(
        description="Lithium-ion Battery Price Forecasting Model Training CLI"
    )
    parser.add_argument(
        "--db-path",
        type=str,
        default="/workspace",
        help="Base path to search for data files (default: /workspace)"
    )
    parser.add_argument(
        "--out-dir",
        type=str,
        default=".",
        help="Path to write outputs and artifacts (default: current directory)"
    )
    parser.add_argument(
        "--config-path",
        type=str,
        default=None,
        help="Path to training configuration YAML file"
    )
    parser.add_argument(
        "--models",
        type=str,
        default=None,
        help="Comma-separated list of candidate model IDs to train (e.g., 'lightgbm_regressor,xgboost_regressor')"
    )
    parser.add_argument(
        "--split-date",
        type=str,
        default=None,
        help="Cutoff date string for temporal splitting (e.g., '1996-01')"
    )
    parser.add_argument(
        "--split-end-date",
        type=str,
        default=None,
        help="Split end/cutoff date string for temporal splitting (e.g., '1996-01')"
    )
    parser.add_argument(
        "--split-cutoff-date",
        type=str,
        default=None,
        help="Split cutoff date string for temporal splitting (e.g., '1996-01')"
    )
    parser.add_argument(
        "--target-column",
        type=str,
        default=None,
        help="Target column name override"
    )
    args, unknown = parser.parse_known_args()
    if unknown:
        logger.warning(f"Ignored unrecognized CLI arguments: {unknown}")
    return args


def load_config(config_path: str = None) -> dict:
    """Loads configuration dictionary from YAML."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = []
    if config_path:
        candidates.append(config_path)
    candidates.extend([
        os.path.join(script_dir, "configs", "training_config.yaml"),
        os.path.join(".", "configs", "training_config.yaml"),
        "/workspace/configs/training_config.yaml"
    ])

    for path in candidates:
        if path and os.path.exists(path):
            logger.info(f"Loading training configuration from {path}")
            with open(path, "r", encoding="utf-8") as f:
                return yaml.safe_load(f)

    logger.warning("No configuration YAML found at standard locations. Using empty base config.")
    return {}


def main():
    """Main execution function."""
    args = parse_args()
    logger.info("Initializing Lithium-ion Future Prediction Model Training Pipeline")
    logger.info(f"Arguments: db_path={args.db_path}, out_dir={args.out_dir}, models={args.models}")

    config = load_config(args.config_path)

    # CLI Split Date Overrides
    split_cutoff = args.split_end_date or args.split_cutoff_date or args.split_date
    if split_cutoff:
        config.setdefault("split", {})["split_cutoff_date"] = split_cutoff
        config["split"]["split_end_date"] = split_cutoff
        config["split"]["split_date"] = split_cutoff
        logger.info(f"Overrode split cutoff date with CLI argument: {split_cutoff}")

    # CLI Target Column Override
    if args.target_column:
        config.setdefault("target", {})["target_column"] = args.target_column
        config["target"]["name"] = args.target_column
        logger.info(f"Overrode target column with CLI argument: {args.target_column}")

    selected_models = None
    if args.models:
        selected_models = [m.strip() for m in args.models.split(",") if m.strip()]
        logger.info(f"Filtering model execution to CLI specified list: {selected_models}")

    # Determine base search path for data
    base_data_path = args.db_path if os.path.exists(args.db_path) else None
    
    # Initialize and execute pipeline
    pipeline = ModelTrainingPipeline(config=config, base_path=args.out_dir, data_path=base_data_path)
    report = pipeline.run(selected_models=selected_models)

    # Copy report to parent run timestamp directory if applicable
    try:
        report_json_path = os.path.join(args.out_dir, "model_training_report.json")
        parent_dir = os.path.dirname(os.path.abspath(args.out_dir))
        if os.path.exists(parent_dir) and os.path.basename(parent_dir).startswith("2026"):
            parent_report_path = os.path.join(parent_dir, "model_training_report.json")
            shutil.copyfile(report_json_path, parent_report_path)
            logger.info(f"Synchronized report to run directory: {parent_report_path}")
    except Exception as e:
        logger.warning(f"Could not synchronize report to parent directory: {e}")

    logger.info("=" * 60)
    logger.info(f"Training Pipeline Completed Successfully! Champion Model: {report.get('best_model_id')}")
    logger.info(f"Champion Test Score ({report.get('primary_metric')}): {report.get('best_model', {}).get('score')}")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
