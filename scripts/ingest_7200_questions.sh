#!/bin/bash
# Ingest 7200 questions using curl

set -e

API_BASE="http://localhost:4000/api/v1"
ADMIN_EMAIL="admin@sscprephub.in"
ADMIN_PASSWORD="admin@sscprephub2024"

echo "Getting admin token..."
TOKEN=$(curl -s -X POST "$API_BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\",\"platform\":\"WEB\"}" | \
  python3 -c "import sys, json; print(json.load(sys.stdin)['accessToken'])")

if [ -z "$TOKEN" ]; then
  echo "Failed to get token"
  exit 1
fi

echo "Token acquired: ${TOKEN:0:20}..."

# Chapter IDs (from earlier API call)
declare -A CHAPTER_MAP=(
  ["Analogy Verbal"]="d7405e83-5ca3-4833-b11d-400ada09654e"
  ["Odd One Out"]="7b9d7538-ad6d-46a5-817d-2859e9abb32d"
  ["Coding-Decoding"]="a000386e-d68a-4cd2-9610-39eee69123e2"
  ["Number Series"]="51364ca7-5d98-4346-a21d-0569c802abc5"
  ["Missing Number"]="74d2588f-8c42-49a4-958b-e9991e797558"
  ["Statement And Conclusion"]="fb61c01e-faa4-41d9-bae0-3838c6ec7c29"
  ["Blood Relations"]="a7146480-1d39-434e-8b9c-217253997c34"
  ["Venn Diagram"]=""  # Need to find
  ["Cube And Dice"]="8f1cea5f-1573-452e-a4bb-14e1e27f0c28"
  ["Sitting Arrangement"]="1d44c7fd-cf6d-4162-a947-7f17983d0fc3"
  ["Direction Sense"]="4d9e846c-5f7e-4297-84fd-968c599ad4b5"
  ["Arithmetic Reasoning"]="4d22d280-beb5-422d-b6b9-464a35debc3a"
  ["Mathematical Operations"]="74095d5b-807e-4d36-81c2-89f46ebbea4b"
  ["Word Arrangement"]="57b30eb4-1aba-4bb3-9ad0-1fc9fd62ad58"
  ["Age"]="9ebf85c0-cdea-4495-be39-4cd6117562e0"
  ["Calendar"]="ch-calendar"
  ["Series Non Verbal"]="fc139b6d-17b3-429d-8159-55afdaa88084"
  ["Counting of Figures"]="62ba25fc-2c40-4b1b-a7eb-7546966bb426"
  ["Paper Cut/Fold"]="18b21889-393a-41eb-af2c-d728f802f6c1"
  ["Embedded Figures"]="dc81a68f-30c2-4b5f-acea-b2b19b1c4acb"
  ["Completion of Figure"]="404c561b-bea8-4644-a9b7-45bfd7698931"
  ["Mirror/Water Image"]="600f468c-f5d6-4134-b0f1-f9db4c7a33df"
  ["Miscellaneous"]="9cb4bc26-1dfb-4c50-9899-6da09970f49c"
)

# Exam IDs
declare -A EXAM_MAP=(
  ["SSC CGL"]="exam-cgl"
  ["SSC CHSL"]="exam-chsl"
  ["SSC CPO"]="exam-cpo"
  ["SSC MTS"]="exam-mts"
)

SUBJECT_ID="c5d2bb1f-ac87-432d-9462-954835c4a4ed"

# Load the parsed questions JSON
if [ ! -f "/tmp/questions.json" ]; then
  echo "questions.json not found, generating..."
  python3 << 'PYEOF'
import json
import sys
sys.path.insert(0, '/Users/sachin/ssc-prep-hub')
from scripts.parse_7200_questions import parse_questions
questions = parse_questions("/tmp/ssc-reasoning-7200.txt")
with open("/tmp/questions.json", "w") as f:
  json.dump([
    {
      "text": q.text,
      "text_hindi": q.text_hindi,
      "options": q.options,
      "correct_answer": q.correct_answer,
      "explanation": q.explanation,
      "explanation_hindi": q.explanation_hindi,
      "chapter_name": q.chapter_name,
      "exam_name": q.exam_name,
      "year": q.year,
      "shift": q.shift,
      "paper_code": q.paper_code
    }
    for q in questions
  ], f)
print(f"Saved {len(questions)} questions")
PYEOF
fi

# Read and ingest
python3 << 'PYEOF'
import json
import subprocess
import time

with open("/tmp/questions.json") as f:
    questions = json.load(f)

print(f"Loaded {len(questions)} questions")

success = 0
failed = 0
skipped = 0

for i, q in enumerate(questions):
    chapter_id = CHAPTER_MAP.get(q["chapter_name"])
    if not chapter_id:
        skipped += 1
        if skipped <= 5:
            print(f"  Skipped (no chapter): {q['chapter_name']}")
        continue
    
    exam_id = EXAM_MAP.get(q["exam_name"], "exam-cgl")
    
    # Parse options
    options_json = []
    for opt in q["options"]:
        if ') ' in opt:
            key = opt[0]
            text = opt[3:]
        else:
            key = opt[0]
            text = opt[2:]
        options_json.append({"key": key, "text": text})
    
    q_data = {
        "questionText": q["text"],
        "questionTextHindi": q["text_hindi"] or q["text"],
        "optionsJson": options_json,
        "correctAnswer": q["correct_answer"],
        "explanation": q["explanation"] or "",
        "explanationHindi": q["explanation_hindi"] or "",
        "chapterId": chapter_id,
        "subjectId": SUBJECT_ID,
        "examId": exam_id,
        "year": q["year"],
        "shift": q["shift"],
        "difficulty": "MEDIUM",
        "marks": 2,
        "negativeMarks": 0.5,
        "isApproved": True,
        "answerVerificationStatus": "VERIFIED_OFFICIAL",
        "translationStatus": "HUMAN_VERIFIED",
    }
    
    # Use curl to create question
    cmd = [
        "curl", "-s", "-X", "POST", f"{API_BASE}/bank/questions",
        "-H", f"Authorization: Bearer {TOKEN}",
        "-H", "Content-Type: application/json",
        "-d", json.dumps(q_data)
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    if result.returncode == 0 and '"id"' in result.stdout:
        success += 1
    else:
        failed += 1
        if failed <= 3:
            print(f"  Failed: {result.stdout[:200]}")
    
    if (success + failed + skipped) % 100 == 0:
        print(f"  Progress: {success} success, {failed} failed, {skipped} skipped")
    
    # Small delay
    if i % 20 == 0:
        time.sleep(0.05)

print(f"\nDone! Success: {success}, Failed: {failed}, Skipped: {skipped}")
PYEOF