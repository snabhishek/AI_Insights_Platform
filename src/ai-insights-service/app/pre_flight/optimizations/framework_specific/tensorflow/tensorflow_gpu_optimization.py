"""Framework-specific strategy: tensorflow_gpu_optimization."""

from .._shared import clone_strategy, make_strategy

STRATEGY = make_strategy(
    name='tensorflow_gpu_optimization',
    framework='tensorflow',
    description='Optimize TensorFlow GPU execution and memory growth.',
    category='gpu',
    defaults={'memory_growth': True, 'allow_growth': True},
    tags=["tensorflow", "gpu", "optimization"],
)


def create_strategy():
    """Return an independent copy of this strategy definition."""
    return clone_strategy(STRATEGY)
