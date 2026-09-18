"""CPU optimization strategy: memory_layout_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='memory_layout_optimization',
    category='computation',
    description='Apply memory layout optimization.',
    transform=set_if_absent('memory_layout_optimization', True),
    tags=("cpu", 'computation'),
)


def create_strategy():
    return STRATEGY
