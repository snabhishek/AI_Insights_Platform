"""Framework-specific strategy: pytorch_distributed_optimization."""

from .._shared import clone_strategy, make_strategy

STRATEGY = make_strategy(
    name='pytorch_distributed_optimization',
    framework='pytorch',
    description='Configure PyTorch distributed training.',
    category='distributed',
    defaults={'enabled': False, 'backend': 'nccl', 'gradient_as_bucket_view': True},
    tags=["pytorch", "distributed", "optimization"],
)


def create_strategy():
    """Return an independent copy of this strategy definition."""
    return clone_strategy(STRATEGY)
