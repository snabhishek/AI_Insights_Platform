from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='padding_optimization', category='data', description='Apply padding optimization', transform=set_if_absent('padding_strategy', 'dynamic'), tags=('data', 'common'))

def create_strategy():
    return STRATEGY
