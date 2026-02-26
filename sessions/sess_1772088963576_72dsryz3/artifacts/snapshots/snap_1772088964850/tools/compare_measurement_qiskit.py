from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from typing import Any, Dict, List, Optional, Sequence, Tuple

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from qiskit import QuantumCircuit
from qiskit.quantum_info import Pauli, StabilizerState, Statevector

from src.core.measurement import measure_pauli_from_tableau
from src.core.solver import TrackConfig, evolve_stabilizer_table, parse_qasm_to_gate_ops


def load_dataset(path: str) -> List[Dict[str, Any]]:
    with open(path, "r") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError("Dataset must be a list of samples.")
    return data


def normalize_pauli(pauli: str, n_qubits: int) -> str:
    token = pauli.strip().upper()
    if not token:
        return "Z" * n_qubits
    if token[0] in "+-":
        token = token[1:]
    if len(token) == 1 and n_qubits > 1:
        # Treat single-char input as "apply to all qubits".
        return token * n_qubits
    if len(token) != n_qubits:
        raise ValueError(f"Pauli length {len(token)} does not match n_qubits={n_qubits}.")
    return token


def pauli_to_qiskit(pauli: str) -> Pauli:
    token = pauli.strip().upper()
    sign = ""
    if token.startswith("+"):
        token = token[1:]
    elif token.startswith("-"):
        sign = "-"
        token = token[1:]
    # Qiskit uses little-endian ordering: rightmost is qubit 0.
    qiskit_str = sign + token[::-1]
    return Pauli(qiskit_str)


def qiskit_expectation(state: Statevector, pauli: str) -> float:
    op = pauli_to_qiskit(pauli)
    return float(state.expectation_value(op).real)


def table_to_stabilizer_list(tableau: Sequence[Sequence[int]]) -> List[str]:
    if not tableau:
        return []
    n = (len(tableau[0]) - 1) // 2
    stabilizers: List[str] = []
    for row in tableau:
        x_r = row[:n]
        z_r = row[n:2 * n]
        phase = row[-1] % 4
        if phase == 0:
            sign = "+"
        elif phase == 2:
            sign = "-"
        elif phase == 1:
            sign = "+i"
        else:
            sign = "-i"
        pauli_chars: List[str] = []
        for xi, zi in zip(x_r, z_r):
            if xi == 0 and zi == 0:
                pauli_chars.append("I")
            elif xi == 1 and zi == 0:
                pauli_chars.append("X")
            elif xi == 0 and zi == 1:
                pauli_chars.append("Z")
            else:
                pauli_chars.append("Y")
        # Convert internal order (q0 left) to Qiskit order (q0 right).
        pauli_qiskit = "".join(pauli_chars[::-1])
        stabilizers.append(sign + pauli_qiskit)
    return stabilizers


def qiskit_expectation_from_tableau(
    init_tableau: Sequence[Sequence[int]],
    circuit: QuantumCircuit,
    pauli: str,
) -> float:
    stabilizers = table_to_stabilizer_list(init_tableau)
    if stabilizers:
        state = StabilizerState.from_stabilizer_list(stabilizers)
        state = state.evolve(circuit)
        return float(state.expectation_value(pauli_to_qiskit(pauli)).real)
    state = Statevector.from_instruction(circuit)
    return qiskit_expectation(state, pauli)


def build_baseline_state(
    sample: Dict[str, Any], circuit: QuantumCircuit
) -> Statevector:
    init_table = sample.get("init_stabilizer_table") or sample.get("initial_table")
    if init_table is not None:
        stabilizers = table_to_stabilizer_list(init_table)
        if stabilizers:
            state = StabilizerState.from_stabilizer_list(stabilizers)
            return state.evolve(circuit)
    return Statevector.from_instruction(circuit)


def build_ours_state_from_tableau(
    final_tableau: Sequence[Sequence[int]],
) -> StabilizerState:
    stabilizers = table_to_stabilizer_list(final_tableau)
    if not stabilizers:
        raise ValueError("Empty stabilizer list from tableau.")
    return StabilizerState.from_stabilizer_list(stabilizers)


def probability_distances(
    p: Dict[str, float], q: Dict[str, float]
) -> Tuple[float, float]:
    keys = set(p) | set(q)
    if not keys:
        return 0.0, 0.0
    diffs = [abs(p.get(k, 0.0) - q.get(k, 0.0)) for k in keys]
    return float(sum(diffs)), float(max(diffs))


def topk_probs(probs: Dict[str, float], k: int) -> str:
    if not probs or k <= 0:
        return ""
    items = sorted(probs.items(), key=lambda x: x[1], reverse=True)[:k]
    return ";".join([f"{bit}:{prob:.6f}" for bit, prob in items])


def get_final_table(sample: Dict[str, Any]) -> Optional[List[List[int]]]:
    if "final_stabilizer_table" in sample:
        return sample["final_stabilizer_table"]
    initial = sample.get("initial_table") or sample.get("init_stabilizer_table")
    circuit = sample.get("circuit")
    if initial is None or circuit is None:
        return None
    gate_ops = parse_qasm_to_gate_ops(circuit)
    final_table, _ = evolve_stabilizer_table(initial, gate_ops, track=TrackConfig(mode="final"))
    return final_table


