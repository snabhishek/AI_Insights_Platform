from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='out_of_memory_recovery', category='reliability', description='Apply out of memory recovery', transform=set_if_absent('out_of_memory_recovery', True), tags=('reliability', 'common'))

def create_strategy():
    return STRATEGY
