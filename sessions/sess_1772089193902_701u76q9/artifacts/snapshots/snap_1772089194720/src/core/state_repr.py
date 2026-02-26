from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Sequence, Tuple


class StateRepresentation(ABC):
    """Abstract quantum state representation.

    English:
        Implementations should be deterministic and support canonicalization.
        This interface allows different state backends to be used uniformly.
    中文：
        量子态表示的抽象基类。
        实现应是确定性的，并支持规范化处理，便于统一调用不同后端。
    """

    @abstractmethod
    def apply_gate(self, gate_op: Tuple[str, List[int]]) -> None:
        """Apply a single gate operation to the state.

        English:
            gate_op is a tuple like ("h", [0]) or ("cx", [0, 1]).
        中文：
            对状态应用一个门操作。
            gate_op 形如 ("h", [0]) 或 ("cx", [0, 1])。
        """
        raise NotImplementedError

    @abstractmethod
    def apply_circuit(self, gate_ops: Sequence[Tuple[str, List[int]]]) -> None:
        """Apply a sequence of gate operations.

        English:
            Implementations should apply in order.
        中文：
            对一串门操作按顺序依次应用。
        """
        raise NotImplementedError

    @abstractmethod
    def to_canonical(self) -> None:
        """Convert the internal state to a canonical form.

        English:
            Canonicalization enables consistent comparisons/serialization.
        中文：
            将内部状态规范化，便于一致的比较与序列化。
        """
        raise NotImplementedError

    @abstractmethod
    def serialize(self) -> List[List[int]]:
        """Serialize the state into a portable, JSON-friendly structure.

        English:
            For tableau states this is typically a 2D integer list.
        中文：
            将状态序列化为可传输结构（如 JSON 友好的形式）。
            对稳定子表通常为二维整数列表。
        """
        raise NotImplementedError

    @abstractmethod
    def metadata(self) -> Dict[str, Any]:
        """Return lightweight metadata for inspection.

        English:
            Example: number of qubits, number of rows, etc.
        中文：
            返回轻量级元信息，例如量子比特数、行数等。
        """
        raise NotImplementedError
