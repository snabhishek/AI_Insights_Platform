"""Framework-specific strategy: pytorch_compile_optimization."""

from .._shared import clone_strategy, make_strategy

STRATEGY = make_strategy(
    name='pytorch_compile_optimization',
    framework='pytorch',
    description='Configure torch.compile safely for supported workloads.',
    category='compilation',
    defaults={'enabled': False, 'backend': 'inductor', 'mode': 'default'},
    tags=["pytorch", "compilation", "optimization"],
)


def create_strategy():
    """Return an independent copy of this strategy definition."""
    return clone_strategy(STRATEGY)
