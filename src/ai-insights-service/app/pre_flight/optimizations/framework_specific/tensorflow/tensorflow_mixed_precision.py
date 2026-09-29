"""Framework-specific strategy: tensorflow_mixed_precision."""

from .._shared import clone_strategy, make_strategy

STRATEGY = make_strategy(
    name='tensorflow_mixed_precision',
    framework='tensorflow',
    description='Configure TensorFlow mixed precision.',
    category='precision',
    defaults={'enabled': False, 'policy': 'mixed_float16'},
    tags=["tensorflow", "precision", "optimization"],
)


def create_strategy():
    """Return an independent copy of this strategy definition."""
    return clone_strategy(STRATEGY)
