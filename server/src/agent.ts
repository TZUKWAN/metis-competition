/**
 * agent.ts — Competition Agent 对话（交互重构版）
 * 1. onboarding 状态机：选成果 → 五问（一轮一问、可恢复、自由输入不破坏流程）→ 总结 + 后台起名 → 自动编排
 * 2. 完成态对话：意图识别（新增成果 / 重做某部分 / 普通讨论），直接驱动现有任务
 * 3. current_context：前端传入当前查看的成果，Agent 知道"第 12 页字太多"指的是 PPT
 */
import { chatCompletion, getLlmConfig } from './llm.js';
import {
  ONBOARDING_QUESTIONS,
  OUTPUT_KEYS,
  artifactStatus,
  ensureSelectedOutputs,
  readFacts,
  readProjectMeta,
  updateProjectMeta,
  writeFacts,
  type OnboardingState,
  type OutputKey,
  type ProjectMeta,
} from './workspace.js';
import { appendMessage, appendMessages, loadChatHistory, nowIso, type ChatMsg } from './chatstore.js';
import { getPrompt } from './settings.js';
import { startAutoRun, isAutoRunning } from './orchestrator.js';

export type { ChatMsg };
export { loadChatHistory };

export interface ChatContext {
  type?: string;
  artifact?: string;
  page?: number;
}

const NL = String.fromCharCode(10);
const inFlight = new Set<string>();

const OUTPUT_LABELS: Record<OutputKey, string> = {
  business_plan: '商业计划书',
  ppt: '路演 PPT',
  demo: '产品 Demo',
  patent: '专利材料',
  copyright: '软件著作权',
};

const WELCOME = '你好，我会帮你完成大学生竞赛项目。你这次希望我帮你制作哪些内容？';

function questionText(step: OnboardingState['step']): string {
  return ONBOARDING_QUESTIONS.find((q) => q.step === step)?.text ?? '';
}

function questionField(step: OnboardingState['step']): keyof OnboardingState | undefined {
  return ONBOARDING_QUESTIONS.find((q) => q.step === step)?.field;
}

function nextStep(step: OnboardingState['step']): OnboardingState['step'] {
  const idx = ONBOARDING_QUESTIONS.findIndex((q) => q.step === step);
  if (idx < 0 || idx === ONBOARDING_QUESTIONS.length - 1) return 'summarize';
  return ONBOARDING_QUESTIONS[idx + 1].step;
}

function saveUserMsg(projectId: string, message: string): void {
  appendMessage(projectId, { role: 'user', content: message, at: nowIso() });
}

/** 新建项目时写入欢迎语 + 选择卡片 */
export function initProjectChat(projectId: string): void {
  if (loadChatHistory(projectId).length) return;
  appendMessages(projectId, [
    { role: 'assistant', content: WELCOME, at: nowIso() },
    { role: 'assistant', kind: 'selector', content: '', at: nowIso() },
  ]);
}

function extractJson<T>(text: string): T | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

/** selector 卡片「继续」按钮入口 */
export function selectOutputs(projectId: string, outputs: string[]): { selected: OutputKey[] } {
  const valid = outputs.filter((o): o is OutputKey => (OUTPUT_KEYS as readonly string[]).includes(o));
  if (!valid.length) throw new Error('请至少选择一项成果');
  const meta = readProjectMeta(projectId);
  const current = meta.onboarding ?? { step: 'select' as const };
  if (current.step === 'select') {
    const labels = valid.map((o) => OUTPUT_LABELS[o]).join('、');
    updateProjectMeta(projectId, {
      selected_outputs: valid,
      onboarding: { ...current, step: 'q1_market' },
    });
    appendMessages(projectId, [
      { role: 'assistant', content: `好的，本项目会制作：${labels}。`, at: nowIso() },
      { role: 'assistant', content: questionText('q1_market'), at: nowIso() },
    ]);
  }
  return { selected: valid };
}

