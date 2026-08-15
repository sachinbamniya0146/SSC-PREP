"""
Upload SSC Delhi Police Constable Reasoning English questions to database
"""
import re
import json
import hashlib
from datetime import datetime

# Database connection
import psycopg2
conn = psycopg2.connect(
    host="localhost",
    port=5432,
    database="ssc_prep_hub_v2",
    user="postgres",
    password="postgres"
)
cur = conn.cursor()

# Get subject IDs
cur.execute('SELECT id, name FROM subjects WHERE name ILIKE %s', ('%reasoning%',))
subjects = cur.fetchall()
print("Subjects:", subjects)

cur.execute('SELECT id, name FROM exams WHERE name ILIKE %s', ('%delhi police%',))
exams = cur.fetchall()
print("Exams:", exams)

reasoning_subject_id = None
for s in subjects:
    if 'reasoning' in s[1].lower():
        reasoning_subject_id = s[0]
        break

delhi_police_exam_id = None
for e in exams:
    if 'delhi police' in e[1].lower() and 'constable' in e[1].lower():
        delhi_police_exam_id = e[0]
        break

print(f"Reasoning subject ID: {reasoning_subject_id}")
print(f"Delhi Police Constable exam ID: {delhi_police_exam_id}")

# Get the PDF source ID for this book
cur.execute("""
    SELECT id FROM source_pdfs 
    WHERE filename = 'SSC Delhi Police Constable Reasoning English.pdf'
""")
source_pdf = cur.fetchone()
if source_pdf:
    source_pdf_id = source_pdf[0]
    print(f"Source PDF ID: {source_pdf_id}")
else:
    # Create source PDF entry
    cur.execute("""
        INSERT INTO source_pdfs (filename, subjectId, examId, bookName, publisher, language, year)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        RETURNING id
    """, (
        'SSC Delhi Police Constable Reasoning English.pdf',
        reasoning_subject_id,
        delhi_police_exam_id,
        'SSC Delhi Police Constable Reasoning English',
        'CAREERWILL PUBLICATION',
        'English',
        2025
    ))
    source_pdf_id = cur.fetchone()[0]
    conn.commit()
    print(f"Created source PDF ID: {source_pdf_id}")

# Create import batch
cur.execute("""
    INSERT INTO import_batches (sourcePdfId, status, totalChunks, completedChunks, failedChunks)
    VALUES (%s, %s, %s, %s, %s)
    RETURNING id
""", (source_pdf_id, 'COMPLETED', 1, 1, 0))
batch_id = cur.fetchone()[0]
conn.commit()
print(f"Created batch ID: {batch_id}")

# Now let's extract questions from the DOCX content we already read
# We have the full text content from the read_file calls
# Let me parse it properly

# Since the content is too large to process inline, let me write a parser
# that reads from a saved file
