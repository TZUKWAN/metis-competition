/**
 * llm.ts — OpenAI 兼容 LLM 客户端（PRD §50：供应商通过 env 配置，不硬编码）
 * COMP_LLM_API_BASE / COMP_LLM_API_KEY / COMP_LLM_MODEL
 */
export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface LlmConfig {
  base: string;
  key: string;
  model: string;
}

export function getLlmConfig(): LlmConfig | null {
  const base = process.env.COMP_LLM_API_BASE;
  const key = process.env.COMP_LLM_API_KEY || process.env.PANGU_LLM_API_KEY;
  const model = process.env.COMP_LLM_MODEL;
  if (!base || !key || !model) return null;
  return { base: base.replace(/\/$/, ''), key, model };
}

/** 非流式对话补全；未配置或调用失败时抛错，由调用方诚实上报。config 可只给 temperature 等覆盖项 */
export async function chatCompletion(
  messages: LlmMessage[],
  config?: Partial<LlmConfig & { temperature: number }> | null,
): Promise<string> {
  const envCfg = getLlmConfig();
  const cfg = envCfg ? { ...envCfg, ...(config ?? {}) } : null;
  if (!cfg) throw new Error('LLM 未配置：请设置 COMP_LLM_API_BASE / COMP_LLM_API_KEY / COMP_LLM_MODEL');
  const { temperature = 0.7, ...rest } = cfg;
  // 关闭推理：当前推理型模型会把输出预算耗在思考上导致 content 为空，且逐页/逐章生成延迟过高
  const body = {
    model: rest.model,
    messages,
    temperature,
    reasoning: { enabled: false },
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 8_000 * attempt)); // 空返回退避重试（上游间歇性返回空内容）
    const resp = await fetch(`${rest.base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rest.key}` },
      body: JSON.stringify(body),
      // 推理型模型即使关闭推理，长文生成实测也可超过 5 分钟
      signal: AbortSignal.timeout(600_000),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      // 免费共享池 429/5xx 限流窗口可达数分钟，梯度退避硬扛（总计约 7.5 分钟）
      if ((resp.status === 429 || resp.status >= 500) && attempt < 4) {
        await new Promise((r) => setTimeout(r, 30_000 * 2 ** attempt));
        continue;
      }
      throw new Error(`LLM 调用失败 HTTP ${resp.status}: ${text.slice(0, 300)}`);
    }
    const data = (await resp.json()) as { choices?: { message?: { content?: string | null } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (content) return content;
  }
  throw new Error('LLM 返回为空（已重试）');
}

/** SSE 流式：逐块调用 onDelta，返回完整文本 */
export async function chatCompletionStream(
  messages: LlmMessage[],
  onDelta: (delta: string) => void,
  config?: LlmConfig | null,
): Promise<string> {
  const cfg = config ?? getLlmConfig();
  if (!cfg) throw new Error('LLM 未配置：请设置 COMP_LLM_API_BASE / COMP_LLM_API_KEY / COMP_LLM_MODEL');
  const resp = await fetch(`${cfg.base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({ model: cfg.model, messages, temperature: 0.7, stream: true, reasoning: { enabled: false } }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '');
    throw new Error(`LLM 流式调用失败 HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
        const delta = json.choices?.[0]?.delta?.content ?? '';
        if (delta) {
          full += delta;
          onDelta(delta);
        }
      } catch {
        // 忽略不完整块
      }
    }
  }
  if (!full) throw new Error('LLM 流式返回为空');
  return full;
}
