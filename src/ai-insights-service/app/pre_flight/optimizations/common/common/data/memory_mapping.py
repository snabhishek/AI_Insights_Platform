from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='memory_mapping', category='data', description='Apply memory mapping', transform=set_if_absent('memory_mapping', True), tags=('data', 'common'))

def create_strategy():
    return STRATEGY
