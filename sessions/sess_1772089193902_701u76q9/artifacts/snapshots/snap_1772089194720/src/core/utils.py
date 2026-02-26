from __future__ import annotations

from typing import List, Sequence, Tuple


def parse_gate_names_from_qasm(qasm: str) -> List[str]:
    """Extract gate names from an OpenQASM string.

    English:
        Returns a list of gate tokens found in the QASM text, normalized
        to "h", "s", "t", or "cx" (cnot is mapped to cx).
    中文：
        从 QASM 文本中提取门名列表，
        并规范化为 "h"、"s"、"t" 或 "cx"（cnot 会映射为 cx）。
    """
    gate_names: List[str] = []
    for line in qasm.splitlines():
        stripped = line.strip().lower()
        if not stripped or stripped.startswith("openqasm") or stripped.startswith("include"):
            continue
        if stripped.startswith("//"):
            continue
        token = stripped.split()[0]
        token = token.split("(")[0]
        if token.endswith(";"):
            token = token[:-1]
        if token in {"h", "s", "t", "cx", "cnot"}:
            gate_names.append("cx" if token == "cnot" else token)
    return gate_names


def format_table_as_lines(table: Sequence[Sequence[int]]) -> str:
    """Format a stabilizer table as newline-delimited rows with commas.

    English:
        Each row becomes a comma-separated line; useful for logs or files.
    中文：
        将每行格式化为逗号分隔的一行文本，
        适合日志或写入文本文件。
    """
    return "\n".join([",".join(map(str, row)) for row in table])


def normalize_gate_weights(gate_weights: Sequence[Tuple[str, float]]) -> List[Tuple[str, float]]:
    """Normalize a list of (gate, weight) pairs to sum to 1.

    English:
        Raises ValueError if the total weight is non-positive.
    中文：
        将 (门名, 权重) 列表归一化为总和 1，
        若权重总和不为正则抛出 ValueError。
    """
    total = sum(weight for _, weight in gate_weights)
    if total <= 0:
        raise ValueError("Gate weights must sum to a positive number.")
    return [(name, weight / total) for name, weight in gate_weights]
