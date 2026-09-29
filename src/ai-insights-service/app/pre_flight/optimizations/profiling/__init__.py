"""Optimization group package."""

from .registry import STRATEGIES, get_strategy, load_strategies

__all__ = ["STRATEGIES", "get_strategy", "load_strategies"]
