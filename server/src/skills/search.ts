/**
 * search.ts — 联网调研基础能力（PRD §7）
 * search_web / open_page / extract_page / save_source
 * 搜索 provider 通过 env 配置（SEARCH_PROVIDER=serper|tavily|browser），不硬编码供应商。
 * browser 为免 key 兜底：Playwright 真浏览器抓百度（主）/搜狗（备）结果页。
 * cn.bing.com 对多词中文查询分词降级严重（真浏览器也如此），不采用。
 * open_page / extract_page 用裸 fetch + HTML 转文本；403 等反爬拦截时用浏览器渲染兜底。
 */
import type { Browser } from 'playwright';

export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProvider {
  search(query: string, maxResults?: number): Promise<SearchResultItem[]>;
}

export function getSearchProvider(): SearchProvider | null {
  const key = process.env.SEARCH_API_KEY;
  const provider = (process.env.SEARCH_PROVIDER || (key ? 'serper' : 'browser')).toLowerCase();

  if (provider === 'serper') {
    if (!key) throw new Error('SEARCH_PROVIDER=serper 需要配置 SEARCH_API_KEY');
    return {
      async search(query, maxResults = 8) {
        const resp = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
          body: JSON.stringify({ q: query, num: maxResults }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!resp.ok) throw new Error(`serper search failed: HTTP ${resp.status}`);
        const data = (await resp.json()) as { organic?: { title: string; link: string; snippet?: string }[] };
        return (data.organic ?? []).slice(0, maxResults).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet ?? '' }));
      },
    };
  }
  if (provider === 'tavily') {
    if (!key) throw new Error('SEARCH_PROVIDER=tavily 需要配置 SEARCH_API_KEY');
    return {
      async search(query, maxResults = 8) {
        const resp = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: key, query, max_results: maxResults }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!resp.ok) throw new Error(`tavily search failed: HTTP ${resp.status}`);
        const data = (await resp.json()) as { results?: { title: string; url: string; content?: string }[] };
        return (data.results ?? []).slice(0, maxResults).map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? '' }));
      },
    };
  }
  if (provider === 'browser') {
    return { search: (query, maxResults = 8) => searchBrowser(query, maxResults) };
  }
  throw new Error(`未知 SEARCH_PROVIDER: ${provider}（支持 serper|tavily|browser）`);
}

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

let browserSingleton: Promise<Browser> | null = null;

/** 进程级共享无头浏览器（research 一次跑多个查询，避免重复启动） */
function getSharedBrowser(): Promise<Browser> {
  if (!browserSingleton) {
    browserSingleton = import('playwright').then(({ chromium }) => chromium.launch({ headless: true }));
  }
  return browserSingleton;
}

