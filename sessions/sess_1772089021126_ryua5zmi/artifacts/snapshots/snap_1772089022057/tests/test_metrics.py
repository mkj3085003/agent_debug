from src.core.metrics import commutation_check


def test_commutation_check_trivial():
    tableau = [
        [1, 0, 0, 1, 0],
        [0, 1, 1, 0, 0],
    ]
    ok, info = commutation_check(tableau)
    assert ok
    assert info["violations"] == 0
