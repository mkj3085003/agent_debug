from __future__ import annotations

from typing import List


def simple_qasm_tokenize(qasm: str) -> List[str]:
    """A minimal whitespace tokenizer for QASM."""
    return [token for token in qasm.replace(";", " ; ").split() if token]
