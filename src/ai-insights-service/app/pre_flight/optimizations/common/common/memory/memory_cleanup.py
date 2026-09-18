from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='memory_cleanup', category='memory', description='Apply memory cleanup', transform=set_if_absent('memory_cleanup', True), tags=('memory', 'common'))

def create_strategy():
    return STRATEGY
