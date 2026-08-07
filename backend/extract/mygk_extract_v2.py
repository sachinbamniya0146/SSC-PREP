#!/usr/bin/env python3
"""myGKstudy v2: capture full question text + options + answer + exam/date/shift, chapter-split."""
import pymupdf, re, json, os

PDF = 'myGKstudy.pdf'
OUT = 'mygk'
os.makedirs(OUT, exist_ok=True)

DATE_RE = re.compile(r'\b(\d{1,2})/(\d{1,2})/(\d{4})\b')
EXAM_RE = re.compile(r'(SSC)\s+(CGL|CHSL|CPO|MTS|GD|JE|STENO)', re.I)
SHIFT_RE = re.compile(r'Shift\s*[-–]?\s*([IV]+|\d)', re.I)
Q_MARK = re.compile(r'^\s*(\d{1,3})\s*\.\s*$')
ANS_RE = re.compile(r'Ans\.?\s*\(([a-dA-D])\)')
OPT_RE = re.compile(r'^\(([a-dA-D])\)\s*(.+)$')
SOL_RE = re.compile(r'^(Sol(?:ution)?\.?|Explanation)\s*[:.]?\s*(.*)$', re.I)

def parse_page(text):
    blocks = []
    cur = None
    for line in text.split('\n'):
        s = line.strip()
        m = Q_MARK.match(s)
        if m:
            if cur:
                blocks.append(cur)
            cur = {'no': int(m.group(1)), 'exam': '', 'date': '', 'shift': '',
                   'ans': '', 'q': '', 'options': {}, 'sol': ''}
            continue
        if cur is None:
            continue
        if not s:
            continue
        # exam tag
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
            continue
        om = OPT_RE.match(s)
        if om:
            cur['options'][om.group(1).upper()] = om.group(2).strip()
            continue
        sm = SOL_RE.match(s)
        if sm and sm.group(2):
            cur['sol'] = (cur['sol'] + ' ' + sm.group(2)).strip()
            continue
        if cur['ans'] or cur['options'] or cur['sol']:
            # tail text after answer line => solution continuation
            if cur['ans'] and not cur['options']:
                pass
            elif cur['ans']:
                cur['sol'] = (cur['sol'] + ' ' + s).strip()
            continue
        # question body accumulation
        cur['q'] = (cur['q'] + ' ' + s).strip()
    if cur:
        blocks.append(cur)
    return blocks

def main():
    doc = pymupdf.open(PDF)
    allb = []
    for p in range(doc.page_count):
        allb += parse_page(doc[p].get_text())
    # chapter split: number reset (<=2 after >5) => boundary
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
    # flatten with chapter index
    flat = []
    for ci, ch in enumerate(chapters):
        for b in ch:
            b['chapter_idx'] = ci
            flat.append(b)
    with_q = sum(1 for b in flat if len(b['q']) > 10)
    with_ans = sum(1 for b in flat if b['ans'])
    with_opts = sum(1 for b in flat if len(b['options']) >= 2)
    with_exam = sum(1 for b in flat if b['exam'])
    print(f"total blocks: {len(flat)} | with_q: {with_q} | with_ans: {with_ans} | with_opts>=2: {with_opts} | with_exam: {with_exam}")
    # sample
    for b in flat:
        if b['q'] and b['ans'] and b['options']:
            print(json.dumps(b, ensure_ascii=False)[:400])
            break
    json.dump(flat, open(os.path.join(OUT, '_questions_v2.json'), 'w'), ensure_ascii=False, indent=1)
    print(f"saved -> mygk/_questions_v2.json")
    doc.close()

if __name__ == '__main__':
    main()
