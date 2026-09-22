from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='logging_optimization', category='training', description='Apply logging optimization', transform=set_if_absent('logging_steps', 100), tags=('training', 'common'))

def create_strategy():
    return STRATEGY
