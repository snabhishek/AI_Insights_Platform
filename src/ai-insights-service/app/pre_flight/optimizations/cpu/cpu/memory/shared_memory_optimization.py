"""CPU optimization strategy: shared_memory_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='shared_memory_optimization',
    category='memory',
    description='Apply shared memory optimization.',
    transform=set_if_absent('shared_memory_optimization', True),
    tags=("cpu", 'memory'),
)


def create_strategy():
    return STRATEGY
