"""GPU optimization strategy: gpu_batch_size_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='gpu_batch_size_optimization',
    category='memory',
    description='Apply gpu batch size optimization.',
    transform=set_if_absent('gpu_batch_size', 'auto'),
    tags=("gpu", 'memory'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
