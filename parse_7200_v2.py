"""
Parse SSC Reasoning 7200 TCS MCQ Chapter-wise DOCX - Fixed version
"""
import re
import json
from docx import Document

doc = Document("/Users/sachin/.hermes/attachments/ssc-reasoning-7200-tcs-mcq-chapter-wise-english-2nbsped_compress.docx")

full_text = []
for para in doc.paragraphs:
    if para.text.strip():
        full_text.append(para.text.strip())

text = "\n".join(full_text)

# Better approach: iterate through paragraphs and build questions
questions = []
current_exam = None
current_question = None
current_options = {}
in_options = False
option_letters = ['a', 'b', 'c', 'd']

exam_pattern = re.compile(r'^(SSC (?:CPO|CGL|CHSL|MTS) .+? \((?:Morning|Afternoon|Evening)\))$')

for para in full_text:
    # Check for exam tag
    exam_match = exam_pattern.match(para)
    if exam_match:
        # Save previous question if complete
        if current_question and len(current_options) == 4:
            questions.append({
                'exam': current_exam,
                'question': current_question,
                'options': current_options,
            })
        current_exam = exam_match.group(1)
        current_question = None
        current_options = {}
        in_options = False
        continue
    
    if not current_exam:
        continue
    
    # Check if this is an option line
    opt_match = re.match(r'^\(([a-d])\)\s*(.+)$', para, re.IGNORECASE)
    if opt_match:
        letter = opt_match.group(1).upper()
        option_text = opt_match.group(2).strip()
        current_options[letter] = option_text
        in_options = True
        continue
    
    # If we were in options and hit a non-option line, question is complete
    if in_options and current_question and len(current_options) == 4:
        questions.append({
            'exam': current_exam,
            'question': current_question,
            'options': current_options,
        })
        current_question = None
        current_options = {}
        in_options = False
        # Check if this line is a new exam tag
        exam_match = exam_pattern.match(para)
        if exam_match:
            current_exam = exam_match.group(1)
            continue
    
    # If we have options but not 4 yet, this might be continuation of option text
    if in_options and current_options:
        # Append to last option
        last_key = list(current_options.keys())[-1]
        current_options[last_key] += " " + para
        continue
    
    # This is question text
    if current_question is None:
        current_question = para
    else:
        current_question += " " + para

# Save last question
if current_question and len(current_options) == 4:
    questions.append({
        'exam': current_exam,
        'question': current_question,
        'options': current_options,
    })

print(f"Found {len(questions)} questions with all 4 options")

# Save
with open('/tmp/parsed_questions_v2.json', 'w') as f:
    json.dump(questions, f, indent=2, ensure_ascii=False)

# Show samples
print("\nFirst 5 questions:")
for q in questions[:5]:
    print(f"\nExam: {q['exam']}")
    print(f"Q: {q['question'][:200]}...")
    print(f"Options: {q['options']}")

print("\nLast 5 questions:")
for q in questions[-5:]:
    print(f"\nExam: {q['exam']}")
    print(f"Q: {q['question'][:200]}...")
    print(f"Options: {q['options']}")

