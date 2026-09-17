/**
 * pptx-io.ts — pptx 的读取/修改/克隆（OOXML 直操，不用 python-pptx 生成）
 * 参考 pptx.skill 的"读取→修改→渲染→检查"闭环思路与 PPTAgent 的"克隆模板页替换内容"原则（PRD §28-29）。
 */
import JSZip from 'jszip';

export interface TextBox {
  shapeId: string;
  name: string;
  isTitle: boolean;
  text: string;
}

export interface SlideInfo {
  index: number; // 1-based
  part: string; // ppt/slides/slideN.xml
  texts: TextBox[];
  pictureCount: number;
  hasChart: boolean;
  imageParts: string[]; // 本页引用到的 media 路径
}

const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
};

export class PptxFile {
  private zip: JSZip;

  private constructor(zip: JSZip) {
    this.zip = zip;
  }

  static async load(filePath: string): Promise<PptxFile> {
    const fs = await import('node:fs');
    const data = fs.readFileSync(filePath);
    return new PptxFile(await JSZip.loadAsync(data));
  }

  static async createFrom(buffer: Buffer): Promise<PptxFile> {
    return new PptxFile(await JSZip.loadAsync(buffer));
  }

  async save(filePath: string): Promise<void> {
    const fs = await import('node:fs');
    const out = await this.zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(filePath, out);
  }

  private async xml(part: string): Promise<string> {
    const f = this.zip.file(part);
    if (!f) throw new Error(`pptx 缺少部件: ${part}`);
    return f.async('string');
  }

  private slideParts(): string[] {
    return Object.keys(this.zip.files)
      .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
      .sort((a, b) => Number(/slide(\d+)\.xml/.exec(a)![1]) - Number(/slide(\d+)\.xml/.exec(b)![1]));
  }

