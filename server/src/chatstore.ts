/**
 * chatstore.ts — 聊天记录存储（qa/chat-history.json）
 * 消息种类：普通 user/assistant 文本；kind:'tool' 工具执行块（编排器写入）；kind:'selector' 成果选择卡片。
 */
import fs from 'node:fs';
import path from 'node:path';
import { projectDir } from './workspace.js';

export interface ChatMsg {
  role: 'user' | 'assistant';
  /** 工具块消息可为空字符串 */
  content?: string;
  at: string;
  /** 工具执行块：前端渲染为紧凑状态行，默认折叠 */
  kind?: 'tool' | 'selector';
  task?: string;
  status?: 'running' | 'done' | 'failed' | 'skipped';
  title?: string;
  detail?: string;
}

function chatFile(projectId: string): string {
  return path.join(projectDir(projectId), 'qa', 'chat-history.json');
}

export function loadChatHistory(projectId: string): ChatMsg[] {
  try {
    return JSON.parse(fs.readFileSync(chatFile(projectId), 'utf8')) as ChatMsg[];
  } catch {
    return [];
  }
}

export function appendMessages(projectId: string, msgs: ChatMsg[]): void {
  const file = chatFile(projectId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const list = loadChatHistory(projectId);
  list.push(...msgs);
  fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
}

export function appendMessage(projectId: string, msg: ChatMsg): void {
  appendMessages(projectId, [msg]);
}

export function nowIso(): string {
  return new Date().toISOString();
}
