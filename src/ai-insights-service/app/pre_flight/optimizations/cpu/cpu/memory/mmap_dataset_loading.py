"""CPU optimization strategy: mmap_dataset_loading."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='mmap_dataset_loading',
    category='memory',
    description='Apply mmap dataset loading.',
    transform=set_if_absent('mmap_dataset_loading', True),
    tags=("cpu", 'memory'),
)


def create_strategy():
    return STRATEGY
