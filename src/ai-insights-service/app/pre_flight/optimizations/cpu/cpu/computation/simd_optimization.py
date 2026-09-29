"""CPU optimization strategy: simd_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='simd_optimization',
    category='computation',
    description='Apply simd optimization.',
    transform=set_if_absent('simd_optimization', True),
    tags=("cpu", 'computation'),
)


def create_strategy():
    return STRATEGY
