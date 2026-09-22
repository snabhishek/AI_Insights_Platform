"""GPU optimization strategy: mixed_precision_training."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='mixed_precision_training',
    category='precision',
    description='Apply mixed precision training.',
    transform=set_if_absent('mixed_precision', True),
    tags=("gpu", 'precision'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
