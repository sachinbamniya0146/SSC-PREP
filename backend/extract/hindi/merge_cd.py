"""Full join: English questions + Hindi stems + verified answers -> Excel."""
import json
import os
from collections import defaultdict

# Load all three sources
en_path = '/Users/sachin/SSC-PREP/backend/extract/pinnacle/Coding-Decoding.json'
hi_path = '/Users/sachin/SSC-PREP/backend/extract/hindi/cd_hindi_parsed.json'
ans_path = '/tmp/chapter_answers.json'

en_qs = json.load(open(en_path))
hi_qs = json.load(open(hi_path))
ans_data = json.load(open(ans_path))
cd_answers = {int(k): v for k, v in ans_data.get('Coding-Decoding', {}).items()}

# Index by book_q
en_by_q = {q['book_q']: q for q in en_qs if q.get('book_q')}
hi_by_q = {q['book_q']: q for q in hi_qs if q.get('book_q')}

print(f"English: {len(en_by_q)} questions")
print(f"Hindi: {len(hi_by_q)} questions")
print(f"Answers: {len(cd_answers)} entries")

# Merge
merged = []
for bq in sorted(set(en_by_q) | set(hi_by_q)):
    en = en_by_q.get(bq, {})
    hi = hi_by_q.get(bq, {})
    ans = cd_answers.get(bq, None)  # (letter, unanimous, count, total_votes)
    
    merged.append({
        'book_q': bq,
        'en_stem': en.get('q', ''),
        'en_opts': {k: en.get(k, '') for k in 'abcd'},
        'hi_stem': hi.get('stem', ''),
        'hi_opts': hi.get('opts', {}),
        'exam': hi.get('exam', '') or en.get('exam', ''),
        'answer': ans[0] if ans else None,
        'answer_confidence': 'high' if ans and ans[1] else ('medium' if ans else 'none'),
    })

usable = [m for m in merged if m['en_stem'] and m['en_opts']['a'] and m['answer']]
print(f"\nUsable (stem+4opts+answer): {len(usable)}/{len(merged)}")

# Quick quality check
for m in usable[:5]:
    print(f"\nQ{m['book_q']:3d}")
    print(f"  EN: {m['en_stem'][:90]}")
    print(f"  HI: {m['hi_stem'][:90]}")
    print(f"  EXAM: {m['exam'][:60]}")
    print(f"  ANS: {m['answer']} ({m['answer_confidence']})")

json.dump(merged, open('/Users/sachin/SSC-PREP/backend/extract/hindi/cd_merged.json', 'w'), ensure_ascii=False)
print("\nsaved cd_merged.json")