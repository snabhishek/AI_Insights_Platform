"""CPU optimization strategy: branch_prediction_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='branch_prediction_optimization',
    category='computation',
    description='Apply branch prediction optimization.',
    transform=set_if_absent('branch_prediction_optimization', True),
    tags=("cpu", 'computation'),
)


def create_strategy():
    return STRATEGY