async function withSearchPage<T>(fn: (page: import('playwright').Page) => Promise<T>): Promise<T> {
  const browser = await getSharedBrowser();
  const ctx = await browser.newContext({ userAgent: BROWSER_UA, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
  try {
    const page = await ctx.newPage();
    return await fn(page);
  } finally {
    await ctx.close();
  }
}

/** 百度/搜狗结果链接是跳转链接，解析出真实 URL 以便来源记录 */
async function resolveRedirectLink(url: string): Promise<string> {
  if (!/(baidu\.com\/link|sogou\.com\/link)/i.test(url)) return url;
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    await resp.arrayBuffer().catch(() => undefined);
    if (resp.url && !/(baidu\.com\/link|sogou\.com\/link)/i.test(resp.url)) return resp.url;
  } catch {
    // 解析失败保留原链接
  }
  return url;
}

/** 百度结果页解析：#content_left 下 class 含 result 的块，过滤广告 */
async function parseBaidu(page: import('playwright').Page, maxResults: number): Promise<SearchResultItem[]> {
  await page.waitForSelector('#content_left h3 a', { timeout: 20_000 });
  const raw = await page.$$eval(
    '#content_left div[class*="result"]',
    (els, max) =>
      els.slice(0, max * 2).map((el) => {
        const cls = el.className || '';
        const a = el.querySelector('h3 a');
        if (!a) return null;
        const adBadge = el.querySelector('span,[data-tuiguang],a[data-is-ad]');
        if (/ec_|tuiguang|ad\b/.test(cls) || adBadge?.textContent?.trim() === '广告') return null;
        return { title: (a.textContent ?? '').trim(), href: (a as HTMLAnchorElement).href };
      }),
    maxResults,
  );
  const items: SearchResultItem[] = [];
  for (const r of raw) {
    if (!r || !r.title || !r.href) continue;
    items.push({ title: r.title, url: r.href, snippet: '' });
    if (items.length >= maxResults) break;
  }
  return items;
}

/** 搜狗结果页解析（百度被验证码拦截时的备选） */
async function parseSogou(page: import('playwright').Page, maxResults: number): Promise<SearchResultItem[]> {
  await page.waitForSelector('div.vrwrap h3 a, div.rb h3 a', { timeout: 20_000 });
  const raw = await page.$$eval(
    'div.vrwrap, div.rb',
    (els, max) =>
      els.slice(0, max * 2).map((el) => {
        const a = el.querySelector('h3 a');
        if (!a) return null;
        return { title: (a.textContent ?? '').trim(), href: (a as HTMLAnchorElement).href };
      }),
    maxResults,
  );
  const items: SearchResultItem[] = [];
  for (const r of raw) {
    if (!r || !r.title || !r.href) continue;
    const abs = r.href.startsWith('http') ? r.href : `https://www.sogou.com${r.href}`;
    items.push({ title: r.title, url: abs, snippet: '' });
    if (items.length >= maxResults) break;
  }
  return items;
}

/** 无效结果（验证码跳转、风控回跳链接等） */
function isJunkResult(r: SearchResultItem): boolean {
  return /wappass\.baidu\.com|captcha|vercode|passport\.baidu|security\.baidu/i.test(r.url);
}

/** 免 key 搜索：Playwright 真浏览器抓百度，结果不足时补搜搜狗合并 */
export async function searchBrowser(query: string, maxResults = 8): Promise<SearchResultItem[]> {
  const results = await withSearchPage(async (page) => {
    let items: SearchResultItem[] = [];
    const target = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=${Math.max(maxResults, 10)}`;
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    try {
      items = await parseBaidu(page, maxResults);
    } catch {
      items = [];
    }
    // 百度被风控/结果过少时，搜狗补充
    if (items.length < 3) {
      try {
        await page.goto(`https://www.sogou.com/web?query=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        const sogouItems = await parseSogou(page, maxResults);
        const seen = new Set(items.map((i) => i.url));
        for (const it of sogouItems) {
          if (seen.has(it.url)) continue;
          items.push(it);
        }
      } catch {
        // 搜狗也失败则保留百度结果
      }
    }
    return items.filter((r) => !isJunkResult(r)).slice(0, maxResults);
  });
  if (!results.length) throw new Error(`browser search: 无结果（query=${query.slice(0, 40)}）`);
  const resolved = await Promise.all(results.map(async (r) => ({ ...r, url: await resolveRedirectLink(r.url) })));
  return resolved;
}

/** 抓取网页 HTML（带基础反拦截 UA 与超时） */
export async function openPage(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(30_000),
    redirect: 'follow',
  });
  if (!resp.ok) throw new Error(`open_page failed: HTTP ${resp.status} ${url}`);
  const html = await resp.text();
  return html;
}

/** HTML → 纯文本（去脚本/样式/标签，压缩空白） */
export function htmlToText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  // 解码常见 HTML 实体
  const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–' };
  for (const [k, v] of Object.entries(entities)) text = text.split(k).join(v);
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 20_000);
}

/** 抓取并提取正文文本；反爬拦截（403 或 200 风控页）时降级为浏览器渲染提取 */
export async function extractPage(url: string): Promise<{ url: string; title: string; text: string }> {
  try {
    const html = await openPage(url);
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : url;
    const text = htmlToText(html);
    if (!/安全验证|验证码|访问验证|异常请求/.test(title) && text.length >= 60) {
      return { url, title, text };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/HTTP 4\d\d|HTTP 5\d\d|fetch failed/i.test(message)) throw err;
  }
  return withSearchPage(async (page) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(1_500);
    const title = (await page.title()).replace(/\s+/g, ' ').trim();
    if (/安全验证|验证码|访问验证/.test(title)) throw new Error(`extract_page failed: 站点风控拦截 ${url}`);
    const text = await page.evaluate(() => document.body.innerText);
    if (!text.trim()) throw new Error(`extract_page failed: 浏览器渲染正文为空 ${url}`);
    return { url, title: title || url, text: text.slice(0, 20_000) };
  });
}
