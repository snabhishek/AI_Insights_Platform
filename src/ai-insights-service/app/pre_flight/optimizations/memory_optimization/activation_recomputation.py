"""Strategy: activation_recomputation."""
from ._shared import make_strategy, clone_strategy

STRATEGY = make_strategy(
    name='activation_recomputation',
    description='Trade compute for lower activation memory.',
    category='activation_memory',
    priority="high",
    tags=["memory", 'activation_memory'],
    defaults={'enabled': False, 'checkpoint_interval': 1},
)

def create_strategy():
    """Return an independent strategy copy."""
    return clone_strategy(STRATEGY)
