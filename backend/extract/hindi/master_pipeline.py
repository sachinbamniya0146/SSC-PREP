#!/usr/bin/env python3
"""Master pipeline: Extract all chapters from PDF -> parse Hindi -> merge with English + answers -> Excel."""
import json
import os
import re
import hashlib
import sys
sys.path.insert(0, os.path.expanduser('~/.hermes/hermes-agent/venv/lib/python3.11/site-packages'))

import pymupdf as fitz
import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from openpyxl.utils import get_column_letter

# ============ CONFIG ============
PDF = '/Users/sachin/Downloads/838411207-Pinnacle-SSC-Reasoning-7200-TCS-MCQ-7th-Edition-2025-Hindi-Medium.pdf'
EN_DIR = '/Users/sachin/SSC-PREP/backend/extract/pinnacle'
OUT_DIR = '/Users/sachin/SSC-PREP/backend/extract/hindi'
CACHE_FILE = os.path.join(OUT_DIR, 'translation_cache.json')
ANS_FILE = '/tmp/chapter_answers.json'

# Load detected chapter page ranges (from find_chapters.py)
RANGES_FILE = os.path.join(OUT_DIR, 'chapter_ranges.json')
chapter_ranges = json.load(open(RANGES_FILE)) if os.path.exists(RANGES_FILE) else {}

CHAPTERS = {
    'Analogy': ('सादृश्यता', chapter_ranges.get('Analogy', (24, 105))),
    'Odd one out': ('विषम', chapter_ranges.get('Odd one out', (109, 142))),
    'Coding-Decoding': ('कोडिंग डिकोडिंग', chapter_ranges.get('Coding-Decoding', (146, 203))),
    'Missing Number': ('लुप्त संख्या', chapter_ranges.get('Missing Number', (249, 267))),
    'Statement and Conclusion': ('कथन और निष्कर्ष', chapter_ranges.get('Statement and Conclusion', (268, 275))),
    'Blood Relation': ('रक्त संबंध', chapter_ranges.get('Blood Relation', (276, 301))),
    'Venn Diagram': ('वेन आरेख', chapter_ranges.get('Venn Diagram', (302, 322))),
    'Cube and Dice': ('घन और पासा', chapter_ranges.get('Cube and Dice', (323, 343))),
    'Sitting Arrangement': ('बैठने की व्यवस्था', chapter_ranges.get('Sitting Arrangement', (344, 362))),
    'Direction': ('दिशा', chapter_ranges.get('Direction', (363, 374))),
    'Mathematical Operations': ('गणितीय संक्रियाएँ', chapter_ranges.get('Mathematical Operations', (375, 491))),
    'Counting Figure': ('आकृतियों की गणना', chapter_ranges.get('Counting Figure', (492, 505))),
    'Paper Folding': ('कागज मोड़ना', chapter_ranges.get('Paper Folding', (506, 569))),
    'Embedded Figure': ('सन्निहित आकृति', chapter_ranges.get('Embedded Figure', (532, 569))),
    'Mirror Image': ('दर्पण प्रतिबिंब', chapter_ranges.get('Mirror Image', (570, 617))),
}

# Load answer keys
ans_data = json.load(open(ANS_FILE))
ans_by_ch = {ch: {int(k): v for k, v in ans.items()} for ch, ans in ans_data.items()}

# Load translation cache
cache = {}
if os.path.exists(CACHE_FILE):
    cache = json.load(open(CACHE_FILE))

def translate(text):
    if not text or not text.strip():
        return ''
    key = hashlib.md5(text.encode()).hexdigest()[:16]
    return cache.get(key, text)

def save_cache():
    json.dump(cache, open(CACHE_FILE, 'w'), ensure_ascii=False)

# ============ PDF COLUMN EXTRACTION ============
COL_EDGES = (200.0, 390.0)

