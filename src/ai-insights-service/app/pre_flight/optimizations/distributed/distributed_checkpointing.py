"""Implementation metadata for distributed_checkpointing."""

from ._shared import make_strategy, clone_strategy

STRATEGY = make_strategy(
    name='distributed_checkpointing',
    group='distributed',
    description='Distributed training and multi-node execution strategy.',
    defaults={"enabled": False},
)

def create_strategy():
    """Return an independent copy of the strategy definition."""
    return clone_strategy(STRATEGY)
