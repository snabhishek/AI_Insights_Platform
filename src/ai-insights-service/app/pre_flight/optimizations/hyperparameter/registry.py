"""Registry for this optimization group."""
from importlib import import_module

STRATEGIES = {}
_MODULES = (
    'random_search',
    'bayesian_optimization',
    'optuna_search',
    'hyperband_search',
    'asha_search',
    'successive_halving',
    'trial_pruning',
    'early_trial_stopping',
    'parallel_trials',
    'resource_aware_trials',
    'budget_aware_search',
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
