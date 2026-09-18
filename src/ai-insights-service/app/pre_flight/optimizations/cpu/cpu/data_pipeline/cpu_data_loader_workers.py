"""CPU optimization strategy: cpu_data_loader_workers."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cpu_data_loader_workers',
    category='data_pipeline',
    description='Apply cpu data loader workers.',
    transform=set_if_absent('cpu_data_loader_workers', 'auto'),
    tags=("cpu", 'data_pipeline'),
)


def create_strategy():
    return STRATEGY
