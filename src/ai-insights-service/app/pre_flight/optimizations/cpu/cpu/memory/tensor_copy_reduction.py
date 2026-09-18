"""CPU optimization strategy: tensor_copy_reduction."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='tensor_copy_reduction',
    category='memory',
    description='Apply tensor copy reduction.',
    transform=set_if_absent('tensor_copy_reduction', True),
    tags=("cpu", 'memory'),
)


def create_strategy():
    return STRATEGY
