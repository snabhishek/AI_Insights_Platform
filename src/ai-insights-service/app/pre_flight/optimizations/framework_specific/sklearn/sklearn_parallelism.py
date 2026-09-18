"""Framework-specific strategy: sklearn_parallelism."""

from .._shared import clone_strategy, make_strategy

STRATEGY = make_strategy(
    name='sklearn_parallelism',
    framework='sklearn',
    description='Control scikit-learn parallel execution.',
    category='parallelism',
    defaults={'n_jobs': -1, 'backend': 'loky'},
    tags=["sklearn", "parallelism", "optimization"],
)


def create_strategy():
    """Return an independent copy of this strategy definition."""
    return clone_strategy(STRATEGY)
