import json
from dataclasses import asdict
from .processes.preflight_pipeline import PreflightPipeline
if __name__ == '__main__':
    result = PreflightPipeline().run({
        'framework': 'pytorch',
        'resource_estimate': {
            'confidence': 'low'
        }
    })
    print(
        json.dumps(
            {
                k:
                asdict(v) if hasattr(v, '__dataclass_fields__') else
                [asdict(x) for x in v]
                for k, v in result.items()
            },
            indent=2,
            default=str))
