#!/usr/bin/env node
/**
 * Auto-translate Hindi for questions missing it.
 * Uses Gemini API (or fallback). Resumable - tracks progress.
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

const prisma = new PrismaClient();

// Gemini API config
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.AI_API_KEY;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;

async function translate(text, targetLang = 'Hindi') {
  if (!text || text.trim().length < 3) return null;
  const prompt = `Translate the following text to ${targetLang}. Keep all numbers, symbols (→, ✓, ×, etc.), and formatting intact. Output ONLY the translation, nothing else:\n\n${text}`;
  
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`API error ${res.status}: ${err.slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (e) {
    console.error(`Fetch error: ${e.message}`);
    return null;
  }
}

async function main() {
  if (!GEMINI_KEY) {
    console.log('WARN: No GEMINI_API_KEY set. Using placeholder Hindi translation (marked AUTO_UNVERIFIED).');
  }

  // Find questions missing Hindi (null/empty Hindi text, excluding those already marked with placeholder)
  const missing = await prisma.question.findMany({
    where: {
      isApproved: true,
      OR: [
        { questionTextHindi: null },
        { questionTextHindi: '' },
      ],
      // Exclude questions that have the placeholder text (they were already processed)
      // Only applies to non-null text
      NOT: {
        AND: [
          { questionTextHindi: { not: null } },
          { questionTextHindi: { not: '' } },
          { questionTextHindi: { contains: 'Hindi translation pending' } },
        ],
      },
    },
    take: 500,
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Questions needing Hindi: ${missing.length}`);

  let translated = 0;
  let skipped = 0;
  let rateLimited = false;

  for (const q of missing) {
    if (rateLimited) {
      // Still update as AUTO_UNVERIFIED so they show up
      await prisma.question.update({
        where: { id: q.id },
        data: { translationStatus: 'AUTO_UNVERIFIED' },
      });
      skipped++;
      continue;
    }

    if (GEMINI_KEY && q.questionText) {
      const hi = await translate(q.questionText);
      if (hi) {
        await prisma.question.update({
          where: { id: q.id },
          data: {
            questionTextHindi: hi,
            translationStatus: 'AUTO_UNVERIFIED',
          },
        });
        translated++;
        // Also translate explanation
        if (q.explanation) {
          const explHi = await translate(q.explanation);
          if (explHi) {
            await prisma.question.update({
              where: { id: q.id },
              data: { explanationHindi: explHi },
            });
          }
        }
        // Rate limit: ~10 req/min for free tier
        await new Promise(r => setTimeout(r, 6000));
      } else {
        rateLimited = true;
        // Mark as AUTO_UNVERIFIED placeholder
        await prisma.question.update({
          where: { id: q.id },
          data: { translationStatus: 'AUTO_UNVERIFIED' },
        });
        skipped++;
      }
    } else {
      // No API key - provide placeholder Hindi text so UI doesn't show empty
      const placeholderHi = `[Hindi translation pending - auto-generation requires GEMINI_API_KEY]`;
      await prisma.question.update({
        where: { id: q.id },
        data: {
          questionTextHindi: placeholderHi,
          translationStatus: 'AUTO_UNVERIFIED',
        },
      });
      skipped++;
    }

    if ((translated + skipped) % 50 === 0) {
      console.log(`  Progress: ${translated} translated, ${skipped} skipped`);
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Translated: ${translated} | Skipped (no key/rate-limit): ${skipped}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());