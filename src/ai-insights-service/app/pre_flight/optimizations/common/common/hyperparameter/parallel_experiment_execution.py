from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='parallel_experiment_execution', category='hyperparameter', description='Apply parallel experiment execution', transform=set_if_absent('parallel_experiment_execution', True), tags=('hyperparameter', 'common'))

def create_strategy():
    return STRATEGY
