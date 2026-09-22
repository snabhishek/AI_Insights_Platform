from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='trial_pruning', category='hyperparameter', description='Apply trial pruning', transform=set_if_absent('trial_pruning', True), tags=('hyperparameter', 'common'))

def create_strategy():
    return STRATEGY
