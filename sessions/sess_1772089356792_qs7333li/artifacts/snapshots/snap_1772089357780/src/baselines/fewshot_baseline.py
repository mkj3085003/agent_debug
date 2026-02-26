from __future__ import annotations

import argparse
import json
import os
from typing import Any, Dict, List

from openai import OpenAI

from src.baselines.baseline_utils import load_dataset, parse_table_output, select_fewshot_examples
from src.core.metrics import exact_match
from src.core.solver import TrackConfig, evolve_stabilizer_table, parse_qasm_to_gate_ops
from src.core.utils import format_table_as_lines


SYSTEM_TEMPLATE = """
You are an expert in stabilizer table calculations for Clifford circuits.
Given an initial stabilizer table and a circuit, output ONLY the final stabilizer table.
"""

USER_TEMPLATE = """
{fewshot_block}

INPUT JSON:
{input_json}

OUTPUT (final stabilizer table only):
"""


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


def build_fewshot_block(examples: List[Dict[str, Any]]) -> str:
    blocks: List[str] = []
    for ex in examples:
        init_table = ex.get("init_stabilizer_table") or ex.get("initial_table")
        circuit = ex.get("circuit")
        final_table = ex.get("final_stabilizer_table")
        if init_table is None or circuit is None or final_table is None:
            continue
        payload = json.dumps({"initial_table": init_table, "circuit": circuit}, ensure_ascii=False)
        blocks.append(
            "EXAMPLE\n"
            f"INPUT JSON:\n{payload}\n"
            "OUTPUT:\n"
            f"{format_table_as_lines(final_table)}\n"
        )
    return "\n".join(blocks)


def build_openai_messages(fewshot_block: str, input_json: str) -> List[Dict[str, str]]:
    user_content = USER_TEMPLATE.format(fewshot_block=fewshot_block, input_json=input_json)
    return [
        {"role": "system", "content": SYSTEM_TEMPLATE.strip()},
        {"role": "user", "content": user_content.strip()},
    ]


def get_openai_client() -> OpenAI:
    base_url = os.getenv("OPENAI_BASE_URL") or os.getenv("OPENAI_API_BASE")
    if base_url:
        return OpenAI(base_url=base_url)
    return OpenAI()


def run_fewshot_baseline(args: argparse.Namespace) -> None:
    samples = load_dataset(args.input)
    fewshot_examples = select_fewshot_examples(samples, args.num_examples)
    fewshot_block = build_fewshot_block(fewshot_examples)

    client = get_openai_client()

    total = 0
    correct = 0
    for sample in samples[: args.max_items]:
        payload = {
            "initial_table": sample.get("initial_table") or sample.get("init_stabilizer_table"),
            "circuit": sample.get("circuit"),
        }
        input_json = json.dumps(payload, ensure_ascii=False)
        messages = build_openai_messages(fewshot_block, input_json)
        response = client.chat.completions.create(
            model=args.model,
            temperature=args.temperature,
            messages=messages,
        )
        output = response.choices[0].message.content or ""
        pred = parse_table_output(output)
        ref = compute_reference(sample)
        if pred is not None and ref:
            total += 1
            if exact_match(pred, ref):
                correct += 1

    accuracy = correct / total if total else 0.0
    print(f"Few-shot baseline exact-match accuracy: {accuracy:.4f} ({correct}/{total})")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run few-shot LLM baseline evaluation.")
    parser.add_argument("--input", type=str, required=True, help="Path to dataset JSON.")
    parser.add_argument("--num-examples", type=int, default=3)
    parser.add_argument("--max-items", type=int, default=50)
    parser.add_argument("--model", type=str, default="gpt-4o")
    parser.add_argument("--temperature", type=float, default=0.0)
    return parser.parse_args()


if __name__ == "__main__":
    run_fewshot_baseline(parse_args())
