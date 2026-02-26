from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Sequence, Tuple

import numpy as np

from .solver import GateOp, apply_cx, apply_h, apply_s
from .state_repr import StateRepresentation
from ..data.canonicalize import canonicalize_tableau


@dataclass
class TableauState(StateRepresentation):
    """Stabilizer tableau state for Clifford circuits.

    English:
        Provides an in-memory tableau representation and gate updates.
    中文：
        用稳定子表表示 Clifford 电路的量子态，并提供门更新。
    """

    table: np.ndarray

    @classmethod
    def from_table(cls, table: Sequence[Sequence[int]]) -> "TableauState":
        """Create a TableauState from a 2D integer table.

        English:
            Validates shape and converts to a numpy array.
        中文：
            从二维整数表创建 TableauState，
            会校验形状并转换为 numpy 数组。
        """
        array = np.array(table, dtype=int)
        if array.ndim != 2 or array.shape[1] < 3:
            raise ValueError("Invalid stabilizer table shape.")
        return cls(array)

    @property
    def n_qubits(self) -> int:
        """Return the number of qubits inferred from the tableau width.

        English:
            For an n-qubit tableau, width = 2n + 1.
        中文：
            由表宽度推断量子比特数：
            n-qubit 表宽为 2n + 1。
        """
        return (self.table.shape[1] - 1) // 2

    def apply_gate(self, gate_op: Tuple[str, List[int]]) -> None:
        """Apply a single Clifford gate to this tableau.

        English:
            Supports "h", "s", "cx"/"cnot".
        中文：
            对该表应用单个 Clifford 门，
            支持 "h"、"s"、"cx"/"cnot"。
        """
        gate, qubits = gate_op
        if gate == "h":
            apply_h(self.table, qubits[0])
        elif gate == "s":
            apply_s(self.table, qubits[0])
        elif gate in {"cx", "cnot"}:
            apply_cx(self.table, qubits[0], qubits[1])
        else:
            raise ValueError(f"Unsupported gate: {gate}")

    def apply_circuit(self, gate_ops: Sequence[GateOp]) -> None:
        """Apply a sequence of gates to this tableau.

        English:
            Gates are applied in order using apply_gate.
        中文：
            按顺序应用门序列，内部调用 apply_gate。
        """
        for gate_op in gate_ops:
            self.apply_gate(gate_op)

    def to_canonical(self) -> None:
        """Canonicalize the tableau.

        English:
            Delegates to data.canonicalize and replaces the internal table.
        中文：
            进行表的规范化处理，
            调用 data.canonicalize 并替换内部表。
        """
        self.table = np.array(canonicalize_tableau(self.table.tolist()), dtype=int)

    def serialize(self) -> List[List[int]]:
        """Serialize the tableau to a Python list of lists.

        English:
            Useful for JSON output or storage.
        中文：
            序列化为二维列表，便于 JSON 输出或存储。
        """
        return self.table.tolist()

    def metadata(self) -> Dict[str, int]:
        """Return basic metadata about the tableau.

        English:
            Includes number of qubits and number of rows.
        中文：
            返回基本元信息，包括量子比特数和行数。
        """
        return {"n_qubits": self.n_qubits, "n_rows": int(self.table.shape[0])}