def build_circuit_from_qasm(qasm: str, n_qubits: int) -> QuantumCircuit:
    gate_ops = parse_qasm_to_gate_ops(qasm)
    circuit = QuantumCircuit(n_qubits)
    for gate, qubits in gate_ops:
        if gate == "h":
            circuit.h(qubits[0])
        elif gate == "s":
            circuit.s(qubits[0])
        elif gate == "cx":
            circuit.cx(qubits[0], qubits[1])
        else:
            raise ValueError(f"Unsupported gate: {gate}")
    return circuit


def infer_n_qubits(sample: Dict[str, Any], qasm: str) -> int:
    if "n_qubits" in sample and int(sample["n_qubits"]) > 0:
        return int(sample["n_qubits"])
    gate_ops = parse_qasm_to_gate_ops(qasm)
    max_idx = 0
    for _, qubits in gate_ops:
        max_idx = max(max_idx, max(qubits))
    return max_idx + 1


def compare_measurements(
    samples: List[Dict[str, Any]],
    pauli_input: str,
    max_items: int,
    tol: float,
    output_csv: Optional[str],
    shots: int,
    top_k: int,
) -> Tuple[int, int, List[str]]:
    total = 0
    matched = 0
    mismatches: List[str] = []
    rows: List[Dict[str, object]] = []

    for idx, sample in enumerate(samples[:max_items]):
        qasm = sample.get("circuit")
        if not qasm:
            continue
        n_qubits = infer_n_qubits(sample, qasm)
        pauli = normalize_pauli(pauli_input, n_qubits)

        final_table = get_final_table(sample)
        if final_table is None:
            continue
        ours = measure_pauli_from_tableau(final_table, pauli)
        circuit = build_circuit_from_qasm(qasm, n_qubits)
        baseline_state = build_baseline_state(sample, circuit)
        exp_val = qiskit_expectation(baseline_state, pauli)

        total += 1
        if ours["deterministic"]:
            target = float(ours["value"])
            ok = abs(exp_val - target) <= tol
        else:
            ok = abs(exp_val) <= tol

        if ours["deterministic"]:
            if ours["value"] == 1:
                ours_p_plus, ours_p_minus = 1.0, 0.0
            elif ours["value"] == -1:
                ours_p_plus, ours_p_minus = 0.0, 1.0
            else:
                ours_p_plus, ours_p_minus = None, None
        else:
            ours_p_plus, ours_p_minus = 0.5, 0.5

        qiskit_p_plus = (1.0 + exp_val) / 2.0
        qiskit_p_minus = (1.0 - exp_val) / 2.0

        # Z-basis distribution comparison
        q_probs = baseline_state.probabilities_dict()
        ours_state = build_ours_state_from_tableau(final_table)
        ours_probs = ours_state.probabilities_dict()
        z_l1, z_max = probability_distances(q_probs, ours_probs)

        # Sampling comparison (empirical)
        q_counts = baseline_state.sample_counts(shots)
        ours_counts = ours_state.sample_counts(shots)
        q_emp = {k: v / shots for k, v in q_counts.items()}
        ours_emp = {k: v / shots for k, v in ours_counts.items()}
        sample_l1, sample_max = probability_distances(q_emp, ours_emp)

        if ok:
            matched += 1
        elif len(mismatches) < 5:
            mismatches.append(
                f"sample={idx} pauli={pauli} ours={ours} qiskit={exp_val:.6f}"
            )

        rows.append(
            {
                "sample_index": idx,
                "n_qubits": n_qubits,
                "pauli": pauli,
                "ours_deterministic": ours["deterministic"],
                "ours_value": ours["value"],
                "ours_p_plus": ours_p_plus,
                "ours_p_minus": ours_p_minus,
                "qiskit_expectation": exp_val,
                "qiskit_p_plus": qiskit_p_plus,
                "qiskit_p_minus": qiskit_p_minus,
                "match": ok,
                "z_prob_l1": z_l1,
                "z_prob_maxdiff": z_max,
                "z_top_qiskit": topk_probs(q_probs, top_k),
                "z_top_ours": topk_probs(ours_probs, top_k),
                "sample_shots": shots,
                "sample_l1": sample_l1,
                "sample_maxdiff": sample_max,
            }
        )

    if output_csv and rows:
        os.makedirs(os.path.dirname(output_csv) or ".", exist_ok=True)
        with open(output_csv, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)

    return total, matched, mismatches


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare our stabilizer measurement with Qiskit expectation values."
    )
    parser.add_argument("--input", type=str, required=True, help="Path to dataset JSON.")
    parser.add_argument("--pauli", type=str, default="", help="Pauli operator, e.g., ZZI. Empty uses all-Z.")
    parser.add_argument("--max-items", type=int, default=50)
    parser.add_argument("--tol", type=float, default=1e-6)
    parser.add_argument("--output-csv", type=str, default="experiments/measurement_compare.csv")
    parser.add_argument("--shots", type=int, default=1024)
    parser.add_argument("--top-k", type=int, default=3)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    samples = load_dataset(args.input)
    total, matched, mismatches = compare_measurements(
        samples,
        args.pauli,
        args.max_items,
        args.tol,
        args.output_csv,
        args.shots,
        args.top_k,
    )
    acc = matched / total if total else 0.0
    print(f"Compared {total} samples, matched {matched}, accuracy {acc:.4f}")
    if total:
        print(f"CSV saved to: {args.output_csv}")
    if mismatches:
        print("Mismatches (first 5):")
        for line in mismatches:
            print(line)


if __name__ == "__main__":
    main()
