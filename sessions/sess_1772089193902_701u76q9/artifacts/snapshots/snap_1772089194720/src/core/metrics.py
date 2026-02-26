from __future__ import annotations

from typing import Dict, Sequence, Tuple


def exact_match(a: Sequence[Sequence[int]], b: Sequence[Sequence[int]]) -> bool:
    """Check whether two tables are exactly equal.

    English:
        Compares after converting to lists to avoid numpy iterator quirks.
    中文：
        判断两个表是否完全一致。
        会先转换成 Python 列表，以避免 numpy 迭代器的差异。
    """
    return list(map(list, a)) == list(map(list, b))


def bit_accuracy(a: Sequence[Sequence[int]], b: Sequence[Sequence[int]]) -> float:
    """Compute element-wise accuracy between two tables.

    English:
        Returns the fraction of matching entries; returns 0.0 if shapes
        differ or if either input is empty.
    中文：
        计算逐元素的准确率（匹配元素数 / 总元素数）。
        若形状不一致或为空则返回 0.0。
    """
    a_rows = list(map(list, a))
    b_rows = list(map(list, b))
    if not a_rows or not b_rows:
        return 0.0
    if len(a_rows) != len(b_rows):
        return 0.0
    total = 0
    correct = 0
    for row_a, row_b in zip(a_rows, b_rows):
        if len(row_a) != len(row_b):
            return 0.0
        for v_a, v_b in zip(row_a, row_b):
            total += 1
            if v_a == v_b:
                correct += 1
    return correct / total if total else 0.0


def _symplectic_product(row_a: Sequence[int], row_b: Sequence[int]) -> int:
    """Binary symplectic product for two tableau rows.

    English:
        Returns 0 if rows commute and 1 if they anti-commute.
    中文：
        计算两行稳定子表的二进制辛内积。
        结果为 0 表示对易，1 表示反对易。
    """
    n_qubits = (len(row_a) - 1) // 2
    acc = 0
    for idx in range(n_qubits):
        xa = row_a[idx]
        za = row_a[n_qubits + idx]
        xb = row_b[idx]
        zb = row_b[n_qubits + idx]
        acc ^= (xa & zb) ^ (za & xb)
    return acc


def commutation_check(tableau: Sequence[Sequence[int]]) -> Tuple[bool, Dict[str, int]]:
    """Check pairwise commutation across all rows.

    English:
        Counts the number of anti-commuting pairs.
    中文：
        检查表中所有行的两两对易性。
        返回是否全部对易，以及反对易对的数量。
    """
    rows = list(map(list, tableau))
    n = len(rows)
    violations = 0
    for i in range(n):
        for j in range(i + 1, n):
            if _symplectic_product(rows[i], rows[j]) == 1:
                violations += 1
    return violations == 0, {"violations": violations}
