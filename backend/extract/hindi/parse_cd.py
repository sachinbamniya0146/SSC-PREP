"""Parse Hindi questions from columnar extraction - each column independently."""
import json
import re

PAGES = json.load(open('/Users/sachin/SSC-PREP/backend/extract/hindi/pages_cd_full.json'))

# Question start: Q.N. or Q. N. at line start
Q_START = re.compile(r'^Q\s*\.\s*(\d{1,3})\s*\.\s*(.*)')
# Option lines: (a) ... (b) ... 
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
            # options line(s) - continue accumulating options until next Q or exam
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

# Coding-Decoding pages are 146-204
cd_pages = [p for p in PAGES if 146 <= p['page'] <= 204]
print(f"CD pages: {len(cd_pages)}")

all_cd = {}
for col_name in ('0', '1', '2'):
    lines = []
    for p in cd_pages:
        lines.extend(p['cols'][col_name])
    qs = parse_column(lines)
    rng = (min(q['book_q'] for q in qs), max(q['book_q'] for q in qs)) if qs else None
    print(f"Column {col_name}: {len(qs)} questions, range={rng}")
    all_cd[col_name] = qs

# Merge by book_q (should be disjoint ranges)
merged = {}
for col, qs in all_cd.items():
    for q in qs:
        merged.setdefault(q['book_q'], {'book_q': q['book_q'], 'opts': {}})
        for k in ('stem', 'exam'):
            if k in q and k not in merged[q['book_q']]:
                merged[q['book_q']][k] = q[k]
        for k, v in q.get('opts', {}).items():
            if k not in merged[q['book_q']]['opts']:
                merged[q['book_q']]['opts'][k] = v

print(f"\nMerged: {len(merged)} questions")
for q in sorted(merged.values(), key=lambda x: x['book_q'])[:10]:
    print(f"Q{q['book_q']:3d} | stem={q.get('stem','')[:100]} | opts={len(q.get('opts',{}))} | exam={q.get('exam','')[:45]}")

json.dump(sorted(merged.values(), key=lambda x: x['book_q']),
          open('/Users/sachin/SSC-PREP/backend/extract/hindi/cd_hindi_parsed.json', 'w'),
          ensure_ascii=False)
print("\nsaved cd_hindi_parsed.json")