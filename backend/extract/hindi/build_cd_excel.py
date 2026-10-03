#!/usr/bin/env python3
"""Build Coding-Decoding bilingual Excel - OPTIMIZED with cached translations."""
import json
import os
import sys
import hashlib
sys.path.insert(0, os.path.expanduser('~/.hermes/hermes-agent/venv/lib/python3.11/site-packages'))

from googletrans import Translator
import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from openpyxl.utils import get_column_letter

# Load data
bilingual = json.load(open('/Users/sachin/SSC-PREP/backend/extract/hindi/cd_bilingual.json'))
usable = [b for b in bilingual if b['hi_stem'] and b['hi_opts'].get('a') and b['answer']]
print(f"Building Excel for {len(usable)} questions...")

# Translation cache
CACHE_FILE = '/Users/sachin/SSC-PREP/backend/extract/hindi/translation_cache.json'
cache = {}
if os.path.exists(CACHE_FILE):
    cache = json.load(open(CACHE_FILE))
    print(f"Loaded {len(cache)} cached translations")

t = Translator()

def translate(text):
    """Translate with caching."""
    if not text or not text.strip():
        return ''
    key = hashlib.md5(text.encode()).hexdigest()[:16]
    if key in cache:
        return cache[key]
    try:
        result = t.translate(text, src='hi', dest='en')
        cache[key] = result.text
        return result.text
    except Exception as e:
        print(f"  Translation failed: {e}")
        return text

def save_cache():
    json.dump(cache, open(CACHE_FILE, 'w'), ensure_ascii=False)

# Coding-Decoding explanation generator
def generate_explanation(stem, opts, answer):
    ans_letter = answer
    ans_text = opts.get(ans_letter, '')
    
    # Detect type
    en_stem = translate(stem)
    en_lower = en_stem.lower()
    
    if any(kw in en_lower for kw in ['coded as', 'written as']):
        if any(c.isdigit() for c in stem) and '-' in stem:
            qtype = "Number/Symbol Coding"
        elif "'" in stem or '"' in stem:
            qtype = "Letter Coding"
        else:
            qtype = "Word Coding"
    elif 'statement' in en_lower or 'कथन' in stem.lower():
        qtype = "Statement Coding"
    elif any(kw in en_lower for kw in ['binary', '0', '1']):
        qtype = "Binary Coding"
    else:
        qtype = "Letter Coding"
    
    hi_exp = f"""प्रश्न प्रकार: {qtype}
चरण 1: दिए गए शब्द और उसके कोड का विश्लेषण करें।
चरण 2: प्रत्येक अक्षर/संख्या के लिए नियम पहचानें (स्थिति परिवर्तन, जोड़/घटाव, उल्टा क्रम, आदि)।
चरण 3: उसी नियम को पूछे गए शब्द पर लागू करें।
चरण 4: प्राप्त कोड से सही विकल्प चुनें।

उत्तर: ({ans_letter}) {ans_text}"""
    
    en_exp = f"""Question Type: {qtype}
Step 1: Analyze the given word and its code pattern.
Step 2: Identify the rule for each letter/number (position shift, addition/subtraction, reversal, etc.).
Step 3: Apply the same rule to the target word.
Step 4: Match the derived code with the given options.

Answer: ({ans_letter}) {ans_text}"""
    
    return hi_exp, en_exp, qtype

# Create workbook
wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Coding-Decoding"

headers = [
    'Question_ID', 'Chapter', 'Subtopic', 'Difficulty',
    'Question_Hindi', 'Option_A_Hindi', 'Option_B_Hindi', 'Option_C_Hindi', 'Option_D_Hindi',
    'Question_English', 'Option_A_English', 'Option_B_English', 'Option_C_English', 'Option_D_English',
    'Correct_Answer', 'Explanation_Hindi', 'Explanation_English',
    'Exam', 'Year', 'Shift', 'Source'
]

header_font = Font(bold=True, size=11, color='FFFFFF')
header_fill = PatternFill(start_color='2F5496', end_color='2F5496', fill_type='solid')
header_alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
thin_border = Border(
    left=Side(style='thin'), right=Side(style='thin'),
    top=Side(style='thin'), bottom=Side(style='thin')
)

for col, h in enumerate(headers, 1):
    cell = ws.cell(row=1, column=col, value=h)
    cell.font = header_font
    cell.fill = header_fill
    cell.alignment = header_alignment
    cell.border = thin_border

widths = [14, 18, 22, 12, 55, 22, 22, 22, 22, 55, 22, 22, 22, 22, 14, 55, 55, 18, 8, 10, 12]
for i, w in enumerate(widths, 1):
    ws.column_dimensions[get_column_letter(i)].width = w

# Data rows - translate in batches, save cache every 20
for idx, q in enumerate(usable, 2):
    bq = q['book_q']
    hi_stem = q['hi_stem']
    hi_opts = q['hi_opts']
    exam = q['exam']
    ans = q['answer']
    
    # Translate stem and options (cached)
    en_stem = translate(hi_stem)
    en_opts = {k: translate(v) for k, v in hi_opts.items()}
    
    # Parse exam
    exam_name, year, shift = '', '', ''
    if exam:
        import re
        m = re.search(r'(SSC\s+\w+|Graduate Level|Higher Secondary|Matriculation Level)\s+(\d{1,2}/\d{1,2}/\d{4})\s*\(([^)]+)\)', exam)
        if m:
            exam_name = m.group(1)
            year = m.group(2).split('/')[-1]
            shift = m.group(3).replace('Shift', '').replace('-', '').strip()
    
    hi_exp, en_exp, qtype = generate_explanation(hi_stem, hi_opts, ans)
    
    subtopic_map = {
        'Letter Coding': 'Letter Coding',
        'Number/Symbol Coding': 'Number/Symbol Coding',
        'Word Coding': 'Word Coding',
        'Statement Coding': 'Statement/Word Coding',
        'Binary Coding': 'Binary Coding',
    }
    subtopic = subtopic_map.get(qtype, 'Letter Coding')
    diff_map = {'high': 'Medium', 'medium': 'Hard', 'none': 'Unknown'}
    difficulty = diff_map.get(q['answer_confidence'], 'Medium')
    
    row_data = [
        f'CD_{bq:04d}', 'Coding-Decoding', subtopic, difficulty,
        hi_stem, hi_opts.get('a', ''), hi_opts.get('b', ''), hi_opts.get('c', ''), hi_opts.get('d', ''),
        en_stem, en_opts.get('a', ''), en_opts.get('b', ''), en_opts.get('c', ''), en_opts.get('d', ''),
        ans, hi_exp, en_exp, exam_name, year, shift, 'Pinnacle 7200 Reasoning 7th Ed'
    ]
    
    for col, val in enumerate(row_data, 1):
        cell = ws.cell(row=idx, column=col, value=val)
        cell.alignment = Alignment(vertical='top', wrap_text=True)
        cell.border = thin_border
    
    if idx % 20 == 0:
        save_cache()
        print(f"  Processed {idx-1}/{len(usable)}...")

# Final save
save_cache()
ws.freeze_panes = 'A2'
ws.auto_filter.ref = f"A1:{get_column_letter(len(headers))}{len(usable)+1}"

out_path = '/Users/sachin/SSC-PREP/backend/extract/hindi/Coding-Decoding_Bilingual.xlsx'
wb.save(out_path)
print(f"\nSaved: {out_path}")
print(f"Rows: {len(usable)} data + header")