from __future__ import annotations

import json
import os
import re
from collections import Counter
from typing import Dict, List, Optional, Sequence, Tuple

from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_community.vectorstores import Chroma
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableLambda

try:
    from langchain_core.documents import Document
except ImportError:
    from langchain_classic.docstore.document import Document  # type: ignore

try:
    from langchain_core.output_parsers import StrOutputParser
except ImportError:
    from langchain_classic.schema.output_parser import StrOutputParser  # type: ignore

from src.core.solver import GateOp, TrackConfig, evolve_stabilizer_table, parse_qasm_to_gate_ops
from src.core.utils import format_table_as_lines, parse_gate_names_from_qasm


OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_API_BASE = os.getenv("OPENAI_API_BASE", "https://models-proxy.stepfun-inc.com/v1/")

if OPENAI_API_KEY:
    os.environ["OPENAI_API_KEY"] = OPENAI_API_KEY
if OPENAI_API_BASE:
    os.environ["OPENAI_API_BASE"] = OPENAI_API_BASE


STABILIZER_SYSTEM_TEMPLATE = """
You are an expert in quantum information, specializing in Clifford gates and stabilizer table calculations. Your task is as follows:

1. **Task Description**
   - Given an initial stabilizer matrix [X|Z|p] and a quantum circuit composed of Clifford gates, compute the final stabilizer matrix after the circuit.
   - Apply each gate step by step, showing how the matrix evolves internally.
   - All matrix operations must strictly follow the transformation rules provided in the Context.

2. **Matrix Format and Phase Encoding**
   - The stabilizer matrix is in the extended form [X|Z|p]:
     - X: first n columns, representing the X components of each generator;
     - Z: next n columns, representing the Z components of each generator;
     - p: last column for phase encoding.
   - Phase column uses integer encoding:
     - 0 -> +1
     - 1 -> +i
     - 2 -> -1
     - 3 -> -i
   - All X and Z entries are binary (0 or 1).

3. **Output Requirements**
   - Output **only the final stabilizer matrix** [X|Z|p] in integer matrix format.
   - Do not include explanations or extra text in the output.
   - Ensure the final matrix format exactly matches the input: n rows, 2n+1 columns, phase column using 0/1/2/3 as described.

4. **Deterministic Reference (if provided)**
   - If a REFERENCE_RESULT is provided, it is authoritative.
   - You must output it exactly as the final answer.
   - If no reference is provided, compute the result using the rules in CONTEXT.

5. **Context**
   - The Context contains the exact transformation rules for H, S, and CNOT on the stabilizer matrix, plus worked examples.
"""


STABILIZER_USER_TEMPLATE = """
**INPUT JSON:**
{input_json}

**REFERENCE_RESULT (authoritative if present):**
{reference_result}

**CONTEXT (RULES + EXAMPLES):**
{context}

**TASK:** Output only the final stabilizer table matrix.
"""


STABILIZER_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", STABILIZER_SYSTEM_TEMPLATE),
        ("user", STABILIZER_USER_TEMPLATE),
    ]
)


def create_stabilizer_matrix_rules_documents() -> List[Document]:
    """Create rule documents with consistent 0/1/2/3 phase encoding."""
    rules_en = [
        "The stabilizer table matrix is [X|Z|p]. X and Z are binary blocks with n columns each; p is an integer phase column.",
        "Phase encoding: 0 -> +1, 1 -> +i, 2 -> -1, 3 -> -i. The total operator is i^p * P(X,Z).",
        "All X/Z updates are modulo 2 (XOR). Phase updates are modulo 4.",
        "A Pauli row is represented by x,z bits. If x=1 and z=1 on a qubit, that qubit is Y.",
        "H gate on qubit k: swap X_k and Z_k. If X_k=1 and Z_k=1 (before swap), update p = (p + 2) mod 4.",
        "S gate on qubit k: Z_k = Z_k XOR X_k. If X_k=1 and Z_k=1 (before update), update p = (p + 2) mod 4.",
        "CNOT gate with control c and target t: X_t = X_t XOR X_c; Z_c = Z_c XOR Z_t.",
        "CNOT phase update: if X_c=1 and Z_t=1 and (X_t XOR Z_c XOR 1)=1 (all evaluated before updates), then p = (p + 2) mod 4.",
        "For stabilizer states, generators are Hermitian, so p is typically 0 or 2; intermediate steps may still be tracked with 0/1/2/3.",
    ]

    documents: List[Document] = []
    for i, rule in enumerate(rules_en):
        documents.append(
            Document(
                page_content=rule,
                metadata={
                    "source": "stabilizer_rules",
                    "rule_id": i + 1,
                    "doc_type": "rule",
                },
            )
        )
    return documents


