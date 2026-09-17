/**
 * agent.ts — Competition Agent 的对话与任务编排（PRD §1.1：一个主 Agent + 顺序任务）
 * M1 范围：对话能感知 project_id、读写项目事实；流水线任务入口在 skills/ 逐阶段接入。
 */
import fs from 'node:fs';
import path from 'node:path';
import { chatCompletionStream, getLlmConfig, type LlmMessage } from './llm.js';
import { getProject, projectDir, readFacts } from './workspace.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

function chatFile(projectId: string): string {
  return path.join(projectDir(projectId), 'qa', 'chat-history.json');
}

export function loadChatHistory(projectId: string): ChatMessage[] {
  try {
    return JSON.parse(fs.readFileSync(chatFile(projectId), 'utf8')) as ChatMessage[];
  } catch {
    return [];
  }
}

function saveChatMessage(projectId: string, msg: ChatMessage): void {
  const file = chatFile(projectId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const list = loadChatHistory(projectId);
  list.push(msg);
  fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
}

function buildSystemPrompt(projectId: string): string {
  const { project } = getProject(projectId);
  const facts = readFacts(projectId);
  const factLines = facts.map((f) => `- ${f.label}（${f.key}, ${f.type}, 已确认=${f.confirmed}）: ${f.value}`).join('\n');
  return [
    '你是 METIS Competition 的 Competition Agent，帮助大学生竞赛团队从一个项目想法出发，完成联网调研、产品 Demo、截图录屏、架构图、商业计划书、路演 PPT、专利和软件著作权材料。',
    `当前项目：${project.name}（${project.project_id}）`,
    `项目类型：${project.project_type}；比赛：${project.competition_name || '未指定'}；赛道：${project.track || '未指定'}`,
    '',
    '项目事实库（facts.json）：',
    factLines || '（空）',
    '',
    '规则：',
    '1. 只能基于项目事实和真实文件作答，不知道就说不知道，不要编造客户、收入、合作、专利等成果。',
    '2. 项目未完成的事项要用"计划/预计/拟/目标/Demo阶段"表述，不得写成已经发生。',
    '3. 你可以建议用户执行流水线任务（调研、Demo、计划书、PPT 等），但一次只推进一件事。',
  ].join('\n');
}

export async function chat(projectId: string, userMessage: string, onDelta: (delta: string) => void): Promise<string> {
  saveChatMessage(projectId, { role: 'user', content: userMessage, at: new Date().toISOString() });
  let reply: string;
  if (getLlmConfig()) {
    const history = loadChatHistory(projectId).slice(-20, -1);
    const messages: LlmMessage[] = [
      { role: 'system', content: buildSystemPrompt(projectId) },
      ...history.map((m) => ({ role: m.role, content: m.content }) as LlmMessage),
      { role: 'user', content: userMessage },
    ];
    reply = await chatCompletionStream(messages, onDelta);
  } else {
    // LLM 未配置：诚实返回 needs_input，不伪装 AI 回复
    reply =
      '当前未配置 LLM（需要环境变量 COMP_LLM_API_BASE / COMP_LLM_API_KEY / COMP_LLM_MODEL），暂时无法生成智能回复。\n\n' +
      `我已收到你的消息并记录到项目 ${projectId}。配置模型后我可以继续。`;
  }
  saveChatMessage(projectId, { role: 'assistant', content: reply, at: new Date().toISOString() });
  return reply;
}
