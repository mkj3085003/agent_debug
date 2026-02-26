from src.data.canonicalize import canonicalize_tableau


def test_canonicalize_tableau_sort():
    table = [
        [0, 1, 0],
        [1, 0, 0],
    ]
    canonical = canonicalize_tableau(table)
    assert canonical == [[1, 0, 0], [0, 1, 0]]
