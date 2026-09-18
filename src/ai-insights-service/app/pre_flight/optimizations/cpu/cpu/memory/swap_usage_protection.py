"""CPU optimization strategy: swap_usage_protection."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='swap_usage_protection',
    category='memory',
    description='Apply swap usage protection.',
    transform=set_if_absent('swap_usage_protection', True),
    tags=("cpu", 'memory'),
)


def create_strategy():
    return STRATEGY
