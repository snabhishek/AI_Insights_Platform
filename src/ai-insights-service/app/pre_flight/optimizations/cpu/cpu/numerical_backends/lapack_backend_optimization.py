"""CPU optimization strategy: lapack_backend_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='lapack_backend_optimization',
    category='numerical_backends',
    description='Apply lapack backend optimization.',
    transform=set_if_absent('lapack_backend_optimization', True),
    tags=("cpu", 'numerical_backends'),
)


def create_strategy():
    return STRATEGY
