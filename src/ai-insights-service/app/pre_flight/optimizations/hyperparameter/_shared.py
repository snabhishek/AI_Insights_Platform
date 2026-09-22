"""Shared helpers for this optimization group."""
from copy import deepcopy

def make_strategy(name, group, description, defaults=None):
    return {
        "name": name,
        "group": group,
        "description": description,
        "defaults": deepcopy(defaults or {}),
    }

def clone_strategy(strategy):
    return deepcopy(strategy)
