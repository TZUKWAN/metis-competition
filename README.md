# METIS Competition

大学生竞赛团队全链路生产平台（PRD v2.0 MVP）：从一个比赛项目想法出发，自动完成联网调研 → 可运行产品 Demo → 自动截图/录屏 → 架构图 → 商业计划书 → 路演 PPT → 专利交底 → 软件著作权材料 → 一致性检查与答辩辅助，全部产出真实文件。

> 详细需求见 PRD v2.0；实施记录见 `PLAN.md` / `CLAUDE_STATE.md`。

## 功能（MVP 已全部落地）

| 能力 | 说明 |
|---|---|
| 项目工作空间 | 三栏 UI（成果树 / 内容区 / Agent 对话），JSON+文件系统存储（PRD §1.3） |
| 比赛规则解析 | 上传规则文件 → rules.json；无文件时默认竞赛模式 |
| 联网调研 | 搜索 provider 可配（serper / tavily / 免 key 浏览器抓取），来源全部落盘 sources.json |
| 产品 Demo | LLM 生成 React+Vite+TS+Tailwind 应用（5–8 页），Playwright 测试 + 自动修复 |
| 截图/录屏 | Playwright 1440×900 截图 + 双录屏，进资产库 manifest.json |
| 架构图 | sci-box 模板（分层架构/三栏框架/流程/路线图）+ 容量检查 + 失败自动缩字重试 |
| 商业计划书 | 用户大纲分章生成 + 财务三表（同一套假设脚本计算）+ DOCX/PDF |
| 路演 PPT | 模板解析 → slide-plan → OOXML 克隆替换 → PowerPoint 渲染 QA（25–35 页母稿） |
| 专利/软著 | 专利点挖掘/交底书/权要建议；软著四件套直接读取真实 Demo 源码 |
| QA/答辩 | 一致性检查、事实核查、PPT 检查、50 道答辩题（含建议回答要点） |
| 桌面端 | Electron 壳（`npm run electron`），与 Web 模式同源数据 |

## 快速开始

```bash
npm install            # 根目录（workspaces: server + web + electron）
cp .env.example .env   # 填入 LLM / 搜索 / 生图 / 视频 API 配置
npm run start          # Web 模式：http://localhost:8787
npm run electron       # 桌面模式（自动拉起服务并开窗口）
npm run test -w server # 服务端自测
```

流水线任务（Web UI 或 API 触发，固定顺序）：
`rules → research → demo → demo_test → capture → diagrams → images → video → business_plan → ppt → patent → copyright → qa_consistency → defense → deliver`

## 设计原则（PRD §1 / §71）

- 一个 Competition Agent + 顺序 Skill，不做多 Agent 编排
- 所有 LLM/搜索/生图/视频走 OpenAI 兼容 env 配置，不锁供应商；未配置的能力**如实失败**，绝不伪造
- 事实优先：无来源数据不写、预测必须标预测、软著必须读真实代码、PPT 优先复用模板与真实截图
- 用户手工修改过的文件，Agent 后续操作读取最新版本，不用缓存覆盖
