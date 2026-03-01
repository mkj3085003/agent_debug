# Runtime Debug Agent (Python-first) 计划与规划

## 目标与范围

**核心目标**：提供一个“agent 化”的运行时单步调试工具，用户在任意项目文件夹中启动它，agent 自动完成调试配置并执行调试流程；在单步执行过程中可与用户对话，解释当前状态、变量与执行路径。

**首期范围**（MVP）：
- 仅支持 **Python**（基于 debugpy + DAP）。
- 以 CLI 交互为主（REPL/对话式交互）。
- 自动完成“调试配置”和“入口识别”的最小闭环。

**非目标**（首期不做）：
- 全语言支持（后续扩展）。
- GUI（先以 CLI/简单 TUI 为主）。
- 分布式/远程调试（首期仅本机）。
 ./runtime-debug-agent/bin/rda.js start --lang python --program /Users/jyxc-dz-0100361/Desktop/project/agent_debug/src/core/frame.py --ui
---

## 产品形态

- 运行在项目根目录的 **agent CLI**（可脚本化调用）。
- 用户输入“调试需求”（例如入口脚本/模块/参数、断点意图、是否停在入口）。
- agent 自动完成：
  1) 识别语言/入口
  2) 生成/补全调试配置
  3) 启动 debug adapter + 目标进程
  4) 进入交互式调试（step/next/bt/vars/eval）
  5) 用户可随时提问“这一步在做什么、变量含义、执行路径”等

---

## 关键能力（MVP）

1) **Python 入口自动识别**
   - 识别 `pyproject.toml` / `requirements.txt` / `setup.py` / `main.py` 等
   - 识别可执行入口：
     - `--program` 直接脚本
     - `--module` Python module
   - 未识别时对话询问用户

2) **自动调试配置**
   - 自动生成 debugpy 的 DAP 启动参数
   - 自动合并用户提供的参数/环境变量
   - 自动设置断点（文件+行号）

3) **运行时单步调试**
   - 统一 DAP 客户端控制：step/next/continue/out
   - 变量查看与表达式求值
   - 堆栈回溯（bt）

4) **对话式解释**
   - 运行中可询问：
     - “当前执行到哪里？”
     - “这一步变量的含义？”
     - “为什么进入了这个函数？”
   - agent 基于 DAP 状态（栈帧、变量、源码片段）生成解释

---

## 用户体验流程（MVP）

1) 用户进入项目目录执行：
   - `rda start` 或 `rda start --lang python`
2) agent 自动探测入口与环境
3) 如果入口不明确，agent 询问：
   - “检测到 X / Y，你要调试哪个入口？”
4) 自动启动 debugpy adapter + 目标程序
5) 进入调试 REPL：
   - `next/step/bt/vars/eval`
   - 同时支持自然语言提问

---

## 系统架构（MVP）

- **RDA CLI**（本地进程）
  - 入口发现 & 交互
  - 调试会话管理
  - DAP 客户端
  - 对话/解释层

- **Debug Adapter**
  - Python: `debugpy.adapter`

- **DAP Client**
  - 发送/接收调试协议消息
  - 维护运行时状态（线程、栈帧、变量）

---

## 里程碑规划

### M0：准备
- 明确需求与交互方式
- 设定首期只做 Python

### M1：最小可运行（2~4 周）
- CLI 启动 Python 调试
- 支持基本 step/next/bt/vars/eval
- 支持简单断点设置

### M2：自动配置与入口识别（2 周）
- 识别项目入口脚本/模块
- 自动配置参数、环境变量
- 入口冲突时对话询问

### M3：对话式解释（2 周）
- 针对当前栈帧/变量生成解释
- 支持常见问题（执行路径、变量含义）

### M4：扩展与稳定（后续）
- 扩展 Node/Go 等语言
- 提升断点策略与代码导航能力
- 支持记录/回放

---

## 技术选型与依赖

- **Python 调试器**：debugpy
- **调试协议**：DAP
- **CLI**：Node.js / TypeScript 或纯 Node JS

---

## 风险与应对

- **入口识别不准确**：通过对话补足
- **Python 环境多样**：允许指定 `--python` 或读取虚拟环境
- **复杂多进程调试**：首期仅支持单进程

---

## 下一步动作（建议）

1) 完成 Python MVP
2) 添加自动入口识别与对话补足
3) 设计统一 DAP 扩展接口，为多语言铺路

