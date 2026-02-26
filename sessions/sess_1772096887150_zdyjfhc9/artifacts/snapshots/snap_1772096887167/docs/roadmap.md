# Agent Debug Platform Roadmap

本文档记录后续演进规划，基于当前已完成的能力与已知短板。

## 当前状态（已能跑通）
- 记录层：run / codex-exec 记录 session，包含工具调用、diff/snapshot、错误事件
- Viewer：时间线 + step 详情 + “恢复到此步 / 从此步 rerun”
- Diff：split/unified、统计、行号、增删高亮
- Prompt：codex-exec 的 prompt 与 agent_message 已记录并展示
- 过滤与标记：Changes/Errors/Tools/Prompts 过滤，事件有 badge
- 记录策略：默认忽略只读命令，支持 ignore/only/important

## 已知短板
- codex prompt 抽取仍是启发式解析，复杂组合参数可能漏掉
- codex 事件仍以 codex.event 为主，结构化 user/model/tool 事件不完整
- diff 仍以文件内容为主，缺少增量 patch 优化
- rerun 仅支持 shell 工具，复杂工具链未打通
- Viewer 缺少搜索/标注/折叠/虚拟列表（大 session 性能可提升）

## Phase 1（1-2 周）：记录质量与一致性
- 完整的 codex prompt 解析（支持 --prompt/-p, --input-file, 多段参数）
- stdin/管道 prompt 采集（无显式 prompt 时也能记录）
- codex event → 结构化事件映射（user.input / model.output / tool.call / tool.result）
- 工具输出细化（stdout/stderr/exitCode/duration）
- 记录解释字段（先规则生成，后续可接模型）

## Phase 2（2-4 周）：恢复与差异优化
- 增量 patch + 周期快照（降低存储与提升 restore 性能）
- 大文件/二进制策略（阈值 + 忽略列表）
- checkpoint 索引，提升 restore 稳定性

## Phase 3（4-6 周）：Viewer 体验提升
- 时间线搜索、折叠、虚拟列表
- Prompt 与 diff 双向联动强化
- step 注释（手动/自动）

## Phase 4（持续）：rerun 与自动化
- 多工具 rerun 支持（非 shell）
- 半自动 rerun（指定从某 step 真实执行，其余复用）
- E2E 测试与回归脚本

## 当前执行（进行中）
- Phase 1 / Step 4：记录 explain 字段（规则生成，后续可接模型）
