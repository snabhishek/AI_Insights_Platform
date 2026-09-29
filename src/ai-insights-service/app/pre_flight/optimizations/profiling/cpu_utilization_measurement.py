"""Implementation metadata for cpu_utilization_measurement."""

from ._shared import make_strategy, clone_strategy

STRATEGY = make_strategy(
    name='cpu_utilization_measurement',
    group='profiling',
    description='Performance and resource profiling strategy.',
    defaults={"enabled": False},
)

def create_strategy():
    """Return an independent copy of the strategy definition."""
    return clone_strategy(STRATEGY)
