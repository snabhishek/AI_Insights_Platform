from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='cost_aware_optimization', category='resource_management', description='Apply cost aware optimization', transform=set_if_absent('cost_aware_optimization', True), tags=('resource_management', 'common'))

def create_strategy():
    return STRATEGY
