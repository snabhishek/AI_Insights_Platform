from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='resource_aware_scheduling', category='resource_management', description='Apply resource aware scheduling', transform=set_if_absent('resource_aware_scheduling', True), tags=('resource_management', 'common'))

def create_strategy():
    return STRATEGY
