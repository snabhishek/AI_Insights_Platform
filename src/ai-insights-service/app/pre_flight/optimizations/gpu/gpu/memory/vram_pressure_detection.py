"""GPU optimization strategy: vram_pressure_detection."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='vram_pressure_detection',
    category='memory',
    description='Apply vram pressure detection.',
    transform=set_if_absent('vram_pressure_detection', True),
    tags=("gpu", 'memory'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
