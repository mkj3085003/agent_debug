from __future__ import annotations

import argparse
from typing import Any, Dict, List

from src.baselines.baseline_utils import load_dataset, parse_table_output
from src.baselines.rag_pipeline import (
    create_stabilizer_matrix_rules_documents,
    load_example_documents,
    setup_rag_pipeline,
)
from src.core.metrics import exact_match
from src.core.solver import TrackConfig, evolve_stabilizer_table, parse_qasm_to_gate_ops


def compute_reference(sample: Dict[str, Any]) -> List[List[int]]:
    if "final_stabilizer_table" in sample:
        return [list(row) for row in sample["final_stabilizer_table"]]
    initial = sample.get("initial_table") or sample.get("init_stabilizer_table")
    circuit = sample.get("circuit")
    if initial is None or circuit is None:
        return []
    gate_ops = parse_qasm_to_gate_ops(circuit)
    final_table, _ = evolve_stabilizer_table(initial, gate_ops, track=TrackConfig(mode="final"))
    return final_table


def run_rag_baseline(args: argparse.Namespace) -> None:
    samples = load_dataset(args.input)
    rule_docs = create_stabilizer_matrix_rules_documents()
    example_docs = load_example_documents(args.examples, max_examples=args.max_examples)
    rag_chain, _ = setup_rag_pipeline(rule_docs, example_docs)

    total = 0
    correct = 0
    for sample in samples[: args.max_items]:
        inputs = {
            "initial_table": sample.get("initial_table") or sample.get("init_stabilizer_table"),
            "circuit": sample.get("circuit"),
            "gate_sequence": sample.get("gate_sequence"),
        }
        output = rag_chain.invoke(inputs)
        pred = parse_table_output(output)
        ref = compute_reference(sample)
        if pred is not None and ref:
            total += 1
            if exact_match(pred, ref):
                correct += 1

    accuracy = correct / total if total else 0.0
    print(f"RAG baseline exact-match accuracy: {accuracy:.4f} ({correct}/{total})")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run RAG baseline evaluation.")
    parser.add_argument("--input", type=str, required=True, help="Path to dataset JSON.")
    parser.add_argument(
        "--examples",
        type=str,
        default="data/raw/stabilizer_evolution_data.json",
        help="Path to example dataset for retrieval.",
    )
    parser.add_argument("--max-examples", type=int, default=200)
    parser.add_argument("--max-items", type=int, default=50)
    return parser.parse_args()


if __name__ == "__main__":
    run_rag_baseline(parse_args())
