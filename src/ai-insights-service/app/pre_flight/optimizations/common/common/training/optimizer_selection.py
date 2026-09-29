from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='optimizer_selection', category='training', description='Apply optimizer selection', transform=set_if_absent('optimizer', 'adamw'), tags=('training', 'common'))

def create_strategy():
    return STRATEGY
