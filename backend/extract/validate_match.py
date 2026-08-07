#!/usr/bin/env python3
"""Validate myGK answers vs Pinnacle hand-verified answers (Analogy) — v2.
Group by (exam, date) ONLY (shift formats differ), flatten in document order.
Both books list each paper's questions in paper order => position alignment valid.
"""
import json, re, glob
from collections import defaultdict

# 1. ground truth: (exam, date) -> [(bq, ans) in order]
analogy = json.load(open('/Users/sachin/ssc-automation/data/book/Analogy.json', encoding='utf-8'))
q_by_num = {q['book_q']: q for q in analogy}
sol_ans = {}
for f in glob.glob('/Users/sachin/ssc-automation/data/book/sol_analogy_b*.py'):
    src = open(f, encoding='utf-8', errors='ignore').read()
    m = re.search(r'SOLS\s*=\s*\{', src)
    if not m: continue
    for mm in re.finditer(r'(\d+)\s*:\s*\(\s*[\'"]([A-Da-d])[\'"]', src[m.end():]):
        sol_ans[int(mm.group(1))] = mm.group(2).upper()

gt_groups = defaultdict(list)
for bq, ans in sol_ans.items():
    q = q_by_num.get(bq)
    if not q: continue
    gt_groups[(q['exam'], q['date'])].append((bq, ans))
print(f"GT groups (exam,date): {len(gt_groups)}, total: {sum(len(v) for v in gt_groups.values())}")

# 2. myGK: (exam, date) -> [ans in order]
mgk = json.load(open('mygk/_chapters.json'))
mgk_qs = [b for ch in mgk for b in ch if b.get('ans') and b.get('date')]
mgk_groups = defaultdict(list)
for b in mgk_qs:
    mgk_groups[(b['exam'], b['date'])].append(b['ans'])
print(f"myGK groups: {len(mgk_groups)}, total: {len(mgk_qs)}")

# 3. compare on shared keys
shared = set(gt_groups) & set(mgk_groups)
print(f"\nshared (exam,date): {len(shared)}")
agree = total = 0
mismatches = []
for key in sorted(shared):
    gta = [a for _, a in gt_groups[key]]
    mga = mgk_groups[key]
    n = min(len(gta), len(mga))
    for i in range(n):
        total += 1
        if gta[i] == mga[i]: agree += 1
        else: mismatches.append((key, i, gta[i], mga[i]))
    if len(gta) != len(mga):
        print(f"  LEN-MISMATCH {key}: gt={len(gta)} mgk={len(mga)}")
print(f"\nAGREEMENT: {agree}/{total} = {100*agree/total:.1f}%")
print(f"mismatches: {len(mismatches)}")
for m in mismatches[:12]:
    print("  ", m)