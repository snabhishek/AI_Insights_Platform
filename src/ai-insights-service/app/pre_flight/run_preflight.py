import json
import sys
import argparse
from dataclasses import asdict, is_dataclass
from .processes.preflight_pipeline import PreflightPipeline
from .processes.system_profiler import SystemProfiler
from .processes.capability_resolver import CapabilityResolver
from .processes.resource_estimator import ResourceEstimator
from .processes.optimization_planner import OptimizationPlanner
from .processes.decision_engine import DecisionEngine


def serialize(obj):
    if is_dataclass(obj):
        return asdict(obj)
    if isinstance(obj, (list, tuple)):
        return [serialize(x) for x in obj]
    if isinstance(obj, dict):
        return {k: serialize(v) for k, v in obj.items()}
    if hasattr(obj, "value"):
        return obj.value
    return str(obj)


def main():
    parser = argparse.ArgumentParser(description="Run Preflight Pipeline")
    parser.add_argument("--config", type=str, help="JSON configuration string")
    parser.add_argument("--config-b64", type=str, help="Base64 encoded JSON configuration string")
    parser.add_argument("--file", type=str, help="Path to JSON configuration file")
    parser.add_argument("--stdin", action="store_true", help="Read JSON configuration from stdin")
    args, _ = parser.parse_known_args()

    config = {}
    if args.config_b64:
        try:
            import base64
            decoded = base64.b64decode(args.config_b64).decode("utf-8")
            config = json.loads(decoded)
        except Exception as e:
            sys.stderr.write(f"Error parsing --config-b64: {e}\n")
    elif args.config:
        try:
            config = json.loads(args.config)
        except Exception as e:
            sys.stderr.write(f"Error parsing --config JSON: {e}\n")
    elif args.file:
        try:
            with open(args.file, "r") as f:
                config = json.load(f)
        except Exception as e:
            sys.stderr.write(f"Error reading config file: {e}\n")
    elif args.stdin:
        try:
            raw = sys.stdin.read().strip()
            if raw:
                config = json.loads(raw)
        except Exception as e:
            sys.stderr.write(f"Error parsing stdin JSON: {e}\n")


    if not config:
        config = {
            "framework": "pytorch",
            "resource_estimate": {
                "confidence": "low"
            }
        }

    pipeline = PreflightPipeline()
    result = pipeline.run(config)

    serialized = {k: serialize(v) for k, v in result.items()}
    print(json.dumps(serialized, indent=2, default=str))


if __name__ == "__main__":
    main()