def infer_n_qubits_from_qasm(qasm: str) -> Optional[int]:
    match = re.search(r"qubit\\[(\\d+)\\]", qasm.lower())
    if match:
        return int(match.group(1))
    return None


def infer_n_qubits_from_table(initial_table: Sequence[Sequence[int]]) -> Optional[int]:
    if not initial_table:
        return None
    row_len = len(initial_table[0])
    if row_len < 3 or (row_len - 1) % 2 != 0:
        return None
    return (row_len - 1) // 2


def gate_sequence_from_inputs(inputs: Dict[str, object]) -> List[str]:
    gate_sequence = inputs.get("gate_sequence")
    if isinstance(gate_sequence, list) and gate_sequence:
        names = []
        for step in gate_sequence:
            if not isinstance(step, dict):
                continue
            name = step.get("name")
            if isinstance(name, str):
                names.append(name.lower())
        if names:
            return names

    circuit = inputs.get("circuit")
    if isinstance(circuit, str) and circuit.strip():
        return parse_gate_names_from_qasm(circuit)
    return []


def gate_sequence_from_sample(sample: Dict[str, object]) -> List[str]:
    gate_sequence = sample.get("gate_sequence")
    if isinstance(gate_sequence, list) and gate_sequence:
        names = []
        for step in gate_sequence:
            if not isinstance(step, dict):
                continue
            name = step.get("name")
            if isinstance(name, str):
                names.append(name.lower())
        if names:
            return names

    qasm = sample.get("circuit")
    if isinstance(qasm, str) and qasm.strip():
        return parse_gate_names_from_qasm(qasm)
    return []


def summarize_gate_counts(gate_seq: Sequence[str]) -> Dict[str, int]:
    counts = Counter(gate_seq)
    return {name: int(counts.get(name, 0)) for name in ("h", "s", "cx")}


def format_gate_counts(counts: Dict[str, int]) -> str:
    return " ".join([f"{name}={counts.get(name, 0)}" for name in ("h", "s", "cx")])


def bigrams(seq: Sequence[str]) -> List[Tuple[str, str]]:
    if len(seq) < 2:
        return []
    return list(zip(seq[:-1], seq[1:]))


def compute_overlap_score(
    query_counts: Dict[str, int],
    doc_counts: Dict[str, int],
    query_depth: int,
    doc_depth: int,
) -> float:
    overlap = sum(min(query_counts.get(k, 0), doc_counts.get(k, 0)) for k in ("h", "s", "cx"))
    denom = max(query_depth, doc_depth, 1)
    return overlap / denom


def compute_bigram_score(query_seq: Sequence[str], doc_seq: Sequence[str]) -> float:
    q_bi = set(bigrams(query_seq))
    d_bi = set(bigrams(doc_seq))
    if not q_bi or not d_bi:
        return 0.0
    inter = q_bi.intersection(d_bi)
    union = q_bi.union(d_bi)
    return len(inter) / len(union)


def compute_n_qubits_score(query_n: Optional[int], doc_n: Optional[int]) -> float:
    if query_n is None or doc_n is None:
        return 0.0
    return 1.0 - min(abs(query_n - doc_n) / max(query_n, doc_n), 1.0)


