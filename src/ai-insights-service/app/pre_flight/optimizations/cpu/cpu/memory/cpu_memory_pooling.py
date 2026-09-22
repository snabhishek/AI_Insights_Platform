"""CPU optimization strategy: cpu_memory_pooling."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cpu_memory_pooling',
    category='memory',
    description='Apply cpu memory pooling.',
    transform=set_if_absent('cpu_memory_pooling', True),
    tags=("cpu", 'memory'),
)


def create_strategy():
    return STRATEGY
