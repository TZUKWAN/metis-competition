# -*- coding: utf-8 -*-
"""生成竞赛 PPT 测试模板：15页，覆盖常见版式角色（PRD §31），占位文本便于替换。"""
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor

BLUE = RGBColor(0x1F, 0x4E, 0x79)
GRAY = RGBColor(0x59, 0x59, 0x59)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
BLANK = prs.slide_layouts[6]

def add_bg(slide, color=BLUE):
    from pptx.oxml.ns import qn
    bg = slide.background
    bg.fill.solid()
    bg.fill.fore_color.rgb = color

def tb(slide, x, y, w, h, text, size=18, bold=False, color=GRAY, align=None):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    r = p.add_run(); r.text = text
    r.font.size = Pt(size); r.font.bold = bold; r.font.color.rgb = color
    return box

def cover():
    s = prs.slides.add_slide(BLANK); add_bg(s)
    tb(s, 1, 2.2, 11, 1.4, "[项目名称]", 44, True, WHITE)
    tb(s, 1, 3.8, 11, 0.8, "[一句话定位]", 22, False, WHITE)
    tb(s, 1, 5.6, 11, 0.6, "[团队名称] | [日期]", 14, False, WHITE)

def title_body(title="[标题]"):
    s = prs.slides.add_slide(BLANK)
    tb(s, 0.6, 0.4, 12, 0.9, title, 30, True, BLUE)
    tb(s, 0.8, 1.6, 11.7, 5.2, "[正文内容：概述项目要点，150字以内]", 17)
    return s

def section(title="[章节名]"):
    s = prs.slides.add_slide(BLANK); add_bg(s)
    tb(s, 1, 3.0, 11, 1.2, title, 40, True, WHITE)

def cards(title="[标题]", n=3):
    s = prs.slides.add_slide(BLANK)
    tb(s, 0.6, 0.4, 12, 0.9, title, 30, True, BLUE)
    w = 11.7 / n
    for i in range(n):
        x = 0.8 + i * w
        tb(s, x, 1.8, w - 0.3, 0.7, f"[卡片{i+1}标题]", 18, True, BLUE)
        tb(s, x, 2.6, w - 0.3, 3.6, f"[卡片{i+1}正文：60字左右的说明文字]", 14)
    return s

def image_text(title="[标题]"):
    s = prs.slides.add_slide(BLANK)
    tb(s, 0.6, 0.4, 12, 0.9, title, 30, True, BLUE)
    pic = s.shapes.add_picture.__doc__  # 占位矩形代替图片
    from pptx.enum.shapes import MSO_SHAPE
    rect = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), Inches(1.8), Inches(7.2), Inches(4.6))
    rect.fill.solid(); rect.fill.fore_color.rgb = RGBColor(0xD9, 0xE2, 0xF3); rect.line.color.rgb = BLUE
    tf = rect.text_frame; tf.text = "[产品截图占位]"
    tb(s, 8.4, 1.8, 4.2, 4.6, "[图片说明文字：介绍该截图展示的核心功能与价值]", 15)
    return s

def full_image():
    s = prs.slides.add_slide(BLANK)
    from pptx.enum.shapes import MSO_SHAPE
    rect = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), Inches(0.8), Inches(11.7), Inches(5.9))
    rect.fill.solid(); rect.fill.fore_color.rgb = RGBColor(0xD9, 0xE2, 0xF3); rect.line.color.rgb = BLUE
    tf = rect.text_frame; tf.text = "[整页大图占位]"
    return s

def chart(title="[图表标题]"):
    s = prs.slides.add_slide(BLANK)
    tb(s, 0.6, 0.4, 12, 0.9, title, 30, True, BLUE)
    from pptx.enum.shapes import MSO_SHAPE
    rect = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(2.2), Inches(1.8), Inches(8.9), Inches(4.6))
    rect.fill.solid(); rect.fill.fore_color.rgb = RGBColor(0xEA, 0xF0, 0xF9); rect.line.color.rgb = BLUE
    tf = rect.text_frame; tf.text = "[数据图表占位]"
    return s

def comparison(title="[对比标题]"):
    s = prs.slides.add_slide(BLANK)
    tb(s, 0.6, 0.4, 12, 0.9, title, 30, True, BLUE)
    for i, x in enumerate([0.8, 6.9]):
        tb(s, x, 1.7, 5.6, 0.7, f"[竞品{i+1}/我方名称]", 18, True, BLUE)
        tb(s, x, 2.5, 5.6, 4.0, "[对比要点：功能、价格、覆盖场景等]", 14)
    return s

def timeline(title="[标题]"):
    s = prs.slides.add_slide(BLANK)
    tb(s, 0.6, 0.4, 12, 0.9, title, 30, True, BLUE)
    for i in range(4):
        x = 0.8 + i * 3.0
        tb(s, x, 2.2, 2.7, 0.6, f"[阶段{i+1}时间]", 16, True, BLUE)
        tb(s, x, 2.9, 2.7, 2.6, "[阶段目标与里程碑]", 13)
    return s

def team(title="[标题]"):
    s = prs.slides.add_slide(BLANK)
    tb(s, 0.6, 0.4, 12, 0.9, title, 30, True, BLUE)
    for i in range(4):
        x = 0.8 + i * 3.0
        tb(s, x, 1.9, 2.7, 0.6, "[姓名/角色]", 16, True, BLUE)
        tb(s, x, 2.6, 2.7, 2.8, "[背景简介：专业、分工、成果]", 13)
    return s

def financial(title="[标题]"):
    s = prs.slides.add_slide(BLANK)
    tb(s, 0.6, 0.4, 12, 0.9, title, 30, True, BLUE)
    tb(s, 0.8, 1.6, 11.7, 0.8, "[核心财务预测数字：营收、利润、增长率]", 17, True, BLUE)
    from pptx.enum.shapes import MSO_SHAPE
    rect = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(2.2), Inches(2.6), Inches(8.9), Inches(3.8))
    rect.fill.solid(); rect.fill.fore_color.rgb = RGBColor(0xEA, 0xF0, 0xF9); rect.line.color.rgb = BLUE
    tf = rect.text_frame; tf.text = "[财务图表占位]"
    return s

def closing():
    s = prs.slides.add_slide(BLANK); add_bg(s)
    tb(s, 1, 2.8, 11, 1.4, "感谢聆听，恳请指导", 40, True, WHITE)
    tb(s, 1, 4.4, 11, 0.8, "[联系方式]", 18, False, WHITE)

cover()
title_body("[项目摘要]")
section("一、市场分析")
cards("[市场痛点]")
title_body("[政策环境]")
section("二、产品介绍")
image_text("[产品总体介绍]")
cards("[核心功能]")
full_image()
section("三、技术方案")
title_body("[技术架构]")
cards("[核心技术]", 4)
image_text("[项目成果展示]")
chart("[市场规模]")
comparison("[竞品分析]")
timeline("[发展规划]")
section("四、团队与财务")
team("[创业团队]")
team("[导师专家]")
financial("[财务预测]")
financial("[融资规划]")
closing()
prs.save(r"D:/metis竞赛/test-assets/竞赛路演测试模板.pptx")
print("template saved, slides:", len(prs.slides.__iter__.__self__._sldIdLst))
