import { type ReactNode } from "react";

type SrcResolver = (src: string) => string;

function renderInline(text: string, keyBase: string, resolveSrc: SrcResolver): ReactNode[] {
  const re = /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_|`([^`]+)`/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${i++}`;
    if (m[1] !== undefined) {
      out.push(
        <img key={key} src={resolveSrc(m[2])} alt={m[1]} className="my-2 block max-w-full rounded border border-slate-200" />,
      );
    } else if (m[3] !== undefined) {
      out.push(
        <a key={key} href={m[4]} target="_blank" rel="noreferrer" className="text-blue-600 underline">
          {renderInline(m[3], key, resolveSrc)}
        </a>,
      );
    } else if (m[5] !== undefined) {
      out.push(
        <strong key={key} className="font-semibold text-slate-900">
          {renderInline(m[5], key, resolveSrc)}
        </strong>,
      );
    } else if (m[6] !== undefined) {
      out.push(<em key={key}>{renderInline(m[6], key, resolveSrc)}</em>);
    } else if (m[7] !== undefined) {
      out.push(<em key={key}>{renderInline(m[7], key, resolveSrc)}</em>);
    } else if (m[8] !== undefined) {
      out.push(
        <code key={key} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-rose-600">
          {m[8]}
        </code>,
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((s) => s.trim());
}

function isSpecialLine(line: string): boolean {
  return (
    /^```/.test(line) ||
    /^(#{1,6})\s/.test(line) ||
    /^>\s?/.test(line) ||
    /^\s*([-*+]|\d+\.)\s+/.test(line) ||
    /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    line.trim().startsWith("|")
  );
}

/** 简单自实现的 markdown 渲染：标题 / 列表 / 粗斜体 / 行内代码 / 代码块 / 表格 / 图片 / 链接 / 引用 */
export function Markdown({ text, imageBase }: { text: string; imageBase?: string }) {
  const resolveSrc: SrcResolver = (src) => {
    if (/^(https?:)?\/\//i.test(src) || src.startsWith("/") || src.startsWith("data:")) return src;
    return imageBase ? `${imageBase}/${src}` : src;
  };

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let key = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    // 代码块
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过收尾 ```
      blocks.push(
        <pre key={key++} className="my-3 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm leading-6 text-slate-100">
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // 标题
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const size = ["text-2xl", "text-xl", "text-lg", "text-base", "text-sm", "text-sm"][level - 1];
      blocks.push(
        <div key={key++} className={`${size} mt-6 mb-2 font-bold text-slate-900 first:mt-0`}>
          {renderInline(heading[2], `h${key}`, resolveSrc)}
        </div>,
      );
      i++;
      continue;
    }

    // 分割线
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="my-4 border-slate-200" />);
      i++;
      continue;
    }

    // 引用
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote key={key++} className="my-2 border-l-4 border-slate-300 bg-slate-50 px-3 py-2 text-slate-600">
          {renderInline(buf.join(" "), `q${key}`, resolveSrc)}
        </blockquote>,
      );
      continue;
    }

    // 表格
    if (line.trim().startsWith("|") && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={key++} className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {header.map((cell, j) => (
                  <th
                    key={j}
                    className="border border-slate-200 bg-slate-100 px-3 py-1.5 text-left font-medium text-slate-700"
                  >
                    {renderInline(cell, `th${key}-${j}`, resolveSrc)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="border border-slate-200 px-3 py-1.5 text-slate-700">
                      {renderInline(cell, `td${key}-${r}-${c}`, resolveSrc)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // 列表（有序 / 无序）
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ""));
        i++;
      }
      blocks.push(
        ordered ? (
          <ol key={key++} className="my-2 list-decimal space-y-1 pl-6">
            {items.map((it, j) => (
              <li key={j}>{renderInline(it, `ol${key}-${j}`, resolveSrc)}</li>
            ))}
          </ol>
        ) : (
          <ul key={key++} className="my-2 list-disc space-y-1 pl-6">
            {items.map((it, j) => (
              <li key={j}>{renderInline(it, `ul${key}-${j}`, resolveSrc)}</li>
            ))}
          </ul>
        ),
      );
      continue;
    }

    // 普通段落（合并相邻行）
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !isSpecialLine(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="my-2 leading-7">
        {renderInline(para.join(" "), `p${key}`, resolveSrc)}
      </p>,
    );
  }

  return <div>{blocks}</div>;
}
