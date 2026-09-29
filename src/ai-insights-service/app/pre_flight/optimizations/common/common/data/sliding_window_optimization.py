from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='sliding_window_optimization', category='data', description='Apply sliding window optimization', transform=set_if_absent('sliding_window_optimization', True), tags=('data', 'common'))

def create_strategy():
    return STRATEGY
