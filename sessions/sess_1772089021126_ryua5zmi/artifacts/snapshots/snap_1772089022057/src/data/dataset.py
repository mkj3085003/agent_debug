from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List


@dataclass
class DatasetExample:
    n_qubits: int
    qasm: str
    tableau_final: List[List[int]]
    tableau_canonical: List[List[int]]
    metadata: Dict[str, Any]


def load_json(path: str) -> List[Dict[str, Any]]:
    with open(path, "r") as f:
        return json.load(f)


def save_json(path: str, data: Iterable[Dict[str, Any]]) -> None:
    with open(path, "w") as f:
        json.dump(list(data), f, indent=2)
