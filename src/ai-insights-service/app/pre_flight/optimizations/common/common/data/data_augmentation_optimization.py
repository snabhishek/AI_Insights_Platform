from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='data_augmentation_optimization', category='data', description='Apply data augmentation optimization', transform=set_if_absent('data_augmentation_optimization', True), tags=('data', 'common'))

def create_strategy():
    return STRATEGY
