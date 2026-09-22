from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='temporary_buffer_optimization', category='memory', description='Apply temporary buffer optimization', transform=set_if_absent('temporary_buffer_optimization', True), tags=('memory', 'common'))

def create_strategy():
    return STRATEGY
