"""CPU optimization strategy: parquet_reader_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='parquet_reader_optimization',
    category='data_pipeline',
    description='Apply parquet reader optimization.',
    transform=set_if_absent('parquet_reader_optimization', True),
    tags=("cpu", 'data_pipeline'),
)


def create_strategy():
    return STRATEGY
