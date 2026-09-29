"""Strategy: unified_memory_optimization."""
from ._shared import make_strategy, clone_strategy

STRATEGY = make_strategy(
    name='unified_memory_optimization',
    description='Coordinate CPU and accelerator memory budgets.',
    category='memory_budget',
    priority="high",
    tags=["memory", 'memory_budget'],
    defaults={'shared_memory_budget_ratio': 0.8},
)

def create_strategy():
    """Return an independent strategy copy."""
    return clone_strategy(STRATEGY)
