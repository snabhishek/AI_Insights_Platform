from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='feature_sparsity_optimization', category='data', description='Apply feature sparsity optimization', transform=set_if_absent('feature_sparsity_optimization', True), tags=('data', 'common'))

def create_strategy():
    return STRATEGY
