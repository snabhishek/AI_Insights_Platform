"""CPU optimization strategy: openblas_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='openblas_optimization',
    category='numerical_backends',
    description='Apply openblas optimization.',
    transform=set_if_absent('openblas_optimization', True),
    tags=("cpu", 'numerical_backends'),
)


def create_strategy():
    return STRATEGY