  /** presentation.xml 中 sldIdLst 的实际顺序（决定播放顺序） */
  private async slideOrder(): Promise<string[]> {
    const presXml = await this.xml('ppt/presentation.xml');
    const relsXml = await this.xml('ppt/_rels/presentation.xml.rels');
    const relMap = new Map<string, string>();
    for (const m of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      relMap.set(m[1], m[2].replace(/^\//, ''));
    }
    const order: string[] = [];
    for (const m of presXml.matchAll(/<p:sldId[^>]*r:id="([^"]+)"/g)) {
      const target = relMap.get(m[1]);
      if (target) order.push(target.startsWith('slides/') ? `ppt/${target}` : target);
    }
    return order;
  }

  /** 单页结构描述（listSlides 与克隆后复用） */
  async describeSlide(part: string, index: number): Promise<SlideInfo> {
    const xml = await this.xml(part);
    const texts: TextBox[] = [];
    for (const spMatch of xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)) {
      const sp = spMatch[1];
      const idM = /<p:cNvPr[^>]*id="([^"]+)"[^>]*name="([^"]*)"/.exec(sp);
      if (!idM) continue;
      const phM = /<p:ph\b[^>]*type="(title|ctrTitle)"/.exec(sp);
      const ts = [...sp.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => t[1]);
      const text = ts.join('');
      if (!text.trim()) continue;
      texts.push({ shapeId: idM[1], name: idM[2], isTitle: Boolean(phM), text });
    }
    const imageParts = new Set<string>();
    const relsName = part.replace('slides/', 'slides/_rels/') + '.rels';
    const relFile = this.zip.file(relsName);
    if (relFile) {
      const relsXml = await relFile.async('string');
      for (const m of relsXml.matchAll(/<Relationship[^>]*Type="[^"]*\/image"[^>]*Target="([^"]+)"/g)) {
        imageParts.add(`ppt/${m[1].replace(/^\.\.\//, '')}`);
      }
    }
    return {
      index,
      part,
      texts,
      pictureCount: (xml.match(/<p:pic>/g) ?? []).length,
      hasChart: xml.includes('/chart'),
      imageParts: [...imageParts],
    };
  }

  async listSlides(): Promise<SlideInfo[]> {
    const order = await this.slideOrder();
    const parts = order.length ? order : this.slideParts();
    const result: SlideInfo[] = [];
    for (let i = 0; i < parts.length; i++) {
      result.push(await this.describeSlide(parts[i], i + 1));
    }
    return result;
  }

  /** 克隆一页模板（追加到末尾），返回新 part 路径 */
  async cloneSlide(sourcePart: string): Promise<string> {
    const srcNum = Number(/slide(\d+)\.xml/.exec(sourcePart)![1]);
    const nums = this.slideParts().map((p) => Number(/slide(\d+)\.xml/.exec(p)![1]));
    const newNum = Math.max(...nums) + 1;
    const newPart = `ppt/slides/slide${newNum}.xml`;

    // 1. 复制 slide xml 与 rels
    const slideXml = await this.xml(sourcePart);
    this.zip.file(newPart, slideXml);
    const srcRels = `${sourcePart.replace('slides/', 'slides/_rels/')}.rels`;
    const relsFile = this.zip.file(srcRels);
    if (relsFile) this.zip.file(newPart.replace('slides/', 'slides/_rels/') + '.rels', await relsFile.async('string'));

    // 2. presentation.xml 追加 sldId
    const presXml = await this.xml('ppt/presentation.xml');
    const usedIds = [...presXml.matchAll(/<p:sldId[^>]*id="(\d+)"/g)].map((m) => Number(m[1]));
    const newSldId = Math.max(...usedIds, 255) + 1;

    // 3. presentation.xml.rels 新 rId
    const presRelsName = 'ppt/_rels/presentation.xml.rels';
    const presRels = await this.xml(presRelsName);
    const usedRids = [...presRels.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
    const newRid = `rId${Math.max(...usedRids) + 1}`;
    this.zip.file(
      presRelsName,
      presRels.replace('</Relationships>', `<Relationship Id="${newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${newNum}.xml"/></Relationships>`),
    );
    this.zip.file(
      'ppt/presentation.xml',
      presXml.replace('</p:sldIdLst>', `<p:sldId id="${newSldId}" r:id="${newRid}"/></p:sldIdLst>`),
    );

    // 4. [Content_Types].xml
    const ct = await this.xml('[Content_Types].xml');
    this.zip.file(
      '[Content_Types].xml',
      ct.replace('</Types>', `<Override PartName="/ppt/slides/slide${newNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`),
    );

    void srcNum;
    return newPart;
  }

  /**
   * 替换文本框内容：把 shapeId 对应 sp 的全部段落替换为新文本（\n 分段），
   * 保留首个 run 的字体格式；extraRuns=false 时删除多余 run。
   */
  async replaceText(part: string, shapeId: string, newText: string): Promise<void> {
    const xml = await this.xml(part);
    const spRe = new RegExp(`<p:sp>(?:(?!</p:sp>)[\\s\\S])*?<p:cNvPr[^>]*id="${shapeId}"[^>]*>[\\s\\S]*?</p:sp>`);
    const m = spRe.exec(xml);
    if (!m) throw new Error(`shape ${shapeId} 不存在于 ${part}`);
    const sp = m[0];
    const txBody = /<p:txBody>([\s\S]*?)<\/p:txBody>/.exec(sp);
    if (!txBody) return;
    const body = txBody[1];
    const bodyPr = /<a:bodyPr[^>]*\/>/.exec(body)?.[0] ?? '<a:bodyPr/>';
    const firstParaM = /<a:p>([\s\S]*?)<\/a:p>/.exec(body);
    if (!firstParaM) return;
    const firstPara = firstParaM[1];
    // 段落属性与首个 run 的格式
    const pPrM = /<a:pPr[^>]*>(?:[\s\S]*?)<\/a:pPr>|<a:pPr[^>]*\/>/.exec(firstPara);
    const firstRunM = /<a:r>([\s\S]*?)<\/a:r>/.exec(firstPara);
    const rPr = firstRunM ? (/<a:rPr[^>]*>(?:[\s\S]*?)<\/a:rPr>|<a:rPr[^>]*\/>/.exec(firstRunM[1])?.[0] ?? '') : '';
    const lines = newText.split('\n');
    const paras = lines
      .map((ln) => `<a:p>${pPrM?.[0] ?? ''}<a:r>${rPr}<a:t>${ln.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</a:t></a:r></a:p>`)
      .join('');
    const newTx = `<p:txBody>${bodyPr}<a:lstStyle/>${paras}</p:txBody>`;
    const newSp = sp.replace(/<p:txBody>[\s\S]*?<\/p:txBody>/, newTx);
    this.zip.file(part, xml.replace(sp, newSp));
  }

  /** 替换指定图片部件的字节（先把新图加入 media，再改该 slide 的 rels 指向） */
  async replaceImage(part: string, relEmbedId: string, imageBytes: Buffer, ext: string): Promise<void> {
    const relsName = part.replace('slides/', 'slides/_rels/') + '.rels';
    const relsXml = await this.xml(relsName);
    const relM = new RegExp(`<Relationship[^>]*Id="${relEmbedId}"[^>]*Target="([^"]+)"`).exec(relsXml);
    if (!relM) throw new Error(`rel ${relEmbedId} 不存在`);
    // 新 media 部件
    const mediaFiles = Object.keys(this.zip.files).filter((k) => /^ppt\/media\/image\d+/.test(k));
    const maxNum = Math.max(0, ...mediaFiles.map((k) => Number(/image(\d+)/.exec(k)![1])));
    const newMedia = `ppt/media/image${maxNum + 1}.${ext}`;
    this.zip.file(newMedia, imageBytes);
    this.zip.file(relsName, relsXml.replace(relM[0], relM[0].replace(`Target="${relM[1]}"`, `Target="../media/image${maxNum + 1}.${ext}"`)));
  }

  /** 列出 slide 中的图片 shape：{shapeId, relEmbedId} */
  async listPictures(part: string): Promise<{ shapeId: string; relEmbedId: string }[]> {
    const xml = await this.xml(part);
    const pics: { shapeId: string; relEmbedId: string }[] = [];
    for (const m of xml.matchAll(/<p:pic>([\s\S]*?)<\/p:pic>/g)) {
      const idM = /<p:cNvPr[^>]*id="([^"]+)"/.exec(m[1]);
      const embedM = /<a:blip[^>]*r:embed="([^"]+)"/.exec(m[1]);
      if (idM && embedM) pics.push({ shapeId: idM[1], relEmbedId: embedM[1] });
    }
    return pics;
  }

  /** 把 chart 图形帧替换为图片（图表用 matplotlib/资产 PNG 预先渲染好） */
  async replaceChartWithImage(part: string, imageBytes: Buffer, ext = 'png'): Promise<void> {
    const xml = await this.xml(part);
    const frameM = /<p:graphicFrame>(?:(?!<\/p:graphicFrame>)[\s\S])*?<c:chart[\s\S]*?<\/p:graphicFrame>/.exec(xml);
    if (!frameM) return;
    const frame = frameM[0];
    const idM = /<p:cNvPr[^>]*id="(\d+)"[^>]*name="([^"]*)"/.exec(frame);
    const xfrmM = /<a:xfrm>([\s\S]*?)<\/a:xfrm>/.exec(frame);
    if (!idM || !xfrmM) return;
    const mediaFiles = Object.keys(this.zip.files).filter((k) => /^ppt\/media\/image\d+/.test(k));
    const maxNum = Math.max(0, ...mediaFiles.map((k) => Number(/image(\d+)/.exec(k)![1])));
    const mediaName = `image${maxNum + 1}.${ext}`;
    this.zip.file(`ppt/media/${mediaName}`, imageBytes);
    // slide rels 新 rId
    const relsName = part.replace('slides/', 'slides/_rels/') + '.rels';
    const relsXml = await this.xml(relsName);
    const usedRids = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((mm) => Number(mm[1]));
    const newRid = `rId${Math.max(0, ...usedRids) + 1}`;
    this.zip.file(relsName, relsXml.replace('</Relationships>', `<Relationship Id="${newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${mediaName}"/></Relationships>`));
    const pic = `<p:pic><p:nvPicPr><p:cNvPr id="${idM[1]}" name="${idM[2]}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${newRid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrmM[0]}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
    this.zip.file(part, xml.replace(frame, pic));
  }

  /** 在 spTree 末尾追加一张居中图片（模板页无图片占位时使用） */
  async addPicture(part: string, imageBytes: Buffer, ext = 'png'): Promise<void> {
    const xml = await this.xml(part);
    const mediaFiles = Object.keys(this.zip.files).filter((k) => /^ppt\/media\/image\d+/.test(k));
    const maxNum = Math.max(0, ...mediaFiles.map((k) => Number(/image(\d+)/.exec(k)![1])));
    const mediaName = `image${maxNum + 1}.${ext}`;
    this.zip.file(`ppt/media/${mediaName}`, imageBytes);
    const relsName = part.replace('slides/', 'slides/_rels/') + '.rels';
    const relsXml = await this.xml(relsName);
    const usedRids = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((mm) => Number(mm[1]));
    const newRid = `rId${Math.max(0, ...usedRids) + 1}`;
    this.zip.file(relsName, relsXml.replace('</Relationships>', `<Relationship Id="${newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${mediaName}"/></Relationships>`));
    // 幻灯片尺寸取自 presentation.xml（默认 16:9 12192000×6858000 EMU）
    let cx = 7315200;
    let cy = 4114800;
    let x = 2438400;
    let y = 1600200;
    const presXml = await this.xml('ppt/presentation.xml');
    const szM = /<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(presXml);
    if (szM) {
      const scx = Number(szM[1]);
      const scy = Number(szM[2]);
      cx = Math.round(scx * 0.6);
      cy = Math.round(cx * (9 / 16));
      if (cy > scy * 0.62) {
        cy = Math.round(scy * 0.62);
        cx = Math.round(cy * (16 / 9));
      }
      x = Math.round((scx - cx) / 2);
      y = Math.round((scy - cy) / 2);
    }
    const idNums = [...xml.matchAll(/<p:cNvPr[^>]*id="(\d+)"/g)].map((m) => Number(m[1]));
    const newId = Math.max(100, ...idNums) + 1;
    const pic = `<p:pic><p:nvPicPr><p:cNvPr id="${newId}" name="metis-asset"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${newRid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
    this.zip.file(part, xml.replace('</p:spTree>', `${pic}</p:spTree>`));
  }

  /** 仅保留指定 slide part（删除其余页引用），用于清掉模板原页只留克隆页 */
  async keepSlidesOnly(keepParts: Set<string>): Promise<void> {
    const presXml = await this.xml('ppt/presentation.xml');
    const relsXml = await this.xml('ppt/_rels/presentation.xml.rels');
    const relMap = new Map<string, string>();
    for (const m of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      relMap.set(m[1], m[2].startsWith('slides/') ? `ppt/${m[2]}` : m[2]);
    }
    const removeRids = new Set<string>();
    let newPres = presXml;
    for (const m of presXml.matchAll(/<p:sldId[^>]*id="(\d+)"[^>]*r:id="([^"]+)"\/>/g)) {
      const part = relMap.get(m[2]);
      if (part && !keepParts.has(part)) {
        removeRids.add(m[2]);
        newPres = newPres.replace(m[0], '');
      }
    }
    this.zip.file('ppt/presentation.xml', newPres);
    let newRels = relsXml;
    for (const rid of removeRids) {
      newRels = newRels.replace(new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*/>`), '');
    }
    this.zip.file('ppt/_rels/presentation.xml.rels', newRels);
  }
}
