from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='framework_specific_optimization', category='model', description='Apply framework specific optimization', transform=set_if_absent('framework_specific_optimization', True), tags=('model', 'common'))

def create_strategy():
    return STRATEGY
