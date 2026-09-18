from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='data_sampling', category='data', description='Apply data sampling', transform=set_if_absent('data_sampling', True), tags=('data', 'common'))

def create_strategy():
    return STRATEGY
