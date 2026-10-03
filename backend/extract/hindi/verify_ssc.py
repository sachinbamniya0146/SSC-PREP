"""Parse SSC reasoning file and cross-verify with Pinnacle Excel."""
import json
import os
import re
import openpyxl

SRC = '/Users/sachin/Downloads/796548671-Ssc-Reasoning-Chapterwise-Solved-Papers-Converted.txt'
XL = '/Users/sachin/SSC-PREP/backend/extract/hindi/Coding-Decoding_Bilingual.xlsx'

wb = openpyxl.load_workbook(XL)
ws = wb.active

# Parse SSC file: each question line starts with \nN. 
# Answers have option letters A/B/C/D; explanations follow.
txt = open(SRC, encoding='utf-8', errors='ignore').read()

# Extract Analogy section (Section-1 : Analogy spans pages 7-116)
# Questions in SSC format are like:  "1.  (A) ...  (B) ...  (C) ...  (D) ... Ans: (C)"
# Let's find analogy lines

# Split into lines
lines = txt.split('\n')

# Find Section 1 Analogy boundary
in_analogy = False
analogy_qs = []
for ln in lines:
    # Start of Section 1
    if 'Section-1' in ln and 'Analogy' in ln:
        in_analogy = True
        continue
    # End when next Section- found
    if in_analogy and re.match(r'Section-\d+', ln):
        in_analogy = False
        continue
    if not in_analogy:
        continue
    # Question line pattern: \n1.    (a) ... (b) ... (d) ... Ans: (C)
    m = re.match(r'^\s*(\d+)\.\s+\(([a-dA-D])\)\s+(.+?)\s+\(([a-dA-D])\)\s+(.+?)\s+\(([a-dA-D])\)\s+(.+?)\s+\(([a-dA-D])\)\s+Ans:\s+\(([a-dA-D])\)', ln)
    if m:
        qnum = int(m.group(1))
        opts = {m.group(2).lower(): m.group(3).strip(),
                m.group(4).lower(): m.group(5).strip(),
                m.group(5).lower(): m.group(6).strip()}  # note: groups off
        # better parse from the matched groups properly
        # Actually groups: 1=qnum, 2=first opt letter, 3=first opt text,
        # 4=second opt letter, 5=second opt text,
        # 6=third opt letter, 7=third opt text,
        # 8=fourth opt letter, 9=fourth opt text,
        # 10=answer letter
        # Let's reparse more carefully below
        analogy_qs.append({'qnum': qnum})
    # Also capture non-standard lines

print(f"Lines in SSC file: {len(lines)}")
print(f"Total Analogy lines found: {sum(1 for l in lines if 'Analogy' in l)}")
# Quick look at first 10 Analogy section lines
in_sec = False
cnt = 0
for ln in lines:
    if 'Section-1 : Analogy' in ln:
        in_sec = True
        continue
    if re.match(r'Section-\d+', ln) and not re.search(r'Analogy', ln):
        break
    if in_sec and cnt < 15:
        print(repr(ln[:160]))
        cnt += 1