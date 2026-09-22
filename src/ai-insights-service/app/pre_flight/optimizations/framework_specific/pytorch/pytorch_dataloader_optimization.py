"""Framework-specific strategy: pytorch_dataloader_optimization."""

from .._shared import clone_strategy, make_strategy

STRATEGY = make_strategy(
    name='pytorch_dataloader_optimization',
    framework='pytorch',
    description='Optimize PyTorch DataLoader workers and prefetching.',
    category='data_pipeline',
    defaults={'num_workers': 0, 'pin_memory': True, 'persistent_workers': False, 'prefetch_factor': 2},
    tags=["pytorch", "data_pipeline", "optimization"],
)


def create_strategy():
    """Return an independent copy of this strategy definition."""
    return clone_strategy(STRATEGY)
