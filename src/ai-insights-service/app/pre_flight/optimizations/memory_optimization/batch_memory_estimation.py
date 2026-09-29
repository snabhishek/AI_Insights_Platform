"""Strategy: batch_memory_estimation."""
from ._shared import make_strategy, clone_strategy

STRATEGY = make_strategy(
    name='batch_memory_estimation',
    description='Estimate safe batch memory before training.',
    category='capacity_estimation',
    priority="high",
    tags=["memory", 'capacity_estimation'],
    defaults={'safety_factor': 0.8, 'initial_batch_size': 1},
)

def create_strategy():
    """Return an independent strategy copy."""
    return clone_strategy(STRATEGY)
