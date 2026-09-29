"""Implementation metadata for resource_reestimator."""

from ._shared import make_strategy, clone_strategy

STRATEGY = make_strategy(
    name='resource_reestimator',
    group='validation',
    description='Optimization validation and preflight strategy.',
    defaults={"enabled": False},
)

def create_strategy():
    """Return an independent copy of the strategy definition."""
    return clone_strategy(STRATEGY)
