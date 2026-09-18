from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='data_type_optimization', category='data', description='Apply data type optimization', transform=set_if_absent('data_type_optimization', True), tags=('data', 'common'))

def create_strategy():
    return STRATEGY
