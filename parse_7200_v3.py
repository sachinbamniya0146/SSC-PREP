"""
Parse SSC Reasoning 7200 TCS MCQ Chapter-wise DOCX - Better parser
"""
import re
import json
from docx import Document

doc = Document("/Users/sachin/.hermes/attachments/ssc-reasoning-7200-tcs-mcq-chapter-wise-english-2nbsped_compress.docx")

questions = []
current_exam = None
current_question = None
current_options = {}
in_question = False

exam_pattern = re.compile(r'^(SSC (?:CPO|CGL|CHSL|MTS) .+? \((?:Morning|Afternoon|Evening)\))$')

for para in doc.paragraphs:
    text = para.text.strip()
    if not text:
        continue
    
    # Check for exam tag (standalone line)
    exam_match = exam_pattern.match(text)
    if exam_match:
        # Save previous question if complete
        if current_question and len(current_options) >= 4:
            questions.append({
                'exam': current_exam,
                'question': current_question,
                'options': current_options,
            })
        current_exam = exam_match.group(1)
        current_question = None
        current_options = {}
        in_question = False
        continue
    
    if not current_exam:
        continue
    
    # Check if this line starts with an option
    opt_match = re.match(r'^\(([a-d])\)\s*(.+)$', text, re.IGNORECASE)
    if opt_match:
        letter = opt_match.group(1).upper()
        option_text = opt_match.group(2).strip()
        current_options[letter] = option_text
        in_question = True
        continue
    
    # If we were collecting options and hit a non-option, and we have 4 options, save
    if in_question and current_question and len(current_options) >= 4:
        questions.append({
            'exam': current_exam,
            'question': current_question,
            'options': current_options,
        })
        current_question = None
        current_options = {}
        in_question = False
        # Check if this is a new exam tag
        exam_match = exam_pattern.match(text)
        if exam_match:
            current_exam = exam_match.group(1)
            continue
    
    # This is question text
    if not in_question:
        if current_question is None:
            current_question = text
        else:
            current_question += " " + text
    else:
        # We're in options but this might be continuation of last option
        if current_options:
            last_key = list(current_options.keys())[-1]
            current_options[last_key] += " " + text

# Save last question
if current_question and len(current_options) >= 4:
    questions.append({
        'exam': current_exam,
        'question': current_question,
        'options': current_options,
    })

print(f"Found {len(questions)} questions with all 4 options")

# Save
with open('/tmp/parsed_questions_v3.json', 'w') as f:
    json.dump(questions, f, indent=2, ensure_ascii=False)

# Show samples
print("\nFirst 10 questions:")
for q in questions[:10]:
    print(f"\nExam: {q['exam']}")
    print(f"Q: {q['question'][:300]}...")
    print(f"Options: {q['options']}")

# Stats by exam
exam_counts = {}
for q in questions:
    exam = q['exam']
    exam_counts[exam] = exam_counts.get(exam, 0) + 1

print("\n\nExam distribution:")
for exam, count in sorted(exam_counts.items(), key=lambda x: -x[1])[:20]:
    print(f"  {exam}: {count}")

