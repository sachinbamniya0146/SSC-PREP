#!/usr/bin/env python3
"""myGKstudy refined: precise exam/date/shift + per-question answer, split by chapter reset."""
import pymupdf, re, json, os

PDF = 'myGKstudy.pdf'
OUT = 'mygk'
os.makedirs(OUT, exist_ok=True)

DATE_RE = re.compile(r'\b(\d{1,2})/(\d{1,2})/(\d{4})\b')
EXAM_RE = re.compile(r'(SSC)\s+(CGL|CHSL|CPO|MTS|GD|JE|STENO)', re.I)
TAG_RE = re.compile(r'(SSC\s+\w[\w\d ().\-/]*?Shift\s*[-–]?\s*\w+)', re.I)
SHIFT_RE = re.compile(r'Shift\s*[-–]?\s*([IV]+|\d|[IV]+/[IV]+)', re.I)
Q_MARK = re.compile(r'^\s*(\d{1,3})\s*\.\s*$')
ANS_RE = re.compile(r'Ans\.?\s*\(([a-dA-D])\)')
OPT_RE = re.compile(r'\(([a-dA-D])\)')

def parse_page(text):
    blocks = []
    cur = None
    for line in text.split('\n'):
        s = line.strip()
        m = Q_MARK.match(s)
        if m:
            if cur:
                blocks.append(cur)
            cur = {'no': int(m.group(1)), 'exam': '', 'date': '', 'shift': '', 'ans': '', 'ntok': 0}
            continue
        if cur is None:
            continue
        if not s:
            continue
        cur['ntok'] += 1
        # exam tag: a line holding "SSC CGL (Tier-I)... Shift-I" — capture date+shift
        if 'SSC' in s or 'Shift' in s:
            em = EXAM_RE.search(s)
            dm = DATE_RE.search(s)
            sm = SHIFT_RE.search(s)
            if em: cur['exam'] = f"{em.group(1)} {em.group(2)}"
            if dm: cur['date'] = f"{dm.group(1)}/{dm.group(2)}/{dm.group(3)}"
            if sm: cur['shift'] = sm.group(1)
        am = ANS_RE.search(s)
        if am:
            cur['ans'] = am.group(1).upper()
    if cur: blocks.append(cur)
    return blocks

def main():
    doc = pymupdf.open(PDF)
    allb = []
    for p in range(doc.page_count):
        allb += parse_page(doc[p].get_text())
    # chapter split: number resets down to a small value (<=2 after being >5) => boundary
    chapters = []
    cur = []
    prev_no = 0
    for b in allb:
        if b['no'] <= 2 and prev_no > 5:
            if cur: chapters.append(cur)
            cur = [b]
        else:
            cur.append(b)
        prev_no = b['no']
    if cur: chapters.append(cur)
    print(f"detected {len(chapters)} chapters")
    for i, ch in enumerate(chapters):
        with_ans = sum(1 for b in ch if b['ans'])
        with_exam = sum(1 for b in ch if b['exam'])
        with_date = sum(1 for b in ch if b['date'])
        print(f"  ch{i}: {len(ch)} Q | ans={with_ans} exam={with_exam} date={with_date} | nos {ch[0]['no']}..{ch[-1]['no']}")
    json.dump(chapters, open(os.path.join(OUT, '_chapters.json'), 'w'), ensure_ascii=False, indent=1)
    print(f"saved chapters -> mygk/_chapters.json")
    doc.close()

if __name__ == '__main__':
    main()