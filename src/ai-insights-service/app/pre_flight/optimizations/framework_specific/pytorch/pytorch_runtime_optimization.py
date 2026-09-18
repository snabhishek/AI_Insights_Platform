"""Framework-specific strategy: pytorch_runtime_optimization."""

from .._shared import clone_strategy, make_strategy

STRATEGY = make_strategy(
    name='pytorch_runtime_optimization',
    framework='pytorch',
    description='Optimize PyTorch runtime configuration.',
    category='runtime',
    defaults={'inference_mode': True, 'benchmark_mode': False},
    tags=["pytorch", "runtime", "optimization"],
)


def create_strategy():
    """Return an independent copy of this strategy definition."""
    return clone_strategy(STRATEGY)
