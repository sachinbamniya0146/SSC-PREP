#!/usr/bin/env python3
"""
Ingest the SSC Reasoning 7200 Questions into the database via API.
"""

import requests
import json
import sys
import time

sys.path.insert(0, '/Users/sachin/ssc-prep-hub')

API_BASE = "http://localhost:4000/api/v1"
ADMIN_EMAIL = "admin@sscprephub.in"
ADMIN_PASSWORD = "admin@sscprephub2024"

def get_admin_token():
    """Get admin authentication token."""
    resp = requests.post(f"{API_BASE}/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD,
        "platform": "WEB"
    }, timeout=30)
    if resp.status_code == 200:
        return resp.json()["accessToken"]
    else:
        print(f"Login failed: {resp.status_code} - {resp.text}")
        return None

def get_chapters(token):
    """Get all chapters for reasoning subject."""
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{API_BASE}/bank/chapters?subjectId=c5d2bb1f-ac87-432d-9462-954835c4a4ed", headers=headers, timeout=30)
    if resp.status_code == 200:
        chapters = resp.json()
        return {c["name"]: c["id"] for c in chapters}
    return {}

def get_exams(token):
    """Get all exams."""
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{API_BASE}/bank/meta", headers=headers, timeout=30)
    if resp.status_code == 200:
        exams = resp.json().get("exams", [])
        return {e["name"]: e["id"] for e in exams}
    return {}

def create_question(token, question_data):
    """Create a question via the API."""
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    resp = requests.post(f"{API_BASE}/bank/questions", headers=headers, json=question_data, timeout=30)
    return resp.status_code == 201, resp.json() if resp.status_code == 201 else resp.text

def main():
    token = get_admin_token()
    if not token:
        print("Failed to get admin token")
        return
    
    print("Fetching chapters and exams...")
    chapter_map = get_chapters(token)
    exam_map = get_exams(token)
    
    print(f"Chapters: {len(chapter_map)}")
    print(f"Exams: {len(exam_map)}")
    
    # Print chapter mapping for verification
    for name, cid in sorted(chapter_map.items()):
        print(f"  {name}: {cid}")
    
    # Load parsed questions
    import parse_7200_questions
    questions = parse_7200_questions.parse_questions("/tmp/ssc-reasoning-7200.txt")
    
    print(f"\nParsed {len(questions)} questions")
    
    # Chapter name mapping from parsed names to DB chapter names
    chapter_rename = {
        "Analogy Verbal": "Reasoning — Analogy",
        "Odd One Out": "Reasoning — Odd One Out",
        "Coding-Decoding": "Reasoning — Coding-Decoding",
        "Number Series": "Reasoning — Number Series",
        "Missing Number": "Missing Number",
        "Statement And Conclusion": "Statement And Conclusion",
        "Blood Relations": "Reasoning — Blood Relations",
        "Venn Diagram": "Venn Diagram",  # Need to check
        "Cube And Dice": "Cube And Dice",
        "Sitting Arrangement": "Sitting Arrangement",
        "Direction Sense": "Reasoning — Direction Sense",
        "Arithmetic Reasoning": "Arithmetic Reasoning",
        "Mathematical Operations": "Reasoning — Mathematical Operations",
        "Word Arrangement": "Word Arrangement",
        "Age": "Age",
        "Calendar": "Calendar",
        "Series Non Verbal": "Series Non Verbal",  # May not exist
        "Counting of Figures": "Counting of Figures",
        "Paper Cut/Fold": "Paper Cut/Fold",
        "Embedded Figures": "Embedded Figures",
        "Completion of Figure": "Completion of Figure",
        "Mirror/Water Image": "Mirror/Water Image",
        "Miscellaneous": "Miscellaneous",
    }
    
    # Map parsed chapter names to DB chapter IDs
    chapter_id_map = {}
    for parsed_name, db_name in chapter_rename.items():
        if db_name in chapter_map:
            chapter_id_map[parsed_name] = chapter_map[db_name]
            print(f"  {parsed_name} -> {db_name} ({chapter_map[db_name]})")
        else:
            # Try exact match
            if parsed_name in chapter_map:
                chapter_id_map[parsed_name] = chapter_map[parsed_name]
                print(f"  {parsed_name} -> {parsed_name} ({chapter_map[parsed_name]})")
            else:
                print(f"  WARNING: {parsed_name} -> {db_name} NOT FOUND!")
    
    # Exam mapping
    exam_id_map = {}
    for parsed_name, db_name in {
        "SSC CGL": "SSC CGL",
        "SSC CHSL": "SSC CHSL", 
        "SSC CPO": "SSC CPO",
        "SSC MTS": "SSC MTS",
    }.items():
        if db_name in exam_map:
            exam_id_map[parsed_name] = exam_map[db_name]
            print(f"  {parsed_name} -> {db_name} ({exam_map[db_name]})")
    
    # Subject ID for Reasoning
    subject_id = "c5d2bb1f-ac87-432d-9462-954835c4a4ed"
    
    # Create questions
    success_count = 0
    fail_count = 0
    skipped_count = 0
    
    print(f"\nStarting ingestion of {len(questions)} questions...")
    
    for i, q in enumerate(questions):
        # Get chapter ID
        chapter_id = chapter_id_map.get(q.chapter_name)
        if not chapter_id:
            skipped_count += 1
            if skipped_count <= 5:
                print(f"  Skipped (no chapter): {q.chapter_name}")
            continue
        
        # Get exam ID
        exam_id = exam_id_map.get(q.exam_name)
        if not exam_id:
            exam_id = exam_map.get("SSC CGL")  # default
        
        # Prepare options
        options_json = []
        for opt in q.options:
            if ') ' in opt:
                key = opt[0]
                text = opt[3:]
            else:
                key = opt[0]
                text = opt[2:]
            options_json.append({"key": key, "text": text})
        
        # Prepare question data
        q_data = {
            "questionText": q.text,
            "questionTextHindi": q.text_hindi or q.text,
            "optionsJson": options_json,
            "correctAnswer": q.correct_answer,
            "explanation": q.explanation or "",
            "explanationHindi": q.explanation_hindi or "",
            "chapterId": chapter_id,
            "subjectId": subject_id,
            "examId": exam_id,
            "year": q.year,
            "shift": q.shift,
            "difficulty": "MEDIUM",
            "marks": 2,
            "negativeMarks": 0.5,
            "isApproved": True,
            "answerVerificationStatus": "VERIFIED_OFFICIAL",
            "translationStatus": "HUMAN_VERIFIED",
        }
        
        success, result = create_question(token, q_data)
        if success:
            success_count += 1
        else:
            fail_count += 1
            if fail_count <= 5:
                print(f"  Failed: {result[:200]}")
        
        if (success_count + fail_count + skipped_count) % 100 == 0:
            print(f"  Progress: {success_count} success, {fail_count} failed, {skipped_count} skipped")
        
        # Small delay to avoid overwhelming the API
        if i % 50 == 0:
            time.sleep(0.1)
    
    print(f"\nDone! Success: {success_count}, Failed: {fail_count}, Skipped: {skipped_count}")

if __name__ == "__main__":
    main()