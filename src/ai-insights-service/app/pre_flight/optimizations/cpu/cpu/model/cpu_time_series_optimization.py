"""CPU optimization strategy: cpu_time_series_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cpu_time_series_optimization',
    category='model',
    description='Apply cpu time series optimization.',
    transform=set_if_absent('cpu_time_series_optimization', True),
    tags=("cpu", 'model'),
)


def create_strategy():
    return STRATEGY
