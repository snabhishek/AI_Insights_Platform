"""CPU optimization strategy: cpu_prefetch_workers."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cpu_prefetch_workers',
    category='data_pipeline',
    description='Apply cpu prefetch workers.',
    transform=set_if_absent('cpu_prefetch_workers', 'auto'),
    tags=("cpu", 'data_pipeline'),
)


def create_strategy():
    return STRATEGY
