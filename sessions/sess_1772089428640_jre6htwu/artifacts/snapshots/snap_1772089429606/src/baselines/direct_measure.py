from __future__ import annotations

import argparse
import json
import os
from typing import Any, Dict, List

from openai import OpenAI

from src.baselines.baseline_utils import load_dataset
from src.core.measurement import measure_pauli_from_tableau
from src.core.solver import TrackConfig, evolve_stabilizer_table, parse_qasm_to_gate_ops


SYSTEM_TEMPLATE = """
You are an expert in stabilizer circuits. Given an initial stabilizer table and a Clifford circuit,
output the measurement result for the specified Pauli operator.
"""

USER_TEMPLATE = """
INPUT JSON:
{input_json}

MEASUREMENT:
{measurement}

Output JSON with keys: deterministic (true/false), value (+1/-1 or null).
"""


def compute_final_table(sample: Dict[str, Any]) -> List[List[int]]:
    initial = sample.get("initial_table") or sample.get("init_stabilizer_table")
    circuit = sample.get("circuit")
    if initial is None or circuit is None:
        return []
    gate_ops = parse_qasm_to_gate_ops(circuit)
    final_table, _ = evolve_stabilizer_table(initial, gate_ops, track=TrackConfig(mode="final"))
    return final_table


def build_openai_messages(input_json: str, measurement: str) -> List[Dict[str, str]]:
    user_content = USER_TEMPLATE.format(input_json=input_json, measurement=measurement)
    return [
        {"role": "system", "content": SYSTEM_TEMPLATE.strip()},
        {"role": "user", "content": user_content.strip()},
    ]


def get_openai_client() -> OpenAI:
    base_url = os.getenv("OPENAI_BASE_URL") or os.getenv("OPENAI_API_BASE")
    if base_url:
        return OpenAI(base_url=base_url)
    return OpenAI()


def run_direct_measure_baseline(args: argparse.Namespace) -> None:
    samples = load_dataset(args.input)
    client = get_openai_client()

    total = 0
    correct = 0
    for sample in samples[: args.max_items]:
        payload = {
            "initial_table": sample.get("initial_table") or sample.get("init_stabilizer_table"),
            "circuit": sample.get("circuit"),
        }
        input_json = json.dumps(payload, ensure_ascii=False)
        messages = build_openai_messages(input_json, args.pauli)
        response = client.chat.completions.create(
            model=args.model,
            temperature=args.temperature,
            messages=messages,
        )
        output = response.choices[0].message.content or ""

        # Parse simple JSON output
        try:
            pred = json.loads(output)
        except json.JSONDecodeError:
            continue

        final_table = compute_final_table(sample)
        if not final_table:
            continue
        ref = measure_pauli_from_tableau(final_table, args.pauli)

        if isinstance(pred, dict) and "deterministic" in pred:
            total += 1
            if pred.get("deterministic") == ref.get("deterministic") and pred.get("value") == ref.get("value"):
                correct += 1

    accuracy = correct / total if total else 0.0
    print(f"Direct measurement baseline accuracy: {accuracy:.4f} ({correct}/{total})")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run direct measurement LLM baseline.")
    parser.add_argument("--input", type=str, required=True, help="Path to dataset JSON.")
    parser.add_argument("--pauli", type=str, required=True, help="Pauli operator, e.g., ZZI")
    parser.add_argument("--max-items", type=int, default=50)
    parser.add_argument("--model", type=str, default="gpt-4o")
    parser.add_argument("--temperature", type=float, default=0.0)
    return parser.parse_args()


if __name__ == "__main__":
    run_direct_measure_baseline(parse_args())
