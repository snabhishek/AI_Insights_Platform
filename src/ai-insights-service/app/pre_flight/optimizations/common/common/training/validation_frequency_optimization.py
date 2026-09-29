from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='validation_frequency_optimization', category='training', description='Apply validation frequency optimization', transform=set_if_absent('validation_frequency_optimization', True), tags=('training', 'common'))

def create_strategy():
    return STRATEGY
