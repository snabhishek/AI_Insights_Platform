from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='parameter_efficient_finetuning', category='model', description='Apply parameter efficient finetuning', transform=set_if_absent('parameter_efficient_finetuning', True), tags=('model', 'common'))

def create_strategy():
    return STRATEGY
