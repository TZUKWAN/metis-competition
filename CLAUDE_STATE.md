# CLAUDE_STATE.md — METIS Competition 开发状态

## 当前目标
按 PRD v2.0（`C:/Users/lauze/Downloads/METIS_Competition_PRD_v2.0_detailed.md`）在 `D:\metis竞赛` 交付 MVP。计划见 `PLAN.md`。
**状态：M1–M10 全部完成；2026-09-17 已按 PRD §69 完成「AI大学生竞赛辅助平台」全流程测试（comp_003），§70 文件清单 23/23 全部 PASS。**


## 交互重构（2026-09-17，commit b215bdc + 修复提交）
已按重构指令完成极简三栏改造（项目列表 / AI 对话 / 生成物），旧阶段导航废弃：
- onboarding 状态机：零表单新建 → 勾选成果卡片 → 五问（一轮一问，LLM 转场带 45s 兜底）→ 总结 + 后台起名 → 自动编排；状态持久化于 project.json（selected_outputs/onboarding）
- orchestrator.ts：按 selected_outputs 生成任务计划（含依赖失败传播、无 API 的 images/video 自动跳过、强制重做清理）；进展以 kind:tool 消息写入聊天
- agent 完成态对话带意图识别：add_outputs（补做专利等）/ rerun_outputs（重做首页等），直接驱动任务
- artifact_status 由 tasks.json + 文件存在动态计算（pending/running/done/attention），旧项目自动推断兼容
- 设置页三 Tab：模型与API（测试连接）/ Skills 开关 / Prompts 编辑（getPrompt 已接入 12 个关键提示词）
- comp_004 实测：零表单新建 → 三问选项 → 五问 → 自动跑完 rules/research/demo/demo_test/capture/diagrams/business_plan/qa/defense；
  PPT 因缺模板失败 → 📎 上传模板 → 对话「重试路演PPT」→ 恢复完成 → deliver 重跑。全链路闭环验证 ✓
- 已知残留：research 一度因 LLM 拥堵变慢（有重试兜底）；专利/软著未选择时不进交付物（已修复空目录问题）

## 测试 API（刘总提供，写入 .env）
- LLM：OpenRouter `https://openrouter.ai/api/v1`，model `stealth/union-alpha`（免费共享池，不稳定：上游 429 限流 / 偶发空 content，llm.ts 已加梯度退避硬扛）
- 搜索：无 serper/tavily key；OpenRouter `:online` 插件需充值不可用 → 已实现 `SEARCH_PROVIDER=browser`（Playwright 真浏览器抓百度，<3 条结果补搜狗，跳转链接还原真实 URL；cn.bing.com 多词中文查询真浏览器也会降级，弃用）
- 生图/视频：无 key，images/video 任务如实 failed（PRD §74 允许），后续配 IMAGE_API_*/VIDEO_API_* 即可启用

## 任务清单（Milestone + 全流程验收）
- [x] M1–M10 机制（详见 git 前状态记录，全部自测通过）
- [x] 全流程：rules→research→demo→demo_test→capture→diagrams→images→video→business_plan→ppt→patent→copyright→qa_consistency→defense→deliver 全部真实执行（comp_003）
- [x] §70 文件清单 23/23 PASS：8 截图 / 3 图（架构+功能+核心流程；技术路线图因容量检查未过，已如实告警）/ 2 视频 / 35 页 PPT 渲染 / 16 条真实来源 / 8 个 Demo 页面 / 10 章计划书
- [x] deliverables/ 全量组装：计划书 docx+pdf、PPT pptx+pdf、产品Demo（源码）、演示视频、专利材料、软著材料、项目资产、答辩问题 docx，README 缺失项=（无）

## 本次修复的关键 bug（均为全流程实测暴露）
1. `env.ts` 的 loadEnv 定义后无人调用 → 模块加载自执行
2. llm.ts：推理模型会耗尽预算返回空 content → `reasoning:{enabled:false}` + 空返回/429/5xx 退避重试（429 梯度 30s→240s）
3. Windows：`shell:false` 直接 spawn `npm.cmd` 在 Node≥18.20 返回 EINVAL（空输出假象）→ npm 一律 `shell:isWin`；`fs.cpSync` 大目录拷贝触发 0xC0000409 原生崩溃 → deliver 改 readdir+copyFile 手写递归（demo 交付排除 node_modules/dist/test-results）
4. demo：page-plan 已存在则沿用（防重跑规划漂移 + 用户修改优先）；file 字段 basename 规整；页面级 3 轮重试
5. **构建修复 LLM 两次"大力出奇迹"**：重写 App.tsx（BrowserRouter+桩页面）+ 新建 src/App.jsx（vite 解析 .jsx 优先于 .tsx，导致 8 个富页面运行时全被旁路，页面只剩标题）→ applyFileBlocks 物理防护（禁改 App/main/vite.config/package.json、禁新增 src/pages 文件与 .jsx），修复提示词加同款硬性约束
6. demo_test：vite preview 只绑 ::1 而 chromium 走 127.0.0.1 → vite.config 显式 `host:'127.0.0.1'` + 全部 URL 改 127.0.0.1；`locator('main, #root')` 多元素命中严格模式报错被 catch 吞掉 → 只取 `#root`；killPort 改 Node 解析 netstat + taskkill
7. diagrams：sci-box 容量检查失败 → 报错反馈 LLM 缩字重试一次；单图失败不拖垮任务（≥2 张即 done）；已有 PNG 跳过续跑并补 manifest

## 测试结果记录（comp_003，2026-09-17）
- demo_test 10/10 通过（8 页可访问、无控制台错误）；截图内容饱满（110–138KB/张）
- QA 报告质量符合 PRD §44–47：consistency-report 发现真实冲突（软著申请表软件名"未命名软件" vs 项目名），只报告不擅改；fact-check / ppt-check / defense-questions(50题) 齐全
- PPT slide-07 实拍验证：嵌真实 Demo 截图（PRD 规则2）；个别 image_text 页文字与图片有遮挡，属母稿可接受范围（规则11，人工可继续改）
- 残余：技术路线图（roadmap_5band）两次缩字重试仍容量不过，已如实告警不阻塞；软著申请表"软件全称"需用户确认后统一

## 运行方式
- `npm run start`（根目录，server 8787 + 静态 web/dist）；流水线 `POST /api/projects/:id/run/:task`
- 搜索 provider 配置见 `.env`（SEARCH_PROVIDER=browser 免 key 可用；有 serper/tavily key 时换回）

## 下一步（可选增强，非验收必需）
1. 补 IMAGE_API_*/VIDEO_API_* 后重跑 images、video，再重跑 ppt 让母稿用上真实感图片/视频封面
2. 软著软件全称/简称确认后重跑 copyright + deliver
3. serper/tavily key 到位后切换 SEARCH_PROVIDER 提升调研稳定性（browser 模式受百度风控波动影响）
