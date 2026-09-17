import './env.js';
import { getSearchProvider, extractPage } from './skills/search.js';

const p = getSearchProvider();
if (!p) { console.error('no provider'); process.exit(1); }
const results = await p.search('中国国际大学生创新创业大赛 参赛规模', 6);
console.log(`results: ${results.length}`);
for (const r of results) console.log(`- [${r.title}] ${r.url}`);
if (results.length) {
  const page = await extractPage(results[0].url);
  console.log(`\nextract ok: title=${page.title.slice(0, 60)} textLen=${page.text.length}`);
}
// 反爬站点兜底测试
const bk = await extractPage('https://baike.baidu.com/item/%E4%B8%AD%E5%9B%BD%E5%9B%BD%E9%99%85%E5%A4%A7%E5%AD%A6%E7%94%9F%E5%88%9B%E6%96%B0%E5%A4%A7%E8%B5%9B/63814303');
console.log(`baike(403兜底): title=${bk.title.slice(0, 50)} textLen=${bk.text.length}`);
process.exit(0);
