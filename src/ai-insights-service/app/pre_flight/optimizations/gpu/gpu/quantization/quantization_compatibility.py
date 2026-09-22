"""GPU optimization strategy: quantization_compatibility."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='quantization_compatibility',
    category='quantization',
    description='Apply quantization compatibility.',
    transform=set_if_absent('quantization_compatibility_check', True),
    tags=("gpu", 'quantization'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
