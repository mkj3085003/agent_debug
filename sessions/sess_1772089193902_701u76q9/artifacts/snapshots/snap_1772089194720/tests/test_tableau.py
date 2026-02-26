from src.core.tableau import TableauState


def test_tableau_apply_gate():
    table = [
        [1, 0, 0, 0, 0],
        [0, 1, 0, 0, 0],
    ]
    state = TableauState.from_table(table)
    state.apply_gate(("h", [0]))
    assert state.serialize()
