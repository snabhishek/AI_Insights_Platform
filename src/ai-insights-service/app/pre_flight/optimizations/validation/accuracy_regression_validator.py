"""Implementation metadata for accuracy_regression_validator."""

from ._shared import make_strategy, clone_strategy

STRATEGY = make_strategy(
    name='accuracy_regression_validator',
    group='validation',
    description='Optimization validation and preflight strategy.',
    defaults={"enabled": False},
)

def create_strategy():
    """Return an independent copy of the strategy definition."""
    return clone_strategy(STRATEGY)
