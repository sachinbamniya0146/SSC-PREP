import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🔍 Starting 4x verification of question bank...');
    
    const questions = await prisma.question.findMany({
        where: { isActive: true },
        select: {
            id: true,
            questionText: true,
            questionTextHindi: true,
            optionsJson: true,
            correctAnswer: true,
            explanation: true,
            explanationHindi: true,
            subject: { select: { name: true, slug: true } },
            chapter: { select: { name: true, slug: true } },
            exam: { select: { code: true } }
        }
    });
    
    console.log(`Total questions: ${questions.length}`);
    
    // Verification 1: All questions have 4 options
    console.log('\n=== VERIFICATION 1: All questions have 4 options ===');
    let opt4Count = 0;
    let optNot4Count = 0;
    for (const q of questions) {
        const opts = q.optionsJson as any[];
        if (opts && Array.isArray(opts) && opts.length === 4) {
            opt4Count++;
        } else {
            optNot4Count++;
            console.log(`❌ Q${q.id}: Options count = ${opts?.length || 'null'}`);
        }
    }
    console.log(`✅ 4 options: ${opt4Count}, ❌ Not 4: ${optNot4Count}`);
    
    // Verification 2: All questions have correctAnswer populated
    console.log('\n=== VERIFICATION 2: All questions have correctAnswer ===');
    let hasAnswer = 0;
    let noAnswer = 0;
    for (const q of questions) {
        if (q.correctAnswer && q.correctAnswer.trim() !== '') {
            hasAnswer++;
        } else {
            noAnswer++;
            console.log(`❌ Q${q.id}: No correctAnswer`);
        }
    }
    console.log(`✅ Has answer: ${hasAnswer}, ❌ No answer: ${noAnswer}`);
    
    // Verification 3: correctAnswer matches one of the options
    console.log('\n=== VERIFICATION 3: correctAnswer matches an option ===');
    let matchCount = 0;
    let mismatchCount = 0;
    for (const q of questions) {
        const opts = q.optionsJson as any[];
        if (q.correctAnswer && opts && Array.isArray(opts)) {
            const optionTexts = opts.map((o: any) => (typeof o === 'object' && o?.text) || o).filter(Boolean);
            if (optionTexts.includes(q.correctAnswer)) {
                matchCount++;
            } else {
                mismatchCount++;
                console.log(`❌ Q${q.id}: Answer "${q.correctAnswer}" not in options [${optionTexts.join(', ')}]`);
            }
        } else {
            mismatchCount++;
        }
    }
    console.log(`✅ Matches: ${matchCount}, ❌ Mismatches: ${mismatchCount}`);
    
    // Verification 4: All questions have Hindi translation
    console.log('\n=== VERIFICATION 4: All questions have Hindi translation ===');
    let hasHindi = 0;
    let noHindi = 0;
    for (const q of questions) {
        if (q.questionTextHindi && q.questionTextHindi.trim() !== '') {
            hasHindi++;
        } else {
            noHindi++;
            console.log(`❌ Q${q.id}: No Hindi translation`);
        }
    }
    console.log(`✅ Has Hindi: ${hasHindi}, ❌ No Hindi: ${noHindi}`);
    
    // Verification 5: No duplicate questions (same text in same exam)
    console.log('\n=== VERIFICATION 5: No duplicate questions ===');
    const textMap = new Map<string, number[]>();
    for (const q of questions) {
        const key = `${q.exam?.code || 'unknown'}:${q.questionText.trim().toLowerCase()}`;
        if (!textMap.has(key)) textMap.set(key, []);
        textMap.get(key)!.push(Number(q.id));
    }
    let dupCount = 0;
    for (const [key, ids] of textMap) {
        if (ids.length > 1) {
            dupCount++;
            console.log(`❌ Duplicate: ${key} (IDs: ${ids.join(', ')})`);
        }
    }
    console.log(`✅ Unique: ${questions.length - dupCount}, ❌ Duplicates: ${dupCount}`);
    
    // Verification 6: All questions have subject and chapter assigned
    console.log('\n=== VERIFICATION 6: All questions have subject & chapter ===');
    let hasSubject = 0, noSubject = 0;
    let hasChapter = 0, noChapter = 0;
    for (const q of questions) {
        if (q.subject) hasSubject++; else noSubject++;
        if (q.chapter) hasChapter++; else noChapter++;
    }
    console.log(`✅ Subject: ${hasSubject}, ❌ No subject: ${noSubject}`);
    console.log(`✅ Chapter: ${hasChapter}, ❌ No chapter: ${noChapter}`);
    
    // Verification 7: Options have isCorrect flags set correctly
    console.log('\n=== VERIFICATION 7: isCorrect flags on options ===');
    let flagsCorrect = 0, flagsWrong = 0;
    for (const q of questions) {
        const opts = q.optionsJson as any[];
        if (opts && Array.isArray(opts) && q.correctAnswer) {
            let correctFlagCount = 0;
            for (const opt of opts) {
                const optText = (typeof opt === 'object' && opt?.text) || opt;
                const shouldBeCorrect = optText === q.correctAnswer;
                const isMarkedCorrect = (typeof opt === 'object' && opt?.isCorrect) === true;
                if (shouldBeCorrect === isMarkedCorrect) {
                    if (shouldBeCorrect) correctFlagCount++;
                } else {
                    flagsWrong++;
                }
            }
            if (correctFlagCount === 1) flagsCorrect++;
            else flagsWrong++;
        } else {
            flagsWrong++;
        }
    }
    console.log(`✅ Correct flags: ${flagsCorrect}, ❌ Wrong flags: ${flagsWrong}`);
    
    // Summary
    console.log('\n=== SUMMARY ===');
    const allPass = optNot4Count === 0 && noAnswer === 0 && mismatchCount === 0 && noHindi === 0 && dupCount === 0 && noSubject === 0 && noChapter === 0 && flagsWrong === 0;
    console.log(`All verifications ${allPass ? 'PASSED ✅' : 'FAILED ❌'}`);
    console.log(`Questions: ${questions.length} total`);
    
    await prisma.$disconnect();
    process.exit(allPass ? 0 : 1);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});