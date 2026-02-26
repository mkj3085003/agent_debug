from __future__ import annotations

from typing import Dict, List, Optional, Sequence, Tuple


def _parse_pauli(pauli: str) -> Tuple[List[int], List[int], int]:
    """Convert a Pauli string into X/Z bit vectors with a global phase.

    English:
        Accepts strings like "IXYZ", "+XYZ", or "-IIZ".
        Returns (x, z, phase) where phase encodes the global factor:
        +1 -> 0, -1 -> 2 (i.e. i^phase).
    中文：
        将 Pauli 字符串转换为 X/Z 位向量与全局相位。
        支持 "IXYZ"、"+XYZ"、"-IIZ" 等格式。
        返回 (x, z, phase)，其中 phase 为全局相位编码：
        +1 -> 0, -1 -> 2（即 i^phase）。
    """
    token = pauli.strip().upper()
    if not token:
        raise ValueError("Empty Pauli string.")

    phase = 0
    if token[0] == "+":
        token = token[1:]
    elif token[0] == "-":
        phase = 2
        token = token[1:]

    if not token or any(c not in "IXYZ" for c in token):
        raise ValueError(f"Invalid Pauli string: {pauli}")

    x: List[int] = []
    z: List[int] = []
    for char in token:
        if char == "I":
            x.append(0)
            z.append(0)
        elif char == "X":
            x.append(1)
            z.append(0)
        elif char == "Y":
            x.append(1)
            z.append(1)
        elif char == "Z":
            x.append(0)
            z.append(1)
        else:
            raise ValueError(f"Invalid Pauli char: {char}")
    return x, z, phase


def _xor_vec(a: Sequence[int], b: Sequence[int]) -> List[int]:
    return [x ^ y for x, y in zip(a, b)]


def _dot_mod2(a: Sequence[int], b: Sequence[int]) -> int:
    return sum((x & y) for x, y in zip(a, b)) % 2


def _dot_mod4(a: Sequence[int], b: Sequence[int]) -> int:
    return sum((x & y) for x, y in zip(a, b)) % 4


def _symplectic_product(x1: Sequence[int], z1: Sequence[int], x2: Sequence[int], z2: Sequence[int]) -> int:
    """Compute the binary symplectic product between two Pauli vectors.

    English:
        Uses the standard stabilizer formalism. The result is 0 if the
        Paulis commute and 1 if they anti-commute.
    中文：
        计算两个 Pauli 向量的二进制辛内积。
        在稳定子形式中，结果为 0 表示对易，1 表示反对易。
    """
    acc = 0
    for a, b, c, d in zip(x1, z1, x2, z2):
        acc ^= (a & d) ^ (b & c)
    return acc


def pauli_commutes_with_tableau(tableau: Sequence[Sequence[int]], pauli: str) -> bool:
    """Check whether a Pauli operator commutes with every row of a tableau.

    English:
        Converts the Pauli to (x, z), then evaluates the symplectic
        product against each tableau row. Any 1 means anti-commutation.
    中文：
        判断给定 Pauli 是否与稳定子表的每一行对易。
        将 Pauli 转为 (x, z) 后逐行计算辛内积，出现 1 即反对易。
    """
    x_p, z_p, _ = _parse_pauli(pauli)
    n_qubits = len(x_p)
    for row in tableau:
        if len(row) != 2 * n_qubits + 1:
            raise ValueError("Tableau row length does not match Pauli length.")
        x_r = row[:n_qubits]
        z_r = row[n_qubits:2 * n_qubits]
        if _symplectic_product(x_r, z_r, x_p, z_p) == 1:
            return False
    return True


def _row_reduce_with_coeff(matrix: Sequence[Sequence[int]]) -> Tuple[List[Tuple[List[int], List[int]]], List[int]]:
    if not matrix:
        return [], []

    m = len(matrix)
    ncols = len(matrix[0])
    work_vecs = [list(row) for row in matrix]
    coeffs: List[List[int]] = [[1 if i == j else 0 for j in range(m)] for i in range(m)]

    pivot_rows: List[Tuple[List[int], List[int]]] = []
    pivot_cols: List[int] = []
    pivot = 0
    for col in range(ncols):
        pivot_idx = None
        for r in range(pivot, m):
            if work_vecs[r][col] == 1:
                pivot_idx = r
                break
        if pivot_idx is None:
            continue
        if pivot_idx != pivot:
            work_vecs[pivot], work_vecs[pivot_idx] = work_vecs[pivot_idx], work_vecs[pivot]
            coeffs[pivot], coeffs[pivot_idx] = coeffs[pivot_idx], coeffs[pivot]
        for r in range(m):
            if r != pivot and work_vecs[r][col] == 1:
                work_vecs[r] = _xor_vec(work_vecs[r], work_vecs[pivot])
                coeffs[r] = _xor_vec(coeffs[r], coeffs[pivot])
        pivot_rows.append((work_vecs[pivot], coeffs[pivot]))
        pivot_cols.append(col)
        pivot += 1
        if pivot >= m:
            break
    return pivot_rows, pivot_cols


