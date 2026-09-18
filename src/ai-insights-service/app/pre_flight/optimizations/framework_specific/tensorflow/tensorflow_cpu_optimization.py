"""Framework-specific strategy: tensorflow_cpu_optimization."""

from .._shared import clone_strategy, make_strategy

STRATEGY = make_strategy(
    name='tensorflow_cpu_optimization',
    framework='tensorflow',
    description='Optimize TensorFlow CPU execution.',
    category='cpu',
    defaults={'oneDNN_enabled': True, 'intra_op_threads': 0, 'inter_op_threads': 0},
    tags=["tensorflow", "cpu", "optimization"],
)


def create_strategy():
    """Return an independent copy of this strategy definition."""
    return clone_strategy(STRATEGY)
