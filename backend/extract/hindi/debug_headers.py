"""Diagnose why chapters before page 249 were not detected."""
import pymupdf as fitz

PDF = '/Users/sachin/Downloads/838411207-Pinnacle-SSC-Reasoning-7200-TCS-MCQ-7th-Edition-2025-Hindi-Medium.pdf'
d = fitz.open(PDF)

for pg in (146, 147, 249, 268):
    page = d[pg]
    h, w = page.rect.height, page.rect.width
    print(f'\n=== page {pg} (w={w:.0f} h={h:.0f}) y_thresh={h*0.06:.1f} ===')
    for b in page.get_text('blocks'):
        x0, y0, x1, y1, txt = b[0], b[1], b[2], b[3], b[4]
        wide = (x1 - x0) > w * 0.5
        if y0 < h * 0.09:
            print(f'  y0={y0:6.1f} y1={y1:6.1f} x0={x0:6.1f} x1={x1:6.1f} '
                  f'width={x1-x0:6.1f} wide={wide} | {txt[:70]!r}')
