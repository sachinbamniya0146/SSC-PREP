import json
import sys
sys.path.insert(0, '/Users/sachin/ssc-automation/data')
from seed_data import QUESTIONS

with open('/tmp/ssc_seed_questions.json', 'w', encoding='utf-8') as f:
    json.dump(QUESTIONS, f, ensure_ascii=False, indent=2)

print(f"Dumped {len(QUESTIONS)} questions to /tmp/ssc_seed_questions.json")