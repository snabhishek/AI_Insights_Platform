from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='reproducibility_optimization', category='training', description='Apply reproducibility optimization', transform=set_if_absent('reproducibility_optimization', True), tags=('training', 'common'))

def create_strategy():
    return STRATEGY
