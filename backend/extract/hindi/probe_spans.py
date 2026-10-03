import pymupdf as fitz

PDF = '/Users/sachin/Downloads/838411207-Pinnacle-SSC-Reasoning-7200-TCS-MCQ-7th-Edition-2025-Hindi-Medium.pdf'
d = fitz.open(PDF)
pg = d[147]

dd = pg.get_text("dict")
print("=== span-level text for the Q.8 block ===")
for b in dd["blocks"]:
    if b.get("type") != 0:
        continue
    for ln in b["lines"]:
        for sp in ln["spans"]:
            if 'कूट' in sp["text"] or 'DANCER' in sp["text"]:
                print(f"bbox={tuple(round(v,1) for v in sp['bbox'])}")
                print("TEXT:", repr(sp["text"]))
                print("FLAGS:", sp["flags"], "font:", sp["font"])
                print()

# raw content stream of that page - look for the Q.8 region
print("=== raw text with positions (words API) ===")
ws = [w for w in pg.get_text("words") if w[1] > 100 and w[1] < 200]
for w in sorted(ws, key=lambda t: (t[1], t[0]))[:40]:
    print(f"({w[0]:6.1f},{w[1]:6.1f}) {w[4]!r}")
