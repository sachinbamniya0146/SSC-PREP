import pymupdf as fitz

P = '/Users/sachin/Downloads/838411207-Pinnacle-SSC-Reasoning-7200-TCS-MCQ-7th-Edition-2025-Hindi-Medium.pdf'
d = fitz.open(P)
print("pages:", d.page_count)

hits = [i for i in range(d.page_count)
        if 'कोडिंग' in d[i].get_text() or 'Coding-Decoding' in d[i].get_text()]
print("coding pages:", hits[:8], "count:", len(hits))

i = hits[1] if len(hits) > 1 else hits[0]
pg = d[i]
print("\npage", i, "rect", pg.rect)
blocks = sorted(pg.get_text("blocks"), key=lambda b: (round(b[1] / 12), b[0]))
for b in blocks[:24]:
    print(f"x0={b[0]:6.1f} y0={b[1]:6.1f} x1={b[2]:6.1f} y1={b[3]:6.1f} | {repr(b[4][:85])}")

# Is the page truly two-column? Check x-distribution of words
words = pg.get_text("words")
xs = sorted(w[0] for w in words)
mid = pg.rect.width / 2
left = sum(1 for x in xs if x < mid)
print(f"\nwords left of mid: {left}/{len(words)}  mid={mid:.1f}")
