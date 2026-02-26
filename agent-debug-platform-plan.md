# Agent Debugging Platform (Replayable Agent Trace) - Project Plan
# Agent 调试平台（可回放执行轨迹）- 项目计划书

Last updated: 2026-02-26
最后更新：2026-02-26

## 1) Vision and Problem / 愿景与问题
Agents can execute complex multi-step tasks, but today they feel like a black box.
代理可以执行复杂的多步任务，但目前仍像“黑盒”。

We need a debugging platform that makes every agent run **observable, replayable, and auditable** so developers can understand and fix failures quickly.
我们需要一个调试平台，让每次代理执行都**可观测、可回放、可审计**，帮助开发者快速理解并修复失败。

## 2) Goals (MVP Focus: B + C) / 目标（MVP 聚焦 B + C）
Primary goals (MVP):
MVP 的主要目标：
- B: Provide a **timeline replay** that shows every step from input to output.
  B：提供**时间线回放**，展示从输入到输出的每一步。
- C: Enable **re-run from any step** with deterministic or live execution modes.
  C：支持**从任意步骤重跑**（可选择“复用结果”或“实时执行”）。

Secondary goal (next phase):
次要目标（下一阶段）：
- A: **Breakpoints + single-step execution** (requires deeper runtime control).
  A：**断点 + 单步执行**（需要更深层的运行时控制）。

## 3) Non-Goals (MVP) / 非目标（MVP 不做）
- Full IDE integration or language-aware debugging.
  完整的 IDE 集成或语言级调试（不做）。
- Perfect determinism across all tools and environments.
  跨所有工具/环境的完全确定性（不做）。
- Enforcing enterprise compliance policies (later).
  企业级合规策略（后续再做）。

## 4) Target Users / 目标用户
- Developers using agentic coding tools (Codex / CLI / IDE).
  使用代理式编程工具的开发者（Codex / CLI / IDE）。
- Small teams who need traceability to trust agent output.
  需要可追溯性以信任输出的小团队。
- Tool builders who need a debug substrate.
  需要调试底座的工具开发者。

## 5) Core Concepts / 核心概念
- **Session**: one user request + the agent's full execution.
  **会话**：一次用户请求 + 代理完整执行过程。
- **Step**: an atomic action (model response, tool call, file write, test run).
  **步骤**：原子行为（模型回复、工具调用、写文件、跑测试）。
- **Event**: structured log entry for timeline rendering and replay.
  **事件**：结构化日志，用于时间线渲染与回放。

## 6) System Architecture (High Level) / 系统架构（高层）
1) Recorder (Agent Wrapper)
   录制器（代理包装器）
   - Captures: user input, model output, tool calls, stdout/stderr, file diffs.
     捕捉：用户输入、模型输出、工具调用、stdout/stderr、文件 diff。
2) Storage (Local)
   存储（本地）
   - Event log: JSONL per session.
     事件日志：每个会话一份 JSONL。
   - File diffs: patches or snapshots.
     文件变化：patch 或 snapshot。
3) Replay Engine
   回放引擎
   - "Replay" mode: no execution; render recorded outputs.
     “回放”模式：不执行，仅渲染记录输出。
   - "Rerun" mode: re-execute tools from a chosen step onward.
     “重跑”模式：从指定步骤开始重新执行工具调用。
4) UI (Timeline)
   UI（时间线）
   - Step-by-step view with diff, logs, and call details.
     分步视图，包含 diff、日志、调用详情。

## 7) Event Schema (Detailed JSONL) / 事件模型（详细 JSONL）
Each line is a JSON object.
每行都是一个 JSON 对象。

Common fields:
通用字段：
- ts: ISO timestamp
  ts：ISO 时间戳
- sessionId: unique session id
  sessionId：会话唯一 ID
- step: monotonic step index
  step：递增步骤号
- type: event type
  type：事件类型
- meta: common metadata (cwd, agentName, host, pid)
  meta：通用元信息（cwd/agentName/host/pid）

Example:
示例：
```json
{
  "ts": "2026-02-26T10:12:05.231Z",
  "sessionId": "sess_01",
  "step": 12,
  "type": "tool.call",
  "tool": "bash",
  "input": { "command": "rg --files" },
  "meta": { "cwd": "/repo", "pid": 9231 }
}
```

Core event types:
核心事件类型：
- session.start / session.end
- user.input
- model.output
- tool.call / tool.result
- fs.diff (patch)
- fs.snapshot (optional, binary/large files)
- test.result
- error

Tool result example:
工具结果示例：
```json
{
  "ts": "2026-02-26T10:12:06.009Z",
  "sessionId": "sess_01",
  "step": 13,
  "type": "tool.result",
  "tool": "bash",
  "output": {
    "stdout": "file1.ts\nfile2.ts\n",
    "stderr": "",
    "exitCode": 0,
    "durationMs": 778
  }
}
```

