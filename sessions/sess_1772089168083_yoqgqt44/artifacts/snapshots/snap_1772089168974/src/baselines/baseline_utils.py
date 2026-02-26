from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional, Sequence


def load_dataset(path: str) -> List[Dict[str, Any]]:
    with open(path, "r") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError("Dataset must be a list of samples.")
    return data


def parse_table_output(text: str) -> Optional[List[List[int]]]:
    cleaned = text.strip()
    if not cleaned:
        return None

    # Try JSON array
    if cleaned.startswith("["):
        try:
            obj = json.loads(cleaned)
            if isinstance(obj, list) and all(isinstance(row, list) for row in obj):
                return [[int(v) for v in row] for row in obj]
        except json.JSONDecodeError:
            pass

    # Fallback: parse lines of comma/space separated ints
    rows: List[List[int]] = []
    for line in cleaned.splitlines():
        line = line.strip().strip("[]").strip()
        if not line:
            continue
        if not re.search(r"\d", line):
            continue
        if "," in line:
            parts = [p.strip() for p in line.split(",") if p.strip()]
        else:
            parts = [p.strip() for p in line.split() if p.strip()]
        try:
            rows.append([int(p) for p in parts])
        except ValueError:
            continue

    return rows or None


def select_fewshot_examples(
    dataset: Sequence[Dict[str, Any]],
    count: int,
) -> List[Dict[str, Any]]:
    return list(dataset[:count])
