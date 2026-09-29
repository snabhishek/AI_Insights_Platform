"""GPU optimization strategy: bf16_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='bf16_optimization',
    category='precision',
    description='Apply bf16 optimization.',
    transform=set_if_absent('precision', 'bf16'),
    tags=("gpu", 'precision'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
