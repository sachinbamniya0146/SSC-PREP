# -*- coding: utf-8 -*-
"""SSC Prep Hub — seed verified PYQs (with correct answers) into Prisma DB.
Only questions WITH verified answers are seeded (user demanded zero answer-mistakes).
Source: ~/ssc-automation/data/seed_data.py (18 verified Reasoning PYQs).
Run: npx ts-node prisma/seed.ts  OR  node via ts-node
"""
import sys, importlib.util, json, subprocess, os

# Load seed_data.py QUESTIONS from the data dir
spec = importlib.util.spec_from_file_location("seed_data", "/Users/sachin/ssc-automation/data/seed_data.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
QUESTIONS = mod.QUESTIONS

print(f"[seed] Loaded {len(QUESTIONS)} verified questions with answers")

def run_psql(sql):
    """Run a SQL statement against sscprephub DB."""
    env = os.environ.copy()
    # default url
    url = "postgresql://sachin@localhost:5432/sscprephub"
    cmd = ["psql", url, "-v", "ON_ERROR_STOP=1", "-c", sql]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r

# 1. Create Subject "Reasoning"
subj_sql = """INSERT INTO subjects (id, name, slug) 
SELECT 'subj-reasoning', 'Reasoning', 'reasoning'
WHERE NOT EXISTS (SELECT 1 FROM subjects WHERE slug='reasoning');
"""
run_psql(subj_sql)
print("[seed] Subject Reasoning ensured")

# 2. Create chapters from distinct topics, insert questions
# Use psycopg? No — go via a small node script using Prisma for correctness.
# Simpler: generate SQL upserts.
lines = []
topic_set = {}
for q in QUESTIONS:
    topic = q["topic"].replace("—", "-").strip()
    # chapter slug
    chapname = topic
    # collect distinct topics
    if topic not in topic_map:
        topic_map[topic] = q

# Build chapters
for topic in topic_map.keys():
    slug = topic.lower().replace(" ", "_").replace("-", "_")[:60]
    lines.append(f"""
INSERT INTO chapters (id, subject_id, name, slug)
SELECT 'chap-' || md5('{topic}'), '{ "subj-reasoning" }', '{topic}', '{slug}'
WHERE NOT EXISTS (SELECT 1 FROM chapters WHERE slug='{slug}');
""")

# Insert questions
# NOTE: Question.id is required uuid; generate deterministic id via md5.
for q in QUESTIONS:
    import hashlib
    qid = "q-" + hashlib.md5(q["q_en"].encode()).hexdigest()[:16]
    topic = q["topic"].replace(" - ", "-")
    chap = topic.replace("'", "''")
    chap_slug = topic.lower().replace(" ", "_")[:60]
    opts_json = json.dumps([
        {"key": "A", "text": q["opt_a"], "isCorrect": q["answer"].upper() == "A"},
        {"key": "B", "text": q["opt_b"], "isCorrect": q["answer"].upper() == "B"},
        {"key": "C", "text": q["opt_c"], "isCorrect": q["answer"].upper() == "C"},
        {"key": "D", "text": q["opt_d"], "isCorrect": q["answer"].upper() == "D"},
    ])
    opts_json_safe = opts_json.replace("'", "''")
    qen_safe = q["q_en"].replace("'", "''")
    qhi_safe = q.get("q_hi", "").replace("'", "''")
    exp_en = q.get("expl_en", "").replace("'", "''")
    exp_hi = q.get("expl_hi", "").replace("'", "''")
    year = q.get("year", None)
    ans = q["answer"].upper()
    diff = q.get("diff", "Medium")

    lines.append(f"""
INSERT INTO questions (
 id, subject_id, chapter_id, topic_id, exam_id, year, shift, paper_code,
 question_text, question_text_hindi, options_json, correct_answer,
 explanation, explanation_hindi, explanation_source, translation_status,
 is_approved, search_hash, difficulty, marks, negative_marks, source_pdf_id, import_batch_id, is_active, created_at, updated_at
)
SELECT '{'-id-}',
 (SELECT id FROM subjects WHERE slug='reasoning'),
 (SELECT id FROM chapters WHERE slug='{chap_slug}'),
 NULL, NULL, {year}, NULL, NULL,
 '{qen_safe}', '{qhi_safe}', '{opts_json_safe}', '{ans}',
 '{exp_en}', '{exp_hi}', 'HUMAN_VERIFIED', 'HUMAN_VERIFIED', TRUE,
 NULL, '{diff}'::difficulty, 1.0, 0.5, NULL, NULL, TRUE, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM questions WHERE id='{qid}');
""")

sql = "\n".join(lines)
with open("/tmp/ssc_seed.sql", "w") as f:
    f.write(sql)
print(f"[seed] SQL ready, {len(lines)} statements")

env = os.environ.copy()
url = "postgresql://sachin@localhost:5432/sscprephub"
r = subprocess.run(["psql", url, "-v", "ON_ERROR_STOP=0", "-f", "/tmp/ssc_seed.sql"], capture_output=True, text=True)
print("[seed] psql stdout tail:")
print("\n".join(r.stdout.splitlines()[-15:]))
if r.stderr:
    print("[seed] stderr tail:", "\n".join(r.stderr.splitlines()[-10:]))