def rerank_documents(
    docs: Sequence[Document],
    query_n: Optional[int],
    query_seq: Sequence[str],
    query_counts: Dict[str, int],
) -> List[Document]:
    query_depth = len(query_seq)

    scored: List[Tuple[float, Document]] = []
    for doc in docs:
        meta = doc.metadata or {}
        doc_n = meta.get("n_qubits")
        doc_seq = meta.get("gate_sequence", [])
        if not isinstance(doc_seq, list):
            doc_seq = []
        doc_counts = meta.get("gate_counts", {})
        if not isinstance(doc_counts, dict):
            doc_counts = {}
        doc_depth = int(meta.get("depth", len(doc_seq)))

        overlap = compute_overlap_score(query_counts, doc_counts, query_depth, doc_depth)
        bigram = compute_bigram_score(query_seq, doc_seq)
        n_score = compute_n_qubits_score(query_n, doc_n)

        score = 0.45 * overlap + 0.35 * bigram + 0.2 * n_score
        scored.append((score, doc))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [doc for _, doc in scored]


def load_example_documents(
    json_path: str,
    max_examples: int = 200,
    include_sequence: bool = False,
) -> List[Document]:
    if not os.path.exists(json_path):
        return []

    with open(json_path, "r") as f:
        data = json.load(f)

    documents: List[Document] = []
    for idx, sample in enumerate(data[:max_examples]):
        init_table = format_table_as_lines(sample.get("init_stabilizer_table", []))
        final_table = format_table_as_lines(sample.get("final_stabilizer_table", []))
        qasm = sample.get("circuit", "")
        gate_sequence = sample.get("gate_sequence", [])

        gate_seq_names = gate_sequence_from_sample(sample)
        gate_counts = summarize_gate_counts(gate_seq_names)
        depth = len(gate_seq_names)
        n_qubits = sample.get("n_qubits")

        gate_str = " ".join(
            [
                f"{step['name']}({','.join(map(str, step['qubits']))})"
                for step in gate_sequence
                if isinstance(step, dict)
            ]
        )

        content = [
            f"EXAMPLE {idx}",
            f"N_QUBITS: {n_qubits}",
            f"DEPTH: {depth}",
            f"GATE_COUNTS: {format_gate_counts(gate_counts)}",
            "INITIAL_TABLE:",
            init_table,
        ]
        if qasm:
            content.extend(["CIRCUIT_QASM:", qasm])
        if gate_str:
            content.extend(["GATE_SEQUENCE:", gate_str])
        if include_sequence and sample.get("stabilizer_table_sequence_list"):
            content.extend(
                [
                    "SEQUENCE_STEPS:",
                    json.dumps(sample["stabilizer_table_sequence_list"][:5]),
                ]
            )
        content.extend(["FINAL_TABLE:", final_table])

        documents.append(
            Document(
                page_content="\n".join(content),
                metadata={
                    "source": "stabilizer_examples",
                    "example_id": idx,
                    "doc_type": "example",
                    "n_qubits": n_qubits,
                    "depth": depth,
                    "gate_counts": gate_counts,
                    "gate_sequence": gate_seq_names,
                },
            )
        )

    return documents


def format_docs(docs: Sequence[Document]) -> str:
    return "\n\n".join(doc.page_content for doc in docs)


def build_retrieval_query(inputs: Dict[str, object]) -> str:
    parts: List[str] = []
    circuit = inputs.get("circuit")
    if isinstance(circuit, str) and circuit.strip():
        parts.append(circuit)

    gate_names = gate_sequence_from_inputs(inputs)
    if gate_names:
        parts.append("gates: " + " ".join(gate_names))
        gate_counts = summarize_gate_counts(gate_names)
        parts.append("gate_counts: " + format_gate_counts(gate_counts))
        parts.append("depth: " + str(len(gate_names)))

    initial_table = inputs.get("initial_table")
    if isinstance(initial_table, list):
        n_qubits = infer_n_qubits_from_table(initial_table)
        if n_qubits is not None:
            parts.append(f"n_qubits: {n_qubits}")

    if isinstance(circuit, str) and circuit.strip():
        n_qubits = infer_n_qubits_from_qasm(circuit)
        if n_qubits is not None:
            parts.append(f"n_qubits: {n_qubits}")

    if not parts:
        parts.append("stabilizer table update rules for H S CX")

    return "\n".join(parts)


def parse_table_input(initial_table: object) -> List[List[int]]:
    if isinstance(initial_table, list):
        return initial_table
    if isinstance(initial_table, str):
        rows = []
        for line in initial_table.splitlines():
            line = line.strip()
            if not line:
                continue
            rows.append([int(v.strip()) for v in line.split(",")])
        return rows
    raise ValueError("Unsupported initial_table format.")


