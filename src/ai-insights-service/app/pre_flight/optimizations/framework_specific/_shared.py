"""Shared helpers for framework-specific strategies."""

from copy import deepcopy


def make_strategy(name, framework, description, category, defaults=None, tags=None):
    """Create a consistent strategy definition."""
    return {
        "name": name,
        "framework": framework,
        "description": description,
        "category": category,
        "defaults": deepcopy(defaults or {}),
        "tags": list(tags or []),
    }


def clone_strategy(strategy):
    """Return an independent copy of a strategy definition."""
    return deepcopy(strategy)
