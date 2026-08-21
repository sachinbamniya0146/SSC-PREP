#!/usr/bin/env python3
"""
Parse the SSC Reasoning 7200 Questions text file.
Uses exact chapter boundaries from the document structure.
"""

import re
import sys
from dataclasses import dataclass
from typing import Optional
from collections import Counter

@dataclass
class Question:
    text: str
    text_hindi: str
    options: list[str]
    correct_answer: str
    explanation: str
    explanation_hindi: str
    chapter_name: str
    exam_name: str
    year: int
    shift: str
    paper_code: Optional[str] = None

# Chapter mapping from DOCX to DB chapters
CHAPTER_MAP = {
    "ANALOGY": "Analogy Verbal",
    "ANALOGY VERBAL": "Analogy Verbal",
    "ODD ONE OUT": "Odd One Out",
    "CLASSIFICATION": "Odd One Out",
    "CODING-DECODING": "Coding-Decoding",
    "CODING AND DECODING": "Coding-Decoding",
    "CODING DECODING": "Coding-Decoding",
    "SERIES": "Number Series",
    "MISSING NUMBER": "Missing Number",
    "STATEMENTS AND CONCLUSION": "Statement And Conclusion",
    "STATEMENT AND CONCLUSION": "Statement And Conclusion",
    "BLOOD RELATION": "Blood Relations",
    "BLOOD RELATIONS": "Blood Relations",
    "VENN DIAGRAM": "Venn Diagram",
    "CUBE AND DICE": "Cube And Dice",
    "DICE AND CUBE": "Cube And Dice",
    "DICE": "Cube And Dice",
    "SITTING ARRANGEMENT": "Sitting Arrangement",
    "DIRECTION": "Direction Sense",
    "DIRECTION SENSE": "Direction Sense",
    "DIRECTIONS": "Direction Sense",
    "ARITHMETIC REASONING": "Arithmetic Reasoning",
    "MATHEMATICAL OPERATIONS": "Mathematical Operations",
    "WORD ARRANGEMENT": "Word Arrangement",
    "AGE": "Age",
    "CALENDAR": "Calendar",
    "SERIES NON VERBAL": "Series Non Verbal",
    "COUNTING OF FIGURES": "Counting of Figures",
    "PAPER CUT/FOLD": "Paper Cut/Fold",
    "EMBEDDED FIGURES": "Embedded Figures",
    "COMPLETION OF FIGURE": "Completion of Figure",
    "MIRROR/WATER IMAGE": "Mirror/Water Image",
    "MIRROR IMAGE": "Mirror/Water Image",
    "MISCELLANEOUS": "Miscellaneous",
}

# Exact chapter boundaries from document (1-indexed line numbers)
# Format: (start_line, chapter_key)
# Questions for a chapter start AFTER the header line
CHAPTER_BOUNDARIES = [
    (556, "ANALOGY"),           # ANALOGY section starts at line 556
    (8162, "CLASSIFICATION"),   # CLASSIFICATION (Odd One Out) starts at line 8162
    (11160, "CODING DECODING"), # CODING-DECODING starts at line 11160
    (14931, "SERIES"),          # SERIES starts at line 14931
    (20917, "STATEMENTS AND CONCLUSION"),  # STATEMENTS starts at line 20917
    (26047, "BLOOD RELATION"),  # BLOOD RELATION starts at line 26047
    (30310, "DICE"),            # DICE/CUBE starts at line 30310
    (32783, "DIRECTIONS"),      # DIRECTIONS starts at line 32783
    (38162, "AGE"),             # AGE starts at line 38162
    (38386, "CALENDAR"),        # CALENDAR starts at line 38386
    (51718, None),              # End of file
]

