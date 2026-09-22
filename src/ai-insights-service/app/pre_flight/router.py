from fastapi import APIRouter, Body, HTTPException
from typing import Any, Dict, Optional
from dataclasses import asdict, is_dataclass

from .processes.preflight_pipeline import PreflightPipeline
from .processes.system_profiler import SystemProfiler
from .processes.capability_resolver import CapabilityResolver
from .processes.resource_estimator import ResourceEstimator
from .processes.optimization_planner import OptimizationPlanner
from .processes.decision_engine import DecisionEngine
from .estimators.registry import load_estimators, get_estimator
from .models import Bottleneck

router = APIRouter(prefix="/preflight", tags=["preflight"])


def serialize_obj(obj):
    if is_dataclass(obj):
        return asdict(obj)
    if isinstance(obj, (list, tuple)):
        return [serialize_obj(x) for x in obj]
    if isinstance(obj, dict):
        return {k: serialize_obj(v) for k, v in obj.items()}
    if hasattr(obj, "value"):
        return obj.value
    return str(obj)


@router.get("/system")
def get_system_snapshot():
    """Profiles and returns current system hardware, memory, disk, and GPU resources."""
    system = SystemProfiler().profile()
    return serialize_obj(system)


@router.post("/capabilities")
def resolve_capabilities(config: Dict[str, Any] = Body(default_factory=dict)):
    """Resolves framework execution capabilities against system hardware."""
    system = SystemProfiler().profile()
    capabilities = CapabilityResolver().resolve(config, system)
    return [serialize_obj(c) for c in capabilities]


@router.post("/estimate")
def estimate_resources(payload: Dict[str, Any] = Body(default_factory=dict)):
    """Runs resource estimation for the given training configuration."""
    config = payload.get("config", payload)
    system = SystemProfiler().profile()
    capabilities = CapabilityResolver().resolve(config, system)
    cap = capabilities[0] if capabilities else None
    
    estimator = ResourceEstimator()
    estimate = estimator.estimate(config, cap, system)
    return serialize_obj(estimate)


@router.post("/optimize")
def plan_optimizations(payload: Dict[str, Any] = Body(default_factory=dict)):
    """Plans optimizations based on detected bottlenecks."""
    config = payload.get("config", payload)
    system = SystemProfiler().profile()
    capabilities = CapabilityResolver().resolve(config, system)
    cap = capabilities[0] if capabilities else None
    
    estimator = ResourceEstimator()
    estimate = estimator.estimate(config, cap, system)
    
    bottleneck_str = payload.get("bottleneck", "unknown")
    try:
        bottleneck = Bottleneck(bottleneck_str)
    except ValueError:
        bottleneck = Bottleneck.UNKNOWN
        
    proposals = OptimizationPlanner().plan(config, cap, system, estimate, bottleneck)
    return [serialize_obj(p) for p in proposals]


@router.post("/pipeline")
def run_pipeline(config: Dict[str, Any] = Body(default_factory=dict)):
    """Runs the full preflight pipeline end-to-end."""
    try:
        pipeline = PreflightPipeline()
        result = pipeline.run(config)
        return {k: serialize_obj(v) for k, v in result.items()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Preflight pipeline failed: {str(e)}")


@router.get("/estimators")
def list_registered_estimators():
    """Lists all 47 registered estimators and their metadata."""
    estimators = load_estimators()
    return {
        "count": len(estimators),
        "estimators": [
            {
                "id": k,
                "name": getattr(v, "name", k),
                "version": getattr(v, "version", "1.0.0"),
            }
            for k, v in estimators.items()
        ]
    }