FS diff example:
文件变化示例：
```json
{
  "ts": "2026-02-26T10:12:06.120Z",
  "sessionId": "sess_01",
  "step": 14,
  "type": "fs.diff",
  "files": [
    {
      "path": "src/entry.ts",
      "patch": "@@ ... @@\n- old\n+ new\n"
    }
  ]
}
```

## 8) Capture Strategy / 采集策略
### Model I/O / 模型输入输出
- Record user input.
  记录用户输入。
- Record model output (full text).
  记录模型输出（全文）。
- Record tool calls invoked by the model.
  记录模型触发的工具调用。

### Tool Execution / 工具执行
- Wrap tool dispatchers (shell, file, network, etc.).
  包装工具分发器（shell/文件/网络等）。
- Capture stdin/stdout/stderr, exit code, duration.
  捕捉 stdin/stdout/stderr、退出码、耗时。

### File Changes / 文件变化
Option A (simple, robust):
方案 A（简单、稳定）：
- Before and after each tool call, hash file tree.
  工具调用前后计算文件树哈希。
- Store unified diffs for changed files.
  对变化文件保存统一 diff。

Option B (future):
方案 B（后续）：
- Full snapshot for large refactors or binary files.
  对大型改动或二进制文件保存完整快照。

## 9) Replay Modes / 回放模式
1) Replay (no execution)
   回放（不执行）
   - Deterministic timeline from recorded events.
     根据事件日志构建确定性时间线。
2) Rerun (live execution)
   重跑（实时执行）
   - From step N onward, re-exec tool calls.
     从第 N 步开始重新执行工具调用。
   - Option to "reuse recorded tool outputs" to keep determinism.
     可选“复用历史工具输出”保持确定性。

## 10) MVP Scope (B + C) / MVP 范围（B + C）
Included:
包含：
- CLI wrapper to run agent and record events.
  CLI 包装器：运行代理并记录事件。
- JSONL event log + diff storage.
  JSONL 事件日志 + diff 存储。
- Web UI timeline viewer.
  Web 时间线浏览器。
- Rerun from step (reuse output vs live re-exec).
  从指定步骤重跑（复用输出或实时执行）。

Excluded:
不包含：
- Breakpoint stepping.
  断点单步。
- Multi-agent correlation.
  多代理关联。
- Enterprise auth / ACL.
  企业级鉴权/ACL。

## 11) Tech Stack (Suggested) / 技术栈（建议）
- Runtime: Node.js + TypeScript.
  运行时：Node.js + TypeScript。
- Storage: JSONL + sqlite (optional indexing).
  存储：JSONL + sqlite（可选索引）。
- UI: React + local static server.
  UI：React + 本地静态服务。
- Diff: jsdiff or git-style unified diff.
  Diff：jsdiff 或 git unified diff。

## 12) Milestones (6 Weeks) / 里程碑（6 周）
Week 1:
第 1 周：
- Define event schema and storage layout.
  定义事件模型与存储结构。
- Build CLI wrapper that records input/model output/tool calls.
  构建 CLI 包装器记录输入/输出/工具调用。

Week 2:
第 2 周：
- Implement file diff capture (patches).
  实现文件 diff 捕捉（patch）。
- Add stdout/stderr capture.
  加入 stdout/stderr 捕捉。

Week 3:
第 3 周：
- Build timeline UI to render steps + diffs.
  构建时间线 UI 渲染步骤与 diff。

Week 4:
第 4 周：
- Rerun engine (from step N).
  实现重跑引擎（从第 N 步）。
- Mode switch: replay vs re-exec.
  回放/重跑模式切换。

Week 5:
第 5 周：
- Hardening: performance, large sessions, config.
  稳定性：性能、大会话、配置。
- Privacy controls (redaction of secrets).
  隐私控制（敏感信息脱敏）。

Week 6:
第 6 周：
- Public demo + docs + sample integration (Codex CLI).
  Demo + 文档 + 示例接入（Codex CLI）。

## 13) Success Metrics / 成功指标
- Time-to-debug reduced by 50%.
  调试时间减少 50%。
- Reproducible sessions >= 80%.
  可复现会话占比 >= 80%。
- Users can identify the failing step in under 2 minutes.
  用户 2 分钟内能定位失败步骤。

## 14) Risks and Mitigations / 风险与对策
- Nondeterminism: add "reuse output" replay mode.
  非确定性：提供“复用输出”回放模式。
- Side effects: provide read-only replay mode and warning prompts.
  副作用：提供只读回放 + 危险操作提示。
- Data size: compress JSONL and cap diff storage.
  数据体积：压缩 JSONL，限制 diff 存储。
- Secrets leakage: configurable redaction rules.
  密钥泄露：可配置脱敏规则。

## 15) Immediate Next Steps / 立即可做的下一步
1) Confirm target integration: Codex CLI / IDE / other.
   确认目标集成：Codex CLI / IDE / 其他。
2) Decide storage layout (JSONL only vs JSONL + sqlite).
   决定存储方案（仅 JSONL vs JSONL + sqlite）。
3) Build prototype recorder and a simple timeline UI.
   构建录制器原型与简单时间线 UI。
