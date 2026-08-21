import json
import sys
sys.path.insert(0, '/Users/sachin/ssc-prep-hub')
from scripts.parse_7200_questions import parse_questions
questions = parse_questions('/tmp/ssc-reasoning-7200.txt')
print(f'Parsed {len(questions)} questions')
with open('/tmp/questions.json', 'w') as f:
    json.dump([
        {
            'text': q.text,
            'text_hindi': q.text_hindi,
            'options': q.options,
            'correct_answer': q.correct_answer,
            'explanation': q.explanation,
            'explanation_hindi': q.explanation_hindi,
            'chapter_name': q.chapter_name,
            'exam_name': q.exam_name,
            'year': q.year,
            'shift': q.shift,
            'paper_code': q.paper_code
        }
        for q in questions
    ], f)
print('Saved to /tmp/questions.json')