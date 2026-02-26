from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

import numpy as np

GateOp = Tuple[str, List[int]]


@dataclass(frozen=True)
class TrackConfig:
    mode: str = "final"  # all | final | stride
    stride: int = 1


def parse_qasm_to_gate_ops(qasm: str) -> List[GateOp]:
    """Parse a minimal OpenQASM 3.0 subset (h, s, t, cx) into gate ops.

    English:
        Recognizes "h", "s", "t", and "cx"/"cnot" with q[i] operands.
        Ignores headers, includes, and qubit declarations.
    中文：
        解析最小 OpenQASM 3.0 子集（h、s、t、cx/cnot），
        支持 q[i] 形式的操作数；忽略头部、include 与量子比特声明。
    """
    ops: List[GateOp] = []
    for raw in qasm.splitlines():
        line = raw.strip().lower()
        if not line or line.startswith("//"):
            continue
        if line.startswith("openqasm") or line.startswith("include"):
            continue
        if line.startswith("qubit["):
            continue

        match = re.match(r"^(h|s|t)\s+q\[(\d+)\]\s*;?$", line)
        if match:
            gate = match.group(1)
            qubit = int(match.group(2))
            ops.append((gate, [qubit]))
            continue

        match = re.match(r"^(cx|cnot)\s+q\[(\d+)\]\s*,\s*q\[(\d+)\]\s*;?$", line)
        if match:
            gate = "cx"
            ctrl = int(match.group(2))
            targ = int(match.group(3))
            ops.append((gate, [ctrl, targ]))
            continue

    return ops


def should_record_step(track: TrackConfig, step_index: int, total_steps: int) -> bool:
    """Decide whether to record a tableau snapshot at a given step.

    English:
        - "all": record every step
        - "final": record only the final step
        - "stride": record every N steps plus the final step
    中文：
        判断在某一步是否需要记录稳定子表。
        - "all": 每一步都记录
        - "final": 仅记录最后一步
        - "stride": 每隔 N 步记录，并确保记录最后一步
    """
    if track.mode == "all":
        return True
    if track.mode == "final":
        return step_index == total_steps
    if track.mode == "stride":
        stride = max(track.stride, 1)
        return step_index % stride == 0 or step_index == total_steps
    raise ValueError(f"Unknown track mode: {track.mode}")


def apply_h(table: np.ndarray, qubit: int) -> None:
    """Apply a Hadamard gate to a stabilizer tableau in-place.

    English:
        Swaps X/Z columns for the qubit and updates the phase for Y terms.
    中文：
        在稳定子表上就地应用 H 门：
        交换该量子比特的 X/Z 列，并对 Y 项更新相位。
    """
    n = (table.shape[1] - 1) // 2
    x = table[:, qubit].copy()
    z = table[:, n + qubit].copy()
    y_mask = (x & z) == 1
    table[y_mask, -1] = (table[y_mask, -1] + 2) % 4
    table[:, qubit] = z
    table[:, n + qubit] = x


def apply_s(table: np.ndarray, qubit: int) -> None:
    """Apply a phase (S) gate to a stabilizer tableau in-place.

    English:
        Maps X -> Y and updates phases for Y terms; Z is unchanged.
    中文：
        在稳定子表上就地应用 S 门：
        X 映射为 Y，并对 Y 项更新相位；Z 列保持不变。
    """
    n = (table.shape[1] - 1) // 2
    x = table[:, qubit].copy()
    z = table[:, n + qubit].copy()
    y_mask = (x & z) == 1
    table[y_mask, -1] = (table[y_mask, -1] + 2) % 4
    table[:, n + qubit] = z ^ x


def apply_cx(table: np.ndarray, control: int, target: int) -> None:
    """Apply a controlled-X (CX) gate to a stabilizer tableau in-place.

    English:
        Updates X/Z columns for control and target and adjusts phase
        according to standard stabilizer update rules.
    中文：
        在稳定子表上就地应用 CX 门：
        更新控制/目标比特的 X/Z 列，并按稳定子规则修正相位。
    """
    n = (table.shape[1] - 1) // 2
    x_c = table[:, control].copy()
    x_t = table[:, target].copy()
    z_c = table[:, n + control].copy()
    z_t = table[:, n + target].copy()

    phase_mask = (x_c & z_t & (x_t ^ z_c ^ 1)) == 1
    table[phase_mask, -1] = (table[phase_mask, -1] + 2) % 4

    table[:, target] = x_t ^ x_c
    table[:, n + control] = z_c ^ z_t


def evolve_stabilizer_table(
    initial_table: Sequence[Sequence[int]],
    gate_ops: Sequence[GateOp],
    track: Optional[TrackConfig] = None,
) -> Tuple[List[List[int]], List[List[List[int]]]]:
    """Evolve a stabilizer tableau through a sequence of gates.

    English:
        Returns the final tableau and a list of snapshots based on track.
    中文：
        将稳定子表按门序列演化，
        返回最终表以及根据 track 记录的中间表序列。
    """
    if track is None:
        track = TrackConfig()

    table = np.array(initial_table, dtype=int)
    if table.ndim != 2 or table.shape[1] < 3:
        raise ValueError("Invalid stabilizer table shape.")

    total_steps = len(gate_ops)
    sequence: List[List[List[int]]] = [table.tolist()]

    for step_index, (gate, qubits) in enumerate(gate_ops, start=1):
        if gate == "h":
            apply_h(table, qubits[0])
        elif gate == "s":
            apply_s(table, qubits[0])
        elif gate == "cx":
            apply_cx(table, qubits[0], qubits[1])
        else:
            raise ValueError(f"Unsupported gate: {gate}")

        if should_record_step(track, step_index, total_steps):
            sequence.append(table.tolist())

    return table.tolist(), sequence
