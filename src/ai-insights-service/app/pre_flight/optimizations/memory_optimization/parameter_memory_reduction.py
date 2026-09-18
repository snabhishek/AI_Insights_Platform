"""Strategy: parameter_memory_reduction."""
from ._shared import make_strategy, clone_strategy

STRATEGY = make_strategy(
    name='parameter_memory_reduction',
    description='Reduce parameter memory using precision or sharding.',
    category='parameter_memory',
    priority="high",
    tags=["memory", 'parameter_memory'],
    defaults={'enabled': False, 'parameter_precision': 'fp32'},
)

def create_strategy():
    """Return an independent strategy copy."""
    return clone_strategy(STRATEGY)
