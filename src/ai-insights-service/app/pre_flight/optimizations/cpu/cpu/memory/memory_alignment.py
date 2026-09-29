"""CPU optimization strategy: memory_alignment."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='memory_alignment',
    category='memory',
    description='Apply memory alignment.',
    transform=set_if_absent('memory_alignment', True),
    tags=("cpu", 'memory'),
)


def create_strategy():
    return STRATEGY
