from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='feature_dimensionality_reduction', category='data', description='Apply feature dimensionality reduction', transform=set_if_absent('feature_dimensionality_reduction', True), tags=('data', 'common'))

def create_strategy():
    return STRATEGY
