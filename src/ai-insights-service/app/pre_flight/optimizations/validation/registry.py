"""Registry for this optimization group."""
from importlib import import_module

STRATEGIES = {}
_MODULES = (
    'optimization_applicability_validator',
    'framework_compatibility_validator',
    'hardware_compatibility_validator',
    'configuration_validator',
    'resource_reestimator',
    'performance_regression_validator',
    'accuracy_regression_validator',
    'numerical_stability_validator',
    'memory_safety_validator',
    'training_dry_run_validator',
    'final_preflight_validator',
)

def load_strategies():
    """Load all strategies in this group."""
    for module_name in _MODULES:
        module = import_module(f"{__package__}.{module_name}")
        STRATEGIES[module.STRATEGY["name"]] = module.create_strategy()
    return dict(STRATEGIES)

def get_strategy(name):
    """Return a strategy by name."""
    strategies = load_strategies()
    if name not in strategies:
        available = ", ".join(sorted(strategies))
        raise KeyError(f"Unknown strategy {name!r}. Available: {available}")
    return strategies[name]
