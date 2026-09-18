"""Implementation metadata for asha_search."""

from ._shared import make_strategy, clone_strategy

STRATEGY = make_strategy(
    name='asha_search',
    group='hyperparameter',
    description='Hyperparameter search and trial-management strategy.',
    defaults={"enabled": False},
)

def create_strategy():
    """Return an independent copy of the strategy definition."""
    return clone_strategy(STRATEGY)
