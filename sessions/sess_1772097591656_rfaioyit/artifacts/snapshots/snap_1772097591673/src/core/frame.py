from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Sequence, Tuple

import cmath
import math
import numpy as np

from .solver import GateOp, apply_cx, apply_h, apply_s
from .state_repr import StateRepresentation
from ..data.canonicalize import canonicalize_tableau


@dataclass
class FrameTerm:
    coeff: complex
    table: np.ndarray


@dataclass
class StabilizerFrame(StateRepresentation):
    """Stabilizer-frame representation for circuits with T gates."""

    terms: List[FrameTerm]
    amplitude_cutoff: float = 1e-12

    @classmethod
    def from_table(
        cls,
        table: Sequence[Sequence[int]],
        amplitude_cutoff: float = 1e-12,
    ) -> "StabilizerFrame":
        array = np.array(table, dtype=int)
        if array.ndim != 2 or array.shape[1] < 3:
            raise ValueError("Invalid stabilizer table shape.")
        return cls([FrameTerm(1 + 0j, array)], amplitude_cutoff)

    @property
    def n_qubits(self) -> int:
        if not self.terms:
            return 0
        return (self.terms[0].table.shape[1] - 1) // 2

    def apply_gate(self, gate_op: Tuple[str, List[int]]) -> None:
        gate, qubits = gate_op
        if gate == "h":
            for term in self.terms:
                apply_h(term.table, qubits[0])
        elif gate == "s":
            for term in self.terms:
                apply_s(term.table, qubits[0])
        elif gate in {"cx", "cnot"}:
            for term in self.terms:
                apply_cx(term.table, qubits[0], qubits[1])
        elif gate == "t":
            self._apply_t(qubits[0])
        else:
            raise ValueError(f"Unsupported gate: {gate}")

    def apply_circuit(self, gate_ops: Sequence[GateOp]) -> None:
        for gate_op in gate_ops:
            self.apply_gate(gate_op)

    def to_canonical(self) -> None:
        for term in self.terms:
            term.table = np.array(canonicalize_tableau(term.table.tolist()), dtype=int)
        self.terms = self._merge_terms(self.terms)

    def serialize(self) -> List[Dict[str, object]]:
        return [
            {
                "coeff": [term.coeff.real, term.coeff.imag],
                "table": term.table.tolist(),
            }
            for term in self.terms
        ]

    def metadata(self) -> Dict[str, Any]:
        return {"n_qubits": self.n_qubits, "n_terms": len(self.terms)}

    def _apply_t(self, qubit: int) -> None:
        phase = cmath.exp(1j * math.pi / 4)
        coeff_a = (1 + phase) / 2
        coeff_b = (1 - phase) / 2

        branched: List[FrameTerm] = []
        for term in self.terms:
            branched.append(FrameTerm(term.coeff * coeff_a, term.table.copy()))

            z_table = term.table.copy()
            apply_s(z_table, qubit)
            apply_s(z_table, qubit)
            branched.append(FrameTerm(term.coeff * coeff_b, z_table))

        self.terms = self._merge_terms(branched)

    def _merge_terms(self, terms: Sequence[FrameTerm]) -> List[FrameTerm]:
        merged: Dict[bytes, FrameTerm] = {}
        for term in terms:
            if abs(term.coeff) < self.amplitude_cutoff:
                continue
            key = term.table.tobytes()
            if key in merged:
                merged[key].coeff += term.coeff
            else:
                merged[key] = FrameTerm(term.coeff, term.table)
        return [term for term in merged.values() if abs(term.coeff) >= self.amplitude_cutoff]
