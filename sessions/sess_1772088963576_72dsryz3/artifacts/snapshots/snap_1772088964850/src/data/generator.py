from __future__ import annotations

import argparse
import json
import random
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

try:
    import qiskit.qasm3 as qasm3
    from qiskit.circuit import QuantumCircuit
    from qiskit.circuit.library.standard_gates import CXGate, HGate, SGate
    from qiskit.quantum_info import StabilizerState
except ModuleNotFoundError as exc:  # pragma: no cover - optional dependency
    raise ModuleNotFoundError(
        "qiskit is required for dataset generation. Please install qiskit."
    ) from exc

from src.core.utils import format_table_as_lines, normalize_gate_weights
from src.data.canonicalize import canonicalize_tableau


@dataclass(frozen=True)
class GenerationConfig:
    n_qubits: int
    num_samples: int
    init_depth: int
    evolve_depth: int
    seed: Optional[int]
    track_mode: str
    trace_stride: int
    include_qasm: bool
    include_sequence_string: bool
    include_init_circuit: bool
    include_gate_sequence: bool
    output_path: str
    gate_weights: List[Tuple[str, float]]


def parse_gate_weights(raw: str) -> List[Tuple[str, float]]:
    pairs: List[Tuple[str, float]] = []
    for item in raw.split(","):
        if not item.strip():
            continue
        if "=" not in item:
            raise ValueError(f"Invalid gate weight format: {item}")
        name, value = item.split("=", 1)
        name = name.strip().lower()
        if name not in {"h", "s", "cx"}:
            raise ValueError(f"Unsupported gate in weights: {name}")
        try:
            weight = float(value.strip())
        except ValueError as exc:
            raise ValueError(f"Invalid weight for {name}: {value}") from exc
        pairs.append((name, weight))
    if not pairs:
        raise ValueError("Gate weights cannot be empty.")
    return normalize_gate_weights(pairs)


def build_random_clifford_circuit(
    n_qubits: int,
    depth: int,
    gate_weights: Sequence[Tuple[str, float]],
    rng: random.Random,
) -> Tuple[QuantumCircuit, List[Dict[str, object]]]:
    qc = QuantumCircuit(n_qubits)
    gate_sequence: List[Dict[str, object]] = []

    gate_names = [name for name, _ in gate_weights]
    gate_probs = [weight for _, weight in gate_weights]

    for step_idx in range(depth):
        gate_name = pick_gate_name(gate_names, gate_probs, n_qubits, rng)
        if gate_name == "h":
            qubit = rng.randrange(n_qubits)
            qc.append(HGate(), [qubit])
            gate_sequence.append({"name": "h", "qubits": [qubit], "index": step_idx})
        elif gate_name == "s":
            qubit = rng.randrange(n_qubits)
            qc.append(SGate(), [qubit])
            gate_sequence.append({"name": "s", "qubits": [qubit], "index": step_idx})
        elif gate_name == "cx":
            if n_qubits < 2:
                continue
            control, target = rng.sample(range(n_qubits), 2)
            qc.append(CXGate(), [control, target])
            gate_sequence.append(
                {"name": "cx", "qubits": [control, target], "index": step_idx}
            )
        else:
            raise ValueError(f"Unexpected gate name: {gate_name}")

    return qc, gate_sequence


def pick_gate_name(
    gate_names: Sequence[str],
    gate_probs: Sequence[float],
    n_qubits: int,
    rng: random.Random,
) -> str:
    for _ in range(20):
        choice = rng.choices(gate_names, weights=gate_probs, k=1)[0]
        if choice == "cx" and n_qubits < 2:
            continue
        return choice
    return "h"


def build_base_stabilizer_state(n_qubits: int) -> StabilizerState:
    stabilizer_list = [
        "+" + "".join(["I"] * i + ["Z"] + ["I"] * (n_qubits - i - 1))
        for i in range(n_qubits)
    ]
    return StabilizerState.from_stabilizer_list(stabilizer_list)


def should_record_step(
    track_mode: str,
    step_index: int,
    total_steps: int,
    trace_stride: int,
) -> bool:
    if track_mode == "all":
        return True
    if track_mode == "final":
        return step_index == total_steps
    if track_mode == "stride":
        if trace_stride <= 0:
            trace_stride = 1
        return step_index % trace_stride == 0 or step_index == total_steps
    raise ValueError(f"Unknown track mode: {track_mode}")


