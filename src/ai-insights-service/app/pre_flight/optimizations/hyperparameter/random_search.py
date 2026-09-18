"""Implementation metadata for random_search."""

from ._shared import make_strategy, clone_strategy

STRATEGY = make_strategy(
    name='random_search',
    group='hyperparameter',
    description='Hyperparameter search and trial-management strategy.',
    defaults={"enabled": False},
)

def create_strategy():
    """Return an independent copy of the strategy definition."""
    return clone_strategy(STRATEGY)
