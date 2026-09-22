"""GPU optimization strategy: automatic_mixed_precision."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='automatic_mixed_precision',
    category='precision',
    description='Apply automatic mixed precision.',
    transform=set_if_absent('automatic_mixed_precision', True),
    tags=("gpu", 'precision'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
