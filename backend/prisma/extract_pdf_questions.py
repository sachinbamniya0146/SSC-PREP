import fitz
import re
import os
import sys
import json

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def extract_questions_from_pdf(pdf_path, exam_code, year, shift):
    """Extract questions from SSC PDF - handles multiple formats"""
    doc = fitz.open(pdf_path)
    questions = []
    
    full_text = ""
    for page in doc:
        full_text += page.get_text() + "\n"
    doc.close()
    
    # Pattern 1: Q.N\nAns\n1.\n2.\n3.\n4. (CGL/CHSL 2024 format)
    pattern1 = r'Q\.(\d+)\s*\n([^\n]+(?:\n[^\n]+)*?)\nAns\s*\n1\.\s*([^\n]*)\n2\.\s*([^\n]*)\n3\.\s*([^\n]*)\n4\.\s*([^\n]*)'
    matches1 = re.findall(pattern1, full_text, re.MULTILINE)
    
    # Pattern 2: Q.N\nQuestion text\nAns\n1. Option\n2. Option\n3. Option\n4. Option (with full question text)
    pattern2 = r'Q\.(\d+)\s*\n([^\n]+(?:\n[^\n]+)*?)\nAns\s*\n1\.\s*([^\n]+)\n2\.\s*([^\n]+)\n3\.\s*([^\n]+)\n4\.\s*([^\n]+)'
    matches2 = re.findall(pattern2, full_text, re.MULTILINE)
    
    # Pattern 3: Q.N Question text (multiple lines) \nAns\n1.\n2.\n3.\n4. (STENO/JE/Selection Post format)
    pattern3 = r'Q\.(\d+)\s*\n([^\n]+(?:\n[^\n]+){1,10}?)\nAns\s*\n1\.\s*([^\n]+)\n2\.\s*([^\n]+)\n3\.\s*([^\n]+)\n4\.\s*([^\n]+)'
    matches3 = re.findall(pattern3, full_text, re.MULTILINE)
    
    # Pattern 4: GD format - Q.N\nAns\n1.\n2.\n3.\n4. (minimal text)
    pattern4 = r'Q\.(\d+)\s*\nAns\s*\n1\.\s*([^\n]*)\n2\.\s*([^\n]*)\n3\.\s*([^\n]*)\n4\.\s*([^\n]*)'
    matches4 = re.findall(pattern4, full_text, re.MULTILINE)
    
    # Combine all matches, preferring more complete ones
    all_matches = []
    
    # Process pattern1 (most complete)
    for m in matches1:
        q_num, q_text, o1, o2, o3, o4 = m
        all_matches.append({
            'q_num': q_num,
            'q_text': q_text.strip(),
            'options': [o1.strip(), o2.strip(), o3.strip(), o4.strip()],
            'pattern': 1
        })
    
    # Process pattern2
    for m in matches2:
        q_num, q_text, o1, o2, o3, o4 = m
        all_matches.append({
            'q_num': q_num,
            'q_text': q_text.strip(),
            'options': [o1.strip(), o2.strip(), o3.strip(), o4.strip()],
            'pattern': 2
        })
    
    # Process pattern3
    for m in matches3:
        q_num, q_text, o1, o2, o3, o4 = m
        all_matches.append({
            'q_num': q_num,
            'q_text': q_text.strip(),
            'options': [o1.strip(), o2.strip(), o3.strip(), o4.strip()],
            'pattern': 3
        })
    
    # Process pattern4
    for m in matches4:
        q_num, o1, o2, o3, o4 = m
        # Try to find question text before this Q.N
        q_start = full_text.find(f'Q.{q_num}')
        q_text = ""
        if q_start > 200:
            q_text = full_text[max(0, q_start-200):q_start].strip().split('\n')[-1]
        all_matches.append({
            'q_num': q_num,
            'q_text': q_text.strip(),
            'options': [o1.strip(), o2.strip(), o3.strip(), o4.strip()],
            'pattern': 4
        })
    
    # Deduplicate by question number, prefer higher pattern number (more complete)
    seen = {}
    for m in all_matches:
        key = int(m['q_num'])
        if key not in seen or m['pattern'] > seen[key]['pattern']:
            seen[key] = m
    
    # Extract answer keys
    # Format: "Q.N Ans X" or "Chosen Option : X"
    ans_key_pattern = r'Q\.(\d+)\s*\nAns\s*(\d+)'
    ans_key_matches = re.findall(ans_key_pattern, full_text)
    ans_key_map = {int(q_num): int(ans) for q_num, ans in ans_key_matches}
    
    chosen_pattern = r'Chosen Option\s*:\s*(\d+)'
    chosen_matches = re.findall(chosen_pattern, full_text)
    
    status_pattern = r'Status\s*:\s*Answered'
    status_matches = re.findall(status_pattern, full_text)
    
    # Also look for "Question ID" pattern with answer
    qid_ans_pattern = r'Question ID\s*:\s*\d+.*?Status\s*:\s*Answered.*?Chosen Option\s*:\s*(\d+)'
    qid_ans_matches = re.findall(qid_ans_pattern, full_text, re.DOTALL)
    
    questions = []
    for q_num_int, m in sorted(seen.items()):
        options = m['options']
        q_text = m['q_text']
        
        if len(q_text) < 5 and len(' '.join(options)) < 10:
            continue
            
        # Try to get correct answer
        correct_answer = ""
        if q_num_int in ans_key_map:
            chosen_idx = ans_key_map[q_num_int] - 1
            if 0 <= chosen_idx < 4 and options[chosen_idx]:
                correct_answer = options[chosen_idx]
        elif len(chosen_matches) > 0:
            # Map chosen options in order
            idx = list(seen.keys()).index(q_num_int)
            if idx < len(chosen_matches):
                chosen_idx = int(chosen_matches[idx]) - 1
                if 0 <= chosen_idx < 4 and options[chosen_idx]:
                    correct_answer = options[chosen_idx]
        
        questions.append({
            "question_text": q_text,
            "options": options,
            "exam_code": exam_code,
            "year": year,
            "shift": shift,
            "correct_answer": correct_answer,
        })
    
    return questions