/** onboarding 总结 + 触发编排（起名放后台，不阻塞） */
async function finishOnboarding(projectId: string, ob: OnboardingState, meta: ProjectMeta): Promise<void> {
  if (getLlmConfig() && meta.name === '新项目') {
    // 起名放后台：LLM 拥堵时可能要几分钟，不能卡住总结与自动编排
    void chatCompletion([
      { role: 'system', content: '根据项目描述起一个简洁有力的中文项目名（8-16字，不要书名号引号）。只输出名称本身。' },
      { role: 'user', content: `目标客户：${ob.market_and_customer ?? ''}${NL}产品效果：${ob.desired_outcome ?? ''}${NL}商业模式：${ob.business_model ?? ''}` },
    ], { temperature: 0.5 })
      .then((res) => {
        const cleaned = res.trim().replace(/^["'「『]+|["'」』]+$/g, '').split(NL)[0].slice(0, 40);
        const cur = readProjectMeta(projectId);
        if (cleaned && cur.name === '新项目') updateProjectMeta(projectId, { name: cleaned });
      })
      .catch(() => {
        // 起名失败保留现名，用户可在左栏重命名
      });
  }

  const finalOb: OnboardingState = { ...ob, step: 'done', completed: true };
  updateProjectMeta(projectId, { onboarding: finalOb });

  // 五问答案写入事实库（user_provided，供后续 skill 使用）
  const facts = readFacts(projectId);
  const add = (key: string, label: string, value?: string) => {
    if (!value?.trim()) return;
    if (facts.some((f) => f.key === key)) return;
    facts.push({ key, label, value: value.trim(), type: 'user_provided', source: 'onboarding', confirmed: true });
  };
  add('target_market', '目标市场', ob.market_and_customer);
  add('desired_outcome', '产品预期效果', ob.desired_outcome);
  add('business_model', '商业模式', ob.business_model);
  add('existing_resources', '已有资源', ob.existing_resources);
  add('university', '所属高校', ob.university);
  writeFacts(projectId, facts);

  const outputs = (meta.selected_outputs ?? []).map((o) => `- ${OUTPUT_LABELS[o as OutputKey] ?? o}`).join(NL) || '- （未选择）';
  appendMessage(projectId, {
    role: 'assistant',
    content:
      `我已经基本了解这个项目：${NL}${NL}项目方向：${meta.summary || meta.name}${NL}目标客户：${ob.market_and_customer || '待补充'}${NL}产品效果：${ob.desired_outcome || '待补充'}${NL}商业模式：${ob.business_model || '调研后给建议'}${NL}已有资源：${ob.existing_resources || '暂无'}${NL}所属高校：${ob.university || '未填写'}${NL}${NL}本项目需要制作：${NL}${outputs}${NL}${NL}我现在开始进行项目调研和产品规划。`,
    at: nowIso(),
  });
  startAutoRun(projectId, { skipDone: false });
}

/** 五问期间：保存答案 + 生成过渡回复（自由输入不破坏流程，LLM 慢时 45s 兜底） */
async function handleOnboardingAnswer(projectId: string, message: string, ob: OnboardingState): Promise<string> {
  const field = questionField(ob.step);
  const qText = questionText(ob.step);
  let saved: string | null = message;
  let reply = '';

  if (getLlmConfig()) {
    try {
      const res = await withTimeout(
        chatCompletion(
          [
            {
              role: 'system',
              content:
                '你是大学生竞赛项目助手，正在用一问一答的方式了解用户项目。当前问题是：「' + qText + '」。' + NL +
                '用户刚发送的消息可能是：对问题的回答，也可能夹带了别的问题或闲聊。' + NL +
                '规则：默认把用户消息当作对当前问题的回答提取到 saved_answer（保持用户原意，轻微整理即可，"不知道/没有/暂无"也算有效回答，哪怕答非所问也先存下来）；只有消息完全是与本问题无关的闲聊或提问（比如问产品能做什么），才把 saved_answer 设为 null，并在 reply 里先简短诚实回答，再自然地回到当前问题。' + NL +
                'reply 不要包含下一个引导问题（下一个问题由系统追加）。' + NL +
                '只输出 JSON：{"saved_answer": "提取的回答或 null", "reply": "给用户的话"}',
            },
            { role: 'user', content: message },
          ],
          { temperature: 0.4 },
        ),
        45_000,
      );
      const parsed = extractJson<{ saved_answer: string | null; reply: string }>(res);
      if (parsed) {
        saved = parsed.saved_answer ?? null;
        reply = parsed.reply ?? '';
      }
    } catch {
      // LLM 失败/超时 → 整条消息按回答保存，流程不中断
    }
  }

  // 只有拿到答案才推进状态机；纯闲聊/未回答则留在当前问题
  const next = saved ? nextStep(ob.step) : ob.step;
  const updated: OnboardingState = { ...ob, step: next };
  if (saved && field) {
    (updated as unknown as Record<string, unknown>)[field as string] = saved.trim();
  }
  updateProjectMeta(projectId, { onboarding: updated });

  if (saved && next === 'summarize') {
    if (reply) appendMessage(projectId, { role: 'assistant', content: reply, at: nowIso() });
    const meta = readProjectMeta(projectId);
    await finishOnboarding(projectId, updated, meta);
    return reply || '收到。';
  }

  const messages: ChatMsg[] = [];
  if (reply) messages.push({ role: 'assistant', content: reply, at: nowIso() });
  if (saved) {
    messages.push({ role: 'assistant', content: questionText(next), at: nowIso() });
  } else {
    messages.push({ role: 'assistant', content: `没关系，回到刚才的问题：${qText}`, at: nowIso() });
  }
  appendMessages(projectId, messages);
  return reply || (saved ? questionText(next) : qText);
}

/** 完成态对话：意图识别（新增成果/重做/闲聊）+ 直接驱动任务 */
async function handleNormalChat(projectId: string, message: string, context: ChatContext | undefined, meta: ProjectMeta): Promise<string> {
  if (!getLlmConfig()) {
    return '当前未配置 LLM（右上角 ⚙ 设置 → 模型与 API），暂时无法智能回复。已记录你的消息。';
  }
  const artifact_status = artifactStatus(projectId);
  const selected = meta.selected_outputs ?? [];
  const statusLine = selected
    .map((o) => `${OUTPUT_LABELS[o as OutputKey] ?? o}: ${artifact_status[o] ?? 'pending'}`)
    .join('；');
  const facts = readFacts(projectId)
    .map((f) => `- ${f.label}: ${f.value}`)
    .join(NL);
  const ctxLine = context?.type
    ? `${NL}用户刚在查看：${context.type}${context.page ? `（第 ${context.page} 页）` : ''}${context.artifact ? `（${context.artifact}）` : ''}。当他提到"这一页/首页/这个文档"时通常指它。`
    : '';
  const runningLine = isAutoRunning(projectId) ? `${NL}注意：后台正在执行生成任务。` : '';

  const res = await chatCompletion(
    [
      {
        role: 'system',
        content:
          getPrompt(
            'prompt.agent_system',
            '你是 METIS Competition 的竞赛项目助手。用户是大学生，正在和你一起准备创新创业比赛。你知道项目的全部资料与成果状态，可以直接驱动后台生成任务，不需要用户去找任何按钮。',
          ) +
          `${NL}${NL}当前项目：${meta.name}${NL}项目方向：${meta.summary}${NL}用户选择的成果：${selected.join(', ')}${NL}成果状态：${statusLine}${runningLine}${ctxLine}${NL}${NL}项目资料（onboarding 与调研得到的事实）：${NL}${facts}`,
      },
      {
        role: 'user',
        content:
          '分析这条用户消息，只输出 JSON：' + NL +
          '{"reply": "给用户的自然回复", "add_outputs": ["patent"], "rerun_outputs": ["demo"]}' + NL +
          "add_outputs：用户明确要求新增的成果（可选 demo/ppt/business_plan/patent/copyright）；" + NL +
          'rerun_outputs：用户明确要求重新生成已有成果时填写（如"重新做一下首页"→demo，"计划书市场分析太空了重新搜"→business_plan，"PPT重做"→ppt）；' + NL +
          '普通聊天/问进度/咨询则两者都省略。不许编造成果或进度。',
      },
      { role: 'user', content: message },
    ],
    { temperature: 0.4 },
  );
  const parsed = extractJson<{ reply: string; add_outputs?: string[]; rerun_outputs?: string[] }>(res);
  if (!parsed) return res.trim();

  const add = (parsed.add_outputs ?? []).filter((o) => (OUTPUT_KEYS as readonly string[]).includes(o) && !selected.includes(o));
  const rerun = (parsed.rerun_outputs ?? []).filter((o) => (OUTPUT_KEYS as readonly string[]).includes(o));

  if (add.length) {
    updateProjectMeta(projectId, { selected_outputs: [...selected, ...add] });
    startAutoRun(projectId, { skipDone: true });
    return `${parsed.reply.trim()}${NL}（已在右侧添加：${add.map((o) => OUTPUT_LABELS[o as OutputKey] ?? o).join('、')}，开始生成。）`;
  }
  if (rerun.length) {
    const taskMap: Record<string, string[]> = {
      demo: ['demo', 'demo_test', 'capture'],
      business_plan: ['business_plan'],
      ppt: ['ppt'],
      patent: ['patent'],
      copyright: ['copyright'],
    };
    startAutoRun(projectId, { skipDone: true, force: rerun.flatMap((o) => taskMap[o] ?? []) });
    return `${parsed.reply.trim()}${NL}（开始重新生成：${rerun.map((o) => OUTPUT_LABELS[o as OutputKey] ?? o).join('、')}，完成后右侧会更新。）`;
  }
  return parsed.reply.trim();
}

/** 对话入口。onboarding 未完成走状态机；完成态走意图识别。 */
export async function chat(projectId: string, message: string, _onDelta: (delta: string) => void, context?: ChatContext): Promise<string> {
  if (inFlight.has(projectId)) {
    throw new Error('上一条消息还在处理中，请等回复出现后再发送');
  }
  inFlight.add(projectId);
  try {
    return await chatInner(projectId, message, context);
  } finally {
    inFlight.delete(projectId);
  }
}

async function chatInner(projectId: string, message: string, context?: ChatContext): Promise<string> {
  saveUserMsg(projectId, message);
  const meta = ensureSelectedOutputs(projectId, readProjectMeta(projectId));
  const ob: OnboardingState = meta.onboarding ?? { step: 'done', completed: true };

  if (ob.step === 'select') {
    // 自由文本选择：LLM 提取成果；失败则引导使用勾选
    let outputs: OutputKey[] = [];
    let ack = '';
    if (getLlmConfig()) {
      try {
        const res = await withTimeout(
          chatCompletion(
            [
              {
                role: 'system',
                content:
                  '从用户消息里提取他想制作的竞赛成果。可选值：demo（产品Demo）、business_plan（商业计划书）、ppt（路演PPT）、patent（专利材料）、copyright（软件著作权）。' + NL +
                  '只输出 JSON：{"outputs": ["demo"], "reply": "一句确认的话"}。一个都提取不到就 outputs 为空数组，reply 里引导他明确说出想要什么。',
              },
              { role: 'user', content: message },
            ],
            { temperature: 0.3 },
          ),
          45_000,
        );
        const parsed = extractJson<{ outputs?: string[]; reply?: string }>(res);
        if (parsed) {
          outputs = (parsed.outputs ?? []).filter((o): o is OutputKey => (OUTPUT_KEYS as readonly string[]).includes(o));
          ack = parsed.reply ?? '';
        }
      } catch {
        // 走引导兜底
      }
    }
    if (outputs.length) {
      if (ack) appendMessage(projectId, { role: 'assistant', content: ack, at: nowIso() });
      selectOutputs(projectId, outputs);
      return ack;
    }
    const guide = '可以直接点上方卡片勾选你想要的内容（可多选），或者直接告诉我，比如"帮我做一份商业计划书和路演PPT"。';
    appendMessage(projectId, { role: 'assistant', content: ack ? `${ack}${NL}${guide}` : guide, at: nowIso() });
    return guide;
  }

  if (ob.step.startsWith('q')) {
    return handleOnboardingAnswer(projectId, message, ob);
  }

  if (ob.step === 'summarize') {
    await finishOnboarding(projectId, ob, meta);
    return '好的，我先按目前的了解开始做了，有需要随时补充。';
  }

  return handleNormalChat(projectId, message, context, meta);
}
