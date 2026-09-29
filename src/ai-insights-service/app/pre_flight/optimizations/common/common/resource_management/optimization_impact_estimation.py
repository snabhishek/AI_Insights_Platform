from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='optimization_impact_estimation', category='resource_management', description='Apply optimization impact estimation', transform=set_if_absent('optimization_impact_estimation', True), tags=('resource_management', 'common'))

def create_strategy():
    return STRATEGY
