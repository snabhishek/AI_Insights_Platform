from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='optimizer_state_reduction', category='training', description='Apply optimizer state reduction', transform=set_if_absent('optimizer_state_reduction', True), tags=('training', 'common'))

def create_strategy():
    return STRATEGY
