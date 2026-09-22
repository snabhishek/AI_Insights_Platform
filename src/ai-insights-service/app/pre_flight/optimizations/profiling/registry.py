"""Registry for this optimization group."""
from importlib import import_module

STRATEGIES = {}
_MODULES = (
    'cpu_profiler',
    'gpu_profiler',
    'ram_profiler',
    'vram_profiler',
    'data_loader_profiler',
    'io_profiler',
    'model_forward_profiler',
    'model_backward_profiler',
    'bottleneck_detector',
    'throughput_measurement',
    'cpu_utilization_measurement',
    'gpu_utilization_measurement',
    'memory_peak_measurement',
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
