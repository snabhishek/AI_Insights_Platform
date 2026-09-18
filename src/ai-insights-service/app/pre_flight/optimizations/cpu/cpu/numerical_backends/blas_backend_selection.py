"""CPU optimization strategy: blas_backend_selection."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='blas_backend_selection',
    category='numerical_backends',
    description='Apply blas backend selection.',
    transform=set_if_absent('blas_backend_selection', True),
    tags=("cpu", 'numerical_backends'),
)


def create_strategy():
    return STRATEGY
