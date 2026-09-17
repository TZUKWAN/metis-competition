/**
 * deliver.ts — 最终交付目录组装（PRD §48）
 * 把一个项目的成果汇总到 deliverables/，只复制真实存在的文件，缺失项如实列出。
 */
import fs from 'node:fs';
import path from 'node:path';
import { projectDir, readFacts, setTaskStatus, touch } from '../workspace.js';

export async function runDeliver(projectId: string): Promise<{ copied: string[]; missing: string[] }> {
  setTaskStatus(projectId, 'deliver', 'running');
  try {
    const dir = projectDir(projectId);
    const facts = readFacts(projectId);
    const productName = facts.find((f) => f.key === 'project_name')?.value ?? projectId;
    const out = path.join(dir, 'deliverables');
    fs.rmSync(out, { recursive: true, force: true });

    const copied: string[] = [];
    const missing: string[] = [];
    // fs.cpSync 在本机 Node 25 + Windows 上多次触发原生崩溃（0xC0000409），改用 readdir+copyFile 手写递归
    const copyTree = (src: string, dest: string, filter?: (s: string) => boolean) => {
      const st = fs.statSync(src);
      if (st.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        for (const entry of fs.readdirSync(src)) {
          const s = path.join(src, entry);
          if (filter && !filter(s)) continue;
          copyTree(s, path.join(dest, entry), filter);
        }
      } else {
        fs.copyFileSync(src, dest);
      }
    };

    const put = (srcRel: string, destRel: string, filter?: (s: string) => boolean) => {
      const src = path.join(dir, srcRel);
      if (!fs.existsSync(src)) {
        missing.push(srcRel);
        return;
      }
      const dest = path.join(out, destRel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      copyTree(src, dest, filter);
      copied.push(destRel);
    };

    const noBuildArtifacts = (src: string) => {
      const rel = path.relative(path.join(dir, 'demo'), src).replace(/\\/g, '/');
      return !/^(node_modules|dist|test-results)\//.test(rel) && !/^(node_modules|dist|test-results)$/.test(rel);
    };

    put('business-plan/business-plan.docx', `${productName}商业计划书.docx`);
    put('business-plan/business-plan.pdf', `${productName}商业计划书.pdf`);
    put('ppt/final.pptx', `${productName}路演PPT.pptx`);
    put('ppt/final.pdf', `${productName}路演PPT.pdf`);
    put('demo', `产品Demo`, noBuildArtifacts); // 纯源码交付；整目录含 node_modules 的 cpSync 在 Windows 上会触发原生崩溃
    put('assets/videos/demo-full.mp4', `Demo演示视频.mp4`);
    put('patent', `专利材料`);
    put('software-copyright/exported', `软件著作权材料`);
    put('assets', `项目资产`);
    put('qa/defense-questions.md', `答辩问题与建议.md`);

    // 答辩问题 docx（若 LLM 可用则不必须；pandoc 直接转换已有 md）
    const dq = path.join(dir, 'qa', 'defense-questions.md');
    if (fs.existsSync(dq)) {
      const { spawnSync } = await import('node:child_process');
      const res = spawnSync('pandoc', [dq, '-o', path.join(out, `${productName}答辩问题与建议.docx`)], { encoding: 'utf8', timeout: 60_000 });
      if (res.status === 0) copied.push(`${productName}答辩问题与建议.docx`);
    }

    fs.writeFileSync(
      path.join(out, 'README.md'),
      `# ${productName} 交付清单\n\n## 已交付\n${copied.map((c) => `- ${c}`).join('\n')}\n\n## 缺失（上游任务未完成）\n${missing.length ? missing.map((m) => `- ${m}`).join('\n') : '（无）'}\n`,
      'utf8',
    );
    touch(projectId);
    setTaskStatus(projectId, 'deliver', 'done');
    return { copied, missing };
  } catch (err) {
    setTaskStatus(projectId, 'deliver', 'failed');
    throw err;
  }
}
