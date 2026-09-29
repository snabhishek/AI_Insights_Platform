"""CPU optimization strategy: cpu_resource_reservation."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cpu_resource_reservation',
    category='scheduling',
    description='Apply cpu resource reservation.',
    transform=set_if_absent('cpu_resource_reservation', True),
    tags=("cpu", 'scheduling'),
)


def create_strategy():
    return STRATEGY
