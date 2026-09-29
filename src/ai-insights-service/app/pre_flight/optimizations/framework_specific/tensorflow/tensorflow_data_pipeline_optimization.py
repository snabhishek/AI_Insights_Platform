"""Framework-specific strategy: tensorflow_data_pipeline_optimization."""

from .._shared import clone_strategy, make_strategy

STRATEGY = make_strategy(
    name='tensorflow_data_pipeline_optimization',
    framework='tensorflow',
    description='Optimize tf.data input pipelines.',
    category='data_pipeline',
    defaults={'prefetch': 'AUTOTUNE', 'cache': False, 'num_parallel_calls': 'AUTOTUNE'},
    tags=["tensorflow", "data_pipeline", "optimization"],
)


def create_strategy():
    """Return an independent copy of this strategy definition."""
    return clone_strategy(STRATEGY)
