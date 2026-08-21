
import json
import asyncio
from prisma import PrismaClient

prisma = PrismaClient()

async def main():
    await prisma.connect()
    
    with open('extracted_questions.json', 'r') as f:
        questions = json.load(f)
    
    # Get all exams, subjects, chapters
    exams = {e.code: e for e in await prisma.exam.find_many()}
    subjects = {s.slug: s for s in await prisma.subject.find_many()}
    chapters = {}
    for c in await prisma.chapter.find_many(include={"subject": True}):
        key = f"{c.subject.slug}:{c.slug}"
        chapters[key] = c
    
    print(f"Found {len(exams)} exams, {len(subjects)} subjects, {len(chapters)} chapters")
    
    # Simple keyword-based subject/chapter mapping
    def guess_subject_chapter(question_text, exam_code):
        q_lower = question_text.lower()
        
        # Quant keywords
        quant_keywords = ['circle', 'triangle', 'track', 'speed', 'time', 'distance', 'interest', 'population', 'percentage', 'profit', 'loss', 'ratio', 'proportion', 'average', 'work', 'pipe', 'cistern', 'simple', 'compound', 'mensuration', 'geometry', 'algebra', 'trigonometry', 'number', 'series', 'sequence', 'equation', 'polynomial', 'quadratic', 'coordinate', 'area', 'volume', 'surface', 'perimeter', 'radius', 'diameter', 'circumference', 'angle', 'degree', 'parallel', 'perpendicular', 'similar', 'congruent', 'theorem', 'pythagoras', 'median', 'altitude', 'centroid', 'incentre', 'circumcentre', 'orthocentre']
        
        # Reasoning keywords
        reasoning_keywords = ['analogy', 'classification', 'series', 'coding', 'decoding', 'blood', 'relation', 'direction', 'seating', 'arrangement', 'puzzle', 'syllogism', 'statement', 'assumption', 'conclusion', 'argument', 'mirror', 'water', 'image', 'paper', 'folding', 'cutting', 'figure', 'completion', 'embedded', 'counting', 'dice', 'cube', 'calendar', 'clock', 'ranking', 'order', 'sequence', 'pattern', 'matrix', 'analogy', 'odd', 'one', 'out']
        
        # English keywords
        english_keywords = ['word', 'meaning', 'synonym', 'antonym', 'spelling', 'idiom', 'phrase', 'one word', 'substitution', 'sentence', 'improvement', 'active', 'passive', 'voice', 'direct', 'indirect', 'speech', 'cloze', 'comprehension', 'para', 'jumble', 'rearrange', 'fill', 'blank', 'spot', 'error', 'grammar', 'vocabulary', 'preposition', 'article', 'tense', 'verb', 'noun', 'adjective', 'adverb', 'conjunction', 'punctuation', 'capitalization']
        
        # GA keywords
        ga_keywords = ['history', 'geography', 'polity', 'economy', 'science', 'physics', 'chemistry', 'biology', 'current', 'affairs', 'gk', 'general', 'knowledge', 'award', 'sport', 'book', 'author', 'invention', 'discovery', 'constitution', 'parliament', 'president', 'prime minister', 'governor', 'chief minister', 'supreme court', 'high court', 'fundamental', 'rights', 'directive', 'principles', 'amendment', 'schedule', 'article', 'budget', 'finance', 'tax', 'gdp', 'inflation', 'bank', 'rbi', 'sebi', 'plan', 'commission', 'niti', 'ayog', 'census', 'population', 'literacy', 'sex ratio', 'state', 'capital', 'river', 'mountain', 'lake', 'dam', 'national park', 'wildlife', 'sanctuary', 'biosphere', 'reserve', 'heritage', 'monument', 'temple', 'fort', 'palace', 'museum']
        
        quant_score = sum(1 for k in quant_keywords if k in q_lower)
        reasoning_score = sum(1 for k in reasoning_keywords if k in q_lower)
        english_score = sum(1 for k in english_keywords if k in q_lower)
        ga_score = sum(1 for k in ga_keywords if k in q_lower)
        
        scores = {
            'quant': quant_score,
            'reasoning': reasoning_score,
            'english': english_score,
            'ga': ga_score,
        }
        
        best = max(scores, key=scores.get)
        if scores[best] == 0:
            best = 'reasoning'  # default
        
        # Map to subject slug based on exam
        subject_map = {
            'CGL': {
                'quant': 'quant-cgl',
                'reasoning': 'reasoning-cgl',
                'english': 'english-cgl',
                'ga': 'ga-cgl',
            },
            'CHSL': {
                'quant': 'quant-chsl',
                'reasoning': 'reasoning-chsl',
                'english': 'english-chsl',
                'ga': 'ga-chsl',
            },
            'MTS': {
                'quant': 'quant-mts',
                'reasoning': 'reasoning-mts',
                'english': 'english-mts',
                'ga': 'ga-mts',
            },
            'GD': {
                'quant': 'quant-gd',
                'reasoning': 'reasoning-gd',
                'english': 'english-gd',
                'ga': 'ga-gd',
            },
            'STENO': {
                'quant': 'quant-steno',
                'reasoning': 'reasoning-steno',
                'english': 'english-steno',
                'ga': 'ga-steno',
            },
            'CPO': {
                'quant': 'quant-cpo',
                'reasoning': 'reasoning-cpo',
                'english': 'english-cpo',
                'ga': 'ga-cpo',
            },
            'JE': {
                'quant': 'engineering-je',
                'reasoning': 'reasoning-je',
                'english': 'english-je',
                'ga': 'ga-je',
            },
            'SELECTION_POST': {
                'quant': 'quant-sp',
                'reasoning': 'reasoning-sp',
                'english': 'english-sp',
                'ga': 'ga-sp',
            },
            'DPC': {
                'quant': 'quant-dpc',
                'reasoning': 'reasoning-dpc',
                'english': 'english-dpc',
                'ga': 'gk-dpc',
            },
            'DPHC': {
                'quant': 'quant-dphc',
                'reasoning': 'reasoning-dphc',
                'english': 'english-dphc',
                'ga': 'ga-dphc',
            },
        }
        
        subject_slug = subject_map.get(exam_code, {}).get(best, f'reasoning-{exam_code.lower()}')
        subject = subjects.get(subject_slug)
        
        # Find chapter within subject
        chapter = None
        if subject:
            subject_chapters = [c for k, c in chapters.items() if k.startswith(f"{subject.slug}:")]
            if subject_chapters:
                chapter = subject_chapters[0]  # First chapter as default
        
        return subject, chapter, best
    
    added = 0
    skipped = 0
    
    for q in questions:
        exam = exams.get(q["exam_code"])
        if not exam:
            skipped += 1
            continue
        
        subject, chapter, category = guess_subject_chapter(q["question_text"], q["exam_code"])
        
        if not subject or not chapter:
            skipped += 1
            continue
        
        # Check if question already exists
        existing = await prisma.question.find_first({
            "where": {
                "examId": exam.id,
                "questionText": q["question_text"],
                "year": q["year"],
                "shift": str(q["shift"]),
            }
        })
        
        if existing:
            skipped += 1
            continue
        
        try:
            await prisma.question.create({
                "data": {
                    "examId": exam.id,
                    "subjectId": subject.id,
                    "chapterId": chapter.id,
                    "questionText": q["question_text"],
                    "questionTextHindi": "",  # Will add later
                    "optionsJson": [
                        {"text": q["options"][0], "isCorrect": False},
                        {"text": q["options"][1], "isCorrect": False},
                        {"text": q["options"][2], "isCorrect": False},
                        {"text": q["options"][3], "isCorrect": False},
                    ],
                    "correctAnswer": "",
                    "explanation": "",
                    "explanationHindi": "",
                    "difficulty": "MEDIUM",
                    "year": q["year"],
                    "shift": str(q["shift"]),
                    "isApproved": False,
                    "isActive": True,
                    "answerVerificationStatus": "PENDING",
                }
            })
            added += 1
        except Exception as e:
            skipped += 1
    
    print(f"Added: {added}, Skipped: {skipped}")
    await prisma.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
