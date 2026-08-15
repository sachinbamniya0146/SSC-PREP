"""
Parse SSC Reasoning 7200 - Full text regex approach
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

# Pattern: Exam tag followed by question and 4 options on same or next lines
# Options can be on same line: (a) opt1 (b) opt2 (c) opt3 (d) opt4
# Or on separate lines

# Split by exam tags
exam_pattern = r'(SSC (?:CPO|CGL|CHSL|MTS) .+? \((?:Morning|Afternoon|Evening)\))'
parts = re.split(exam_pattern, text)

questions = []
for i in range(1, len(parts), 2):
    exam = parts[i]
    content = parts[i+1] if i+1 < len(parts) else ""
    
    # Find all question-option blocks in this content
    # Look for: question text followed by (a) ... (b) ... (c) ... (d) ...
    
    # Pattern for options on same line or consecutive lines
    opt_pattern = r'\(a\)\s*(.*?)\s*\(b\)\s*(.*?)\s*\(c\)\s*(.*?)\s*\(d\)\s*(.*?)(?=\(a\)|SSC |$)'
    
    matches = re.findall(opt_pattern, content, re.DOTALL | re.IGNORECASE)
    
    for match in matches:
        opt_a, opt_b, opt_c, opt_d = match
        # Clean up
        opt_a = re.sub(r'\s+', ' ', opt_a).strip()
        opt_b = re.sub(r'\s+', ' ', opt_b).strip()
        opt_c = re.sub(r'\s+', ' ', opt_c).strip()
        opt_d = re.sub(r'\s+', ' ', opt_d).strip()
        
        # Get question text (text before first option)
        # This is harder with this approach
        
    print(f"Exam: {exam} - Found {len(matches)} option sets")

# Let's try a different approach - scan line by line
print("\n\n--- Line by line scan ---")
lines = text.split('\n')
current_exam = None
buffer = []

for line in lines:
    # Check for exam tag
    exam_match = re.match(r'^(SSC (?:CPO|CGL|CHSL|MTS) .+? \((?:Morning|Afternoon|Evening)\))$', line.strip())
    if exam_match:
        current_exam = exam_match.group(1)
        buffer = []
        continue
    
    if current_exam:
        buffer.append(line)
        # Check if this line has all 4 options
        if re.search(r'\(a\).*\(b\).*\(c\).*\(d\)', line, re.IGNORECASE):
            # Found complete question in buffer
            full_block = "\n".join(buffer)
            # Extract question (text before first option)
            q_match = re.search(r'^(.*?)\(a\)', full_block, re.DOTALL)
            if q_match:
                question = q_match.group(1).strip()
                # Extract options
                opt_match = re.search(r'\(a\)\s*(.*?)\s*\(b\)\s*(.*?)\s*\(c\)\s*(.*?)\s*\(d\)\s*(.*?)(?=\n(?:\(a\)|SSC |\n\n)|$)', full_block, re.DOTALL | re.IGNORECASE)
                if opt_match:
                    questions.append({
                        'exam': current_exam,
                        'question': question,
                        'options': {
                            'A': opt_match.group(1).strip(),
                            'B': opt_match.group(2).strip(),
                            'C': opt_match.group(3).strip(),
                            'D': opt_match.group(4).strip(),
                        }
                    })
            buffer = []

print(f"\nTotal questions found: {len(questions)}")

# Save
with open('/tmp/parsed_questions_v4.json', 'w') as f:
    json.dump(questions, f, indent=2, ensure_ascii=False)

# Show samples
print("\nFirst 10 questions:")
for q in questions[:10]:
    print(f"\nExam: {q['exam']}")
    print(f"Q: {q['question'][:300]}...")
    print(f"Options: {q['options']}")

# Stats
exam_counts = {}
for q in questions:
    exam = q['exam']
    exam_counts[exam] = exam_counts.get(exam, 0) + 1

print("\n\nExam distribution:")
for exam, count in sorted(exam_counts.items(), key=lambda x: -x[1]):
    print(f"  {exam}: {count}")

