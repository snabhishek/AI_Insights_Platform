from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='data_prefetching', category='data', description='Apply data prefetching', transform=set_if_absent('data_prefetching', True), tags=('data', 'common'))

def create_strategy():
    return STRATEGY
