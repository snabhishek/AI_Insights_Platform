"""Strategy registry."""
from importlib import import_module

_MODULES = (
    "ram_optimization",
    "vram_optimization",
    "unified_memory_optimization",
    "tensor_lifetime_optimization",
    "activation_recomputation",
    "optimizer_state_memory_reduction",
    "parameter_memory_reduction",
    "batch_memory_estimation",
    "memory_peak_reduction",
    "memory_safety_margin",
)
STRATEGIES = {}

def load_strategies():
    for module_name in _MODULES:
        module = import_module(f"{__package__}.{module_name}")
        STRATEGIES[module.STRATEGY["name"]] = module.create_strategy()
    return dict(STRATEGIES)

def get_strategy(name):
    strategies = load_strategies()
    if name not in strategies:
        raise KeyError(f"Unknown strategy: {name}")
    return strategies[name]
