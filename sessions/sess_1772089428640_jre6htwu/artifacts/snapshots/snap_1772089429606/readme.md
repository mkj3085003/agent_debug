# StabilizerGPT

StabilizerGPT 是一个面向 **Clifford 电路稳定子表** 的研究代码库：
输入 OpenQASM（h/s/cx），输出 **规范化稳定子表（tableau）**，并通过确定性规则得到测量结果。RAG / LLM 作为对照基线。
当前已提供实验性的 T 门稳定子分解模拟（stabilizer frame）。

## 主要功能
- OpenQASM 3 子集解析（h / s / t / cx / cnot）
- 稳定子表演化与规范化
- 测量判定与一致性检查
- Qiskit 数据生成器
- LLM 基线：RAG / few-shot / 直接测量
- 指标：exact_match / bit_accuracy / commutation_check

## 环境与依赖
- Python 3.10+
- 核心依赖：`numpy`
- 数据生成：`qiskit`
- LLM 基线：`openai`、`langchain-*`、`chromadb`

### 安装示例
```
python -m venv venv
source venv/bin/activate
pip install numpy
pip install qiskit
pip install openai langchain-core langchain-community langchain-openai langchain-chroma chromadb
```

只使用 core 模块时，安装 `numpy` 即可。

## 快速开始（核心逻辑）
```python
from src.core.solver import parse_qasm_to_gate_ops, evolve_stabilizer_table, TrackConfig
from src.data.canonicalize import canonicalize_tableau

initial_table = [
    [1, 0, 0, 0, 0],
    [0, 1, 0, 0, 0],
]

qasm = """OPENQASM 3;
qubit[2] q;
h q[0];
cx q[0], q[1];
"""

ops = parse_qasm_to_gate_ops(qasm)
final_table, _ = evolve_stabilizer_table(initial_table, ops, track=TrackConfig(mode="final"))
canonical = canonicalize_tableau(final_table)
print(canonical)
```

## T 门模拟（实验性，stabilizer frame）
```python
from src.core.frame import StabilizerFrame
from src.core.solver import parse_qasm_to_gate_ops

initial_table = [
    [0, 1, 0],
]

qasm = """OPENQASM 3;
qubit[1] q;
t q[0];
"""

ops = parse_qasm_to_gate_ops(qasm)
frame = StabilizerFrame.from_table(initial_table)
frame.apply_circuit(ops)
frame.to_canonical()
print(frame.serialize())
```

## 数据生成（需要 qiskit）
```bash
python -m src.data.generator \
  --n-qubits 4 \
  --num-samples 2000 \
  --init-depth 4 \
  --evolve-depth 8 \
  --output data/raw/d0_sanity.json
```

常用参数：
- `--gate-weights h=1,s=1,cx=2`
- `--track-mode all|final|stride` + `--trace-stride`
- `--include-gate-sequence` / `--include-init-circuit`

## LLM Baselines（可选）
需要设置 OpenAI 相关环境变量：
```bash
export OPENAI_API_KEY=your_key
```

### RAG baseline
```bash
python -m src.baselines.rag_baseline \
  --input data/raw/d0_sanity.json \
  --max-items 50
```

### Few-shot baseline
```bash
python -m src.baselines.fewshot_baseline \
  --input data/raw/d0_sanity.json \
  --model gpt-4o \
  --max-items 50
```

### Direct measurement baseline
```bash
python -m src.baselines.direct_measure \
  --input data/raw/d0_sanity.json \
  --pauli ZZI \
  --max-items 50
```

## 指标与验证
- `src/core/metrics.py`：exact_match / bit_accuracy / commutation_check
- 详细说明见 `METRICS.md`

## 测试
```bash
pip install pytest
pytest
```

## 目录速览
- `src/core/`：稳定子表演化、QASM 解析、测量与指标
- `src/data/`：数据集与规范化
- `src/baselines/`：RAG / few-shot / 直接测量基线
- `tests/`：核心逻辑测试
- `PROJECT_PLAN.md` / `PROJECT_STRUCTURE.md` / `PROJECT_DATA_PLAN.md`：项目规划与实验说明

## 状态说明
当前训练流程仍是占位实现（`src/training/eval.py`），主要用于基线与数据管线验证。
