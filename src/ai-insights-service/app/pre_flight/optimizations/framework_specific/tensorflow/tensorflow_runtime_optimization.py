"""Framework-specific strategy: tensorflow_runtime_optimization."""

from .._shared import clone_strategy, make_strategy

STRATEGY = make_strategy(
    name='tensorflow_runtime_optimization',
    framework='tensorflow',
    description='Optimize TensorFlow runtime settings.',
    category='runtime',
    defaults={'intra_op_parallelism_threads': 0, 'inter_op_parallelism_threads': 0},
    tags=["tensorflow", "runtime", "optimization"],
)


def create_strategy():
    """Return an independent copy of this strategy definition."""
    return clone_strategy(STRATEGY)
