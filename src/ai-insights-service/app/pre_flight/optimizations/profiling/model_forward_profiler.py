"""Implementation metadata for model_forward_profiler."""

from ._shared import make_strategy, clone_strategy

STRATEGY = make_strategy(
    name='model_forward_profiler',
    group='profiling',
    description='Performance and resource profiling strategy.',
    defaults={"enabled": False},
)

def create_strategy():
    """Return an independent copy of the strategy definition."""
    return clone_strategy(STRATEGY)
