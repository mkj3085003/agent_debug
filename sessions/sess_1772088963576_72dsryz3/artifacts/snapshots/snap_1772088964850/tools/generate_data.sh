#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_PATH="$ROOT_DIR/data/raw/stabilizer_evolution_data.json"

python3 -m src.data.generator \
  --n-qubits 3 \
  --num-samples 5 \
  --init-depth 4 \
  --evolve-depth 6 \
  --seed 42 \
  --track-mode all \
  --trace-stride 1 \
  --include-qasm \
  --include-gate-sequence \
  --output "$OUT_PATH"

echo "\nGenerated dataset: $OUT_PATH"
