"""
Parse SSC Reasoning 7200 TCS MCQ Chapter-wise DOCX
Extracts questions with exam tags, options, Hindi translations
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
print(f"Total paragraphs: {len(full_text)}")
print(f"Total chars: {len(text)}")

# Find exam patterns
exam_patterns = [
    r'SSC CPO \d{4}',
    r'SSC CGL \d{4}',
    r'SSC CHSL \d{4}',
    r'SSC MTS \d{4}',
    r'SSC CPO \d{2}/\d{2}/\d{4}',
    r'SSC CGL \d{2}/\d{2}/\d{4}',
    r'SSC CHSL \d{2}/\d{2}/\d{4}',
    r'SSC MTS \d{2}/\d{2}/\d{4}',
    r'SSC MTS \d{2}-\d{2}-\d{4}',
]

# Chapter markers
chapter_markers = [
    'ANALOGY VERBAL', 'ODD ONE OUT', 'CODING AND DECODING', 'CODING-DECODING',
    'SERIES', 'MISSING NUMBER', 'STATEMENT AND CONCLUSION', 'STATEMENTS AND CONCLUSION',
    'BLOOD RELATION', 'VENN DIAGRAM', 'CUBE AND DICE', 'DICE AND CUBE',
    'SITTING ARRANGEMENT', 'DIRECTION', 'ARITHMETIC REASONING',
    'MATHEMATICAL OPERATIONS', 'WORD ARRANGEMENT', 'AGE', 'CALENDAR',
    'SERIES NON VERBAL', 'COUNTING OF FIGURES', 'PAPER CUT/FOLD',
    'EMBEDDED FIGURES', 'EMBEDDED FIGURE', 'COMPLETION OF FIGURE',
    'MIRROR/WATER IMAGE', 'MIRROR IMAGE', 'WATER IMAGE',
    'MISCELLANEOUS', 'QR CODES QUESTIONS'
]

# Let's find question blocks
# Questions typically start with exam tag like "SSC CPO 12/03/2019 (Morning)"
# Followed by question text and options (a), (b), (c), (d)

# Split by exam tags
exam_tag_pattern = r'(SSC (?:CPO|CGL|CHSL|MTS) .+? \((?:Morning|Afternoon|Evening|Morning)\))'
parts = re.split(exam_tag_pattern, text)

questions = []
current_exam = None
current_chapter = None

for i, part in enumerate(parts):
    if re.match(exam_tag_pattern, part):
        current_exam = part.strip()
        continue
    
    if current_exam and part.strip():
        # Check if this part contains a question
        # Look for options pattern
        if re.search(r'\(a\).*?\(b\).*?\(c\).*?\(d\)', part, re.DOTALL | re.IGNORECASE):
            # Extract question text before options
            opt_match = re.search(r'\(a\)', part)
            if opt_match:
                q_text = part[:opt_match.start()].strip()
                options_text = part[opt_match.start():].strip()
                
                # Parse options
                opts = {}
                for opt_letter in ['a', 'b', 'c', 'd']:
                    pattern = rf'\({opt_letter}\)\s*(.*?)(?=\([a-d]\)|$)'
                    match = re.search(pattern, options_text, re.DOTALL | re.IGNORECASE)
                    if match:
                        opts[opt_letter.upper()] = match.group(1).strip()
                
                # Check for Hindi translation
                hindi_text = ""
                if "का अर्थ है" in q_text or "तब" in q_text or "है?" in q_text:
                    # Split English/Hindi
                    hindi_part = q_text
                    q_text = q_text  # Keep both for now
                
                questions.append({
                    'exam': current_exam,
                    'question': q_text,
                    'options': opts,
                    'hindi': hindi_text if hindi_text else None,
                    'raw': part[:500]
                })
                current_exam = None

print(f"\nFound {len(questions)} questions with options")

# Save for inspection
with open('/tmp/parsed_questions.json', 'w') as f:
    json.dump(questions[:50], f, indent=2, ensure_ascii=False)

print("\nFirst 3 questions:")
for q in questions[:3]:
    print(f"\nExam: {q['exam']}")
    print(f"Q: {q['question'][:200]}...")
    print(f"Options: {q['options']}")
    if q['hindi']:
        print(f"Hindi: {q['hindi'][:100]}...")