def stabilizer_table_from_state(stab_state: StabilizerState) -> List[List[int]]:
    pauli_list = extract_stabilizer_list(stab_state)
    return pauli_list_to_extended_stabilizer_matrix_signed(pauli_list).tolist()


def extract_stabilizer_list(stab_state: StabilizerState) -> List[str]:
    s = str(stab_state)
    match = __import__("re").search(r"StabilizerState\(\['(.*)'\]\)", s)
    if match:
        list_content = match.group(1)
        return [item.strip().strip("'") for item in list_content.split("', '")]
    match = __import__("re").search(r"\['(.*)'\]", s)
    if match:
        list_content = match.group(1)
        return [item.strip().strip("'") for item in list_content.split("', '")]
    raise ValueError(f"Could not extract stabilizer list from: {s}")


def pauli_list_to_extended_stabilizer_matrix_signed(stabilizer_list: Sequence[str]):
    if not stabilizer_list:
        return __import__("numpy").array([[]], dtype=int)

    n_qubits = len(stabilizer_list[0]) - 1
    n_rows = len(stabilizer_list)

    gamma_matrix = __import__("numpy").zeros((n_rows, 2 * n_qubits), dtype=int)
    phase_vector = __import__("numpy").zeros(n_rows, dtype=int)

    for i, pauli_str in enumerate(stabilizer_list):
        phase_char = pauli_str[:2] if len(pauli_str) > 1 and pauli_str[1] == "i" else pauli_str[0]

        if phase_char == "+":
            phase_vector[i] = 0
        elif phase_char == "-":
            phase_vector[i] = 2
        elif phase_char == "+i":
            phase_vector[i] = 1
        elif phase_char == "-i":
            phase_vector[i] = 3
        else:
            raise ValueError(f"Invalid phase symbol: {phase_char}")

        pauli_ops = pauli_str[1:] if phase_char in ("+", "-") else pauli_str[2:]
        # Qiskit Pauli strings are little-endian (rightmost is qubit 0).
        # Reverse to match our internal ordering (leftmost is qubit 0).
        pauli_ops = pauli_ops[::-1]
        for j, char in enumerate(pauli_ops):
            if char == "X":
                gamma_matrix[i, j] = 1
            elif char == "Y":
                gamma_matrix[i, j] = 1
                gamma_matrix[i, j + n_qubits] = 1
            elif char == "Z":
                gamma_matrix[i, j + n_qubits] = 1

    phase_column = phase_vector.reshape(-1, 1)
    return __import__("numpy").hstack([gamma_matrix, phase_column])


def generate_single_sample(
    n_qubits: int,
    init_depth: int,
    evolve_depth: int,
    gate_weights: Sequence[Tuple[str, float]],
    rng: random.Random,
    track_mode: str,
    trace_stride: int,
    include_qasm: bool,
    include_sequence_string: bool,
    include_init_circuit: bool,
    include_gate_sequence: bool,
) -> Dict[str, object]:
    base_state = build_base_stabilizer_state(n_qubits)
    init_circuit, init_gate_seq = build_random_clifford_circuit(
        n_qubits, init_depth, gate_weights, rng
    )
    current_state = base_state.evolve(init_circuit)

    evolution_circuit, evolution_gate_seq = build_random_clifford_circuit(
        n_qubits, evolve_depth, gate_weights, rng
    )

    tables: List[List[List[int]]] = []
    initial_table = stabilizer_table_from_state(current_state)
    tables.append(initial_table)

    step_count = 0
    for instruction in evolution_circuit.data:
        step_count += 1
        gate = instruction.operation
        qubits_idx = [evolution_circuit.find_bit(q).index for q in instruction.qubits]

        temp_qc = QuantumCircuit(n_qubits)
        temp_qc.append(gate, qubits_idx)
        current_state = current_state.evolve(temp_qc)

        if should_record_step(track_mode, step_count, evolve_depth, trace_stride):
            table = stabilizer_table_from_state(current_state)
            tables.append(table)

    final_table = stabilizer_table_from_state(current_state)
    canonical_final = canonicalize_tableau(final_table)

    data_point: Dict[str, object] = {
        "n_qubits": n_qubits,
        "init_stabilizer_table": initial_table,
        "final_stabilizer_table": final_table,
        "canonical_final_stabilizer_table": canonical_final,
        "tracking": {
            "mode": track_mode,
            "trace_stride": trace_stride,
            "recorded_tables": len(tables),
        },
        "stabilizer_table_sequence_list": tables,
    }

    if include_sequence_string:
        data_point["stabilizer_table_sequence_string"] = "\n".join(
            [";".join([",".join(map(str, row)) for row in table]) for table in tables]
        )

    if include_qasm:
        data_point["circuit"] = qasm3.dumps(evolution_circuit)
        if include_init_circuit:
            data_point["init_circuit"] = qasm3.dumps(init_circuit)

    if include_gate_sequence:
        data_point["gate_sequence"] = evolution_gate_seq
        if include_init_circuit:
            data_point["init_gate_sequence"] = init_gate_seq

    return data_point


