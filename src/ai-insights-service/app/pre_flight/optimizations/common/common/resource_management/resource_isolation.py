from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='resource_isolation', category='resource_management', description='Apply resource isolation', transform=set_if_absent('resource_isolation', True), tags=('resource_management', 'common'))

def create_strategy():
    return STRATEGY
