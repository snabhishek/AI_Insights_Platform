from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='knowledge_distillation', category='model', description='Apply knowledge distillation', transform=set_if_absent('knowledge_distillation', True), tags=('model', 'common'))

def create_strategy():
    return STRATEGY
