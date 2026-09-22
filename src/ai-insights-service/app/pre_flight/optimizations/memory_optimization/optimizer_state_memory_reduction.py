"""Strategy: optimizer_state_memory_reduction."""
from ._shared import make_strategy, clone_strategy

STRATEGY = make_strategy(
    name='optimizer_state_memory_reduction',
    description='Reduce optimizer-state memory.',
    category='optimizer_memory',
    priority="high",
    tags=["memory", 'optimizer_memory'],
    defaults={'enabled': False, 'state_precision': 'fp32'},
)

def create_strategy():
    """Return an independent strategy copy."""
    return clone_strategy(STRATEGY)
