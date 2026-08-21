import { PrismaClient, Role, TestType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting comprehensive SSC exam data seeding...');

  // ============================================
  // 1. CREATE ALL SSC EXAMS
  // ============================================
  const exams = [
    { name: 'SSC CGL', slug: 'ssc-cgl', code: 'CGL' },
    { name: 'SSC CHSL', slug: 'ssc-chsl', code: 'CHSL' },
    { name: 'SSC MTS', slug: 'ssc-mts', code: 'MTS' },
    { name: 'SSC GD Constable', slug: 'ssc-gd', code: 'GD' },
    { name: 'SSC Stenographer', slug: 'ssc-steno', code: 'STENO' },
    { name: 'SSC CPO', slug: 'ssc-cpo', code: 'CPO' },
    { name: 'SSC JE', slug: 'ssc-je', code: 'JE' },
    { name: 'SSC Selection Post', slug: 'ssc-selection-post', code: 'SELECTION_POST' },
    { name: 'Delhi Police Constable', slug: 'delhi-police-constable', code: 'DPC' },
    { name: 'Delhi Police Head Constable', slug: 'delhi-police-hc', code: 'DPHC' },
  ];

  console.log('📝 Creating exams...');
  for (const exam of exams) {
    await prisma.exam.upsert({
      where: { code: exam.code },
      update: { isActive: true },
      create: exam,
    });
    console.log(`  ✓ ${exam.name}`);
  }

  // ============================================
  // 2. CREATE SUBJECTS FOR EACH EXAM
  // ============================================
  const subjectData = {
    CGL: [
      { name: 'General Intelligence & Reasoning', slug: 'reasoning-cgl', description: 'Logical reasoning, analogies, series, coding-decoding' },
      { name: 'General Awareness', slug: 'ga-cgl', description: 'Current affairs, history, geography, polity, economy' },
      { name: 'Quantitative Aptitude', slug: 'quant-cgl', description: 'Arithmetic, algebra, geometry, trigonometry, data interpretation' },
      { name: 'English Comprehension', slug: 'english-cgl', description: 'Grammar, vocabulary, comprehension, cloze test' },
    ],
    CHSL: [
      { name: 'General Intelligence', slug: 'reasoning-chsl', description: 'Logical reasoning, analogies, series, coding-decoding' },
      { name: 'General Awareness', slug: 'ga-chsl', description: 'Current affairs, history, geography, polity, economy' },
      { name: 'Quantitative Aptitude', slug: 'quant-chsl', description: 'Arithmetic, algebra, geometry, data interpretation' },
      { name: 'English Language', slug: 'english-chsl', description: 'Grammar, vocabulary, comprehension, cloze test' },
    ],
    MTS: [
      { name: 'General Intelligence & Reasoning', slug: 'reasoning-mts', description: 'Logical reasoning, analogies, series, coding-decoding' },
      { name: 'General Awareness', slug: 'ga-mts', description: 'Current affairs, history, geography, polity, economy' },
      { name: 'Numerical Aptitude', slug: 'quant-mts', description: 'Basic arithmetic, percentages, ratios, averages' },
      { name: 'English Language', slug: 'english-mts', description: 'Basic grammar, vocabulary, comprehension' },
    ],
    GD: [
      { name: 'General Intelligence & Reasoning', slug: 'reasoning-gd', description: 'Logical reasoning, analogies, series, coding-decoding' },
      { name: 'General Knowledge & Awareness', slug: 'ga-gd', description: 'Current affairs, history, geography, polity, economy, sports' },
      { name: 'Elementary Mathematics', slug: 'quant-gd', description: 'Number systems, decimals, fractions, percentages, ratios' },
      { name: 'English/Hindi', slug: 'english-gd', description: 'Basic comprehension, grammar, vocabulary' },
    ],
    STENO: [
      { name: 'General Intelligence & Reasoning', slug: 'reasoning-steno', description: 'Logical reasoning, analogies, series, coding-decoding' },
      { name: 'General Awareness', slug: 'ga-steno', description: 'Current affairs, history, geography, polity, economy' },
      { name: 'English Language & Comprehension', slug: 'english-steno', description: 'Grammar, vocabulary, comprehension, précis writing' },
    ],
    CPO: [
      { name: 'General Intelligence & Reasoning', slug: 'reasoning-cpo', description: 'Logical reasoning, analogies, series, coding-decoding' },
      { name: 'General Knowledge & Awareness', slug: 'ga-cpo', description: 'Current affairs, history, geography, polity, economy' },
      { name: 'Quantitative Aptitude', slug: 'quant-cpo', description: 'Arithmetic, algebra, geometry, trigonometry, data interpretation' },
      { name: 'English Comprehension', slug: 'english-cpo', description: 'Grammar, vocabulary, comprehension, cloze test' },
    ],
    JE: [
      { name: 'General Intelligence & Reasoning', slug: 'reasoning-je', description: 'Logical reasoning, analogies, series, coding-decoding' },
      { name: 'General Awareness', slug: 'ga-je', description: 'Current affairs, history, geography, polity, economy' },
      { name: 'General Engineering (Civil/Mech/Elec)', slug: 'engineering-je', description: 'Engineering discipline specific' },
    ],
    SELECTION_POST: [
      { name: 'General Intelligence', slug: 'reasoning-sp', description: 'Logical reasoning, analogies, series, coding-decoding' },
      { name: 'General Awareness', slug: 'ga-sp', description: 'Current affairs, history, geography, polity, economy' },
      { name: 'Quantitative Aptitude', slug: 'quant-sp', description: 'Arithmetic, algebra, geometry, data interpretation' },
      { name: 'English Language', slug: 'english-sp', description: 'Grammar, vocabulary, comprehension, cloze test' },
    ],
    DPC: [
      { name: 'General Knowledge', slug: 'gk-dpc', description: 'Current affairs, history, geography, polity, economy' },
      { name: 'Reasoning', slug: 'reasoning-dpc', description: 'Logical reasoning, analogies, series, coding-decoding' },
      { name: 'Numerical Ability', slug: 'quant-dpc', description: 'Arithmetic, algebra, geometry, data interpretation' },
      { name: 'Computer Fundamentals', slug: 'computer-dpc', description: 'MS Office, Internet, Email, Basic computer knowledge' },
    ],
    DPHC: [
      { name: 'General Awareness', slug: 'ga-dphc', description: 'Current affairs, history, geography, polity, economy' },
      { name: 'Quantitative Aptitude', slug: 'quant-dphc', description: 'Arithmetic, algebra, geometry, data interpretation' },
      { name: 'General Intelligence', slug: 'reasoning-dphc', description: 'Logical reasoning, analogies, series, coding-decoding' },
      { name: 'English Language', slug: 'english-dphc', description: 'Grammar, vocabulary, comprehension' },
      { name: 'Computer Knowledge', slug: 'computer-dphc', description: 'MS Office, Internet, Email, Basic computer knowledge' },
    ],
  };

  console.log('\n📚 Creating subjects...');
  for (const [examCode, subjects] of Object.entries(subjectData)) {
    const exam = await prisma.exam.findUnique({ where: { code: examCode } });
    if (!exam) continue;
    
    for (const subject of subjects) {
      const created = await prisma.subject.upsert({
        where: { slug: subject.slug },
        update: {},
        create: {
          name: subject.name,
          slug: subject.slug,
          exams: { connect: { id: exam.id } },
        },
      });
      console.log(`  ✓ ${subject.name} (${examCode})`);
    }
  }

  // ============================================
  // 3. CREATE EXAM PATTERNS FOR EACH EXAM
  // ============================================
  console.log('\n📋 Creating exam patterns...');
  
  const patternData = {
    CGL: {
      tier1: {
        totalQuestions: 100,
        totalMarks: 200,
        durationMinutes: 60,
        negativeMarks: 0.5,
        sections: [
          { name: 'General Intelligence & Reasoning', subjectSlug: 'reasoning-cgl', questions: 25, marks: 50 },
          { name: 'General Awareness', subjectSlug: 'ga-cgl', questions: 25, marks: 50 },
          { name: 'Quantitative Aptitude', subjectSlug: 'quant-cgl', questions: 25, marks: 50 },
          { name: 'English Comprehension', subjectSlug: 'english-cgl', questions: 25, marks: 50 },
        ],
      },
      tier2: {
        totalQuestions: 150,
        totalMarks: 450,
        durationMinutes: 120,
        negativeMarks: 0.5,
        sections: [
          { name: 'Mathematical Abilities', subjectSlug: 'quant-cgl', questions: 30, marks: 90 },
          { name: 'Reasoning & General Intelligence', subjectSlug: 'reasoning-cgl', questions: 30, marks: 90 },
          { name: 'English Language & Comprehension', subjectSlug: 'english-cgl', questions: 45, marks: 135 },
          { name: 'General Awareness', subjectSlug: 'ga-cgl', questions: 25, marks: 75 },
          { name: 'Computer Knowledge', subjectSlug: 'computer-cgl', questions: 20, marks: 60 },
        ],
      },
    },
    CHSL: {
      tier1: {
        totalQuestions: 100,
        totalMarks: 200,
        durationMinutes: 60,
        negativeMarks: 0.5,
        sections: [
          { name: 'General Intelligence', subjectSlug: 'reasoning-chsl', questions: 25, marks: 50 },
          { name: 'General Awareness', subjectSlug: 'ga-chsl', questions: 25, marks: 50 },
          { name: 'Quantitative Aptitude', subjectSlug: 'quant-chsl', questions: 25, marks: 50 },
          { name: 'English Language', subjectSlug: 'english-chsl', questions: 25, marks: 50 },
        ],
      },
      tier2: {
        totalQuestions: 100,
        totalMarks: 200,
        durationMinutes: 60,
        negativeMarks: 0.5,
        sections: [
          { name: 'Mathematical Abilities', subjectSlug: 'quant-chsl', questions: 25, marks: 50 },
          { name: 'Reasoning & General Intelligence', subjectSlug: 'reasoning-chsl', questions: 25, marks: 50 },
          { name: 'English Language & Comprehension', subjectSlug: 'english-chsl', questions: 25, marks: 50 },
          { name: 'General Awareness', subjectSlug: 'ga-chsl', questions: 25, marks: 50 },
        ],
      },
    },
    MTS: {
      tier1: {
        totalQuestions: 90,
        totalMarks: 270,
        durationMinutes: 90,
        negativeMarks: 0.0, // No negative marking for MTS
        sections: [
          { name: 'General Intelligence & Reasoning', subjectSlug: 'reasoning-mts', questions: 20, marks: 60 },
          { name: 'General Awareness', subjectSlug: 'ga-mts', questions: 25, marks: 75 },
          { name: 'Numerical Aptitude', subjectSlug: 'quant-mts', questions: 20, marks: 60 },
          { name: 'English Language', subjectSlug: 'english-mts', questions: 25, marks: 75 },
        ],
      },
    },
    GD: {
      tier1: {
        totalQuestions: 80,
        totalMarks: 160,
        durationMinutes: 60,
        negativeMarks: 0.25,
        sections: [
          { name: 'General Intelligence & Reasoning', subjectSlug: 'reasoning-gd', questions: 20, marks: 40 },
          { name: 'General Knowledge & Awareness', subjectSlug: 'ga-gd', questions: 20, marks: 40 },
          { name: 'Elementary Mathematics', subjectSlug: 'quant-gd', questions: 20, marks: 40 },
          { name: 'English/Hindi', subjectSlug: 'english-gd', questions: 20, marks: 40 },
        ],
      },
    },
    STENO: {
      tier1: {
        totalQuestions: 200,
        totalMarks: 200,
        durationMinutes: 120,
        negativeMarks: 0.25,
        sections: [
          { name: 'General Intelligence & Reasoning', subjectSlug: 'reasoning-steno', questions: 50, marks: 50 },
          { name: 'General Awareness', subjectSlug: 'ga-steno', questions: 50, marks: 50 },
          { name: 'English Language & Comprehension', subjectSlug: 'english-steno', questions: 100, marks: 100 },
        ],
      },
    },
    CPO: {
      paper1: {
        totalQuestions: 200,
        totalMarks: 200,
        durationMinutes: 120,
        negativeMarks: 0.25,
        sections: [
          { name: 'General Intelligence & Reasoning', subjectSlug: 'reasoning-cpo', questions: 50, marks: 50 },
          { name: 'General Knowledge & Awareness', subjectSlug: 'ga-cpo', questions: 50, marks: 50 },
          { name: 'Quantitative Aptitude', subjectSlug: 'quant-cpo', questions: 50, marks: 50 },
          { name: 'English Comprehension', subjectSlug: 'english-cpo', questions: 50, marks: 50 },
        ],
      },
      paper2: {
        totalQuestions: 200,
        totalMarks: 200,
        durationMinutes: 120,
        negativeMarks: 0.25,
        sections: [
          { name: 'English Language & Comprehension', subjectSlug: 'english-cpo', questions: 200, marks: 200 },
        ],
      },
    },
    JE: {
      paper1: {
        totalQuestions: 200,
        totalMarks: 200,
        durationMinutes: 120,
        negativeMarks: 0.25,
        sections: [
          { name: 'General Intelligence & Reasoning', subjectSlug: 'reasoning-je', questions: 50, marks: 50 },
          { name: 'General Awareness', subjectSlug: 'ga-je', questions: 50, marks: 50 },
          { name: 'General Engineering', subjectSlug: 'engineering-je', questions: 100, marks: 100 },
        ],
      },
    },
    SELECTION_POST: {
      phase1: {
        totalQuestions: 100,
        totalMarks: 200,
        durationMinutes: 60,
        negativeMarks: 0.5,
        sections: [
          { name: 'General Intelligence', subjectSlug: 'reasoning-sp', questions: 25, marks: 50 },
          { name: 'General Awareness', subjectSlug: 'ga-sp', questions: 25, marks: 50 },
          { name: 'Quantitative Aptitude', subjectSlug: 'quant-sp', questions: 25, marks: 50 },
          { name: 'English Language', subjectSlug: 'english-sp', questions: 25, marks: 50 },
        ],
      },
    },
    DPC: {
      tier1: {
        totalQuestions: 100,
        totalMarks: 200,
        durationMinutes: 90,
        negativeMarks: 0.25,
        sections: [
          { name: 'General Knowledge', subjectSlug: 'gk-dpc', questions: 25, marks: 50 },
          { name: 'Reasoning', subjectSlug: 'reasoning-dpc', questions: 25, marks: 50 },
          { name: 'Numerical Ability', subjectSlug: 'quant-dpc', questions: 25, marks: 50 },
          { name: 'Computer Fundamentals', subjectSlug: 'computer-dpc', questions: 25, marks: 50 },
        ],
      },
    },
    DPHC: {
      tier1: {
        totalQuestions: 100,
        totalMarks: 200,
        durationMinutes: 90,
        negativeMarks: 0.25,
        sections: [
          { name: 'General Awareness', subjectSlug: 'ga-dphc', questions: 20, marks: 40 },
          { name: 'Quantitative Aptitude', subjectSlug: 'quant-dphc', questions: 20, marks: 40 },
          { name: 'General Intelligence', subjectSlug: 'reasoning-dphc', questions: 20, marks: 40 },
          { name: 'English Language', subjectSlug: 'english-dphc', questions: 20, marks: 40 },
          { name: 'Computer Knowledge', subjectSlug: 'computer-dphc', questions: 20, marks: 40 },
        ],
      },
    },
  };

  for (const [examCode, patterns] of Object.entries(patternData)) {
    const exam = await prisma.exam.findUnique({ where: { code: examCode } });
    if (!exam) continue;

    for (const [tierName, pattern] of Object.entries(patterns)) {
      // Get subject IDs
      const subjects = await prisma.subject.findMany({
        where: { slug: { in: pattern.sections.map(s => s.subjectSlug) } },
      });
      const subjectMap = new Map(subjects.map(s => [s.slug, s.id]));
      
      const sections = pattern.sections.map(s => ({
        ...s,
        subjectId: subjectMap.get(s.subjectSlug),
      })).filter(s => s.subjectId);

      await prisma.examPattern.upsert({
        where: { 
          examId_name: { 
            examId: exam.id, 
            name: `${exam.name} - ${tierName.toUpperCase()}` 
          } 
        } as any,
        update: { isActive: true },
        create: {
          examId: exam.id,
          name: `${exam.name} - ${tierName.toUpperCase()}`,
          totalQuestions: pattern.totalQuestions,
          totalMarks: pattern.totalMarks,
          durationMinutes: pattern.durationMinutes,
          negativeMarks: pattern.negativeMarks,
          sections,
          isActive: true,
        },
      });
      console.log(`  ✓ ${exam.name} - ${tierName}`);
    }
  }

  // ============================================
  // 4. CREATE CHAPTERS FOR KEY SUBJECTS
  // ============================================
  console.log('\n📖 Creating chapters...');
  
  const chapterData = {
    // Reasoning chapters
    'reasoning-cgl': [
      { name: 'Analogy', slug: 'analogy', description: 'Word/Number/Letter analogy questions' },
      { name: 'Classification', slug: 'classification', description: 'Odd one out questions' },
      { name: 'Series Completion', slug: 'series', description: 'Number/Letter series completion' },
      { name: 'Coding-Decoding', slug: 'coding-decoding', description: 'Letter/Number coding and decoding' },
      { name: 'Blood Relations', slug: 'blood-relations', description: 'Family relationship puzzles' },
      { name: 'Direction Sense', slug: 'direction-sense', description: 'Direction and distance problems' },
      { name: 'Seating Arrangement', slug: 'seating-arrangement', description: 'Linear and circular arrangements' },
      { name: 'Puzzle Test', slug: 'puzzle-test', description: 'Complex logical puzzles' },
      { name: 'Syllogism', slug: 'syllogism', description: 'Logical deduction from statements' },
      { name: 'Statement-Assumption', slug: 'statement-assumption', description: 'Implicit assumption identification' },
      { name: 'Statement-Conclusion', slug: 'statement-conclusion', description: 'Valid conclusion identification' },
      { name: 'Statement-Argument', slug: 'statement-argument', description: 'Strong/weak argument identification' },
      { name: 'Mirror Images', slug: 'mirror-images', description: 'Mirror image recognition' },
      { name: 'Water Images', slug: 'water-images', description: 'Water image recognition' },
      { name: 'Paper Folding/Cutting', slug: 'paper-folding', description: 'Paper folding and cutting patterns' },
      { name: 'Figure Completion', slug: 'figure-completion', description: 'Complete the figure pattern' },
      { name: 'Embedded Figures', slug: 'embedded-figures', description: 'Find embedded figure' },
      { name: 'Counting Figures', slug: 'counting-figures', description: 'Count triangles/squares/rectangles' },
    ],
    'reasoning-chsl': [
      { name: 'Analogy', slug: 'analogy', description: 'Word/Number/Letter analogy questions' },
      { name: 'Classification', slug: 'classification', description: 'Odd one out questions' },
      { name: 'Series Completion', slug: 'series', description: 'Number/Letter series completion' },
      { name: 'Coding-Decoding', slug: 'coding-decoding', description: 'Letter/Number coding and decoding' },
      { name: 'Blood Relations', slug: 'blood-relations', description: 'Family relationship puzzles' },
      { name: 'Direction Sense', slug: 'direction-sense', description: 'Direction and distance problems' },
      { name: 'Seating Arrangement', slug: 'seating-arrangement', description: 'Linear and circular arrangements' },
      { name: 'Syllogism', slug: 'syllogism', description: 'Logical deduction from statements' },
      { name: 'Mirror Images', slug: 'mirror-images', description: 'Mirror image recognition' },
      { name: 'Water Images', slug: 'water-images', description: 'Water image recognition' },
      { name: 'Paper Folding/Cutting', slug: 'paper-folding', description: 'Paper folding and cutting patterns' },
    ],
    'reasoning-mts': [
      { name: 'Analogy', slug: 'analogy', description: 'Word/Number/Letter analogy questions' },
      { name: 'Classification', slug: 'classification', description: 'Odd one out questions' },
      { name: 'Series', slug: 'series', description: 'Number/Letter series completion' },
      { name: 'Coding-Decoding', slug: 'coding-decoding', description: 'Letter/Number coding and decoding' },
      { name: 'Blood Relations', slug: 'blood-relations', description: 'Family relationship puzzles' },
      { name: 'Direction Sense', slug: 'direction-sense', description: 'Direction and distance problems' },
      { name: 'Mirror Images', slug: 'mirror-images', description: 'Mirror image recognition' },
    ],
    'reasoning-gd': [
      { name: 'Analogy', slug: 'analogy', description: 'Word/Number/Letter analogy questions' },
      { name: 'Classification', slug: 'classification', description: 'Odd one out questions' },
      { name: 'Series', slug: 'series', description: 'Number/Letter series completion' },
      { name: 'Coding-Decoding', slug: 'coding-decoding', description: 'Letter/Number coding and decoding' },
      { name: 'Mirror Images', slug: 'mirror-images', description: 'Mirror image recognition' },
      { name: 'Water Images', slug: 'water-images', description: 'Water image recognition' },
    ],
    // Quant chapters
    'quant-cgl': [
      { name: 'Number System', slug: 'number-system', description: 'Divisibility, LCM, HCF, remainders' },
      { name: 'Simplification', slug: 'simplification', description: 'BODMAS, fractions, decimals' },
      { name: 'Percentage', slug: 'percentage', description: 'Basic percentage, profit/loss, discount' },
      { name: 'Ratio & Proportion', slug: 'ratio-proportion', description: 'Ratio, proportion, variation' },
      { name: 'Average', slug: 'average', description: 'Mean, weighted average, age problems' },
      { name: 'Time & Work', slug: 'time-work', description: 'Work efficiency, pipes & cisterns' },
      { name: 'Time, Speed & Distance', slug: 'time-speed-distance', description: 'Trains, boats, races, relative speed' },
      { name: 'Simple & Compound Interest', slug: 'interest', description: 'SI, CI, installments' },
      { name: 'Profit & Loss', slug: 'profit-loss', description: 'CP, SP, profit%, loss%, discount%' },
      { name: 'Partnership', slug: 'partnership', description: 'Profit sharing, working/sleeping partners' },
      { name: 'Mixture & Alligation', slug: 'mixture-alligation', description: 'Mixtures, replacements, alligation' },
      { name: 'Algebra', slug: 'algebra', description: 'Linear/quadratic equations, identities' },
      { name: 'Geometry', slug: 'geometry', description: 'Lines, angles, triangles, circles, quadrilaterals' },
      { name: 'Mensuration 2D', slug: 'mensuration-2d', description: 'Area, perimeter of 2D shapes' },
      { name: 'Mensuration 3D', slug: 'mensuration-3d', description: 'Volume, surface area of 3D shapes' },
      { name: 'Trigonometry', slug: 'trigonometry', description: 'Trigonometric ratios, identities, heights & distances' },
      { name: 'Coordinate Geometry', slug: 'coordinate-geometry', description: 'Distance, section formula, area' },
      { name: 'Data Interpretation', slug: 'data-interpretation', description: 'Tables, bar graphs, line graphs, pie charts' },
    ],
    'quant-chsl': [
      { name: 'Number System', slug: 'number-system', description: 'Divisibility, LCM, HCF, remainders' },
      { name: 'Simplification', slug: 'simplification', description: 'BODMAS, fractions, decimals' },
      { name: 'Percentage', slug: 'percentage', description: 'Basic percentage, profit/loss, discount' },
      { name: 'Ratio & Proportion', slug: 'ratio-proportion', description: 'Ratio, proportion, variation' },
      { name: 'Average', slug: 'average', description: 'Mean, weighted average, age problems' },
      { name: 'Time & Work', slug: 'time-work', description: 'Work efficiency, pipes & cisterns' },
      { name: 'Time, Speed & Distance', slug: 'time-speed-distance', description: 'Trains, boats, races, relative speed' },
      { name: 'Simple & Compound Interest', slug: 'interest', description: 'SI, CI, installments' },
      { name: 'Profit & Loss', slug: 'profit-loss', description: 'CP, SP, profit%, loss%, discount%' },
      { name: 'Geometry', slug: 'geometry', description: 'Lines, angles, triangles, circles' },
      { name: 'Mensuration', slug: 'mensuration', description: 'Area, perimeter, volume, surface area' },
      { name: 'Data Interpretation', slug: 'data-interpretation', description: 'Tables, bar graphs, line graphs, pie charts' },
    ],
    'quant-mts': [
      { name: 'Number System', slug: 'number-system', description: 'Basic number operations' },
      { name: 'Simplification', slug: 'simplification', description: 'BODMAS, fractions, decimals' },
      { name: 'Percentage', slug: 'percentage', description: 'Basic percentage calculations' },
      { name: 'Ratio & Proportion', slug: 'ratio-proportion', description: 'Basic ratio and proportion' },
      { name: 'Average', slug: 'average', description: 'Simple average problems' },
      { name: 'Time & Work', slug: 'time-work', description: 'Basic work problems' },
      { name: 'Time & Distance', slug: 'time-distance', description: 'Speed, distance, time basics' },
      { name: 'Profit & Loss', slug: 'profit-loss', description: 'Basic profit and loss' },
      { name: 'Simple Interest', slug: 'simple-interest', description: 'Simple interest calculations' },
      { name: 'Mensuration', slug: 'mensuration', description: 'Area, perimeter basics' },
    ],
    'quant-gd': [
      { name: 'Number System', slug: 'number-system', description: 'Integers, fractions, decimals' },
      { name: 'Simplification', slug: 'simplification', description: 'BODMAS rule' },
      { name: 'Percentage', slug: 'percentage', description: 'Basic percentage' },
      { name: 'Ratio & Proportion', slug: 'ratio-proportion', description: 'Ratio and proportion' },
      { name: 'Average', slug: 'average', description: 'Simple average' },
      { name: 'Time & Work', slug: 'time-work', description: 'Work problems' },
      { name: 'Profit & Loss', slug: 'profit-loss', description: 'Profit and loss basics' },
      { name: 'Simple Interest', slug: 'simple-interest', description: 'Simple interest' },
      { name: 'Mensuration', slug: 'mensuration', description: 'Area, perimeter' },
    ],
    // English chapters
    'english-cgl': [
      { name: 'Spot the Error', slug: 'spot-error', description: 'Grammar error detection' },
      { name: 'Fill in the Blanks', slug: 'fill-blanks', description: 'Vocabulary and grammar fill-ups' },
      { name: 'Synonyms', slug: 'synonyms', description: 'Similar meaning words' },
      { name: 'Antonyms', slug: 'antonyms', description: 'Opposite meaning words' },
      { name: 'Spelling Check', slug: 'spelling', description: 'Correct/incorrect spelling identification' },
      { name: 'Idioms & Phrases', slug: 'idioms-phrases', description: 'Common idioms and phrases' },
      { name: 'One Word Substitution', slug: 'one-word-sub', description: 'Single word for phrase' },
      { name: 'Sentence Improvement', slug: 'sentence-improvement', description: 'Better sentence construction' },
      { name: 'Active/Passive Voice', slug: 'active-passive', description: 'Voice transformation' },
      { name: 'Direct/Indirect Speech', slug: 'direct-indirect', description: 'Speech transformation' },
      { name: 'Cloze Test', slug: 'cloze-test', description: 'Passage with blanks' },
      { name: 'Reading Comprehension', slug: 'reading-comprehension', description: 'Passage based questions' },
      { name: 'Para Jumbles', slug: 'para-jumbles', description: 'Sentence rearrangement' },
    ],
    'english-chsl': [
      { name: 'Spot the Error', slug: 'spot-error', description: 'Grammar error detection' },
      { name: 'Fill in the Blanks', slug: 'fill-blanks', description: 'Vocabulary and grammar fill-ups' },
      { name: 'Synonyms', slug: 'synonyms', description: 'Similar meaning words' },
      { name: 'Antonyms', slug: 'antonyms', description: 'Opposite meaning words' },
      { name: 'Spelling Check', slug: 'spelling', description: 'Correct/incorrect spelling' },
      { name: 'Idioms & Phrases', slug: 'idioms-phrases', description: 'Common idioms and phrases' },
      { name: 'One Word Substitution', slug: 'one-word-sub', description: 'Single word for phrase' },
      { name: 'Sentence Improvement', slug: 'sentence-improvement', description: 'Better sentence construction' },
      { name: 'Active/Passive Voice', slug: 'active-passive', description: 'Voice transformation' },
      { name: 'Direct/Indirect Speech', slug: 'direct-indirect', description: 'Speech transformation' },
      { name: 'Cloze Test', slug: 'cloze-test', description: 'Passage with blanks' },
      { name: 'Reading Comprehension', slug: 'reading-comprehension', description: 'Passage based questions' },
    ],
    // GA chapters
    'ga-cgl': [
      { name: 'History', slug: 'history', description: 'Ancient, Medieval, Modern Indian History' },
      { name: 'Geography', slug: 'geography', description: 'Physical, Indian, World Geography' },
      { name: 'Polity', slug: 'polity', description: 'Constitution, Parliament, Judiciary' },
      { name: 'Economy', slug: 'economy', description: 'Indian Economy, Budget, Banking' },
      { name: 'Science', slug: 'science', description: 'Physics, Chemistry, Biology basics' },
      { name: 'Current Affairs', slug: 'current-affairs', description: 'National/International events' },
      { name: 'Static GK', slug: 'static-gk', description: 'Awards, Books, Sports, Important Days' },
    ],
    // DPC chapters
    'gk-dpc': [
      { name: 'History', slug: 'history', description: 'Ancient, Medieval, Modern Indian History' },
      { name: 'Geography', slug: 'geography', description: 'Physical, Indian, World Geography' },
      { name: 'Polity', slug: 'polity', description: 'Constitution, Parliament, Judiciary' },
      { name: 'Economy', slug: 'economy', description: 'Indian Economy, Budget, Banking' },
      { name: 'Science', slug: 'science', description: 'Physics, Chemistry, Biology basics' },
      { name: 'Current Affairs', slug: 'current-affairs', description: 'National/International events' },
      { name: 'Static GK', slug: 'static-gk', description: 'Awards, Books, Sports, Important Days' },
    ],
    'reasoning-dpc': [
      { name: 'Analogy', slug: 'analogy', description: 'Word/Number/Letter analogy questions' },
      { name: 'Classification', slug: 'classification', description: 'Odd one out questions' },
      { name: 'Series Completion', slug: 'series', description: 'Number/Letter series completion' },
      { name: 'Coding-Decoding', slug: 'coding-decoding', description: 'Letter/Number coding and decoding' },
      { name: 'Blood Relations', slug: 'blood-relations', description: 'Family relationship puzzles' },
      { name: 'Direction Sense', slug: 'direction-sense', description: 'Direction and distance problems' },
      { name: 'Syllogism', slug: 'syllogism', description: 'Logical deduction from statements' },
      { name: 'Mirror Images', slug: 'mirror-images', description: 'Mirror image recognition' },
      { name: 'Water Images', slug: 'water-images', description: 'Water image recognition' },
      { name: 'Paper Folding/Cutting', slug: 'paper-folding', description: 'Paper folding and cutting patterns' },
    ],
    'quant-dpc': [
      { name: 'Number System', slug: 'number-system', description: 'Divisibility, LCM, HCF, remainders' },
      { name: 'Simplification', slug: 'simplification', description: 'BODMAS, fractions, decimals' },
      { name: 'Percentage', slug: 'percentage', description: 'Basic percentage, profit/loss, discount' },
      { name: 'Ratio & Proportion', slug: 'ratio-proportion', description: 'Ratio, proportion, variation' },
      { name: 'Average', slug: 'average', description: 'Mean, weighted average, age problems' },
      { name: 'Time & Work', slug: 'time-work', description: 'Work efficiency, pipes & cisterns' },
      { name: 'Time, Speed & Distance', slug: 'time-speed-distance', description: 'Trains, boats, races, relative speed' },
      { name: 'Simple & Compound Interest', slug: 'interest', description: 'SI, CI, installments' },
      { name: 'Profit & Loss', slug: 'profit-loss', description: 'CP, SP, profit%, loss%, discount%' },
      { name: 'Geometry', slug: 'geometry', description: 'Lines, angles, triangles, circles' },
      { name: 'Mensuration', slug: 'mensuration', description: 'Area, perimeter, volume, surface area' },
      { name: 'Data Interpretation', slug: 'data-interpretation', description: 'Tables, bar graphs, line graphs, pie charts' },
    ],
    'computer-dpc': [
      { name: 'MS Office', slug: 'ms-office', description: 'Word, Excel, PowerPoint basics' },
      { name: 'Internet & Email', slug: 'internet-email', description: 'Browsing, email, search engines' },
      { name: 'Computer Basics', slug: 'computer-basics', description: 'Hardware, software, OS basics' },
    ],
    // STENO chapters
    'reasoning-steno': [
      { name: 'Analogy', slug: 'analogy', description: 'Word/Number/Letter analogy questions' },
      { name: 'Classification', slug: 'classification', description: 'Odd one out questions' },
      { name: 'Series Completion', slug: 'series', description: 'Number/Letter series completion' },
      { name: 'Coding-Decoding', slug: 'coding-decoding', description: 'Letter/Number coding and decoding' },
      { name: 'Blood Relations', slug: 'blood-relations', description: 'Family relationship puzzles' },
      { name: 'Direction Sense', slug: 'direction-sense', description: 'Direction and distance problems' },
      { name: 'Seating Arrangement', slug: 'seating-arrangement', description: 'Linear and circular arrangements' },
      { name: 'Syllogism', slug: 'syllogism', description: 'Logical deduction from statements' },
      { name: 'Mirror Images', slug: 'mirror-images', description: 'Mirror image recognition' },
      { name: 'Water Images', slug: 'water-images', description: 'Water image recognition' },
    ],
    'ga-steno': [
      { name: 'History', slug: 'history', description: 'Ancient, Medieval, Modern Indian History' },
      { name: 'Geography', slug: 'geography', description: 'Physical, Indian, World Geography' },
      { name: 'Polity', slug: 'polity', description: 'Constitution, Parliament, Judiciary' },
      { name: 'Economy', slug: 'economy', description: 'Indian Economy, Budget, Banking' },
      { name: 'Science', slug: 'science', description: 'Physics, Chemistry, Biology basics' },
      { name: 'Current Affairs', slug: 'current-affairs', description: 'National/International events' },
      { name: 'Static GK', slug: 'static-gk', description: 'Awards, Books, Sports, Important Days' },
    ],
    'english-steno': [
      { name: 'Spot the Error', slug: 'spot-error', description: 'Grammar error detection' },
      { name: 'Fill in the Blanks', slug: 'fill-blanks', description: 'Vocabulary and grammar fill-ups' },
      { name: 'Synonyms', slug: 'synonyms', description: 'Similar meaning words' },
      { name: 'Antonyms', slug: 'antonyms', description: 'Opposite meaning words' },
      { name: 'Spelling Check', slug: 'spelling', description: 'Correct/incorrect spelling identification' },
      { name: 'Idioms & Phrases', slug: 'idioms-phrases', description: 'Common idioms and phrases' },
      { name: 'One Word Substitution', slug: 'one-word-sub', description: 'Single word for phrase' },
      { name: 'Sentence Improvement', slug: 'sentence-improvement', description: 'Better sentence construction' },
      { name: 'Active/Passive Voice', slug: 'active-passive', description: 'Voice transformation' },
      { name: 'Direct/Indirect Speech', slug: 'direct-indirect', description: 'Speech transformation' },
      { name: 'Cloze Test', slug: 'cloze-test', description: 'Passage with blanks' },
      { name: 'Reading Comprehension', slug: 'reading-comprehension', description: 'Passage based questions' },
      { name: 'Para Jumbles', slug: 'para-jumbles', description: 'Sentence rearrangement' },
    ],
    // CPO chapters
    'reasoning-cpo': [
      { name: 'Analogy', slug: 'analogy', description: 'Word/Number/Letter analogy questions' },
      { name: 'Classification', slug: 'classification', description: 'Odd one out questions' },
      { name: 'Series Completion', slug: 'series', description: 'Number/Letter series completion' },
      { name: 'Coding-Decoding', slug: 'coding-decoding', description: 'Letter/Number coding and decoding' },
      { name: 'Blood Relations', slug: 'blood-relations', description: 'Family relationship puzzles' },
      { name: 'Direction Sense', slug: 'direction-sense', description: 'Direction and distance problems' },
      { name: 'Seating Arrangement', slug: 'seating-arrangement', description: 'Linear and circular arrangements' },
      { name: 'Syllogism', slug: 'syllogism', description: 'Logical deduction from statements' },
      { name: 'Mirror Images', slug: 'mirror-images', description: 'Mirror image recognition' },
      { name: 'Water Images', slug: 'water-images', description: 'Water image recognition' },
    ],
    'ga-cpo': [
      { name: 'History', slug: 'history', description: 'Ancient, Medieval, Modern Indian History' },
      { name: 'Geography', slug: 'geography', description: 'Physical, Indian, World Geography' },
      { name: 'Polity', slug: 'polity', description: 'Constitution, Parliament, Judiciary' },
      { name: 'Economy', slug: 'economy', description: 'Indian Economy, Budget, Banking' },
      { name: 'Science', slug: 'science', description: 'Physics, Chemistry, Biology basics' },
      { name: 'Current Affairs', slug: 'current-affairs', description: 'National/International events' },
      { name: 'Static GK', slug: 'static-gk', description: 'Awards, Books, Sports, Important Days' },
    ],
    'quant-cpo': [
      { name: 'Number System', slug: 'number-system', description: 'Divisibility, LCM, HCF, remainders' },
      { name: 'Simplification', slug: 'simplification', description: 'BODMAS, fractions, decimals' },
      { name: 'Percentage', slug: 'percentage', description: 'Basic percentage, profit/loss, discount' },
      { name: 'Ratio & Proportion', slug: 'ratio-proportion', description: 'Ratio, proportion, variation' },
      { name: 'Average', slug: 'average', description: 'Mean, weighted average, age problems' },
      { name: 'Time & Work', slug: 'time-work', description: 'Work efficiency, pipes & cisterns' },
      { name: 'Time, Speed & Distance', slug: 'time-speed-distance', description: 'Trains, boats, races, relative speed' },
      { name: 'Simple & Compound Interest', slug: 'interest', description: 'SI, CI, installments' },
      { name: 'Profit & Loss', slug: 'profit-loss', description: 'CP, SP, profit%, loss%, discount%' },
      { name: 'Geometry', slug: 'geometry', description: 'Lines, angles, triangles, circles' },
      { name: 'Mensuration', slug: 'mensuration', description: 'Area, perimeter, volume, surface area' },
      { name: 'Data Interpretation', slug: 'data-interpretation', description: 'Tables, bar graphs, line graphs, pie charts' },
    ],
    'english-cpo': [
      { name: 'Spot the Error', slug: 'spot-error', description: 'Grammar error detection' },
      { name: 'Fill in the Blanks', slug: 'fill-blanks', description: 'Vocabulary and grammar fill-ups' },
      { name: 'Synonyms', slug: 'synonyms', description: 'Similar meaning words' },
      { name: 'Antonyms', slug: 'antonyms', description: 'Opposite meaning words' },
      { name: 'Spelling Check', slug: 'spelling', description: 'Correct/incorrect spelling identification' },
      { name: 'Idioms & Phrases', slug: 'idioms-phrases', description: 'Common idioms and phrases' },
      { name: 'One Word Substitution', slug: 'one-word-sub', description: 'Single word for phrase' },
      { name: 'Sentence Improvement', slug: 'sentence-improvement', description: 'Better sentence construction' },
      { name: 'Active/Passive Voice', slug: 'active-passive', description: 'Voice transformation' },
      { name: 'Direct/Indirect Speech', slug: 'direct-indirect', description: 'Speech transformation' },
      { name: 'Cloze Test', slug: 'cloze-test', description: 'Passage with blanks' },
      { name: 'Reading Comprehension', slug: 'reading-comprehension', description: 'Passage based questions' },
    ],
    // JE chapters
    'reasoning-je': [
      { name: 'Analogy', slug: 'analogy', description: 'Word/Number/Letter analogy questions' },
      { name: 'Classification', slug: 'classification', description: 'Odd one out questions' },
      { name: 'Series Completion', slug: 'series', description: 'Number/Letter series completion' },
      { name: 'Coding-Decoding', slug: 'coding-decoding', description: 'Letter/Number coding and decoding' },
      { name: 'Blood Relations', slug: 'blood-relations', description: 'Family relationship puzzles' },
      { name: 'Direction Sense', slug: 'direction-sense', description: 'Direction and distance problems' },
      { name: 'Syllogism', slug: 'syllogism', description: 'Logical deduction from statements' },
    ],
    'ga-je': [
      { name: 'History', slug: 'history', description: 'Ancient, Medieval, Modern Indian History' },
      { name: 'Geography', slug: 'geography', description: 'Physical, Indian, World Geography' },
      { name: 'Polity', slug: 'polity', description: 'Constitution, Parliament, Judiciary' },
      { name: 'Economy', slug: 'economy', description: 'Indian Economy, Budget, Banking' },
      { name: 'Science', slug: 'science', description: 'Physics, Chemistry, Biology basics' },
      { name: 'Current Affairs', slug: 'current-affairs', description: 'National/International events' },
      { name: 'Static GK', slug: 'static-gk', description: 'Awards, Books, Sports, Important Days' },
    ],
    'engineering-je': [
      { name: 'Civil Engineering', slug: 'civil-engineering', description: 'Civil engineering topics' },
      { name: 'Mechanical Engineering', slug: 'mechanical-engineering', description: 'Mechanical engineering topics' },
      { name: 'Electrical Engineering', slug: 'electrical-engineering', description: 'Electrical engineering topics' },
    ],
    // Selection Post chapters
    'reasoning-sp': [
      { name: 'Analogy', slug: 'analogy', description: 'Word/Number/Letter analogy questions' },
      { name: 'Classification', slug: 'classification', description: 'Odd one out questions' },
      { name: 'Series Completion', slug: 'series', description: 'Number/Letter series completion' },
      { name: 'Coding-Decoding', slug: 'coding-decoding', description: 'Letter/Number coding and decoding' },
      { name: 'Blood Relations', slug: 'blood-relations', description: 'Family relationship puzzles' },
      { name: 'Direction Sense', slug: 'direction-sense', description: 'Direction and distance problems' },
      { name: 'Syllogism', slug: 'syllogism', description: 'Logical deduction from statements' },
      { name: 'Mirror Images', slug: 'mirror-images', description: 'Mirror image recognition' },
    ],
    'ga-sp': [
      { name: 'History', slug: 'history', description: 'Ancient, Medieval, Modern Indian History' },
      { name: 'Geography', slug: 'geography', description: 'Physical, Indian, World Geography' },
      { name: 'Polity', slug: 'polity', description: 'Constitution, Parliament, Judiciary' },
      { name: 'Economy', slug: 'economy', description: 'Indian Economy, Budget, Banking' },
      { name: 'Science', slug: 'science', description: 'Physics, Chemistry, Biology basics' },
      { name: 'Current Affairs', slug: 'current-affairs', description: 'National/International events' },
      { name: 'Static GK', slug: 'static-gk', description: 'Awards, Books, Sports, Important Days' },
    ],
    'quant-sp': [
      { name: 'Number System', slug: 'number-system', description: 'Divisibility, LCM, HCF, remainders' },
      { name: 'Simplification', slug: 'simplification', description: 'BODMAS, fractions, decimals' },
      { name: 'Percentage', slug: 'percentage', description: 'Basic percentage, profit/loss, discount' },
      { name: 'Ratio & Proportion', slug: 'ratio-proportion', description: 'Ratio, proportion, variation' },
      { name: 'Average', slug: 'average', description: 'Mean, weighted average, age problems' },
      { name: 'Time & Work', slug: 'time-work', description: 'Work efficiency, pipes & cisterns' },
      { name: 'Time, Speed & Distance', slug: 'time-speed-distance', description: 'Trains, boats, races, relative speed' },
      { name: 'Simple & Compound Interest', slug: 'interest', description: 'SI, CI, installments' },
      { name: 'Profit & Loss', slug: 'profit-loss', description: 'CP, SP, profit%, loss%, discount%' },
      { name: 'Geometry', slug: 'geometry', description: 'Lines, angles, triangles, circles' },
      { name: 'Mensuration', slug: 'mensuration', description: 'Area, perimeter, volume, surface area' },
      { name: 'Data Interpretation', slug: 'data-interpretation', description: 'Tables, bar graphs, line graphs, pie charts' },
    ],
    'english-sp': [
      { name: 'Spot the Error', slug: 'spot-error', description: 'Grammar error detection' },
      { name: 'Fill in the Blanks', slug: 'fill-blanks', description: 'Vocabulary and grammar fill-ups' },
      { name: 'Synonyms', slug: 'synonyms', description: 'Similar meaning words' },
      { name: 'Antonyms', slug: 'antonyms', description: 'Opposite meaning words' },
      { name: 'Spelling Check', slug: 'spelling', description: 'Correct/incorrect spelling identification' },
      { name: 'Idioms & Phrases', slug: 'idioms-phrases', description: 'Common idioms and phrases' },
      { name: 'One Word Substitution', slug: 'one-word-sub', description: 'Single word for phrase' },
      { name: 'Sentence Improvement', slug: 'sentence-improvement', description: 'Better sentence construction' },
      { name: 'Active/Passive Voice', slug: 'active-passive', description: 'Voice transformation' },
      { name: 'Direct/Indirect Speech', slug: 'direct-indirect', description: 'Speech transformation' },
      { name: 'Cloze Test', slug: 'cloze-test', description: 'Passage with blanks' },
      { name: 'Reading Comprehension', slug: 'reading-comprehension', description: 'Passage based questions' },
    ],
    // DPHC chapters
    'ga-dphc': [
      { name: 'History', slug: 'history', description: 'Ancient, Medieval, Modern Indian History' },
      { name: 'Geography', slug: 'geography', description: 'Physical, Indian, World Geography' },
      { name: 'Polity', slug: 'polity', description: 'Constitution, Parliament, Judiciary' },
      { name: 'Economy', slug: 'economy', description: 'Indian Economy, Budget, Banking' },
      { name: 'Science', slug: 'science', description: 'Physics, Chemistry, Biology basics' },
      { name: 'Current Affairs', slug: 'current-affairs', description: 'National/International events' },
      { name: 'Static GK', slug: 'static-gk', description: 'Awards, Books, Sports, Important Days' },
    ],
    'quant-dphc': [
      { name: 'Number System', slug: 'number-system', description: 'Divisibility, LCM, HCF, remainders' },
      { name: 'Simplification', slug: 'simplification', description: 'BODMAS, fractions, decimals' },
      { name: 'Percentage', slug: 'percentage', description: 'Basic percentage, profit/loss, discount' },
      { name: 'Ratio & Proportion', slug: 'ratio-proportion', description: 'Ratio, proportion, variation' },
      { name: 'Average', slug: 'average', description: 'Mean, weighted average, age problems' },
      { name: 'Time & Work', slug: 'time-work', description: 'Work efficiency, pipes & cisterns' },
      { name: 'Time, Speed & Distance', slug: 'time-speed-distance', description: 'Trains, boats, races, relative speed' },
      { name: 'Simple & Compound Interest', slug: 'interest', description: 'SI, CI, installments' },
      { name: 'Profit & Loss', slug: 'profit-loss', description: 'CP, SP, profit%, loss%, discount%' },
      { name: 'Geometry', slug: 'geometry', description: 'Lines, angles, triangles, circles' },
      { name: 'Mensuration', slug: 'mensuration', description: 'Area, perimeter, volume, surface area' },
      { name: 'Data Interpretation', slug: 'data-interpretation', description: 'Tables, bar graphs, line graphs, pie charts' },
    ],
    'reasoning-dphc': [
      { name: 'Analogy', slug: 'analogy', description: 'Word/Number/Letter analogy questions' },
      { name: 'Classification', slug: 'classification', description: 'Odd one out questions' },
      { name: 'Series Completion', slug: 'series', description: 'Number/Letter series completion' },
      { name: 'Coding-Decoding', slug: 'coding-decoding', description: 'Letter/Number coding and decoding' },
      { name: 'Blood Relations', slug: 'blood-relations', description: 'Family relationship puzzles' },
      { name: 'Direction Sense', slug: 'direction-sense', description: 'Direction and distance problems' },
      { name: 'Syllogism', slug: 'syllogism', description: 'Logical deduction from statements' },
      { name: 'Mirror Images', slug: 'mirror-images', description: 'Mirror image recognition' },
    ],
    'english-dphc': [
      { name: 'Spot the Error', slug: 'spot-error', description: 'Grammar error detection' },
      { name: 'Fill in the Blanks', slug: 'fill-blanks', description: 'Vocabulary and grammar fill-ups' },
      { name: 'Synonyms', slug: 'synonyms', description: 'Similar meaning words' },
      { name: 'Antonyms', slug: 'antonyms', description: 'Opposite meaning words' },
      { name: 'Spelling Check', slug: 'spelling', description: 'Correct/incorrect spelling identification' },
      { name: 'Idioms & Phrases', slug: 'idioms-phrases', description: 'Common idioms and phrases' },
      { name: 'One Word Substitution', slug: 'one-word-sub', description: 'Single word for phrase' },
      { name: 'Sentence Improvement', slug: 'sentence-improvement', description: 'Better sentence construction' },
      { name: 'Active/Passive Voice', slug: 'active-passive', description: 'Voice transformation' },
      { name: 'Direct/Indirect Speech', slug: 'direct-indirect', description: 'Speech transformation' },
      { name: 'Cloze Test', slug: 'cloze-test', description: 'Passage with blanks' },
      { name: 'Reading Comprehension', slug: 'reading-comprehension', description: 'Passage based questions' },
    ],
    'computer-dphc': [
      { name: 'MS Office', slug: 'ms-office', description: 'Word, Excel, PowerPoint basics' },
      { name: 'Internet & Email', slug: 'internet-email', description: 'Browsing, email, search engines' },
      { name: 'Computer Basics', slug: 'computer-basics', description: 'Hardware, software, OS basics' },
    ],
  };

  for (const [subjectSlug, chapters] of Object.entries(chapterData)) {
    const subject = await prisma.subject.findUnique({ where: { slug: subjectSlug } });
    if (!subject) continue;

    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i];
      await prisma.chapter.upsert({
        where: { subjectId_slug: { subjectId: subject.id, slug: chapter.slug } },
        update: {},
        create: {
          subjectId: subject.id,
          name: chapter.name,
          slug: chapter.slug,
        },
      });
      console.log(`  ✓ ${chapter.name} (${subjectSlug})`);
    }
  }

  // ============================================
  // 5. CREATE MOCK TEST TEMPLATES
  // ============================================
  console.log('\n🧪 Creating mock test templates...');
  
  const mockTemplates = [
    // CGL Mock Tests
    { examCode: 'CGL', type: 'FULL_MOCK', title: 'CGL Tier-1 Full Mock Test 1', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, isPremium: false },
    { examCode: 'CGL', type: 'FULL_MOCK', title: 'CGL Tier-1 Full Mock Test 2', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, isPremium: true },
    { examCode: 'CGL', type: 'FULL_MOCK', title: 'CGL Tier-1 Full Mock Test 3', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, isPremium: true },
    { examCode: 'CGL', type: 'FULL_MOCK', title: 'CGL Tier-2 Paper 1 Full Mock', durationMinutes: 120, totalQuestions: 150, totalMarks: 450, isPremium: true },
    { examCode: 'CGL', type: 'PREVIOUS_YEAR', title: 'CGL 2023 Tier-1 (Shift 1) Memory Based', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, isPremium: false },
    { examCode: 'CGL', type: 'PREVIOUS_YEAR', title: 'CGL 2023 Tier-1 (Shift 2) Memory Based', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, isPremium: false },
    { examCode: 'CGL', type: 'PREVIOUS_YEAR', title: 'CGL 2022 Tier-1 (Shift 1) Memory Based', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, isPremium: false },
    { examCode: 'CGL', type: 'PREVIOUS_YEAR', title: 'CGL 2022 Tier-1 (Shift 2) Memory Based', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, isPremium: false },
    { examCode: 'CGL', type: 'YEAR_WISE', title: 'CGL 2023 All Shifts Compilation', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, isPremium: true },
    { examCode: 'CGL', type: 'YEAR_WISE', title: 'CGL 2022 All Shifts Compilation', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, isPremium: true },
    { examCode: 'CGL', type: 'SHIFT_WISE', title: 'CGL Tier-1 Morning Shift Practice', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, isPremium: true },
    { examCode: 'CGL', type: 'SHIFT_WISE', title: 'CGL Tier-1 Evening Shift Practice', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, isPremium: true },
    { examCode: 'CGL', type: 'MINI_MOCK', title: 'CGL Reasoning Mini Mock', durationMinutes: 20, totalQuestions: 25, totalMarks: 50, isPremium: false },
    { examCode: 'CGL', type: 'MINI_MOCK', title: 'CGL Quant Mini Mock', durationMinutes: 25, totalQuestions: 25, totalMarks: 50, isPremium: false },
    { examCode: 'CGL', type: 'MINI_MOCK', title: 'CGL English Mini Mock', durationMinutes: 20, totalQuestions: 25, totalMarks: 50, isPremium: false },
    { examCode: 'CGL', type: 'MINI_MOCK', title: 'CGL GA Mini Mock', durationMinutes: 15, totalQuestions: 25, totalMarks: 50, isPremium: false },

    // CHSL Mock Tests
    { examCode: 'CHSL', type: 'FULL_MOCK', title: 'CHSL Tier-1 Full Mock Test 1', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, isPremium: false },
    { examCode: 'CHSL', type: 'FULL_MOCK', title: 'CHSL Tier-1 Full Mock Test 2', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, isPremium: true },
    { examCode: 'CHSL', type: 'PREVIOUS_YEAR', title: 'CHSL 2023 Tier-1 (Shift 1) Memory Based', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, isPremium: false },
    { examCode: 'CHSL', type: 'PREVIOUS_YEAR', title: 'CHSL 2023 Tier-1 (Shift 2) Memory Based', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, isPremium: false },
    { examCode: 'CHSL', type: 'PREVIOUS_YEAR', title: 'CHSL 2022 Tier-1 (Shift 1) Memory Based', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, isPremium: false },
    { examCode: 'CHSL', type: 'YEAR_WISE', title: 'CHSL 2023 All Shifts Compilation', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, isPremium: true },
    { examCode: 'CHSL', type: 'SHIFT_WISE', title: 'CHSL Tier-1 Morning Shift Practice', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, isPremium: true },
    { examCode: 'CHSL', type: 'MINI_MOCK', title: 'CHSL Reasoning Mini Mock', durationMinutes: 20, totalQuestions: 25, totalMarks: 50, isPremium: false },
    { examCode: 'CHSL', type: 'MINI_MOCK', title: 'CHSL Quant Mini Mock', durationMinutes: 25, totalQuestions: 25, totalMarks: 50, isPremium: false },

    // MTS Mock Tests
    { examCode: 'MTS', type: 'FULL_MOCK', title: 'MTS Full Mock Test 1', durationMinutes: 90, totalQuestions: 90, totalMarks: 270, isPremium: false },
    { examCode: 'MTS', type: 'FULL_MOCK', title: 'MTS Full Mock Test 2', durationMinutes: 90, totalQuestions: 90, totalMarks: 270, isPremium: true },
    { examCode: 'MTS', type: 'PREVIOUS_YEAR', title: 'MTS 2023 Memory Based', durationMinutes: 90, totalQuestions: 90, totalMarks: 270, isPremium: false },
    { examCode: 'MTS', type: 'PREVIOUS_YEAR', title: 'MTS 2022 Memory Based', durationMinutes: 90, totalQuestions: 90, totalMarks: 270, isPremium: false },
    { examCode: 'MTS', type: 'MINI_MOCK', title: 'MTS Reasoning Mini Mock', durationMinutes: 25, totalQuestions: 20, totalMarks: 60, isPremium: false },

    // GD Mock Tests
    { examCode: 'GD', type: 'FULL_MOCK', title: 'GD Constable Full Mock Test 1', durationMinutes: 60, totalQuestions: 80, totalMarks: 160, isPremium: false },
    { examCode: 'GD', type: 'FULL_MOCK', title: 'GD Constable Full Mock Test 2', durationMinutes: 60, totalQuestions: 80, totalMarks: 160, isPremium: true },
    { examCode: 'GD', type: 'PREVIOUS_YEAR', title: 'GD 2023 Memory Based', durationMinutes: 60, totalQuestions: 80, totalMarks: 160, isPremium: false },
    { examCode: 'GD', type: 'PREVIOUS_YEAR', title: 'GD 2022 Memory Based', durationMinutes: 60, totalQuestions: 80, totalMarks: 160, isPremium: false },
    { examCode: 'GD', type: 'MINI_MOCK', title: 'GD Reasoning Mini Mock', durationMinutes: 20, totalQuestions: 20, totalMarks: 40, isPremium: false },

    // Steno Mock Tests
    { examCode: 'STENO', type: 'FULL_MOCK', title: 'Stenographer Full Mock Test 1', durationMinutes: 120, totalQuestions: 200, totalMarks: 200, isPremium: false },
    { examCode: 'STENO', type: 'PREVIOUS_YEAR', title: 'Steno 2023 Memory Based', durationMinutes: 120, totalQuestions: 200, totalMarks: 200, isPremium: false },
    { examCode: 'STENO', type: 'MINI_MOCK', title: 'Steno English Mini Mock', durationMinutes: 40, totalQuestions: 50, totalMarks: 50, isPremium: false },

    // CPO Mock Tests
    { examCode: 'CPO', type: 'FULL_MOCK', title: 'CPO Paper-1 Full Mock Test 1', durationMinutes: 120, totalQuestions: 200, totalMarks: 200, isPremium: false },
    { examCode: 'CPO', type: 'FULL_MOCK', title: 'CPO Paper-1 Full Mock Test 2', durationMinutes: 120, totalQuestions: 200, totalMarks: 200, isPremium: true },
    { examCode: 'CPO', type: 'PREVIOUS_YEAR', title: 'CPO 2023 Paper-1 Memory Based', durationMinutes: 120, totalQuestions: 200, totalMarks: 200, isPremium: false },
    { examCode: 'CPO', type: 'PREVIOUS_YEAR', title: 'CPO 2022 Paper-1 Memory Based', durationMinutes: 120, totalQuestions: 200, totalMarks: 200, isPremium: false },

    // JE Mock Tests
    { examCode: 'JE', type: 'FULL_MOCK', title: 'JE Paper-1 Full Mock Test 1', durationMinutes: 120, totalQuestions: 200, totalMarks: 200, isPremium: false },
    { examCode: 'JE', type: 'PREVIOUS_YEAR', title: 'JE 2023 Paper-1 Memory Based', durationMinutes: 120, totalQuestions: 200, totalMarks: 200, isPremium: false },

    // Selection Post Mock Tests
    { examCode: 'SELECTION_POST', type: 'FULL_MOCK', title: 'Selection Post Phase-1 Full Mock 1', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, isPremium: false },
    { examCode: 'SELECTION_POST', type: 'PREVIOUS_YEAR', title: 'Selection Post 2023 Phase-1 Memory Based', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, isPremium: false },

    // Delhi Police Mock Tests
    { examCode: 'DPC', type: 'FULL_MOCK', title: 'Delhi Police Constable Full Mock 1', durationMinutes: 90, totalQuestions: 100, totalMarks: 200, isPremium: false },
    { examCode: 'DPC', type: 'PREVIOUS_YEAR', title: 'DPC 2023 Memory Based', durationMinutes: 90, totalQuestions: 100, totalMarks: 200, isPremium: false },
    { examCode: 'DPC', type: 'MINI_MOCK', title: 'DPC Computer Fundamentals Mini Mock', durationMinutes: 20, totalQuestions: 25, totalMarks: 50, isPremium: false },

    { examCode: 'DPHC', type: 'FULL_MOCK', title: 'Delhi Police HC Full Mock 1', durationMinutes: 90, totalQuestions: 100, totalMarks: 200, isPremium: false },
    { examCode: 'DPHC', type: 'PREVIOUS_YEAR', title: 'DPHC 2023 Memory Based', durationMinutes: 90, totalQuestions: 100, totalMarks: 200, isPremium: false },
    { examCode: 'DPHC', type: 'MINI_MOCK', title: 'DPHC Computer Knowledge Mini Mock', durationMinutes: 20, totalQuestions: 25, totalMarks: 50, isPremium: false },
  ];

  for (const template of mockTemplates) {
    const exam = await prisma.exam.findUnique({ where: { code: template.examCode } });
    if (!exam) continue;

    await prisma.testTemplate.upsert({
      where: { 
        examId_title: { 
          examId: exam.id, 
          title: template.title 
        } 
      } as any,
      update: { isActive: true, isPremium: template.isPremium },
      create: {
        examId: exam.id,
        title: template.title,
        type: template.type as TestType,
        durationMinutes: template.durationMinutes,
        totalQuestions: template.totalQuestions,
        totalMarks: template.totalMarks,
        isPremium: template.isPremium,
        description: `${template.type} for ${exam.name}`,
        isActive: true,
      },
    });
    console.log(`  ✓ ${template.title} (${template.examCode})`);
  }

  // ============================================
  // 6. CREATE ADMIN USER
  // ============================================
  console.log('\n👤 Creating admin user...');
  await prisma.user.upsert({
    where: { email: 'sachinbamniya0143@gmail.com' },
    update: { role: Role.ADMIN },
    create: {
      email: 'sachinbamniya0143@gmail.com',
      fullName: 'Admin Sachin',
      passwordHash: '$2b$10$dummy', // Will be set via proper auth
      role: Role.ADMIN,
      isEmailVerified: true,
    },
  });
  console.log('  ✓ Admin user created');

  console.log('\n✅ Comprehensive SSC exam data seeding completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });