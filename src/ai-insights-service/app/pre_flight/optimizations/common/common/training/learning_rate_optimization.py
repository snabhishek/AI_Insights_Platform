from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='learning_rate_optimization', category='training', description='Apply learning rate optimization', transform=set_if_absent('learning_rate', 0.001), tags=('training', 'common'))

def create_strategy():
    return STRATEGY
