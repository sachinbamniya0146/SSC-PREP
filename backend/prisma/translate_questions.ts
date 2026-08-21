import { PrismaClient } from '@prisma/client';
import { translate } from '@vitalets/google-translate-api';

const prisma = new PrismaClient();

async function translateText(text: string, from: string = 'en', to: string = 'hi'): Promise<string> {
    if (!text || text.trim() === '') return '';
    try {
        const result = await translate(text, { from, to });
        return result.text;
    } catch (e) {
        console.error(`Translation failed for: ${text.substring(0, 50)}...`, e);
        return text; // Return original on failure
    }
}

async function main() {
    console.log('🔤 Starting Hindi translation for English questions...');
    
    // Get all questions without Hindi translation
    const questions = await prisma.question.findMany({
        where: {
            questionTextHindi: '',
            isActive: true
        },
        take: 500, // Process in larger batches
        select: {
            id: true,
            questionText: true,
            explanation: true,
            optionsJson: true,
            correctAnswer: true
        }
    });
    
    console.log(`Found ${questions.length} questions to translate`);
    
    let translated = 0;
    let failed = 0;
    
    for (const q of questions) {
        try {
            // Translate question text
            const questionTextHindi = await translateText(q.questionText);
            
            // Translate explanation if exists
            const explanationHindi = q.explanation ? await translateText(q.explanation) : '';
            
            // Update question
            await prisma.question.update({
                where: { id: q.id },
                data: {
                    questionTextHindi,
                    explanationHindi
                }
            });
            
            translated++;
            if (translated % 25 === 0) {
                console.log(`Translated ${translated}/${questions.length}...`);
            }
            
            // Small delay to avoid rate limiting
            await new Promise(r => setTimeout(r, 200));
            
        } catch (e) {
            failed++;
            console.error(`Failed to translate question ${q.id}:`, e);
        }
    }
    
    console.log(`\n✅ Translation complete: ${translated} translated, ${failed} failed`);
    await prisma.$disconnect();
}

main().catch(console.error);