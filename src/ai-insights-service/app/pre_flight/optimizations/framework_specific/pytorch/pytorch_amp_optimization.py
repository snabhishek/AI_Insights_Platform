"""Framework-specific strategy: pytorch_amp_optimization."""

from .._shared import clone_strategy, make_strategy

STRATEGY = make_strategy(
    name='pytorch_amp_optimization',
    framework='pytorch',
    description='Configure PyTorch automatic mixed precision.',
    category='precision',
    defaults={'enabled': False, 'dtype': 'float16', 'gradient_scaling': True},
    tags=["pytorch", "precision", "optimization"],
)


def create_strategy():
    """Return an independent copy of this strategy definition."""
    return clone_strategy(STRATEGY)
