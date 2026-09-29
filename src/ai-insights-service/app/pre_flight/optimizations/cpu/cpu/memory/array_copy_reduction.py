"""CPU optimization strategy: array_copy_reduction."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='array_copy_reduction',
    category='memory',
    description='Apply array copy reduction.',
    transform=set_if_absent('array_copy_reduction', True),
    tags=("cpu", 'memory'),
)


def create_strategy():
    return STRATEGY
