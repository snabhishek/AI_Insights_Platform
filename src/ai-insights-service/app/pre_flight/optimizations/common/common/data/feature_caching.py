from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='feature_caching', category='data', description='Apply feature caching', transform=set_if_absent('feature_caching', True), tags=('data', 'common'))

def create_strategy():
    return STRATEGY
