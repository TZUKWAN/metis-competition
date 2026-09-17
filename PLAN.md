# METIS Competition 实施计划（基于 PRD v2.0）

> 目标：按 PRD v2.0 交付 MVP（Milestone 1–10），主链跑通：
> 项目建档 → 规则解析 → 联网调研 → Demo → 测试 → 截图/录屏 → 架构图 → 计划书 → PPT → 专利/软著 → QA/答辩。

## 0. 现状勘察结论（2026-09-16）

- 工作目录 `D:\metis竞赛` 为空，本项目在此新建独立工程。
- PRD 所指"现有 METIS 仓库"= `D:\LATEXTEST\metis-alpha2-release`（Electron 科研工作台，已具备项目管理、文件树、AI 对话、Word/PPT 编辑、文件预览、用户系统、模型配置、API Key 管理 8 项能力）。该仓库属另一产品线且位于工作目录外，本阶段**不侵入修改**，仅作能力参考；Competition 以独立 Web 应用构建，保留将来迁入的接口余地。
- 环境：Node 25.6 / npm 11.8 / Python 3.13.2 / Git 2.54；GitHub 可访问（sci-box 仓库确认存在）。
- LLM：走 OpenAI 兼容接口，env 配置，不硬编码供应商。

## 1. 技术路线（最简实现）

```
D:\metis竞赛\
├── PLAN.md / CLAUDE_STATE.md
├── package.json            # 根脚本（dev/build/test）
├── server/                 # Node + Express + TypeScript
│   └── src/
│       ├── index.ts        # 入口：API + 静态服务
│       ├── workspace.ts    # 项目 CRUD、目录结构生成、文件读写
│       ├── agent.ts        # Competition Agent：顺序任务编排 + 对话
│       ├── llm.ts          # OpenAI 兼容 LLM 客户端（env 配置）
│       └── skills/         # 能力模块（普通函数，非独立 Agent）
│           ├── rules.ts        # 比赛规则解析 → rules.json + competition-rules.md
│           ├── research.ts     # 联网调研 → research/ + sources.json
│           ├── demo.ts         # Demo 生成（React+Vite+TS+Tailwind）+ npm build
│           ├── capture.ts      # Playwright 测试 + 截图 + 录屏 → assets/
│           ├── diagram.ts      # sci-box 接入 → assets/diagrams
│           ├── images.ts       # ImageProvider（生图 brief + 生成 + QA）
│           ├── video.ts        # VideoProvider（image-to-video）
│           ├── businessplan.ts # 按章节生成计划书 → DOCX/PDF + 财务三表
│           ├── ppt.ts          # 模板解析 + slide-plan + clone 替换 → pptx
│           ├── patent.ts       # patent-disclosure-skill 接入
│           ├── copyright.ts    # SoftwareCopyright-Skill 接入
│           └── qa.ts           # 一致性检查 + 事实检查 + 答辩问题
├── web/                    # React + Vite + TS + Tailwind 三栏 UI
└── workspace/competition/{project_id}/   # PRD §1.3 目录结构（JSON+文件系统）
```

- Demo 技术栈固定 React + Vite + TypeScript + Tailwind + mock 数据（PRD §9）。
- 测试/截图/录屏：Playwright（PRD §10–12）。
- 架构图：clone `jihe520/sci-box` 到 `third_party/sci-box`，调用其 diagram 能力（PRD §15）。
- 专利：`third_party/patent-disclosure-skill`；软著：`third_party/SoftwareCopyright-Skill`（PRD §38/40）。
- 计划书：按章节生成 Markdown → 合并 → DOCX/PDF；财务用同一套 assumptions 由脚本算三表（PRD §23/25）。
- PPT：模板 pptx → 渲染 PNG + 提取文本/占位 → template.json → slide-plan.json → clone 模板页替换文字/图片 → 渲染 QA（PRD §28–37）。不用 python-pptx 从零批量生成。
- 任务状态：tasks.json，状态 waiting/running/done/failed/needs_input（PRD §51）。

## 2. Server API 契约（v1）

- `GET  /api/projects` 项目列表
- `POST /api/projects` 新建项目（生成完整目录 + project.json/facts.json/sources.json/rules.json/tasks.json/assets/manifest.json/context.md）
- `GET  /api/projects/:id` 项目详情 + 文件树
- `GET  /api/projects/:id/file?path=` 读文件（文本/二进制）
- `PUT  /api/projects/:id/file?path=` 写文件（支持用户手工修改后回读，PRD §54）
- `POST /api/projects/:id/upload` 上传材料 → input/
- `GET  /api/projects/:id/facts` / `PUT` 事实库
- `POST /api/projects/:id/chat` 对话（SSE），Agent 感知当前 project_id 与当前节点
- `POST /api/projects/:id/run/:task` 执行流水线任务：rules|research|demo|capture|diagrams|images|video|business_plan|ppt|patent|copyright|qa（固定顺序，PRD §42）
- 静态服务：web 构建产物 + workspace 文件预览

## 3. 任务拆解（对应 PRD §72 Milestone）

| 阶段 | 内容 | 验收 |
|---|---|---|
| M1 | 项目工作空间 API + 三栏 UI 壳 + Agent 对话能拿到 project_id | 建项目后目录完整；重开仍在 |
| M2 | 规则解析 + 联网调研（search/open/extract，sources.json） | 给定 AI 教育项目产出调研包 |
| M3 | Demo 生成 + npm install/build + Playwright 基础测试 + 自动修复 | 浏览器能打开 Demo |
| M4 | Playwright 截图 6 张 + 录屏 + 封面帧 + manifest | PPT/计划书前能找到截图 |
| M5 | sci-box 架构图/流程图 → assets/diagrams | ≥1 架构图 + 1 流程图 |
| M6 | 商业计划书按章节生成 + 财务三表 + DOCX/PDF | 完整计划书 DOCX |
| M7 | PPT 模板解析 + slide-plan + clone 替换 + 渲染 QA | 25–35 页母稿沿用模板风格 |
| M8 | 生图 ImageProvider + image-brief + VLM QA；VideoProvider image-to-video | Hero 图/场景图/UI-on-device 图 |
| M9 | 专利交底书 + 软著材料（读真实 Demo 代码） | 真实文件输出 |
| M10 | consistency-report + fact-check + ppt-check + defense-questions | QA 报告齐全 |

## 4. 验证方式

- 每个 Milestone：真实命令输出 + 生成文件路径 + 测试结果，记录到 CLAUDE_STATE.md。
- 最终按 PRD §69 建测试项目"AI大学生竞赛辅助平台"，只输入一句想法，顺序完成 15 步；§70 文件级清单逐项核对。
- 禁止伪实现：任何步骤必须产生真实文件，LLM/搜索/生图必须真实调用并记录来源。

## 5. 风险点

1. LLM Provider 的 base URL/Key 需确认有效性（先做冒烟测试）。
2. Playwright 浏览器二进制下载体积大、可能受网络影响。
3. sci-box / 两个 Skill 仓库的实际接入成本需克隆后评估。
4. PPT 渲染 QA 依赖 LibreOffice/soffice（需确认本机是否安装）。
5. 联网搜索接口需要可用 provider（无 key 时调研步骤只能标注 needs_input，不得伪造来源）。

## 6. 完成标准与交付物

- 交付物：可运行的 METIS Competition Web 应用（server + web）、workspace 下完整测试项目、全部中间产物与最终 deliverables/。
- 完成标准：PRD §70 文件清单全部真实存在且内容一致；§69 的 15 步全部真实执行；各交付物项目名称/技术/数据互不冲突。
