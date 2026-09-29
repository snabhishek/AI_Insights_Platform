"""CPU optimization strategy: csv_reader_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='csv_reader_optimization',
    category='data_pipeline',
    description='Apply csv reader optimization.',
    transform=set_if_absent('csv_reader_optimization', True),
    tags=("cpu", 'data_pipeline'),
)


def create_strategy():
    return STRATEGY