def _clean(s):
    for ch in ('‭', '‬', '‎', '‪', '؜'):
        s = s.replace(ch, '')
    return re.sub(r'\s+', ' ', s)

def _col(x0, x1, w):
    if x1 - x0 > w * 0.75:
        return None
    if x0 < COL_EDGES[0]: return 0
    if x0 < COL_EDGES[1]: return 1
    return 2

def page_lines(page):
    """Return (banner, {col_str: [lines]}) for one page.

    Column keys are strings so they match what json.dump writes and what
    json.load returns -- in-memory int keys silently break a later reload.
    """
    w, h = page.rect.width, page.rect.height
    header_block = None
    for b in page.get_text("blocks"):
        x0, y0, x1, y1, txt = b[0], b[1], b[2], b[3], b[4]
        if y0 < h * 0.06 and (x1 - x0) > w * 0.5:
            header_block = (y0, x0, x1, y1, _clean(txt))
            break
    banner = header_block[4] if header_block else ''
    hy0, hy1 = (header_block[0], header_block[3]) if header_block else (0, 0)
    hx0, hx1 = (header_block[1], header_block[2]) if header_block else (0, 0)

    words = page.get_text("words")
    if not words:
        return banner, {'0': [], '1': [], '2': []}

    cols = {'0': [], '1': [], '2': []}
    for x0, y0, x1, y1, txt, *_ in words:
        txt = _clean(txt)
        if header_block and y0 >= hy0 and y1 <= hy1 and x0 >= hx0 and x1 <= hx1:
            continue
        if y1 > h - h * 0.045:
            continue
        c = _col(x0, x1, w)
        if c is not None:
            cols[str(c)].append((x0, y0, x1, txt))

    out = {'0': [], '1': [], '2': []}
    for c, ws in cols.items():
        ws.sort(key=lambda t: (round(t[1] / 3.0), t[0]))
        lines, cur, cur_y = [], [], None
        for x0, y0, x1, txt in ws:
            if cur_y is None or abs(y0 - cur_y) <= 4.0:
                cur.append((x0, x1, txt))
                cur_y = y0 if cur_y is None else cur_y
            else:
                lines.append(cur)
                cur, cur_y = [(x0, x1, txt)], y0
        if cur:
            lines.append(cur)
        for ln in lines:
            ln.sort(key=lambda t: t[0])
            buf = re.sub(r'\s+', ' ', ' '.join(t[2] for t in ln)).strip()
            if buf:
                out[c].append(buf)
    return banner, out

def extract_chapter_pages(first, last):
    d = fitz.open(PDF)
    pages = []
    for i in range(first, min(last+1, d.page_count)):
        banner, cols = page_lines(d[i])
        pages.append({'page': i, 'banner': banner, 'cols': cols})
    return pages

# ============ PARSE QUESTIONS ============
Q_START = re.compile(r'^Q\s*\.\s*(\d{1,3})\s*\.\s*(.*)')
OPT_PAT = re.compile(r'\(([a-dA-D])\)\s*(.+?)(?=\s*\([a-dA-D]\)|\s*$)')
EXAM_PAT = re.compile(r'(SSC\s+\w+(?:\s+\d{1,2}/\d{1,2}/\d{4})?\s*(?:\([^)]*\))?|Graduate Level\s+\d{1,2}/\d{1,2}/\d{4}\s*\([^)]*\)|Higher Secondary\s+\d{1,2}/\d{1,2}/\d{4}\s*\([^)]*\)|Matriculation Level\s+\d{1,2}/\d{1,2}/\d{4}\s*\([^)]*\))')

