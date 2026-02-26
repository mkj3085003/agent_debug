# StabilizerGPT Code Framework (Proposed)

This document proposes a clean code framework that matches the project plan and keeps RAG as a baseline. It is a design blueprint and does not require immediate file moves.

---

## 1. Top-Level Layout

```
stabilizergpt/
  README.md
  PROJECT_PLAN.md
  PROJECT_STRUCTURE.md

  src/
    core/
      state_repr.py            # Abstract StateRepresentation interface
      tableau.py               # TableauState: canonicalization, gate updates
      measurement.py           # Measurement rules from tableau
      qasm_parser.py           # Minimal QASM -> gate ops
      metrics.py               # Exact match, bit accuracy, commutation checks

    data/
      dataset.py               # Dataset schema, IO helpers
      canonicalize.py          # Canonical form for tableau
      generator.py             # Data generation wrapper (calls solver)

    models/
      tokenizer.py             # QASM tokenization
      seq2seq.py               # Transformer model
      loss.py                  # Multi-task loss definitions

    training/
      train.py                 # Training loop
      eval.py                  # Evaluation loop
      configs.py               # Config dataclasses

    baselines/
      rag_pipeline.py          # RAG pipeline (baseline)
      rag_baseline.py          # RAG baseline entrypoint
      fewshot_baseline.py      # Few-shot prompt baseline
      direct_measure.py        # QASM -> measurement prediction baseline

    experiments/
      runs/                    # Outputs, logs, checkpoints
      scripts/                 # Run scripts for experiments

  data/
    raw/
    processed/
    splits/

  notebooks/
    error_analysis.ipynb
    results_plot.ipynb

  tests/
    test_tableau.py
    test_canonicalize.py
    test_metrics.py

  tools/
    export_dataset.py
    validate_dataset.py
```

---


## 2. Data Flow

1) QASM
2) QASM parser -> gate ops
3) TableauState evolves
4) Canonicalize tableau
5) Serialize output
6) Measurement via solver (post-processing)

---

## 3. Dataset Format (Recommended)

### 3.1 Minimal JSON schema
```
{
  "n_qubits": 6,
  "qasm": "...",
  "tableau_final": [[...]],
  "tableau_canonical": [[...]],
  "measurement": {
    "basis": "Z",
    "distribution": {...}
  }
}
```

### 3.2 Optional Fields
- `tableau_sequence` (for step supervision)
- `gate_sequence` (parsed ops)
- `metadata` (depth, gate counts)

---

## 4. Baselines

- `rag_baseline.py`: current RAG system kept for comparison
- `fewshot_baseline.py`: prompt-only baseline
- `direct_measure.py`: QASM -> measurement prediction baseline

---

## 5. Metrics & Evaluation

- Exact match (canonical tableau)
- Bit accuracy (X, Z, p)
- Commutation checks (physical consistency)
- Measurement correctness (distribution / expectation)
- Generalization (bigger n_qubits, deeper circuits)

---

## 6. Experiments Organization

- `experiments/scripts/`: reproducible run commands
- `experiments/runs/`: logs, checkpoints, results
- `notebooks/`: plots + error analysis

---

## 7. Minimal Run Commands (Example)

```
python -m src.data.generator --n-qubits 6 --num-samples 10000 --output data/raw/train.json
python -m src.training.train --config configs/base.yaml
python -m src.training.eval --config configs/base.yaml --split test
python -m src.baselines.rag_baseline --input data/raw/test.json
```

---

## 8. Design Principles

- Canonicalization is mandatory for training labels
- RAG is a baseline only
- Solver outputs remain authoritative
- Future T/noise expansion should not break training format
