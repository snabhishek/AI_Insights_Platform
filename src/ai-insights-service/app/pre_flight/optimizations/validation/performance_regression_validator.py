"""Implementation metadata for performance_regression_validator."""

from ._shared import make_strategy, clone_strategy

STRATEGY = make_strategy(
    name='performance_regression_validator',
    group='validation',
    description='Optimization validation and preflight strategy.',
    defaults={"enabled": False},
)

def create_strategy():
    """Return an independent copy of the strategy definition."""
    return clone_strategy(STRATEGY)