def extract_pdf_meta(pdf_path):
    """Extract year and shift from PDF filename or content"""
    filename = os.path.basename(pdf_path).lower()
    
    # Try to extract from filename
    year = None
    shift = 1
    
    # Year patterns
    year_match = re.search(r'(20\d{2})', filename)
    if year_match:
        year = int(year_match.group(1))
    
    # Shift patterns
    shift_match = re.search(r'shift[_\-\s]?(\d+)', filename)
    if shift_match:
        shift = int(shift_match.group(1))
    elif re.search(r's[_\-\s]?(\d+)', filename):
        shift = int(re.search(r's[_\-\s]?(\d+)', filename).group(1))
    
    # Exam code from filename
    exam_code = None
    if 'cgl' in filename:
        exam_code = 'CGL'
    elif 'chsl' in filename:
        exam_code = 'CHSL'
    elif 'mts' in filename:
        exam_code = 'MTS'
    elif 'gd' in filename or 'constable' in filename:
        exam_code = 'GD'
    elif 'steno' in filename:
        exam_code = 'STENO'
    elif 'cpo' in filename or 'si-cpo' in filename:
        exam_code = 'CPO'
    elif 'je' in filename or 'junior-engineer' in filename:
        exam_code = 'JE'
    elif 'selection' in filename or 'phase' in filename:
        exam_code = 'SELECTION_POST'
    elif 'delhi-police' in filename or 'dp' in filename:
        exam_code = 'DPC'
    elif 'dp-hc' in filename or 'delhi-police-hc' in filename:
        exam_code = 'DPHC'
    
    # If not in filename, try from content
    if not exam_code or not year:
        doc = fitz.open(pdf_path)
        sample_text = ""
        for page in doc[:3]:
            sample_text += page.get_text() + "\n"
        doc.close()
        
        if not exam_code:
            if 'CGL' in sample_text or 'Combined Graduate Level' in sample_text:
                exam_code = 'CGL'
            elif 'CHSL' in sample_text or 'Higher Secondary' in sample_text:
                exam_code = 'CHSL'
            elif 'MTS' in sample_text or 'Multi Tasking' in sample_text:
                exam_code = 'MTS'
            elif 'GD' in sample_text or 'Constable' in sample_text:
                exam_code = 'GD'
            elif 'Stenographer' in sample_text:
                exam_code = 'STENO'
            elif 'Sub-Inspector' in sample_text or 'CPO' in sample_text:
                exam_code = 'CPO'
            elif 'Junior Engineer' in sample_text:
                exam_code = 'JE'
            elif 'Selection Post' in sample_text:
                exam_code = 'SELECTION_POST'
            elif 'Delhi Police' in sample_text and 'Constable' in sample_text:
                exam_code = 'DPC'
            elif 'Delhi Police' in sample_text and 'Head Constable' in sample_text:
                exam_code = 'DPHC'
        
        if not year:
            year_match = re.search(r'Exam Date.*?(\d{2})/(\d{2})/(20\d{2})', sample_text)
            if year_match:
                year = int(year_match.group(3))
            else:
                year_match = re.search(r'(20\d{2})', sample_text)
                if year_match:
                    year = int(year_match.group(1))
        
        if shift == 1:
            shift_match = re.search(r'Shift[_\-\s]?(\d+)', sample_text, re.IGNORECASE)
            if shift_match:
                shift = int(shift_match.group(1))
    
    return exam_code, year, shift

