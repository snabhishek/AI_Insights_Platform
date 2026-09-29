"""CPU optimization strategy: cpu_load_balancing."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cpu_load_balancing',
    category='scheduling',
    description='Apply cpu load balancing.',
    transform=set_if_absent('cpu_load_balancing', True),
    tags=("cpu", 'scheduling'),
)


def create_strategy():
    return STRATEGY