def gate_ops_from_inputs(inputs: Dict[str, object]) -> List[GateOp]:
    gate_sequence = inputs.get("gate_sequence")
    if isinstance(gate_sequence, list) and gate_sequence:
        ops: List[GateOp] = []
        for step in gate_sequence:
            if not isinstance(step, dict):
                continue
            name = step.get("name")
            qubits = step.get("qubits")
            if isinstance(name, str) and isinstance(qubits, list):
                ops.append((name, [int(q) for q in qubits]))
        if ops:
            return ops

    circuit = inputs.get("circuit")
    if isinstance(circuit, str):
        return parse_qasm_to_gate_ops(circuit)
    return []


def compute_reference_result(inputs: Dict[str, object]) -> Optional[str]:
    try:
        initial_table = parse_table_input(inputs.get("initial_table"))
        gate_ops = gate_ops_from_inputs(inputs)
        if not gate_ops:
            return None
        final_table, _ = evolve_stabilizer_table(
            initial_table, gate_ops, track=TrackConfig(mode="final")
        )
        return format_table_as_lines(final_table)
    except Exception:
        return None


def setup_rag_pipeline(rule_docs: List[Document], example_docs: List[Document]):
    embeddings = OpenAIEmbeddings()
    vectorstore = Chroma.from_documents(
        example_docs,
        embeddings,
        persist_directory="./chroma_db",
    )
    retriever = vectorstore.as_retriever(
        search_type="mmr",
        search_kwargs={"k": 12, "fetch_k": 64},
    )

    llm = ChatOpenAI(model="gpt-4o", temperature=0)

    def retrieve_context(inputs: Dict[str, object]) -> str:
        query = build_retrieval_query(inputs)
        docs = retriever.get_relevant_documents(query) if example_docs else []

        query_seq = gate_sequence_from_inputs(inputs)
        query_counts = summarize_gate_counts(query_seq)
        query_n = None
        initial_table = inputs.get("initial_table")
        if isinstance(initial_table, list):
            query_n = infer_n_qubits_from_table(initial_table)
        circuit = inputs.get("circuit")
        if query_n is None and isinstance(circuit, str):
            query_n = infer_n_qubits_from_qasm(circuit)

        reranked = rerank_documents(docs, query_n, query_seq, query_counts)
        if not reranked and example_docs:
            reranked = rerank_documents(example_docs, query_n, query_seq, query_counts)

        top_examples = reranked[:6]
        return format_docs(rule_docs + top_examples)

    def build_input_json(inputs: Dict[str, object]) -> str:
        payload = {
            "initial_table": inputs.get("initial_table"),
            "circuit": inputs.get("circuit"),
            "gate_sequence": inputs.get("gate_sequence"),
        }
        return json.dumps(payload, ensure_ascii=False, indent=2)

    rag_chain = (
        {
            "context": RunnableLambda(retrieve_context),
            "reference_result": RunnableLambda(compute_reference_result),
            "input_json": RunnableLambda(build_input_json),
        }
        | STABILIZER_PROMPT
        | llm
        | StrOutputParser()
    )

    return rag_chain, retriever


def main():
    print("1. Loading rule + example documents...")
    rule_docs = create_stabilizer_matrix_rules_documents()
    example_docs = load_example_documents("stabilizer_evolution_data.json", max_examples=50)

    print("2. Setting up RAG pipeline...")
    rag_chain, _ = setup_rag_pipeline(rule_docs, example_docs)

    sample_data = {
        "initial_table": [
            [0, 0, 0, 1, 1, 1, 1],
            [0, 0, 0, 0, 1, 1, 1],
            [0, 0, 0, 1, 0, 1, 1],
        ],
        "circuit": "OPENQASM 3.0;\ninclude \"stdgates.inc\";\nqubit[3] q;\nh q[2];\nh q[1];\ns q[1];\n",
    }

    inputs = {
        "initial_table": sample_data["initial_table"],
        "circuit": sample_data["circuit"],
    }

    print("\n--- Running RAG + deterministic solver ---")
    result = rag_chain.invoke(inputs)
    print(result)


if __name__ == "__main__":
    main()
