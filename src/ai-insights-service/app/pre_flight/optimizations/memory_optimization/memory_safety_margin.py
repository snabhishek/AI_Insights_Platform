"""Strategy: memory_safety_margin."""
from ._shared import make_strategy, clone_strategy

STRATEGY = make_strategy(
    name='memory_safety_margin',
    description='Maintain a reserve to reduce OOM failures.',
    category='reliability',
    priority="high",
    tags=["memory", 'reliability'],
    defaults={'reserve_ratio': 0.1, 'minimum_reserve_gb': 0.5},
)

def create_strategy():
    """Return an independent strategy copy."""
    return clone_strategy(STRATEGY)
