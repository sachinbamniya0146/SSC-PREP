
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

async function main() {
    const questions = JSON.parse(fs.readFileSync('extracted_questions.json', 'utf-8'));
    
    // Get all exams, subjects, chapters
    const exams = await prisma.exam.findMany();
    const examMap = new Map(exams.map(e => [e.code, e]));
    
    const subjects = await prisma.subject.findMany();
    const subjectMap = new Map(subjects.map(s => [s.slug, s]));
    
    const chapters = await prisma.chapter.findMany({ include: { subject: true } });
    const chapterMap = new Map();
    for (const c of chapters) {
        const key = `${c.subject.slug}:${c.slug}`;
        chapterMap.set(key, c);
    }
    
    console.log(`Found ${exams.length} exams, ${subjects.length} subjects, ${chapters.length} chapters`);
    
    // Simple keyword-based subject/chapter mapping
    function guessSubjectChapter(questionText: string, examCode: string) {
        const qLower = questionText.toLowerCase();
        
        // First, check for computer-related keywords (high priority for DPC)
        // Only count as computer if question explicitly mentions MS Office / Excel / Word / computer hardware/networking
        const computerKeywords = ['ms excel', 'ms word', 'microsoft excel', 'microsoft word', 'microsoft office', 'spreadsheet', 'worksheet', 'workbook', 'formula bar', 'shortcut key', 'ctrl +', 'ribbon tab', 'bullet', 'numbering in', 'print preview', 'page layout', 'mail merge', 'pivot table', 'vlookup', 'hlookup', 'conditional formatting', 'data validation', 'macro', 'vba', 'visual basic', 'local area network', 'wide area network', 'router', 'switch', 'protocol', 'ip address', 'subnet', 'gateway', 'dns', 'dhcp', 'firewall', 'browser', 'url', 'http', 'https', 'ftp', 'smtp', 'pop3', 'imap', 'email client', 'outlook', 'gmail', 'cpu', 'ram', 'rom', 'motherboard', 'hard disk', 'ssd', 'cache memory', 'operating system', 'windows', 'linux', 'device driver', 'input device', 'output device', 'monitor', 'keyboard', 'mouse', 'printer', 'scanner', 'plotter'];
        
        const quantKeywords = ['circle', 'triangle', 'track', 'speed', 'time', 'distance', 'interest', 'population', 'percentage', 'profit', 'loss', 'ratio', 'proportion', 'average', 'work', 'pipe', 'cistern', 'simple', 'compound', 'mensuration', 'geometry', 'algebra', 'trigonometry', 'number', 'series', 'sequence', 'equation', 'polynomial', 'quadratic', 'coordinate', 'area', 'volume', 'surface', 'perimeter', 'radius', 'diameter', 'circumference', 'angle', 'degree', 'parallel', 'perpendicular', 'similar', 'congruent', 'theorem', 'pythagoras', 'median', 'altitude', 'centroid', 'incentre', 'circumcentre', 'orthocentre'];
        
        const reasoningKeywords = ['analogy', 'classification', 'series', 'coding', 'decoding', 'blood', 'relation', 'direction', 'seating', 'arrangement', 'puzzle', 'syllogism', 'statement', 'assumption', 'conclusion', 'argument', 'mirror', 'water', 'image', 'paper', 'folding', 'cutting', 'figure', 'completion', 'embedded', 'counting', 'dice', 'cube', 'calendar', 'clock', 'ranking', 'order', 'sequence', 'pattern', 'matrix', 'analogy', 'odd', 'one', 'out'];
        
        const englishKeywords = ['word', 'meaning', 'synonym', 'antonym', 'spelling', 'idiom', 'phrase', 'one word', 'substitution', 'sentence', 'improvement', 'active', 'passive', 'voice', 'direct', 'indirect', 'speech', 'cloze', 'comprehension', 'para', 'jumble', 'rearrange', 'fill', 'blank', 'spot', 'error', 'grammar', 'vocabulary', 'preposition', 'article', 'tense', 'verb', 'noun', 'adjective', 'adverb', 'conjunction', 'punctuation', 'capitalization'];
        
        const gaKeywords = ['history', 'geography', 'polity', 'economy', 'science', 'physics', 'chemistry', 'biology', 'current', 'affairs', 'gk', 'general', 'knowledge', 'award', 'sport', 'book', 'author', 'invention', 'discovery', 'constitution', 'parliament', 'president', 'prime minister', 'governor', 'chief minister', 'supreme court', 'high court', 'fundamental', 'rights', 'directive', 'principles', 'amendment', 'schedule', 'article', 'budget', 'finance', 'tax', 'gdp', 'inflation', 'bank', 'rbi', 'sebi', 'plan', 'commission', 'niti', 'ayog', 'census', 'population', 'literacy', 'sex ratio', 'state', 'capital', 'river', 'mountain', 'lake', 'dam', 'national park', 'wildlife', 'sanctuary', 'biosphere', 'reserve', 'heritage', 'monument', 'temple', 'fort', 'palace', 'museum'];
        
        let quantScore = 0, reasoningScore = 0, englishScore = 0, gaScore = 0, computerScore = 0;
        
        for (const k of quantKeywords) if (qLower.includes(k)) quantScore++;
        for (const k of reasoningKeywords) if (qLower.includes(k)) reasoningScore++;
        for (const k of englishKeywords) if (qLower.includes(k)) englishScore++;
        for (const k of gaKeywords) if (qLower.includes(k)) gaScore++;
        for (const k of computerKeywords) if (qLower.includes(k)) computerScore++;
        
        // For DPC: if question has quant keywords but also generic words like 'ans', 'option', 'question id', don't count as computer
        // Only classify as computer if computerScore is significantly higher than quantScore
        const scores = { quant: quantScore, reasoning: reasoningScore, english: englishScore, ga: gaScore, computer: computerScore };
        let best = (Object.entries(scores).reduce((a, b) => scores[a[0] as keyof typeof scores] > scores[b[0] as keyof typeof scores] ? a : b)[0]) as keyof typeof scores;
        
        // Override: if it's a DPC question and quantScore > 0 but computerScore is only from generic words, prefer quant
        if (examCode === 'DPC' && best === 'computer' && quantScore > 0 && computerScore <= 2) {
            // Check if computer keywords are specific (not generic)
            const specificComputerKw = ['ms excel', 'ms word', 'microsoft excel', 'microsoft word', 'microsoft office', 'spreadsheet', 'worksheet', 'workbook', 'formula bar', 'shortcut key', 'ctrl +', 'ribbon tab', 'pivot table', 'vlookup', 'hlookup', 'conditional formatting', 'data validation', 'macro', 'vba', 'visual basic', 'local area network', 'wide area network', 'router', 'switch', 'protocol', 'ip address', 'subnet', 'gateway', 'dns', 'dhcp', 'firewall', 'browser', 'url', 'http', 'https', 'ftp', 'smtp', 'pop3', 'imap', 'cpu', 'ram', 'rom', 'motherboard', 'hard disk', 'ssd', 'cache memory', 'operating system', 'windows', 'linux', 'device driver'];
            const hasSpecificComputer = specificComputerKw.some(k => qLower.includes(k));
            if (!hasSpecificComputer) {
                best = 'quant';
            }
        }
        
        const examSubjectSlugs: Record<string, Record<string, string>> = {
            CGL: { quant: 'quant-cgl', reasoning: 'reasoning-cgl', english: 'english-cgl', ga: 'ga-cgl' },
            CHSL: { quant: 'quant-chsl', reasoning: 'reasoning-chsl', english: 'english-chsl', ga: 'ga-chsl' },
            MTS: { quant: 'quant-mts', reasoning: 'reasoning-mts', english: 'english-mts', ga: 'ga-mts' },
            GD: { quant: 'quant-gd', reasoning: 'reasoning-gd', english: 'english-gd', ga: 'ga-gd' },
            STENO: { quant: 'quant-steno', reasoning: 'reasoning-steno', english: 'english-steno', ga: 'ga-steno' },
            CPO: { quant: 'quant-cpo', reasoning: 'reasoning-cpo', english: 'english-cpo', ga: 'ga-cpo' },
            JE: { quant: 'engineering-je', reasoning: 'reasoning-je', english: 'english-je', ga: 'ga-je' },
            SELECTION_POST: { quant: 'quant-sp', reasoning: 'reasoning-sp', english: 'english-sp', ga: 'ga-sp' },
            DPC: { quant: 'quant-dpc', reasoning: 'reasoning-dpc', english: 'english-dpc', ga: 'gk-dpc', computer: 'computer-dpc' },
            DPHC: { quant: 'quant-dphc', reasoning: 'reasoning-dphc', english: 'english-dphc', ga: 'ga-dphc', computer: 'computer-dphc' },
        };
        
        const subjectSlug = examSubjectSlugs[examCode]?.[best] || `reasoning-${examCode.toLowerCase()}`;
        const subject = subjectMap.get(subjectSlug) || null;
        
        let chapter = null;
        if (subject) {
            // Try to match chapter based on keywords in question text
            const qLower = questionText.toLowerCase();
            let bestChapter = null;
            for (const [key, ch] of chapterMap) {
                if (key.startsWith(`${subject.slug}:`)) {
                    // Check if chapter slug appears in question
                    if (qLower.includes(ch.slug.replace(/-/g, ' '))) {
                        bestChapter = ch;
                        break;
                    }
                    // Fallback: first chapter of subject
                    if (!chapter) {
                        chapter = ch;
                    }
                }
            }
            if (bestChapter) {
                chapter = bestChapter;
            }
        }
        
        return { subject, chapter, category: best };
    }
    
    let added = 0, skipped = 0;
    
    for (const q of questions) {
        const exam = examMap.get(q.exam_code);
        if (!exam) { skipped++; continue; }
        
        const { subject, chapter } = guessSubjectChapter(q.question_text, q.exam_code);
        if (!subject || !chapter) { skipped++; continue; }
        
        // Check if exists
        const existing = await prisma.question.findFirst({
            where: {
                examId: exam.id,
                questionText: q.question_text,
                year: q.year,
                shift: String(q.shift),
            }
        });
        
        if (existing) { skipped++; continue; }
        
        try {
            // Set correct answer if available in extracted data
            let optionsJson = [
                { text: q.options[0], isCorrect: false },
                { text: q.options[1], isCorrect: false },
                { text: q.options[2], isCorrect: false },
                { text: q.options[3], isCorrect: false },
            ];
            let correctAnswer = "";
            
            if (q.correct_answer && q.correct_answer.trim()) {
                // Find which option matches the correct answer
                for (let i = 0; i < 4; i++) {
                    if (q.options[i].trim() === q.correct_answer.trim()) {
                        optionsJson[i].isCorrect = true;
                        correctAnswer = q.correct_answer.trim();
                        break;
                    }
                }
            }
            
            await prisma.question.create({
                data: {
                    examId: exam.id,
                    subjectId: subject.id,
                    chapterId: chapter.id,
                    questionText: q.question_text,
                    questionTextHindi: "",
                    optionsJson: optionsJson,
                    correctAnswer: correctAnswer,
                    explanation: "",
                    explanationHindi: "",
                    difficulty: "MEDIUM",
                    year: q.year,
                    shift: String(q.shift),
                    isApproved: false,
                    isActive: true,
                    answerVerificationStatus: "PENDING",
                }
            });
            added++;
        } catch (e) {
            skipped++;
        }
    }
    
    console.log(`Added: ${added}, Skipped: ${skipped}`);
    await prisma.$disconnect();
}

main().catch(console.error);
