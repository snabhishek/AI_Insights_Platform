"""GPU optimization strategy: pinned_memory."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='pinned_memory',
    category='data_transfer',
    description='Apply pinned memory.',
    transform=set_if_absent('pin_memory', True),
    tags=("gpu", 'data_transfer'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
