"""CPU optimization strategy: oversubscription_control."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='oversubscription_control',
    category='execution',
    description='Apply oversubscription control.',
    transform=set_if_absent('oversubscription_control', True),
    tags=("cpu", 'execution'),
)


def create_strategy():
    return STRATEGY
