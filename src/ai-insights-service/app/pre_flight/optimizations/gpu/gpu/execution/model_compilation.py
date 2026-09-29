"""GPU optimization strategy: model_compilation."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='model_compilation',
    category='execution',
    description='Apply model compilation.',
    transform=set_if_absent('model_compilation', True),
    tags=("gpu", 'execution'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
