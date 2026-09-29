from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='checkpoint_memory_management', category='memory', description='Apply checkpoint memory management', transform=set_if_absent('checkpoint_memory_management', True), tags=('memory', 'common'))

def create_strategy():
    return STRATEGY
