from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='accuracy_preserving_optimization', category='resource_management', description='Apply accuracy preserving optimization', transform=set_if_absent('accuracy_preserving_optimization', True), tags=('resource_management', 'common'))

def create_strategy():
    return STRATEGY