# Expected counts from the table of contents (using mapped chapter names)
EXPECTED_COUNTS = {
    "Analogy Verbal": 1322,
    "Odd One Out": 633,
    "Coding-Decoding": 759,
    "Number Series": 794,
    "Missing Number": 168,
    "Statement And Conclusion": 366,
    "Blood Relations": 168,
    "Venn Diagram": 307,
    "Cube And Dice": 128,
    "Sitting Arrangement": 191,
    "Direction Sense": 44,
    "Arithmetic Reasoning": 120,
    "Mathematical Operations": 401,
    "Word Arrangement": 209,
    "Age": 39,
    "Calendar": 21,
    "Series Non Verbal": 308,
    "Counting of Figures": 176,
    "Paper Cut/Fold": 266,
    "Embedded Figures": 289,
    "Completion of Figure": 82,
    "Mirror/Water Image": 288,
    "Miscellaneous": 55,
}

# Exam mapping from text patterns
EXAM_PATTERNS = [
    (r'SSC CPO.*?2018', "SSC CPO", 2018),
    (r'SSC CGL.*?2018', "SSC CGL", 2018),
    (r'SSC CHSL.*?2018', "SSC CHSL", 2018),
    (r'SSC MTS.*?2019', "SSC MTS", 2019),
    (r'SSC CPO.*?2019', "SSC CPO", 2019),
    (r'SSC CGL.*?2019', "SSC CGL", 2019),
    (r'SSC CHSL.*?2019', "SSC CHSL", 2019),
    (r'SSC CPO.*?2020', "SSC CPO", 2020),
    (r'SSC CHSL.*?2020', "SSC CHSL", 2020),
    (r'SSC CGL.*?2020', "SSC CGL", 2020),
    (r'SSC MTS.*?2020', "SSC MTS", 2020),
]

def clean_text(text: str) -> str:
    """Clean extracted text."""
    if not text:
        return ""
    text = re.sub(r'\s+', ' ', text)
    text = text.replace('\u2013', '-').replace('\u2014', '-')
    text = text.replace('\u2018', "'").replace('\u2019', "'")
    text = text.replace('\u201c', '"').replace('\u201d', '"')
    return text.strip()

def get_exam_info(text: str) -> tuple[str, int, str]:
    """Extract exam name, year, shift from text."""
    for pattern, name, year in EXAM_PATTERNS:
        if re.search(pattern, text):
            shift = "Morning"
            if "Afternoon" in text or "Evening" in text:
                shift = "Afternoon"
            return name, year, shift
    return "SSC CGL", 2020, "Morning"

