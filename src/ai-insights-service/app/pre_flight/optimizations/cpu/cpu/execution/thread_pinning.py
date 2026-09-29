"""CPU optimization strategy: thread_pinning."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='thread_pinning',
    category='execution',
    description='Apply thread pinning.',
    transform=set_if_absent('thread_pinning', True),
    tags=("cpu", 'execution'),
)


def create_strategy():
    return STRATEGY
