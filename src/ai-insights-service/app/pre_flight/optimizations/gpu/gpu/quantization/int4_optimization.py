"""GPU optimization strategy: int4_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='int4_optimization',
    category='quantization',
    description='Apply int4 optimization.',
    transform=set_if_absent('quantization_bits', 4),
    tags=("gpu", 'quantization'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
