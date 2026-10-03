#!/usr/bin/env python3
"""Fast batch translation using googletrans - extract all unique texts first."""
import json
import os
import sys
import hashlib
sys.path.insert(0, os.path.expanduser('~/.hermes/hermes-agent/venv/lib/python3.11/site-packages'))

from googletrans import Translator

# Load data
bilingual = json.load(open('/Users/sachin/SSC-PREP/backend/extract/hindi/cd_bilingual.json'))
usable = [b for b in bilingual if b['hi_stem'] and b['hi_opts'].get('a') and b['answer']]

# Collect ALL unique Hindi texts to translate
texts = set()
for q in usable:
    texts.add(q['hi_stem'])
    for v in q['hi_opts'].values():
        if v:
            texts.add(v)

print(f"Total unique Hindi texts to translate: {len(texts)}")

# Cache
CACHE_FILE = '/Users/sachin/SSC-PREP/backend/extract/hindi/translation_cache.json'
cache = {}
if os.path.exists(CACHE_FILE):
    cache = json.load(open(CACHE_FILE))
    print(f"Already cached: {len(cache)}")

# Find missing
missing = [t for t in texts if hashlib.md5(t.encode()).hexdigest()[:16] not in cache]
print(f"Missing translations: {len(missing)}")

# Translate missing in batches
t = Translator()
batch_size = 50
for i in range(0, len(missing), batch_size):
    batch = missing[i:i+batch_size]
    for text in batch:
        key = hashlib.md5(text.encode()).hexdigest()[:16]
        try:
            result = t.translate(text, src='hi', dest='en')
            cache[key] = result.text
        except Exception as e:
            print(f"  Failed: {e}")
            cache[key] = text  # fallback
    json.dump(cache, open(CACHE_FILE, 'w'), ensure_ascii=False)
    print(f"  Done {min(i+batch_size, len(missing))}/{len(missing)}")

print("Translation complete!")