def _express_in_span(
    target: Sequence[int],
    pivot_rows: Sequence[Tuple[List[int], List[int]]],
    pivot_cols: Sequence[int],
    n_rows: int,
) -> Optional[List[int]]:
    coeff = [0] * n_rows
    vec = list(target)
    for (row_vec, row_coeff), col in zip(pivot_rows, pivot_cols):
        if vec[col] == 1:
            vec = _xor_vec(vec, row_vec)
            coeff = _xor_vec(coeff, row_coeff)
    if any(vec):
        return None
    return coeff


def _combine_rows_phase(
    tableau: Sequence[Sequence[int]],
    coeff: Sequence[int],
    n_qubits: int,
) -> Tuple[int, List[int], List[int]]:
    phase_full = 0
    x_acc = [0] * n_qubits
    z_acc = [0] * n_qubits
    for idx, bit in enumerate(coeff):
        if not bit:
            continue
        row = tableau[idx]
        x_r = row[:n_qubits]
        z_r = row[n_qubits:2 * n_qubits]
        # Convert AG phase (sign only) to full i^phase representation.
        row_phase_full = (row[-1] + _dot_mod4(x_r, z_r)) % 4
        symp = _dot_mod2(x_acc, z_r) ^ _dot_mod2(z_acc, x_r)
        phase_full = (phase_full + row_phase_full + 2 * symp) % 4
        x_acc = _xor_vec(x_acc, x_r)
        z_acc = _xor_vec(z_acc, z_r)
    # Convert back to AG phase (sign only).
    phase_sign = (phase_full - _dot_mod4(x_acc, z_acc)) % 4
    return phase_sign, x_acc, z_acc


def measure_pauli_from_tableau(tableau: Sequence[Sequence[int]], pauli: str) -> Dict[str, Optional[int]]:
    """Return a strict, verifiable measurement result summary.

    English:
        Implements full stabilizer-group membership checking.
        - If any row anti-commutes with the Pauli, the outcome is random.
        - If it commutes but is not in the stabilizer group, the outcome is random.
        - If it is in the stabilizer group, the outcome is deterministic with sign.
    中文：
        完整实现稳定子群成员检测。
        - 若存在反对易行，则结果为随机。
        - 若对易但不在稳定子群中，结果仍为随机。
        - 若在稳定子群中，结果为确定性并给出符号。
    """
    x_p, z_p, phase_p = _parse_pauli(pauli)
    n_qubits = len(x_p)

    if not tableau:
        # Empty tableau => only identity is in the group.
        if all(v == 0 for v in x_p + z_p):
            return {"deterministic": True, "value": 1 if phase_p == 0 else -1}
        return {"deterministic": False, "value": None}

    for row in tableau:
        if len(row) != 2 * n_qubits + 1:
            raise ValueError("Tableau row length does not match Pauli length.")
        x_r = row[:n_qubits]
        z_r = row[n_qubits:2 * n_qubits]
        if _symplectic_product(x_r, z_r, x_p, z_p) == 1:
            return {"deterministic": False, "value": None}

    matrix = [row[: 2 * n_qubits] for row in tableau]
    pivot_rows, pivot_cols = _row_reduce_with_coeff(matrix)
    coeff = _express_in_span(x_p + z_p, pivot_rows, pivot_cols, len(matrix))
    if coeff is None:
        return {"deterministic": False, "value": None}

    phase_total, x_acc, z_acc = _combine_rows_phase(tableau, coeff, n_qubits)
    if x_acc != x_p or z_acc != z_p:
        raise ValueError("Row-span reconstruction failed; tableau may be inconsistent.")

    phase_diff = (phase_total - phase_p) % 4
    if phase_diff == 0:
        return {"deterministic": True, "value": 1}
    if phase_diff == 2:
        return {"deterministic": True, "value": -1}

    # phase_diff in {1,3} => Pauli commutes but is not in stabilizer group.
    return {"deterministic": False, "value": None}
