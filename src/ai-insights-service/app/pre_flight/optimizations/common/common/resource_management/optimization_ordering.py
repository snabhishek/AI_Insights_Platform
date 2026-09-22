from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='optimization_ordering', category='resource_management', description='Apply optimization ordering', transform=set_if_absent('optimization_ordering', True), tags=('resource_management', 'common'))

def create_strategy():
    return STRATEGY
