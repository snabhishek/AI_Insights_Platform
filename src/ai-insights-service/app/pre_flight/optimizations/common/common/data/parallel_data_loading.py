from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='parallel_data_loading', category='data', description='Apply parallel data loading', transform=set_if_absent('num_workers', 2), tags=('data', 'common'))

def create_strategy():
    return STRATEGY
