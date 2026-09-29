from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='constraint_based_optimization', category='resource_management', description='Apply constraint based optimization', transform=set_if_absent('constraint_based_optimization', True), tags=('resource_management', 'common'))

def create_strategy():
    return STRATEGY
