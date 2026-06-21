"""
Convert cahier_des_charges.md to a formatted Word document.
"""

from docx import Document
from docx.shared import Pt, RGBColor, Inches, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.style import WD_STYLE_TYPE
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import re

SRC = r"C:\PFE\projet\AI-Powered Educational Content Summarization Platform\cahier_des_charges.md"
OUT = r"C:\PFE\projet\AI-Powered Educational Content Summarization Platform\Cahier_des_Charges_Detaille.docx"

# ── image map (IMG:key → file path) ──────────────────────────────────────
IMAGES = {
    "plugin_flow": r"C:\Users\arhal\.gemini\antigravity\brain\8d17882d-7223-4c2e-af7c-0669a7bd680f\plugin_flow_diagram_1775920438050.png",
    "pipeline":    r"C:\Users\arhal\.gemini\antigravity\brain\8d17882d-7223-4c2e-af7c-0669a7bd680f\ai_pipeline_diagram_1775920456229.png",
    "dbschema":    r"C:\Users\arhal\.gemini\antigravity\brain\8d17882d-7223-4c2e-af7c-0669a7bd680f\database_schema_er_1775849768022.png",
}

# ── helpers ────────────────────────────────────────────────────────────────

def set_font(run, name="Calibri", size=11, bold=False, italic=False, color=None):
    run.font.name = name
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    if color:
        run.font.color.rgb = RGBColor(*color)

def add_horizontal_rule(doc):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after  = Pt(4)
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), '6')
    bottom.set(qn('w:space'), '1')
    bottom.set(qn('w:color'), 'CCCCCC')
    pBdr.append(bottom)
    pPr.append(pBdr)

def add_table_from_md(doc, lines):
    """Parse a markdown table and render it as a Word table."""
    rows = [l for l in lines if l.strip().startswith('|') and '---' not in l]
    if not rows:
        return
    parsed = []
    for row in rows:
        cells = [c.strip() for c in row.strip().strip('|').split('|')]
        parsed.append(cells)
    if not parsed:
        return
    ncols = max(len(r) for r in parsed)
    table = doc.add_table(rows=len(parsed), cols=ncols)
    table.style = 'Table Grid'
    for ri, row in enumerate(parsed):
        for ci, cell_text in enumerate(row):
            cell = table.cell(ri, ci)
            cell.text = ''
            p = cell.paragraphs[0]
            # strip bold markers
            clean = re.sub(r'\*\*(.+?)\*\*', r'\1', cell_text)
            run = p.add_run(clean)
            is_header = (ri == 0)
            set_font(run, bold=is_header, size=10)
            if is_header:
                tc = cell._tc
                tcPr = tc.get_or_add_tcPr()
                shd = OxmlElement('w:shd')
                shd.set(qn('w:val'), 'clear')
                shd.set(qn('w:color'), 'auto')
                shd.set(qn('w:fill'), '1F4E79')
                tcPr.append(shd)
                run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
    doc.add_paragraph()


def render_inline(para, text):
    """Render inline **bold**, *italic*, and `code` within a paragraph."""
    pattern = re.compile(r'(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)')
    last = 0
    for m in pattern.finditer(text):
        # plain text before
        if m.start() > last:
            run = para.add_run(text[last:m.start()])
            set_font(run)
        full = m.group(0)
        if full.startswith('**'):
            run = para.add_run(m.group(2))
            set_font(run, bold=True)
        elif full.startswith('`'):
            run = para.add_run(m.group(4))
            set_font(run, name='Courier New', size=9.5, color=(0x1F, 0x4E, 0x79))
        else:
            run = para.add_run(m.group(3))
            set_font(run, italic=True)
        last = m.end()
    if last < len(text):
        run = para.add_run(text[last:])
        set_font(run)


# ── main ───────────────────────────────────────────────────────────────────

doc = Document()

# page margins
for section in doc.sections:
    section.top_margin    = Cm(2.5)
    section.bottom_margin = Cm(2.5)
    section.left_margin   = Cm(2.8)
    section.right_margin  = Cm(2.8)

# ── cover page ─────────────────────────────────────────────────────────────
doc.add_paragraph()
doc.add_paragraph()

title_p = doc.add_paragraph()
title_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = title_p.add_run("CAHIER DES CHARGES")
set_font(run, size=22, bold=True, color=(0x1F, 0x4E, 0x79))

sub_p = doc.add_paragraph()
sub_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = sub_p.add_run("Système de Résumé Automatique en Temps Réel\ndes Séances Pédagogiques")
set_font(run, size=14, color=(0x2E, 0x75, 0xB6))

doc.add_paragraph()
tag_p = doc.add_paragraph()
tag_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = tag_p.add_run("Intégration à la Plateforme Yool Education")
set_font(run, size=12, italic=True, color=(0x59, 0x59, 0x59))

doc.add_paragraph()
doc.add_paragraph()
add_horizontal_rule(doc)
doc.add_paragraph()

doc.add_page_break()

# ── parse markdown ─────────────────────────────────────────────────────────
with open(SRC, encoding='utf-8') as f:
    lines = f.readlines()

i = 0
skip_cover = True   # skip the first # heading (already done as cover)
in_code    = False
code_lines = []
table_lines = []
in_table   = False

