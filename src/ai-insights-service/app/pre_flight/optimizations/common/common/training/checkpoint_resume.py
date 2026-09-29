from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='checkpoint_resume', category='training', description='Apply checkpoint resume', transform=set_if_absent('checkpoint_resume', True), tags=('training', 'common'))

def create_strategy():
    return STRATEGY
