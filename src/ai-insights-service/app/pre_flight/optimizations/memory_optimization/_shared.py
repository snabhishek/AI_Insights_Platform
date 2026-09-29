"""Shared helpers."""
from copy import deepcopy

def make_strategy(name, description, category, priority="medium", tags=(), defaults=None):
    return {
        "name": name,
        "description": description,
        "category": category,
        "priority": priority,
        "tags": list(tags),
        "defaults": deepcopy(defaults or {}),
    }

def clone_strategy(strategy):
    return deepcopy(strategy)
