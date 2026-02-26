from __future__ import annotations

from typing import List, Tuple

from .solver import GateOp, parse_qasm_to_gate_ops


def parse_qasm(qasm: str) -> List[GateOp]:
    """Parse a minimal OpenQASM 3.0 subset into gate operations.

    English:
        Thin wrapper around solver.parse_qasm_to_gate_ops, kept to provide
        a stable API surface for the core module.
    中文：
        对 solver.parse_qasm_to_gate_ops 的轻量封装，
        便于 core 模块对外提供统一解析接口。
    """
    return parse_qasm_to_gate_ops(qasm)
