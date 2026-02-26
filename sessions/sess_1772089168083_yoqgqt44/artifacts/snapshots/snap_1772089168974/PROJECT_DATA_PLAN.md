# StabilizerGPT 实验数据规模与生成计划

---

## 1. 数据集分层设计

### D0：Sanity / 调试集
用于快速验证 pipeline 与 baseline 正常运行。
- n_qubits：3–5
- depth：4–10
- samples：2,000
- gate_weights：h=1,s=1,cx=2
- 说明：生成快，用于代码回归、RAG/few-shot 打通

### D1：主训练集（基础）
用于训练与主要对比实验。
- n_qubits：3–8
- depth：10–40
- samples：50,000
- gate_weights：h=1,s=1,cx=2
- 说明：作为论文主结果的数据规模基线

### D2：大规模训练集（论文级）
用于提升模型稳健性、外推能力。
- n_qubits：3–10
- depth：20–80
- samples：200,000
- gate_weights：h=1,s=1,cx=2
- 说明：需要较多计算资源；用于最终结果展示

### D3：外推测试集（不参与训练）
只用于测量泛化能力。
- n_qubits：9–12
- depth：60–120
- samples：20,000
- gate_weights：h=1,s=1,cx=2
- 说明：测试模型在更大规模上的性能衰减

### D4：分布偏移测试集（不参与训练）
用于 gate 分布变化的稳健性测试。
- n_qubits：3–8
- depth：10–40
- samples：20,000
- gate_weights：h=1,s=1,cx=5
- 说明：CX 占比上升，模拟更重纠缠电路

---

## 2. 数据集切分建议

- D0 / D1 / D2：按 80/10/10 切分 train/val/test
- D3 / D4：仅做 test（不参与训练）

---

## 3. 数据生成参数（生成器脚本）

推荐生成参数示例：

### D0
```
python3 -m src.data.generator \
  --n-qubits 4 \
  --num-samples 2000 \
  --init-depth 4 \
  --evolve-depth 8 \
  --seed 1 \
  --track-mode all \
  --include-qasm \
  --include-gate-sequence \
  --output data/raw/d0_sanity.json
```

### D1
```
python3 -m src.data.generator \
  --n-qubits 6 \
  --num-samples 50000 \
  --init-depth 6 \
  --evolve-depth 30 \
  --seed 2 \
  --track-mode all \
  --include-qasm \
  --include-gate-sequence \
  --output data/raw/d1_train.json
```

### D2
```
python3 -m src.data.generator \
  --n-qubits 8 \
  --num-samples 200000 \
  --init-depth 8 \
  --evolve-depth 60 \
  --seed 3 \
  --track-mode all \
  --include-qasm \
  --include-gate-sequence \
  --output data/raw/d2_train_large.json
```

### D3
```
python3 -m src.data.generator \
  --n-qubits 10 \
  --num-samples 20000 \
  --init-depth 10 \
  --evolve-depth 100 \
  --seed 4 \
  --track-mode all \
  --include-qasm \
  --include-gate-sequence \
  --output data/raw/d3_extrapolation.json
```

### D4
```
python3 -m src.data.generator \
  --n-qubits 6 \
  --num-samples 20000 \
  --init-depth 6 \
  --evolve-depth 30 \
  --seed 5 \
  --track-mode all \
  --include-qasm \
  --include-gate-sequence \
  --gate-weights h=1,s=1,cx=5 \
  --output data/raw/d4_shifted.json
```

---

## 4. 规模与资源建议

- D0：几分钟内完成，适合频繁回归
- D1：适合 baseline 对比实验
- D2：用于论文最终结果，建议在资源充足时生成
- D3/D4：生成一次即可用于泛化评测

---

## 5. 推荐实验流程

1) 先生成 D0，确认 pipeline 正常
2) 用 D1 完成主要 baseline 对比
3) 用 D3/D4 测试泛化
4) 资源允许时再生成 D2 做最终结果

---

## 6. 可选扩展（未来）

- 添加 T 门/噪声版本的 D1/D2
- 对比“状态表预测”与“直接测量预测”在大规模上的差距

