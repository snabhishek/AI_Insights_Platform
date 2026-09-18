"""GPU optimization strategy: multi_gpu_batch_distribution."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='multi_gpu_batch_distribution',
    category='distributed',
    description='Apply multi gpu batch distribution.',
    transform=set_if_absent('multi_gpu_batch_distribution', True),
    tags=("gpu", 'distributed'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