def main():
    # Get all PDFs from the directory
    pdf_dir = "/Users/sachin/Downloads/PYQ/"
    all_pdfs = [f for f in os.listdir(pdf_dir) if f.endswith('.pdf')]
    
    print(f"Found {len(all_pdfs)} PDF files")
    
    # Process each PDF
    pdf_mapping = []
    for pdf_file in all_pdfs:
        pdf_path = os.path.join(pdf_dir, pdf_file)
        exam_code, year, shift = extract_pdf_meta(pdf_path)
        
        if not exam_code or not year:
            print(f"Could not determine exam/year for {pdf_file}, skipping")
            continue
            
        pdf_mapping.append((pdf_path, exam_code, year, shift))
        print(f"Queued: {pdf_file} -> {exam_code} {year} Shift {shift}")
    
    print(f"\nTotal PDFs to process: {len(pdf_mapping)}")
    
    all_questions = []
    for pdf_path, exam_code, year, shift in pdf_mapping:
        if not os.path.exists(pdf_path):
            print(f"Skipping missing: {pdf_path}")
            continue
            
        print(f"\nProcessing {os.path.basename(pdf_path)} -> {exam_code} {year} Shift {shift}...")
        questions = extract_questions_from_pdf(pdf_path, exam_code, year, shift)
        print(f"  Extracted {len(questions)} questions")
        all_questions.extend(questions)
    
    print(f"\nTotal questions extracted: {len(all_questions)}")
    
    # Save to JSON for later import
    with open('extracted_questions.json', 'w') as f:
        json.dump(all_questions, f, indent=2)
    
    # Print stats by exam
    exam_stats = {}
    for q in all_questions:
        key = f"{q['exam_code']} {q['year']} Shift {q['shift']}"
        exam_stats[key] = exam_stats.get(key, 0) + 1
    
    print("\nQuestions per exam:")
    for exam, count in sorted(exam_stats.items()):
        print(f"  {exam}: {count}")
    
    # Print sample
    for q in all_questions[:5]:
        print(f"\nQ: {q['question_text'][:100]}...")
        print(f"Options: {q['options']}")
        print(f"Exam: {q['exam_code']} Year: {q['year']} Shift: {q['shift']}")
        print(f"Correct: {q['correct_answer'][:50] if q['correct_answer'] else 'N/A'}")

if __name__ == "__main__":
    main()