def parse_questions(filepath: str) -> list[Question]:
    """Parse the extracted text file and extract all questions."""
    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
        lines = f.readlines()
    
    # Build chapter for each line based on boundaries
    line_to_chapter = {}
    for idx in range(len(CHAPTER_BOUNDARIES) - 1):
        start_line, chap_key = CHAPTER_BOUNDARIES[idx]
        end_line, _ = CHAPTER_BOUNDARIES[idx + 1]
        mapped_name = CHAPTER_MAP[chap_key] if chap_key else None
        # Convert to 0-indexed
        for line_idx in range(start_line - 1, min(end_line - 1, len(lines))):
            line_to_chapter[line_idx] = mapped_name
    
    questions = []
    current_exam_info = None
    
    i = 0
    while i < len(lines):
        original_line = lines[i]
        line = original_line.strip()
        
        # Get current chapter for this line
        current_chapter = line_to_chapter.get(i, None)
        
        # Check for SSC exam references
        exam_info = get_exam_info(line)
        if exam_info != ("SSC CGL", 2020, "Morning"):
            current_exam_info = exam_info
        
        # Detect question patterns:
        # 1. Tab-bullet format: \t• Question
        # 2. Numbered format: Q.XXX Question
        is_question_start = False
        q_text = ""
        
        if original_line.startswith('\t•') or line.startswith('•'):
            is_question_start = True
            q_text = clean_text(line[1:] if line.startswith('•') else line[2:])
        elif re.match(r'^Q\.\d+', line):
            is_question_start = True
            q_text = clean_text(line)
        
        if is_question_start and current_chapter:
            # Skip if too short or instructional
            if len(q_text) < 15:
                i += 1
                continue
            if q_text.upper().startswith('HOW TO') or q_text.upper().startswith('SOME IMPORTANT'):
                i += 1
                continue
            if q_text.upper().startswith('TYPE -') or q_text.upper().startswith('EX -'):
                i += 1
                continue
            if q_text.upper().startswith('DEFINITION') or q_text.upper().startswith('SOL:'):
                i += 1
                continue
            if q_text.upper().startswith('INTRODUCTION'):
                i += 1
                continue
            
            # Collect options (a) (b) (c) (d)
            options = []
            j = i + 1
            while j < len(lines) and len(options) < 4:
                opt_line = lines[j].strip()
                # Match (a) (b) (c) (d) patterns
                opt_match = re.match(r'\(([a-d])\)\s*(.+)', opt_line)
                if not opt_match:
                    opt_match = re.match(r'([a-d])\)\s*(.+)', opt_line)
                if opt_match:
                    opt_letter = opt_match.group(1)
                    opt_text = clean_text(opt_match.group(2))
                    if len(opt_text) > 1:
                        options.append(f"{opt_letter}) {opt_text}")
                j += 1
            
            # Try to find answer in next few lines
            explanation = ""
            correct = ""
            for k in range(j, min(j+15, len(lines))):
                exp_line = lines[k].strip()
                # Look for answer patterns
                if re.search(r'(correct answer|right answer|answer\s*(?:is|:)\s*\(?([a-d])\)?)', exp_line, re.I):
                    ans_match = re.search(r'\(([a-d])\)', exp_line)
                    if ans_match:
                        correct = ans_match.group(1)
                    else:
                        ans_match = re.search(r'(?:answer|is)\s*([a-d])', exp_line, re.I)
                        if ans_match:
                            correct = ans_match.group(1)
                    explanation = clean_text(exp_line)
                    break
                elif exp_line and not exp_line.startswith('•') and not re.match(r'\([a-d]\)', exp_line) and not exp_line.startswith('SSC') and not re.match(r'^Q\.\d+', exp_line):
                    # Could be explanation
                    if len(exp_line) > 30 and not exp_line.startswith('('):
                        explanation = clean_text(exp_line)
                        break
            
            # Default correct answer if not found
            if not correct:
                correct = "a"
            
            if options:
                # Get exam info
                exam_name, year, shift = current_exam_info or ("SSC CGL", 2020, "Morning")
                paper_code = ""
                for k in range(max(0, i-20), i):
                    ref = get_exam_info(lines[k].strip())
                    if ref != ("SSC CGL", 2020, "Morning"):
                        paper_code = lines[k].strip()
                        break
                
                questions.append(Question(
                    text=q_text,
                    text_hindi="",
                    options=options,
                    correct_answer=correct,
                    explanation=explanation,
                    explanation_hindi="",
                    chapter_name=current_chapter,
                    exam_name=exam_name,
                    year=year,
                    shift=shift,
                    paper_code=paper_code
                ))
        
        i += 1
    
    return questions

if __name__ == "__main__":
    filepath = sys.argv[1] if len(sys.argv) > 1 else "/tmp/ssc-reasoning-7200.txt"
    questions = parse_questions(filepath)
    print(f"Parsed {len(questions)} questions")
    
    # Count by chapter
    chap_counts = Counter(q.chapter_name for q in questions)
    for chap, cnt in chap_counts.most_common():
        expected = EXPECTED_COUNTS.get(chap, 0)
        status = "✓" if abs(cnt - expected) < 20 else "✗"
        print(f"  {status} {chap}: {cnt} (expected: {expected})")
    
    # Count by exam
    exam_counts = Counter(q.exam_name for q in questions)
    for exam, cnt in exam_counts.most_common():
        print(f"  {exam}: {cnt}")
    
    # Sample questions
    print("\nSample questions:")
    for q in questions[:5]:
        print(f"\n  Chapter: {q.chapter_name}")
        print(f"  Q: {q.text[:120]}...")
        print(f"  Options: {q.options}")
        print(f"  Answer: {q.correct_answer}")
        print(f"  Exam: {q.exam_name} {q.year} {q.shift}")
        print(f"  Explanation: {q.explanation[:120] if q.explanation else 'N/A'}...")