#!/usr/bin/env python3
"""Pinnacle 7200 TCS MCQ — full extractor v2 (chunk-based, robust).
Output: extract/pinnacle/<Chapter>.json — [{book_q, q, a,b,c,d, exam, date, shift, year, has_fig}]
"""
import pymupdf, re, json, os

PDF = 'pinnacle.pdf'
OUT = 'pinnacle'
os.makedirs(OUT, exist_ok=True)

CHAPTERS = [
    (5, 'Analogy'), (74, 'Odd one out'), (104, 'Coding-Decoding'), (141, 'Series'),
    (179, 'Missing Number'), (191, 'Statement and Conclusion'), (240, 'Blood Relation'),
    (251, 'Venn Diagram'), (287, 'Cube and Dice'), (304, 'Sitting Arrangement'),
    (319, 'Direction'), (323, 'Arithmetic Reasoning'), (331, 'Mathematical Operations'),
    (353, 'Word Arrangement'), (367, 'Age'), (370, 'Calendar'), (372, 'Series Non Verbal'),
    (406, 'Counting Figure'), (452, 'Embedded Figure'), (491, 'Completion Of Figure'),
    (501, 'Mirror Image'), (532, 'Miscellaneous'),
]

EXAM_RE = re.compile(
    r'SSC\s+(?:CGL\s*\(?\s*Tier\s*-\s*I{1,2}\)?\s*)?(CGL|CHSL|CPO|MTS|GD|JE|STENO|SELECTION\s*POST|DELHI\s*POLICE|CISF|CRPF|BSF|CAPF)',
    re.I)
DATE_RE = re.compile(r'\b(\d{1,2})/(\d{1,2})/(\d{4})\b')
SHIFT_RE = re.compile(r'\(?\s*(Morning|Evening|Afternoon|Night)\s*\)?', re.I)
Q_SPLIT = re.compile(r'Q\.\s*(\d{1,3})\s*\.')

def norm(s):
    return re.sub(r'\s+', ' ', s).strip()

def find_exam_tag(text):
    """Return (match_end_index, exam, date, shift, year) for first SSC exam tag, or None."""
    m = EXAM_RE.search(text)
    if not m:
        return None
    exam = norm(m.group(0))
    rest = text[m.end():]
    date, shift, year = '', '', ''
    dm = DATE_RE.search(rest[:40])
    if dm:
        date = f"{dm.group(1)}/{dm.group(2)}/{dm.group(3)}"
        year = dm.group(3)
    sm = SHIFT_RE.search(rest[:40])
    if sm:
        shift = sm.group(1)
    # end = position after the tag content (date/shift)
    end = m.end()
    if dm and dm.start() < 40:
        end = max(end, m.end() + dm.end())
    if sm and sm.start() < 40:
        end = max(end, m.end() + sm.end())
    return (end, exam, date, shift, year)

def parse_options(text):
    """Parse options from text like '(a) 24 (b) 14 (c) 21 (d) 18' possibly multi-line."""
    opts = {'a': '', 'b': '', 'c': '', 'd': ''}
    # find option spans
    parts = re.split(r'\(([a-dA-D])\)', text)
    # parts[0] = leading junk, then pairs (letter, content)
    if len(parts) < 2:
        return opts, norm(text)
    for k in range(1, len(parts), 2):
        letter = parts[k].lower()
        content = parts[k + 1] if k + 1 < len(parts) else ''
        if letter in opts:
            opts[letter] += ' ' + norm(content)
    for k in opts:
        opts[k] = norm(opts[k])
    return opts, norm(parts[0])

def parse_chapter(doc, start_p1, end_p1):
    text = ''
    for p in range(start_p1 - 1, min(end_p1, doc.page_count)):
        text += doc[p].get_text() + '\n'
    # normalize lines: join wrapped lines but keep structure
    text = text.replace('\r', '\n')
    # split into question chunks
    chunks = Q_SPLIT.split(text)
    # chunks[0] = preamble; then alternating book_q, content
    qs = []
    for i in range(1, len(chunks), 2):
        book_q = int(chunks[i])
        content = chunks[i + 1]
        # cut at next 'Q.' boundary already handled by split
        # find exam tag
        tag = find_exam_tag(content)
        if tag:
            end, exam, date, shift, year = tag
            q_part = content[:tag[0] - 0]  # before tag
            opt_part = content[tag[0]:]
            # remove stray header text (chapter title, page numbers)
            q_part = re.sub(r'^(Pinnacle\s*\n?)', '', q_part, flags=re.I)
        else:
            exam, date, shift, year = '', '', '', ''
            q_part = content
            opt_part = ''
        opts, leading = parse_options(opt_part)
        # question = q_part + leading (text before options that might be after tag)
        q = norm(q_part) + (' ' + norm(leading) if leading and norm(leading) not in norm(q_part) else '')
        q = re.sub(r'\s+', ' ', q).strip()
        # strip exam tag leaked into question (tag text like 'SSC CPO 12/03/2019 (Morning)')
        if tag:
            q = re.sub(r'SSC\s+(?:CGL\s*\(?\s*Tier\s*-\s*I{1,2}\)?\s*)?(?:CGL|CHSL|CPO|MTS|GD|JE|STENO|SELECTION\s*POST|DELHI\s*POLICE|CISF|CRPF|BSF|CAPF)\s*\d{1,2}/\d{1,2}/\d{4}\s*\(?\s*(?:Morning|Evening|Afternoon|Night)?\s*\)?', '', q, flags=re.I)
        # strip footer
        q = re.sub(r'www\.ssccglpinnacle\.com.*$', '', q, flags=re.I).strip()
        if not q and not any(opts.values()):
            continue
        has_fig = bool(re.search(r'\b(figure|diagram|image|given\s*below|as\s*shown)\b', q, re.I)) or not any(opts.values())
        qs.append({'book_q': book_q, 'q': q, 'exam': exam, 'date': date, 'shift': shift,
                   'year': year, 'a': opts['a'], 'b': opts['b'], 'c': opts['c'], 'd': opts['d'],
                   'has_fig': has_fig})
    return qs

def main():
    doc = pymupdf.open(PDF)
    total = 0
    for idx, (sp, name) in enumerate(CHAPTERS):
        ep = CHAPTERS[idx + 1][0] if idx + 1 < len(CHAPTERS) else doc.page_count + 1
        qs = parse_chapter(doc, sp, ep)
        total += len(qs)
        with open(os.path.join(OUT, f'{name}.json'), 'w', encoding='utf-8') as f:
            json.dump(qs, f, ensure_ascii=False, indent=1)
        print(f"{name:28s} p{sp:3d}-{ep-1:<3d}: {len(qs):4d}")
    print(f"\nTOTAL: {total}")
    doc.close()

if __name__ == '__main__':
    main()
