"""Framework-specific strategy: tensorflow_xla_optimization."""

from .._shared import clone_strategy, make_strategy

STRATEGY = make_strategy(
    name='tensorflow_xla_optimization',
    framework='tensorflow',
    description='Configure XLA compilation for TensorFlow.',
    category='compilation',
    defaults={'enabled': False, 'jit_compile': False},
    tags=["tensorflow", "compilation", "optimization"],
)


def create_strategy():
    """Return an independent copy of this strategy definition."""
    return clone_strategy(STRATEGY)