def parse_column(lines):
    questions = []
    q = None
    stem_parts = []
    for ln in lines:
        s = ln.strip()
        m = Q_START.match(s)
        if m:
            if q:
                q['stem'] = re.sub(r'\s+', ' ', ' '.join(stem_parts)).strip()
                questions.append(q)
            qnum = int(m.group(1))
            q = {'book_q': qnum, 'opts': {}}
            stem_parts = [m.group(2).strip()]
            continue
        if q is None:
            continue
        if re.match(r'\([a-dA-D]\)', s):
            for om in OPT_PAT.finditer(s):
                q['opts'][om.group(1).lower()] = om.group(2).strip()
            continue
        if EXAM_PAT.search(s):
            q['exam'] = EXAM_PAT.search(s).group(0).strip()
            continue
        if s:
            stem_parts.append(s)
    if q:
        q['stem'] = re.sub(r'\s+', ' ', ' '.join(stem_parts)).strip()
        questions.append(q)
    return questions

def extract_hindi_chapter(chapter_name, first_page, last_page):
    print(f"  Extracting pages {first_page}-{last_page}...")
    pages = extract_chapter_pages(first_page, last_page)
    all_qs = {}
    for col_name in ('0', '1', '2'):
        lines = []
        for p in pages:
            lines.extend(p['cols'].get(col_name, []))
        qs = parse_column(lines)
        for q in qs:
            all_qs.setdefault(q['book_q'], {'book_q': q['book_q'], 'opts': {}})
            for k in ('stem', 'exam'):
                if k in q and k not in all_qs[q['book_q']]:
                    all_qs[q['book_q']][k] = q[k]
            for k, v in q.get('opts', {}).items():
                if k not in all_qs[q['book_q']]['opts']:
                    all_qs[q['book_q']]['opts'][k] = v
    return sorted(all_qs.values(), key=lambda x: x['book_q'])

# ============ EXCEL BUILDER ============
header_font = Font(bold=True, size=11, color='FFFFFF')
header_fill = PatternFill(start_color='2F5496', end_color='2F5496', fill_type='solid')
header_alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
thin_border = Border(left=Side(style='thin'), right=Side(style='thin'), top=Side(style='thin'), bottom=Side(style='thin'))

