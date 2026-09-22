"""GPU optimization strategy: distributed_data_parallel."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='distributed_data_parallel',
    category='distributed',
    description='Apply distributed data parallel.',
    transform=set_if_absent('distributed_strategy', 'ddp'),
    tags=("gpu", 'distributed'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