while i < len(lines):
    raw  = lines[i].rstrip('\n')
    line = raw.strip()

    # ── code block ──────────────────────────────────────────────────────
    if line.startswith('```'):
        if not in_code:
            in_code    = True
            code_lines = []
        else:
            in_code = False
            # render code block
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Inches(0.4)
            p.paragraph_format.space_before = Pt(4)
            p.paragraph_format.space_after  = Pt(4)
            pPr = p._p.get_or_add_pPr()
            shd = OxmlElement('w:shd')
            shd.set(qn('w:val'), 'clear')
            shd.set(qn('w:color'), 'auto')
            shd.set(qn('w:fill'), 'F0F4F8')
            pPr.append(shd)
            run = p.add_run('\n'.join(code_lines))
            set_font(run, name='Courier New', size=8.5, color=(0x1F, 0x4E, 0x79))
        i += 1
        continue

    if in_code:
        code_lines.append(raw)
        i += 1
        continue

    # ── table ───────────────────────────────────────────────────────────
    if line.startswith('|'):
        table_lines.append(line)
        i += 1
        continue
    else:
        if table_lines:
            add_table_from_md(doc, table_lines)
            table_lines = []

    # ── image placeholder ────────────────────────────────────────────────
    img_match = re.match(r'!\[.*?\]\(IMG:(\w+)\)', line)
    if img_match:
        key = img_match.group(1)
        if key in IMAGES:
            import os
            img_path = IMAGES[key]
            if os.path.exists(img_path):
                p = doc.add_paragraph()
                p.paragraph_format.space_before = Pt(8)
                p.paragraph_format.space_after  = Pt(8)
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                run = p.add_run()
                run.add_picture(img_path, width=Inches(5.8))
        i += 1
        continue

    # ── horizontal rule ─────────────────────────────────────────────────
    if line == '---':
        add_horizontal_rule(doc)
        i += 1
        continue


    # ── headings ────────────────────────────────────────────────────────
    if line.startswith('### '):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(10)
        p.paragraph_format.space_after  = Pt(4)
        run = p.add_run(line[4:])
        set_font(run, size=12, bold=True, color=(0x2E, 0x75, 0xB6))
        i += 1
        continue

    if line.startswith('## '):
        text = line[3:]
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(14)
        p.paragraph_format.space_after  = Pt(6)
        run = p.add_run(text)
        set_font(run, size=13, bold=True, color=(0x1F, 0x4E, 0x79))
        # underline
        pPr = p._p.get_or_add_pPr()
        pBdr = OxmlElement('w:pBdr')
        bottom = OxmlElement('w:bottom')
        bottom.set(qn('w:val'), 'single')
        bottom.set(qn('w:sz'), '4')
        bottom.set(qn('w:space'), '1')
        bottom.set(qn('w:color'), '2E75B6')
        pBdr.append(bottom)
        pPr.append(pBdr)
        i += 1
        continue

    if line.startswith('# '):
        if skip_cover:
            skip_cover = False
            i += 1
            continue
        p = doc.add_paragraph()
        run = p.add_run(line[2:])
        set_font(run, size=16, bold=True, color=(0x1F, 0x4E, 0x79))
        i += 1
        continue

    # ── blockquote ──────────────────────────────────────────────────────
    if line.startswith('> '):
        text = re.sub(r'\*(.+?)\*', r'\1', line[2:])
        p = doc.add_paragraph()
        p.paragraph_format.left_indent  = Inches(0.4)
        p.paragraph_format.space_before = Pt(4)
        p.paragraph_format.space_after  = Pt(4)
        pPr = p._p.get_or_add_pPr()
        pBdr = OxmlElement('w:pBdr')
        left = OxmlElement('w:left')
        left.set(qn('w:val'), 'single')
        left.set(qn('w:sz'), '6')
        left.set(qn('w:space'), '4')
        left.set(qn('w:color'), '2E75B6')
        pBdr.append(left)
        pPr.append(pBdr)
        run = p.add_run(text)
        set_font(run, italic=True, color=(0x40, 0x40, 0x40))
        i += 1
        continue

    # ── bullet list ─────────────────────────────────────────────────────
    if line.startswith('- '):
        p = doc.add_paragraph(style='List Bullet')
        p.paragraph_format.left_indent  = Inches(0.3)
        p.paragraph_format.space_before = Pt(2)
        p.paragraph_format.space_after  = Pt(2)
        render_inline(p, line[2:])
        i += 1
        continue

    # ── numbered list ───────────────────────────────────────────────────
    m = re.match(r'^(\d+)\.\s+(.+)', line)
    if m:
        p = doc.add_paragraph(style='List Number')
        p.paragraph_format.left_indent  = Inches(0.3)
        p.paragraph_format.space_before = Pt(2)
        p.paragraph_format.space_after  = Pt(2)
        render_inline(p, m.group(2))
        i += 1
        continue

    # ── bold paragraph title (e.g. **Phase 1 — …**) ─────────────────────
    if line.startswith('**') and line.endswith('**') and len(line) > 4:
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(8)
        p.paragraph_format.space_after  = Pt(2)
        run = p.add_run(line.strip('*'))
        set_font(run, bold=True, color=(0x1F, 0x4E, 0x79))
        i += 1
        continue

    # ── empty line ──────────────────────────────────────────────────────
    if not line:
        i += 1
        continue

    # ── normal paragraph ────────────────────────────────────────────────
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(3)
    p.paragraph_format.space_after  = Pt(6)
    p.paragraph_format.alignment    = WD_ALIGN_PARAGRAPH.JUSTIFY
    render_inline(p, line)
    i += 1

# flush any remaining table
if table_lines:
    add_table_from_md(doc, table_lines)

doc.save(OUT)
print(f"✅  Saved → {OUT}")
