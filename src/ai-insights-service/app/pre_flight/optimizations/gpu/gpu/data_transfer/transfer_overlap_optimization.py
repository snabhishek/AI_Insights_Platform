"""GPU optimization strategy: transfer_overlap_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='transfer_overlap_optimization',
    category='data_transfer',
    description='Apply transfer overlap optimization.',
    transform=set_if_absent('transfer_overlap_optimization', True),
    tags=("gpu", 'data_transfer'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
