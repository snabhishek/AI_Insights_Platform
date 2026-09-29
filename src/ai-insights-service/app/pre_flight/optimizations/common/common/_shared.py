from dataclasses import dataclass, field
from copy import deepcopy
from typing import Any, Callable, Mapping, MutableMapping, Optional

Transform = Callable[[MutableMapping[str, Any], 'OptimizationContext'], Mapping[str, Any]]

@dataclass(frozen=True)
class OptimizationSpec:
    name: str
    category: str
    description: str
    priority: int = 50
    risk: str = 'low'
    accuracy_risk: str = 'low'
    supported_frameworks: tuple[str, ...] = ('generic',)
    required_capabilities: tuple[str, ...] = ()
    dependencies: tuple[str, ...] = ()
    conflicts: tuple[str, ...] = ()
    tags: tuple[str, ...] = ()

@dataclass
class OptimizationContext:
    config: MutableMapping[str, Any]
    system: Mapping[str, Any] = field(default_factory=dict)
    dataset: Mapping[str, Any] = field(default_factory=dict)
    model: Mapping[str, Any] = field(default_factory=dict)
    runtime: Mapping[str, Any] = field(default_factory=dict)
    metrics: Mapping[str, Any] = field(default_factory=dict)
    framework: str = 'generic'
    dry_run: bool = False

@dataclass
class OptimizationResult:
    optimization: str
    applied: bool
    changed: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    details: dict[str, Any] = field(default_factory=dict)

class OptimizationStrategy:
    def __init__(self, spec: OptimizationSpec, transform: Optional[Transform]):
        self.spec = spec
        self._transform = transform

    def is_applicable(self, context: OptimizationContext) -> bool:
        frameworks = set(self.spec.supported_frameworks)
        if frameworks and 'generic' not in frameworks and context.framework not in frameworks:
            return False
        return set(self.spec.required_capabilities).issubset(set(context.system.get('capabilities', ())))

    def apply(self, context: OptimizationContext) -> OptimizationResult:
        if not self.is_applicable(context):
            return OptimizationResult(self.spec.name, False, warnings=['Optimization is not applicable.'])
        if self._transform is None:
            return OptimizationResult(self.spec.name, False, warnings=['No transformation configured.'])
        before = deepcopy(dict(context.config))
        try:
            updates = dict(self._transform(context.config, context))
        except (TypeError, ValueError, KeyError, OverflowError) as exc:
            return OptimizationResult(self.spec.name, False, errors=[f'Transformation failed: {exc}'])
        changed = {k: v for k, v in updates.items() if before.get(k) != v}
        if not context.dry_run:
            context.config.update(changed)
        return OptimizationResult(self.spec.name, bool(changed), changed, details={'dry_run': context.dry_run})

def create_strategy(*, name, category, description, transform, priority=50, risk='low', accuracy_risk='low', supported_frameworks=('generic',), required_capabilities=(), dependencies=(), conflicts=(), tags=()):
    if not name.strip():
        raise ValueError('Optimization name cannot be empty.')
    return OptimizationStrategy(OptimizationSpec(name, category, description, priority, risk, accuracy_risk, tuple(supported_frameworks), tuple(required_capabilities), tuple(dependencies), tuple(conflicts), tuple(tags)), transform)

def set_if_absent(key, value):
    def transform(config, context):
        return {} if key in config else {key: value}
    return transform
