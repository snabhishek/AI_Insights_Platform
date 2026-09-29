"""Registry for framework-specific optimization strategies."""

from importlib import import_module

STRATEGIES = {}

_MODULES = [

    ('pytorch', 'pytorch_runtime_optimization'),
    ('pytorch', 'pytorch_dataloader_optimization'),
    ('pytorch', 'pytorch_amp_optimization'),
    ('pytorch', 'pytorch_compile_optimization'),
    ('pytorch', 'pytorch_memory_optimization'),
    ('pytorch', 'pytorch_distributed_optimization'),
    ('tensorflow', 'tensorflow_runtime_optimization'),
    ('tensorflow', 'tensorflow_data_pipeline_optimization'),
    ('tensorflow', 'tensorflow_mixed_precision'),
    ('tensorflow', 'tensorflow_xla_optimization'),
    ('tensorflow', 'tensorflow_cpu_optimization'),
    ('tensorflow', 'tensorflow_gpu_optimization'),
    ('sklearn', 'sklearn_parallelism'),
    ('sklearn', 'sklearn_memory_optimization'),
    ('sklearn', 'sklearn_pipeline_optimization'),
    ('lightgbm', 'lightgbm_thread_optimization'),
    ('lightgbm', 'lightgbm_histogram_optimization'),
    ('lightgbm', 'lightgbm_data_sampling'),
    ('lightgbm', 'lightgbm_memory_optimization'),
    ('xgboost', 'xgboost_thread_optimization'),
    ('xgboost', 'xgboost_histogram_optimization'),
    ('xgboost', 'xgboost_cpu_optimization'),
    ('xgboost', 'xgboost_gpu_optimization'),
    ('xgboost', 'xgboost_memory_optimization'),
]

def load_strategies():
    """Import and return all framework-specific strategies."""
    for framework, module_name in _MODULES:
        module = import_module(f"{__package__}.{framework}.{module_name}")
        strategy = module.create_strategy()
        STRATEGIES[strategy["name"]] = strategy
    return dict(STRATEGIES)


def get_strategy(name):
    """Return a strategy by its unique name."""
    strategies = load_strategies()
    if name not in strategies:
        available = ", ".join(sorted(strategies))
        raise KeyError(f"Unknown strategy {name!r}. Available: {available}")
    return strategies[name]
