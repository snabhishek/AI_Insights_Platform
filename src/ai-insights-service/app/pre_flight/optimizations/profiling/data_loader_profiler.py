"""Implementation metadata for data_loader_profiler."""

from ._shared import make_strategy, clone_strategy

STRATEGY = make_strategy(
    name='data_loader_profiler',
    group='profiling',
    description='Performance and resource profiling strategy.',
    defaults={"enabled": False},
)

def create_strategy():
    """Return an independent copy of the strategy definition."""
    return clone_strategy(STRATEGY)
