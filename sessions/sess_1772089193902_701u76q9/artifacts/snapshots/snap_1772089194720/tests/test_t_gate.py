from src.core.frame import StabilizerFrame
from src.core.solver import parse_qasm_to_gate_ops


def test_parse_t_gate():
    qasm = "OPENQASM 3.0;\nqubit[1] q;\nt q[0];"
    ops = parse_qasm_to_gate_ops(qasm)
    assert ops == [("t", [0])]


def test_t_gate_on_zero_state():
    table = [[0, 1, 0]]
    frame = StabilizerFrame.from_table(table)
    frame.apply_gate(("t", [0]))
    frame.to_canonical()
    assert len(frame.terms) == 1
    coeff = frame.terms[0].coeff
    assert abs(coeff - 1.0) < 1e-9