def build_excel(chapter_name, hi_qs, en_qs, answers):
    # Index English by book_q
    en_by_q = {q['book_q']: q for q in en_qs if q.get('book_q')}
    
    # Merge
    merged = []
    for hi in hi_qs:
        bq = hi['book_q']
        en = en_by_q.get(bq, {})
        ans = answers.get(bq)
        merged.append({
            'book_q': bq,
            'hi_stem': hi.get('stem', ''),
            'hi_opts': hi.get('opts', {}),
            'en_stem': en.get('q', ''),
            'en_opts': {k: en.get(k, '') for k in 'abcd'},
            'exam': hi.get('exam', '') or en.get('exam', ''),
            'answer': ans[0] if ans else None,
            'answer_conf': 'high' if ans and ans[1] else ('medium' if ans else 'none'),
        })
    
    usable = [m for m in merged if m['hi_stem'] and m['hi_opts'].get('a') and m['answer']]
    print(f"    Usable: {len(usable)}/{len(merged)}")
    
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = chapter_name[:31]
    
    headers = [
        'Question_ID', 'Chapter', 'Subtopic', 'Difficulty',
        'Question_Hindi', 'Option_A_Hindi', 'Option_B_Hindi', 'Option_C_Hindi', 'Option_D_Hindi',
        'Question_English', 'Option_A_English', 'Option_B_English', 'Option_C_English', 'Option_D_English',
        'Correct_Answer', 'Explanation_Hindi', 'Explanation_English',
        'Exam', 'Year', 'Shift', 'Source'
    ]
    
    for col, h in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=h)
        cell.font = header_font; cell.fill = header_fill; cell.alignment = header_alignment; cell.border = thin_border
    
    widths = [14, 18, 22, 12, 55, 22, 22, 22, 22, 55, 22, 22, 22, 22, 14, 55, 55, 18, 8, 10, 12]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    
    for idx, q in enumerate(usable, 2):
        bq = q['book_q']
        hi_stem = q['hi_stem']
        hi_opts = q['hi_opts']
        en_stem = q['en_stem'] or translate(hi_stem)
        en_opts = q['en_opts']
        if not any(en_opts.values()):
            en_opts = {k: translate(v) for k, v in hi_opts.items()}
        exam = q['exam']
        ans = q['answer']
        
        # Parse exam
        exam_name, year, shift = '', '', ''
        if exam:
            m = re.search(r'(SSC\s+\w+|Graduate Level|Higher Secondary|Matriculation Level)\s+(\d{1,2}/\d{1,2}/\d{4})\s*\(([^)]+)\)', exam)
            if m:
                exam_name, year, shift = m.group(1), m.group(2).split('/')[-1], m.group(3).replace('Shift', '').replace('-', '').strip()
        
        # Explanation
        ans_letter = ans
        ans_text = hi_opts.get(ans, '') or en_opts.get(ans, '')
        hi_exp = f"""प्रश्न प्रकार: {chapter_name}
चरण 1: दिए गए शब्द और उसके कोड का विश्लेषण करें।
चरण 2: प्रत्येक अक्षर/संख्या के लिए नियम पहचानें।
चरण 3: उसी नियम को पूछे गए शब्द पर लागू करें।
चरण 4: सही विकल्प चुनें।
उत्तर: ({ans_letter}) {ans_text}"""
        en_exp = f"""Question Type: {chapter_name}
Step 1: Analyze the given pattern.
Step 2: Identify the rule for each element.
Step 3: Apply the same rule to the target.
Step 4: Select the correct option.
Answer: ({ans_letter}) {ans_text}"""
        
        diff_map = {'high': 'Medium', 'medium': 'Hard', 'none': 'Unknown'}
        difficulty = diff_map.get(q['answer_conf'], 'Medium')
        
        row = [
            f'{chapter_name[:2].upper()}_{bq:04d}', chapter_name, chapter_name, difficulty,
            hi_stem, hi_opts.get('a', ''), hi_opts.get('b', ''), hi_opts.get('c', ''), hi_opts.get('d', ''),
            en_stem, en_opts.get('a', ''), en_opts.get('b', ''), en_opts.get('c', ''), en_opts.get('d', ''),
            ans, hi_exp, en_exp, exam_name, year, shift, 'Pinnacle 7200 Reasoning 7th Ed'
        ]
        for col, val in enumerate(row, 1):
            cell = ws.cell(row=idx, column=col, value=val)
            cell.alignment = Alignment(vertical='top', wrap_text=True)
            cell.border = thin_border
    
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = f"A1:{get_column_letter(len(headers))}{len(usable)+1}"
    
    out_path = os.path.join(OUT_DIR, f"{chapter_name}_Bilingual.xlsx")
    wb.save(out_path)
    save_cache()
    print(f"    Saved: {out_path} ({len(usable)} rows)")
    return len(usable)

# ============ MAIN ============
if __name__ == '__main__':
    os.makedirs(OUT_DIR, exist_ok=True)
    
    total = 0
    for en_name, (hi_name, (first, last)) in CHAPTERS.items():
        print(f"\n=== {en_name} ===")
        en_file = os.path.join(EN_DIR, en_name + '.json')
        if not os.path.exists(en_file) and en_name == 'Paper Folding':
            en_file = os.path.join(EN_DIR, 'Completion Of Figure.json')
        if not os.path.exists(en_file):
            print(f"  English file missing: {en_file}")
            continue
        
        en_qs = json.load(open(en_file))
        hi_qs = extract_hindi_chapter(hi_name, first, last)
        answers = ans_by_ch.get(en_name, {})
        
        if not hi_qs:
            print(f"  No Hindi questions extracted")
            continue
        
        n = build_excel(en_name, hi_qs, en_qs, answers)
        total += n
    
    print(f"\n=== DONE ===")
    print(f"Total questions across all chapters: {total}")