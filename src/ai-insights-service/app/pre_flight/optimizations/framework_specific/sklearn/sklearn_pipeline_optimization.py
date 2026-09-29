"""Framework-specific strategy: sklearn_pipeline_optimization."""

from .._shared import clone_strategy, make_strategy

STRATEGY = make_strategy(
    name='sklearn_pipeline_optimization',
    framework='sklearn',
    description='Optimize scikit-learn pipeline execution and caching.',
    category='pipeline',
    defaults={'memory_cache_enabled': False, 'pre_dispatch': '2*n_jobs'},
    tags=["sklearn", "pipeline", "optimization"],
)


def create_strategy():
    """Return an independent copy of this strategy definition."""
    return clone_strategy(STRATEGY)
