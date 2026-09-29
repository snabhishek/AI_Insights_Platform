from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='io_optimization', category='data', description='Apply io optimization', transform=set_if_absent('io_optimization', True), tags=('data', 'common'))

def create_strategy():
    return STRATEGY