def parse_args() -> GenerationConfig:
    parser = argparse.ArgumentParser(
        description="Generate stabilizer evolution datasets for Clifford circuits."
    )
    parser.add_argument("--n-qubits", type=int, default=3)
    parser.add_argument("--num-samples", type=int, default=5)
    parser.add_argument("--init-depth", type=int, default=5)
    parser.add_argument("--evolve-depth", type=int, default=5)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument(
        "--track-mode",
        type=str,
        default="all",
        choices=["all", "final", "stride"],
    )
    parser.add_argument("--trace-stride", type=int, default=1)
    qasm_group = parser.add_mutually_exclusive_group()
    qasm_group.add_argument(
        "--include-qasm",
        action="store_true",
        default=True,
        help="Include QASM for circuits (default: enabled).",
    )
    qasm_group.add_argument(
        "--no-include-qasm",
        dest="include_qasm",
        action="store_false",
        help="Disable QASM output.",
    )
    parser.add_argument("--include-sequence-string", action="store_true")
    parser.add_argument("--include-init-circuit", action="store_true")
    parser.add_argument("--include-gate-sequence", action="store_true")
    parser.add_argument("--output", type=str, default="data/raw/stabilizer_evolution_data.json")
    parser.add_argument(
        "--gate-weights",
        type=str,
        default="h=1,s=1,cx=2",
        help="Comma-separated weights, e.g. h=1,s=1,cx=2",
    )

    args = parser.parse_args()
    gate_weights = parse_gate_weights(args.gate_weights)

    return GenerationConfig(
        n_qubits=args.n_qubits,
        num_samples=args.num_samples,
        init_depth=args.init_depth,
        evolve_depth=args.evolve_depth,
        seed=args.seed,
        track_mode=args.track_mode,
        trace_stride=args.trace_stride,
        include_qasm=args.include_qasm,
        include_sequence_string=args.include_sequence_string,
        include_init_circuit=args.include_init_circuit,
        include_gate_sequence=args.include_gate_sequence,
        output_path=args.output,
        gate_weights=gate_weights,
    )


def main() -> None:
    cfg = parse_args()
    rng = random.Random(cfg.seed)

    dataset: List[Dict[str, object]] = []
    for _ in range(cfg.num_samples):
        sample = generate_single_sample(
            n_qubits=cfg.n_qubits,
            init_depth=cfg.init_depth,
            evolve_depth=cfg.evolve_depth,
            gate_weights=cfg.gate_weights,
            rng=rng,
            track_mode=cfg.track_mode,
            trace_stride=cfg.trace_stride,
            include_qasm=cfg.include_qasm,
            include_sequence_string=cfg.include_sequence_string,
            include_init_circuit=cfg.include_init_circuit,
            include_gate_sequence=cfg.include_gate_sequence,
        )
        dataset.append(sample)

    with open(cfg.output_path, "w") as f:
        json.dump(dataset, f, indent=2)

    if dataset:
        example = dataset[0]
        print("--- Example Sample ---")
        print(f"n_qubits: {example['n_qubits']}")
        print(f"tables tracked: {example['tracking']['recorded_tables']}")
        print("initial table:")
        print(format_table_as_lines(example["init_stabilizer_table"]))
        print("final table:")
        print(format_table_as_lines(example["final_stabilizer_table"]))


if __name__ == "__main__":
    main()
