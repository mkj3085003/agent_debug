# Agent Debug Platform - Detailed Dev Plan & Code Architecture
# Agent 调试平台 - 详细开发计划与代码架构

Last updated: 2026-02-26
最后更新：2026-02-26

---

## 0) Scope & Assumptions / 范围与假设
- Focus on MVP B+C: timeline replay + rerun from step.
  聚焦 MVP B+C：时间线回放 + 从步骤重跑。
- First integration: Codex CLI via wrapper.
  首个接入：Codex CLI（通过 wrapper）。
- Local-first storage, no cloud backend.
  本地优先存储，不做云端后端。
- Use JSONL + file artifacts; optional sqlite index later.
  使用 JSONL + 文件制品，后续可加 sqlite 索引。

---

## 1) Product Requirements / 产品需求
### Must-have (MVP) / 必须有（MVP）
- Record full agent session as structured events (JSONL).
  记录完整会话为结构化事件（JSONL）。
- Visual timeline with step-by-step inspection.
  可视化时间线，可逐步查看。
- File diffs per step.
  每步文件 diff。
- Rerun from step with two modes:
  从任意步骤重跑，支持两种模式：
  - Reuse recorded tool outputs.
    复用历史工具输出。
  - Live re-execution.
    实时重新执行。

### Nice-to-have (Post-MVP) / 后续可选
- Breakpoints, single-step execution.
  断点、单步执行。
- Multi-agent correlation.
  多代理关联。
- Remote storage + sharing.
  远程存储与分享。

---

## 2) Architecture Overview / 架构总览
### Components / 组件
1) **CLI Wrapper**
   - Launches Codex CLI, intercepts IO, injects recorder.
   - 启动 Codex CLI，截获 IO，注入录制器。

2) **Recorder**
   - Emits structured events for user input, model output, tool calls/results.
   - 输出结构化事件：用户输入/模型输出/工具调用。

3) **Tool Adapters**
   - Shell, file, network, test runner.
   - 工具适配器：Shell/文件/网络/测试。

4) **Diff Engine**
   - Detects changed files and stores patch.
   - 识别文件变化并保存 patch。

5) **Event Store**
   - JSONL event log per session + artifacts folder.
   - 每会话一个 JSONL + 制品目录。

6) **Replay Engine**
   - Replay vs rerun.
   - 支持回放与重跑。

7) **Viewer UI**
   - Timeline, step detail, diff viewer, rerun controls.
   - 时间线、步骤详情、diff 查看、重跑按钮。

### Data Flow / 数据流
1) User runs `agent-debug run -- codex ...`
   用户运行 `agent-debug run -- codex ...`
2) Wrapper starts agent → Recorder subscribes to tool events
   Wrapper 启动代理 → Recorder 订阅工具事件
3) Events are streamed to JSONL
   事件流写入 JSONL
4) Diff engine computes patch after each tool step
   Diff 引擎在每步后生成 patch
5) Viewer reads JSONL + artifacts to render timeline
   Viewer 读取 JSONL + 制品渲染时间线
6) Rerun from step triggers Replay Engine
   从步骤重跑触发回放引擎

---

## 3) Repo Layout (Proposed) / 代码目录结构（建议）
```
agent-debug/
  apps/
    cli/                 # CLI wrapper
    viewer/              # Web UI
  packages/
    recorder/            # Event capture + schema
    tool-adapters/       # Shell/fs/net/test adapters
    diff-engine/         # File diff + snapshot
    replay/              # Replay + rerun engine
    store/               # JSONL + artifacts storage
    shared/              # Types, utils, config
  docs/
  examples/
  test/
```

---

## 4) Event Schema (Versioned) / 事件模型（版本化）
### Common Fields / 通用字段
- `schemaVersion`: "1.0.0"
- `sessionId`
- `step`
- `ts`
- `type`
- `meta`: { cwd, host, pid, agent }

### Key Events / 核心事件
- `session.start` / `session.end`
- `user.input`
- `model.output`
- `tool.call` / `tool.result`
- `fs.diff`
- `test.result`
- `error`

### Tool Call / Tool Result (Example)
```json
{ "type": "tool.call", "tool": "bash", "input": { "command": "rg --files" } }
{ "type": "tool.result", "tool": "bash", "output": { "stdout": "...", "exitCode": 0 } }
```

### FS Diff (Example)
```json
{ "type": "fs.diff", "files": [{ "path": "src/a.ts", "patch": "@@ ..." }] }
```

---

## 5) Storage Layout / 存储结构
```
sessions/
  sess_01/
    events.jsonl
    artifacts/
      diff/
        step_14.patch
      logs/
        step_13.stdout.txt
        step_13.stderr.txt
```

---

## 6) Rerun Strategy / 重跑策略
### Mode A: Reuse Outputs / 复用输出
- Uses recorded tool results.
- No side effects, fully deterministic.
- 直接读取历史结果，无副作用。

### Mode B: Live Re-Execution / 实时执行
- Re-exec tool calls from step N onward.
- Requires workspace safety checks.
- 从步骤 N 起重新执行，需要安全检查。

### Safety / 安全机制
- Rerun only in clean workspace or in a clone.
- Only allow re-exec if user confirms risk.
- 可在副本目录执行，避免污染主仓库。

---

## 7) MVP Development Plan / MVP 开发计划
### Phase 1: Recorder + CLI Wrapper (Week 1)
- Build `agent-debug run -- <command>` wrapper.
- Capture user input + model output.
- Emit JSONL events.

### Phase 2: Tool Adapters + Diff (Week 2)
- Intercept tool calls (shell/fs).
- Record stdout/stderr/exit code.
- Compute unified diff after each step.

### Phase 3: Viewer UI (Week 3)
- Timeline list with step cards.
- Step detail: tool input/output + diff viewer.

### Phase 4: Replay + Rerun (Week 4)
- Replay mode (no exec).
- Rerun mode with reuse or live re-exec.

### Phase 5: Hardening (Week 5)
- Redaction rules (API keys).
- Size limits + compression.
- Error recovery for partial sessions.

### Phase 6: Demo + Docs (Week 6)
- Demo with Codex CLI.
- README + usage docs.

---

## 8) Testing Plan / 测试计划
### Unit Tests / 单元测试
- Event schema validation.
- Diff engine correctness.
- Redaction rules.

### Integration Tests / 集成测试
- Full session recording.
- Replay rendering.
- Rerun from step.

---

## 9) Key Risks / 关键风险
- Non-determinism in live re-exec.
  实时重跑不确定性。
- Large sessions causing storage bloat.
  大会话导致存储膨胀。
- Tool adapters not covering all tool types.
  工具适配范围不全。

---

## 10) Immediate Next Steps / 立即下一步
1) Confirm Codex CLI integration details.
2) Build `agent-debug` wrapper skeleton.
3) Define schema v1 + storage layout.
4) Prototype viewer with mock JSONL.
