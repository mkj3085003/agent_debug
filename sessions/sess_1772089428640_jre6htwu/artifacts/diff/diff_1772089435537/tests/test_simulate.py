from src.core.frame import StabilizerFrame
from src.core.simulate import simulate_gate_ops, simulate_qasm
from src.core.tableau import TableauState


def test_simulate_clifford_returns_tableau():
    initial_table = [[0, 1, 0]]
    state = simulate_gate_ops(initial_table, [("h", [0])])
    assert isinstance(state, TableauState)
    assert state.metadata()["n_qubits"] == 1


def test_simulate_t_returns_frame():
    initial_table = [[0, 1, 0]]
    qasm = """OPENQASM 3;
    qubit[1] q;
    t q[0];"""
    state = simulate_qasm(initial_table, qasm)
    assert isinstance(state, StabilizerFrame)
    assert state.metadata()["n_terms"] == 1
