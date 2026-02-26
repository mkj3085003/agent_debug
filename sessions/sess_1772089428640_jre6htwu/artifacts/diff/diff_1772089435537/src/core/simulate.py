from __future__ import annotations

from typing import Sequence

from .solver import GateOp, parse_qasm_to_gate_ops
from .state_repr import StateRepresentation
from .tableau import TableauState
from .frame import StabilizerFrame


def _needs_frame(gate_ops: Sequence[GateOp]) -> bool:
    return any(gate == "t" for gate, _ in gate_ops)


def simulate_gate_ops(
    initial_table: Sequence[Sequence[int]],
    gate_ops: Sequence[GateOp],
    canonicalize: bool = True,
) -> StateRepresentation:
    """Simulate a circuit using TableauState or StabilizerFrame.

    English:
        Uses TableauState for Clifford-only circuits and switches to
        StabilizerFrame if a T gate is present.
    """
    if _needs_frame(gate_ops):
        state: StateRepresentation = StabilizerFrame.from_table(initial_table)
    else:
        state = TableauState.from_table(initial_table)

    state.apply_circuit(gate_ops)
    if canonicalize:
        state.to_canonical()
    return state


def simulate_qasm(
    initial_table: Sequence[Sequence[int]],
    qasm: str,
    canonicalize: bool = True,
) -> StateRepresentation:
    """Parse QASM and simulate with the appropriate backend."""
    gate_ops = parse_qasm_to_gate_ops(qasm)
    return simulate_gate_ops(initial_table, gate_ops, canonicalize=canonicalize)
