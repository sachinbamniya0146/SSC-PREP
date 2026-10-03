"""Derive true chapter page ranges from the PDF running headers.

Match on the ENGLISH chapter title in the header: the Hindi titles carry
doubled/garbled matras in this PDF (e.g. "लुप्त संख्याा"), while the English
titles are clean. Longest title first so "Embedded Figure" wins over
"Counting of Figure" and "Cube and Dice" over "Dice".
"""
import json

import pymupdf as fitz

PDF = '/Users/sachin/Downloads/838411207-Pinnacle-SSC-Reasoning-7200-TCS-MCQ-7th-Edition-2025-Hindi-Medium.pdf'

# header substring -> chapter key (keys match the English JSON filenames)
TITLES = {
    'Analogy': 'Analogy',
    'Odd one out': 'Odd one out',
    'Odd One Out': 'Odd one out',
    'Coding Decoding': 'Coding-Decoding',
    'Coding-Decoding': 'Coding-Decoding',
    'Series Completion': 'Series',
    'Number Series': 'Series',
    'Missing Number': 'Missing Number',
    'Statement & Conclusion': 'Statement and Conclusion',
    'Statement and Conclusion': 'Statement and Conclusion',
    'Blood Relation': 'Blood Relation',
    'Blood Relations': 'Blood Relation',
    'Venn Diagram': 'Venn Diagram',
    'Venn - Diagram': 'Venn Diagram',
    'Cube and Dice': 'Cube and Dice',
    'Cube & Dice': 'Cube and Dice',
    'Sitting Arrangement': 'Sitting Arrangement',
    'Direction': 'Direction',
    'Arithmetic Reasoning': 'Mathematical Operations',
    'Mathematical Operations': 'Mathematical Operations',
    'Counting of Figure': 'Counting Figure',
    'Counting Figure': 'Counting Figure',
    'Paper Cut and Fold': 'Paper Folding',
    'Paper Cutting': 'Paper Folding',
    'Embedded Figure': 'Embedded Figure',
    'Mirror / Water Image': 'Mirror Image',
    'Mirror Image': 'Mirror Image',
}
# longest first so specific titles beat their substrings
ORDER = sorted(TITLES, key=len, reverse=True)


def header(page):
    """Running-header text: full-width blocks in the top band."""
    h, w = page.rect.height, page.rect.width
    parts = []
    for b in page.get_text('blocks'):
        x0, y0, x1, y1, txt = b[0], b[1], b[2], b[3], b[4]
        if y0 < h * 0.06 and (x1 - x0) > w * 0.5:
            parts.append((round(y0, 1), round(x0, 1), txt))
    parts.sort()
    return ' '.join(t for _, _, t in parts)


def main():
    d = fitz.open(PDF)
    per_page = []
    for i in range(d.page_count):
        hd = header(d[i])
        hit = None
        for title in ORDER:
            if title in hd:
                hit = TITLES[title]
                break
        per_page.append((i, hit, hd))

    # collapse to transitions - compare only the chapter title, ignore the Day: Nth
    chapter_of = {}
    for title in ORDER:
        chapter_of[title] = TITLES[title]

    def get_chapter(hd):
        for title in ORDER:
            if title in hd:
                return TITLES[title]
        return None

    # The chapter title only appears on section-intro pages; on the rest the
    # running header is absent. So take only the *recognised* pages as
    # boundaries and let each chapter span up to the next recognised one.
    anchors = [(i, get_chapter(hd), hd) for i, _, hd in per_page if get_chapter(hd)]

    print(f"{'start':>6} {'end':>6}  {'chapter':<28} pages")
    ranges = {}
    for idx, (pg, key, hd) in enumerate(anchors):
        end = anchors[idx + 1][0] - 1 if idx + 1 < len(anchors) else d.page_count - 1
        if key in ranges:
            a0, b0 = ranges[key]
            if (end - pg) > (b0 - a0):
                ranges[key] = (pg, end)
        else:
            ranges[key] = (pg, end)

    for key, (a, b) in sorted(ranges.items(), key=lambda kv: kv[1][0]):
        print(f"{a:6d} {b:6d}  {key:<28} ({b - a + 1} pages)")

    json.dump(ranges, open('/Users/sachin/SSC-PREP/backend/extract/hindi/chapter_ranges.json', 'w'), indent=2)
    print('\nsaved chapter_ranges.json')
    unmatched = [i for i, hit, _ in per_page if not hit]
    print(f"pages with no recognised header: {len(unmatched)}")


if __name__ == '__main__':
    main()
