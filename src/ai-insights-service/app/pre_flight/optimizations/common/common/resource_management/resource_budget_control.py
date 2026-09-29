from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='resource_budget_control', category='resource_management', description='Apply resource budget control', transform=set_if_absent('resource_budget_control', True), tags=('resource_management', 'common'))

def create_strategy():
    return STRATEGY
