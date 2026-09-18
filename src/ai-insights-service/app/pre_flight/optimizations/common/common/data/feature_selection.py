from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='feature_selection', category='data', description='Apply feature selection', transform=set_if_absent('feature_selection', True), tags=('data', 'common'))

def create_strategy():
    return STRATEGY
