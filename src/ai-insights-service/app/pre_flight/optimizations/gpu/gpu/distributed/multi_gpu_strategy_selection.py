"""GPU optimization strategy: multi_gpu_strategy_selection."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='multi_gpu_strategy_selection',
    category='distributed',
    description='Apply multi gpu strategy selection.',
    transform=set_if_absent('multi_gpu_strategy', 'auto'),
    tags=("gpu", 'distributed'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
