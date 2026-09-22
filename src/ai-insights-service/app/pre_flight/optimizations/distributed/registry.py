"""Registry for this optimization group."""
from importlib import import_module

STRATEGIES = {}
_MODULES = (
    'distributed_training',
    'distributed_data_parallel',
    'distributed_cpu_training',
    'multi_gpu_training',
    'gradient_synchronization',
    'communication_optimization',
    'node_resource_balancing',
    'distributed_checkpointing',
    'distributed_failure_recovery',
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
