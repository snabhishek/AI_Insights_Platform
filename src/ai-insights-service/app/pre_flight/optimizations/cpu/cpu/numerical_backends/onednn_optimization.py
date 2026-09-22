"""CPU optimization strategy: onednn_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='onednn_optimization',
    category='numerical_backends',
    description='Apply onednn optimization.',
    transform=set_if_absent('onednn_optimization', True),
    tags=("cpu", 'numerical_backends'),
)


def create_strategy():
    return STRATEGY
