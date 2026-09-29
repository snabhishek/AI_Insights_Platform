from copy import deepcopy

def supplied_value(context, name):
    for source in (context.metadata, context.baseline, context.config):
        value = source.get(name)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0:
            return float(value)
    return None

def clone(value):
    return deepcopy(value)
