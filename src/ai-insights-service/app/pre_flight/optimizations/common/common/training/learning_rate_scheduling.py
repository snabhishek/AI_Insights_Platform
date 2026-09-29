from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='learning_rate_scheduling', category='training', description='Apply learning rate scheduling', transform=set_if_absent('learning_rate_scheduling', True), tags=('training', 'common'))

def create_strategy():
    return STRATEGY
