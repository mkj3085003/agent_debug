from __future__ import annotations

from typing import List, Sequence


def _dot_mod2(a: Sequence[int], b: Sequence[int]) -> int:
    return sum((x & y) for x, y in zip(a, b)) % 2


def _row_mul(rows: List[List[int]], target: int, source: int) -> None:
    if target == source:
        return
    row_t = rows[target]
    row_s = rows[source]
    n = (len(row_t) - 1) // 2
    x_t = row_t[:n]
    z_t = row_t[n : 2 * n]
    x_s = row_s[:n]
    z_s = row_s[n : 2 * n]
    phase = (row_t[-1] + row_s[-1] + 2 * _dot_mod2(z_t, x_s)) % 4
    rows[target] = [a ^ b for a, b in zip(x_t, x_s)] + [a ^ b for a, b in zip(z_t, z_s)] + [phase]


def _swap_rows(rows: List[List[int]], i: int, j: int) -> None:
    if i == j:
        return
    rows[i], rows[j] = rows[j], rows[i]


def canonicalize_tableau(tableau: Sequence[Sequence[int]]) -> List[List[int]]:
    """Canonicalize a stabilizer tableau via symplectic row reduction.

    The algorithm performs deterministic Gaussian elimination over GF(2)
    on the [X|Z] block while updating phases via Pauli multiplication.
    """
    rows = [list(row) for row in tableau]
    if not rows:
        return []

    n = (len(rows[0]) - 1) // 2
    m = len(rows)

    pivot_row = 0
    # Stage 1: RREF on X block
    for col in range(n):
        pivot = None
        for r in range(pivot_row, m):
            if rows[r][col] == 1:
                pivot = r
                break
        if pivot is None:
            continue
        _swap_rows(rows, pivot_row, pivot)
        for r in range(m):
            if r != pivot_row and rows[r][col] == 1:
                _row_mul(rows, r, pivot_row)
        pivot_row += 1
        if pivot_row >= m:
            break

    # Stage 2: RREF on Z block for remaining rows (X block is all zeros there)
    for col in range(n):
        pivot = None
        for r in range(pivot_row, m):
            if rows[r][n + col] == 1:
                pivot = r
                break
        if pivot is None:
            continue
        _swap_rows(rows, pivot_row, pivot)
        for r in range(m):
            if r != pivot_row and rows[r][n + col] == 1:
                _row_mul(rows, r, pivot_row)
        pivot_row += 1
        if pivot_row >= m:
            break

    return rows
