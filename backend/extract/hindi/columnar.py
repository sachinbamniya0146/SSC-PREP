"""Word-level columnar extraction of the bilingual Pinnacle PDF.

Block-level extraction concatenates spans and fuses Devanagari words
("केरूपमें" instead of "के रूप में"). The words API keeps real word boxes, so
we rebuild lines from word geometry instead.
"""
import json
import re

import pymupdf as fitz

PDF = '/Users/sachin/Downloads/838411207-Pinnacle-SSC-Reasoning-7200-TCS-MCQ-7th-Edition-2025-Hindi-Medium.pdf'

COL_EDGES = (200.0, 390.0)     # x0 boundaries between the three text columns
GAP_RATIO = 0.34               # insert a space when gap > GAP_RATIO * median char width
LINE_TOL = 4.0                 # words within this many points share a line


def _clean(s):
    for ch in ('‭', '‬', '‎', '‪', '؜'):
        s = s.replace(ch, '')
    return s


def _col(x0, x1, page_w):
    if x1 - x0 > page_w * 0.75:       # full-width banner (chapter header/footer)
        return None
    if x0 < COL_EDGES[0]:
        return 0
    if x0 < COL_EDGES[1]:
        return 1
    return 2


def page_lines(page):
    """Return (banner_text, {col: [line_text, ...]}) with words re-spaced.

    The running header (chapter title + Day range) and the footer watermark sit
    above/below the text columns, so they are split off by y-position rather
    than by width -- a header word is never wide enough to trip the width test.
    """
    w, h = page.rect.width, page.rect.height

    # running header: use block geometry, since a header *word* is never wide
    # enough to trip a width test but the header *block* is
    header_block = None
    for b in page.get_text("blocks"):
        x0, y0, x1, y1, txt = b[0], b[1], b[2], b[3], b[4]
        if y0 < h * 0.06 and (x1 - x0) > w * 0.5:
            header_block = (y0, x0, x1, y1, _clean(txt))
            break
    banner = header_block[4] if header_block else ''
    hy0, hy1 = (header_block[0], header_block[3]) if header_block else (0, 0)
    hx0, hx1 = (header_block[1], header_block[2]) if header_block else (0, 0)

    words = page.get_text("words")   # (x0, y0, x1, y1, word, block, line, word_no)
    if not words:
        return banner, {0: [], 1: [], 2: []}

    cols = {0: [], 1: [], 2: []}
    for x0, y0, x1, y1, txt, *_ in words:
        txt = _clean(txt)
        if header_block and y0 >= hy0 and y1 <= hy1 and x0 >= hx0 and x1 <= hx1:
            continue                                  # word inside header block
        if y1 > h - h * 0.045:
            continue                                  # footer watermark: drop
        c = _col(x0, x1, w)
        if c is not None:
            cols[c].append((x0, y0, x1, txt))

    # group words into lines by vertical overlap, then order horizontally
    out = {0: [], 1: [], 2: []}
    for c, ws in cols.items():
        ws.sort(key=lambda t: (round(t[1] / 3.0), t[0]))
        lines, cur, cur_y = [], [], None
        for x0, y0, x1, txt in ws:
            if cur_y is None or abs(y0 - cur_y) <= LINE_TOL:
                cur.append((x0, x1, txt))
                cur_y = y0 if cur_y is None else cur_y
            else:
                lines.append(cur)
                cur, cur_y = [(x0, x1, txt)], y0
        if cur:
            lines.append(cur)

        for ln in lines:
            ln.sort(key=lambda t: t[0])
            # the words API already splits on whitespace, so a plain space join
            # is exactly the original spacing
            buf = re.sub(r'\s+', ' ', ' '.join(t[2] for t in ln)).strip()
            if buf:
                out[c].append(buf)

    return banner, out


def extract(path=PDF, first=0, last=None):
    d = fitz.open(path)
    last = d.page_count if last is None else min(last, d.page_count)
    pages = []
    for i in range(first, last):
        banner, cols = page_lines(d[i])
        pages.append({'page': i, 'banner': banner, 'cols': cols})
    return pages


if __name__ == '__main__':
    pages = extract(first=146, last=204)
    for p in pages:
        if p['page'] == 147:
            print('BANNER:', p['banner'][:120])
            for c in (0, 1, 2):
                print(f"\n===== COLUMN {c} =====")
                for ln in p['cols'][c][:26]:
                    print(' ', ln)
            break
    json.dump(pages, open('/Users/sachin/SSC-PREP/backend/extract/hindi/pages_cd_full.json', 'w'))
    print("\nsaved pages_cd_full.json:", len(pages), "pages")
