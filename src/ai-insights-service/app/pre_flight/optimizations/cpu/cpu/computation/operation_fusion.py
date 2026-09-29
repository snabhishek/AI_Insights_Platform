"""CPU optimization strategy: operation_fusion."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='operation_fusion',
    category='computation',
    description='Apply operation fusion.',
    transform=set_if_absent('operation_fusion', True),
    tags=("cpu", 'computation'),
)


def create_strategy():
    return STRATEGY
