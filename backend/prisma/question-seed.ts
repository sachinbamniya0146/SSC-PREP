import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Realistic SSC questions organized by exam, subject, chapter, year
const questionsData = {
  // CGL Questions
  CGL: {
    'reasoning-cgl': {
      'analogy': [
        {
          questionText: 'Book : Author :: Painting : ?',
          questionTextHindi: 'पुस्तक : लेखक :: चित्र : ?',
          optionsJson: [
            { text: 'Painter', isCorrect: true },
            { text: 'Canvas', isCorrect: false },
            { text: 'Brush', isCorrect: false },
            { text: 'Color', isCorrect: false }
          ],
          correctAnswer: 'Painter',
          explanation: 'Book is written by Author, similarly Painting is made by Painter.',
          explanationHindi: 'पुस्तक लेखक द्वारा लिखी जाती है, इसी तरह चित्र चित्रकार द्वारा बनाया जाता है।',
          difficulty: 'EASY',
          year: 2023,
          shift: 1,
          isMirrorQuestion: false,
        },
        {
          questionText: '25 : 37 :: 49 : ?',
          questionTextHindi: '25 : 37 :: 49 : ?',
          optionsJson: [
            { text: '65', isCorrect: true },
            { text: '63', isCorrect: false },
            { text: '61', isCorrect: false },
            { text: '59', isCorrect: false }
          ],
          correctAnswer: '65',
          explanation: '25 = 5², 37 = 6²+1; 49 = 7², so answer = 8²+1 = 65',
          explanationHindi: '25 = 5², 37 = 6²+1; 49 = 7², तो उत्तर = 8²+1 = 65',
          difficulty: 'MEDIUM',
          year: 2023,
          shift: 2,
          isMirrorQuestion: false,
        },
        {
          questionText: 'ABCD : WXYZ :: EFGH : ?',
          questionTextHindi: 'ABCD : WXYZ :: EFGH : ?',
          optionsJson: [
            { text: 'VUTS', isCorrect: true },
            { text: 'STUV', isCorrect: false },
            { text: 'TUVW', isCorrect: false },
            { text: 'UVWX', isCorrect: false }
          ],
          correctAnswer: 'VUTS',
          explanation: 'Reverse alphabetical order: A↔Z, B↔Y, C↔X, D↔W. Similarly E↔V, F↔U, G↔T, H↔S',
          explanationHindi: 'उल्टा वर्णमाला क्रम: A↔Z, B↔Y, C↔X, D↔W. इसी तरह E↔V, F↔U, G↔T, H↔S',
          difficulty: 'EASY',
          year: 2022,
          shift: 1,
          isMirrorQuestion: false,
        }
      ],
      'classification': [
        {
          questionText: 'Find the odd one out: 25, 36, 49, 64, 81',
          questionTextHindi: 'विषम ज्ञात कीजिए: 25, 36, 49, 64, 81',
          optionsJson: [
            { text: '25', isCorrect: false },
            { text: '36', isCorrect: false },
            { text: '49', isCorrect: false },
            { text: '64', isCorrect: true }
          ],
          correctAnswer: '64',
          explanation: 'All are squares of odd numbers except 64 (8², even). 25=5², 36=6², 49=7², 81=9²',
          explanationHindi: 'सभी विषम संख्याओं के वर्ग हैं सिवाय 64 के (8², सम)। 25=5², 36=6², 49=7², 81=9²',
          difficulty: 'EASY',
          year: 2023,
          shift: 1,
          isMirrorQuestion: false,
        }
      ],
      'series': [
        {
          questionText: 'Complete the series: 2, 6, 12, 20, 30, ?',
          questionTextHindi: 'श्रृंखला पूरी कीजिए: 2, 6, 12, 20, 30, ?',
          optionsJson: [
            { text: '42', isCorrect: true },
            { text: '40', isCorrect: false },
            { text: '38', isCorrect: false },
            { text: '36', isCorrect: false }
          ],
          correctAnswer: '42',
          explanation: 'Pattern: n(n+1) → 1×2=2, 2×3=6, 3×4=12, 4×5=20, 5×6=30, 6×7=42',
          explanationHindi: 'पैटर्न: n(n+1) → 1×2=2, 2×3=6, 3×4=12, 4×5=20, 5×6=30, 6×7=42',
          difficulty: 'MEDIUM',
          year: 2022,
          shift: 2,
          isMirrorQuestion: false,
        }
      ],
      'coding-decoding': [
        {
          questionText: 'If CAT = 3120, then DOG = ?',
          questionTextHindi: 'यदि CAT = 3120, तो DOG = ?',
          optionsJson: [
            { text: '4157', isCorrect: true },
            { text: '4156', isCorrect: false },
            { text: '4158', isCorrect: false },
            { text: '4159', isCorrect: false }
          ],
          correctAnswer: '4157',
          explanation: 'C=3, A=1, T=20 → 3120. D=4, O=15, G=7 → 4157',
          explanationHindi: 'C=3, A=1, T=20 → 3120. D=4, O=15, G=7 → 4157',
          difficulty: 'EASY',
          year: 2023,
          shift: 1,
          isMirrorQuestion: false,
        }
      ],
      'blood-relations': [
        {
          questionText: 'Pointing to a photograph, a man said, "I have no brother or sister but that man\'s father is my father\'s son." Whose photograph was it?',
          questionTextHindi: 'एक तस्वीर की ओर इशारा करते हुए एक आदमी ने कहा, "मेरा कोई भाई या बहन नहीं है लेकिन उस आदमी के पिता मेरे पिता के बेटे हैं।" यह किसकी तस्वीर थी?',
          optionsJson: [
            { text: 'His son', isCorrect: true },
            { text: 'His father', isCorrect: false },
            { text: 'His grandfather', isCorrect: false },
            { text: 'Himself', isCorrect: false }
          ],
          correctAnswer: 'His son',
          explanation: '"My father\'s son" = me (since no siblings). So "that man\'s father is me" → that man is my son.',
          explanationHindi: '"मेरे पिता के बेटे" = मैं (क्योंकि कोई भाई-बहन नहीं)। तो "उस आदमी के पिता मैं हूँ" → वह आदमी मेरा बेटा है।',
          difficulty: 'MEDIUM',
          year: 2022,
          shift: 1,
          isMirrorQuestion: false,
        }
      ],
      'direction-sense': [
        {
          questionText: 'A man walks 5 km North, then 3 km East, then 5 km South. How far is he from starting point?',
          questionTextHindi: 'एक आदमी 5 किमी उत्तर, फिर 3 किमी पूर्व, फिर 5 किमी दक्षिण चलता है। वह प्रारंभिक बिंदु से कितनी दूर है?',
          optionsJson: [
            { text: '3 km', isCorrect: true },
            { text: '5 km', isCorrect: false },
            { text: '8 km', isCorrect: false },
            { text: '13 km', isCorrect: false }
          ],
          correctAnswer: '3 km',
          explanation: 'Net North-South = 5-5 = 0. Net East = 3 km. Distance = 3 km East.',
          explanationHindi: 'कुल उत्तर-दक्षिण = 5-5 = 0। कुल पूर्व = 3 किमी। दूरी = 3 किमी पूर्व।',
          difficulty: 'EASY',
          year: 2023,
          shift: 2,
          isMirrorQuestion: false,
        }
      ],
      'seating-arrangement': [
        {
          questionText: 'Five friends A, B, C, D, E sit in a row. A sits next to B but not next to C. D sits next to E. C sits at one end. Who sits in the middle?',
          questionTextHindi: 'पांच दोस्त A, B, C, D, E एक पंक्ति में बैठे हैं। A, B के बगल में बैठता है लेकिन C के बगल में नहीं। D, E के बगल में बैठता है। C एक छोर पर बैठता है। बीच में कौन बैठता है?',
          optionsJson: [
            { text: 'B', isCorrect: true },
            { text: 'D', isCorrect: false },
            { text: 'A', isCorrect: false },
            { text: 'E', isCorrect: false }
          ],
          correctAnswer: 'B',
          explanation: 'Arrangement: C, A, B, D, E (C at end, A next to B not C, D next to E). Middle is B.',
          explanationHindi: 'व्यवस्था: C, A, B, D, E (C छोर पर, A, B के बगल में C के नहीं, D, E के बगल में)। बीच में B है।',
          difficulty: 'MEDIUM',
          year: 2022,
          shift: 2,
          isMirrorQuestion: false,
        }
      ],
      'syllogism': [
        {
          questionText: 'Statements: All pens are books. Some books are pencils. Conclusions: I. Some pens are pencils. II. Some pencils are books.',
          questionTextHindi: 'कथन: सभी पेन किताबें हैं। कुछ किताबें पेंसिल हैं। निष्कर्ष: I. कुछ पेन पेंसिल हैं। II. कुछ पेंसिल किताबें हैं।',
          optionsJson: [
            { text: 'Only II follows', isCorrect: true },
            { text: 'Only I follows', isCorrect: false },
            { text: 'Both follow', isCorrect: false },
            { text: 'Neither follows', isCorrect: false }
          ],
          correctAnswer: 'Only II follows',
          explanation: 'All pens are books + Some books are pencils = No conclusion about pens and pencils. But "Some books are pencils" → "Some pencils are books" (converse).',
          explanationHindi: 'सभी पेन किताबें हैं + कुछ किताबें पेंसिल हैं = पेन और पेंसिल के बारे में कोई निष्कर्ष नहीं। लेकिन "कुछ किताबें पेंसिल हैं" → "कुछ पेंसिल किताबें हैं" (व्युत्क्रम)।',
          difficulty: 'MEDIUM',
          year: 2023,
          shift: 1,
          isMirrorQuestion: false,
        }
      ],
      'mirror-images': [
        {
          questionText: 'Which of the following is the mirror image of "AMBULANCE" when mirror is placed vertically?',
          questionTextHindi: 'जब दर्पण ऊर्ध्वाधर रखा जाता है तो "AMBULANCE" का दर्पण प्रतिबिंब कौन सा होगा?',
          optionsJson: [
            { text: 'ƎᑌᗰꓭᗺꓭA', isCorrect: true },
            { text: 'ECNALUBMA', isCorrect: false },
            { text: 'AMBULANCE', isCorrect: false },
            { text: 'ECNALUBMⱯ', isCorrect: false }
          ],
          correctAnswer: 'ƎᑌᗰꓭᗺꓭA',
          explanation: 'Mirror image reverses left-right. A becomes Ɐ, M becomes ꓘ, B becomes ᖷ, U becomes ∩, L becomes ꓶ, A becomes Ɐ, N becomes N, C becomes ꓭ, E becomes Ǝ',
          explanationHindi: 'दर्पण प्रतिबिंब बाएं-दाएं को उल्टा करता है। A Ɐ बन जाता है, M ꓘ बन जाता है, B ᖷ बन जाता है, U ∩ बन जाता है, L ꓶ बन जाता है, A Ɐ बन जाता है, N N रहता है, C ꓭ बन जाता है, E Ǝ बन जाता है',
          difficulty: 'MEDIUM',
          year: 2022,
          shift: 1,
          isMirrorQuestion: true,
        }
      ],
    },
    'quant-cgl': {
      'number-system': [
        {
          questionText: 'Find the LCM of 12, 15, 20, 27',
          questionTextHindi: '12, 15, 20, 27 का लघुत्तम समापवर्त्य (LCM) ज्ञात कीजिए',
          optionsJson: [
            { text: '540', isCorrect: true },
            { text: '270', isCorrect: false },
            { text: '1080', isCorrect: false },
            { text: '135', isCorrect: false }
          ],
          correctAnswer: '540',
          explanation: '12=2²×3, 15=3×5, 20=2²×5, 27=3³. LCM = 2²×3³×5 = 4×27×5 = 540',
          explanationHindi: '12=2²×3, 15=3×5, 20=2²×5, 27=3³. LCM = 2²×3³×5 = 4×27×5 = 540',
          difficulty: 'EASY',
          year: 2023,
          shift: 1,
          isMirrorQuestion: false,
        }
      ],
      'percentage': [
        {
          questionText: 'If 40% of a number is 120, what is 60% of that number?',
          questionTextHindi: 'यदि किसी संख्या का 40% 120 है, तो उस संख्या का 60% क्या है?',
          optionsJson: [
            { text: '180', isCorrect: true },
            { text: '160', isCorrect: false },
            { text: '200', isCorrect: false },
            { text: '150', isCorrect: false }
          ],
          correctAnswer: '180',
          explanation: '40% = 120 → 1% = 3 → 60% = 180. Or: 60% = 1.5 × 40% = 1.5 × 120 = 180',
          explanationHindi: '40% = 120 → 1% = 3 → 60% = 180। या: 60% = 1.5 × 40% = 1.5 × 120 = 180',
          difficulty: 'EASY',
          year: 2022,
          shift: 2,
          isMirrorQuestion: false,
        }
      ],
      'profit-loss': [
        {
          questionText: 'A man sells an article at a loss of 10%. If he had sold it for Rs. 50 more, he would have gained 5%. Find the cost price.',
          questionTextHindi: 'एक आदमी एक वस्तु को 10% की हानि पर बेचता है। यदि वह इसे 50 रुपये अधिक में बेचता, तो उसे 5% लाभ होता। लागत मूल्य ज्ञात कीजिए।',
          optionsJson: [
            { text: 'Rs. 333.33', isCorrect: true },
            { text: 'Rs. 300', isCorrect: false },
            { text: 'Rs. 350', isCorrect: false },
            { text: 'Rs. 400', isCorrect: false }
          ],
          correctAnswer: 'Rs. 333.33',
          explanation: 'SP at 10% loss = 0.9 CP. SP at 5% gain = 1.05 CP. Difference = 0.15 CP = 50 → CP = 50/0.15 = 333.33',
          explanationHindi: '10% हानि पर SP = 0.9 CP। 5% लाभ पर SP = 1.05 CP। अंतर = 0.15 CP = 50 → CP = 50/0.15 = 333.33',
          difficulty: 'MEDIUM',
          year: 2023,
          shift: 2,
          isMirrorQuestion: false,
        }
      ],
      'time-work': [
        {
          questionText: 'A can do a work in 10 days, B in 15 days. They work together for 3 days. What fraction of work is left?',
          questionTextHindi: 'A एक कार्य को 10 दिन में, B को 15 दिन में कर सकता है। वे 3 दिन साथ काम करते हैं। कार्य का कितना अंश बचा है?',
          optionsJson: [
            { text: '1/2', isCorrect: true },
            { text: '1/3', isCorrect: false },
            { text: '1/4', isCorrect: false },
            { text: '1/5', isCorrect: false }
          ],
          correctAnswer: '1/2',
          explanation: 'A\'s 1 day = 1/10, B\'s 1 day = 1/15. Together 1 day = 1/10 + 1/15 = 1/6. In 3 days = 3/6 = 1/2. Left = 1/2.',
          explanationHindi: 'A का 1 दिन = 1/10, B का 1 दिन = 1/15। साथ में 1 दिन = 1/10 + 1/15 = 1/6। 3 दिन में = 3/6 = 1/2। बचा = 1/2।',
          difficulty: 'EASY',
          year: 2022,
          shift: 1,
          isMirrorQuestion: false,
        }
      ],
    },
    'english-cgl': {
      'spot-error': [
        {
          questionText: 'Find the error: "Each of the boys (a) / have completed (b) / their homework (c) / No error (d)"',
          questionTextHindi: 'त्रुटि ढूंढें: "Each of the boys (a) / have completed (b) / their homework (c) / No error (d)"',
          optionsJson: [
            { text: '(b)', isCorrect: true },
            { text: '(a)', isCorrect: false },
            { text: '(c)', isCorrect: false },
            { text: '(d)', isCorrect: false }
          ],
          correctAnswer: '(b)',
          explanation: '"Each of the boys" is singular, so verb should be "has completed" not "have completed".',
          explanationHindi: '"Each of the boys" एकवचन है, इसलिए क्रिया "has completed" होनी चाहिए "have completed" नहीं।',
          difficulty: 'EASY',
          year: 2023,
          shift: 1,
          isMirrorQuestion: false,
        }
      ],
      'synonyms': [
        {
          questionText: 'Choose the synonym of "EPHEMERAL"',
          questionTextHindi: '"EPHEMERAL" का पर्यायवाची चुनें',
          optionsJson: [
            { text: 'Transient', isCorrect: true },
            { text: 'Permanent', isCorrect: false },
            { text: 'Eternal', isCorrect: false },
            { text: 'Lasting', isCorrect: false }
          ],
          correctAnswer: 'Transient',
          explanation: 'Ephemeral means lasting for a very short time. Synonym: Transient.',
          explanationHindi: 'Ephemeral का अर्थ है बहुत कम समय तक रहने वाला। पर्यायवाची: Transient।',
          difficulty: 'MEDIUM',
          year: 2022,
          shift: 2,
          isMirrorQuestion: false,
        }
      ],
    },
    'ga-cgl': {
      'history': [
        {
          questionText: 'Who was the founder of the Maurya Empire?',
          questionTextHindi: 'मौर्य साम्राज्य का संस्थापक कौन था?',
          optionsJson: [
            { text: 'Chandragupta Maurya', isCorrect: true },
            { text: 'Ashoka', isCorrect: false },
            { text: 'Bindusara', isCorrect: false },
            { text: 'Chanakya', isCorrect: false }
          ],
          correctAnswer: 'Chandragupta Maurya',
          explanation: 'Chandragupta Maurya founded the Maurya Empire around 322 BCE with the help of Chanakya.',
          explanationHindi: 'चंद्रगुप्त मौर्य ने चाणक्य की सहायता से लगभग 322 ईसा पूर्व में मौर्य साम्राज्य की स्थापना की।',
          difficulty: 'EASY',
          year: 2023,
          shift: 1,
          isMirrorQuestion: false,
        }
      ],
      'geography': [
        {
          questionText: 'Which is the longest river in India?',
          questionTextHindi: 'भारत की सबसे लंबी नदी कौन सी है?',
          optionsJson: [
            { text: 'Ganga', isCorrect: true },
            { text: 'Brahmaputra', isCorrect: false },
            { text: 'Yamuna', isCorrect: false },
            { text: 'Godavari', isCorrect: false }
          ],
          correctAnswer: 'Ganga',
          explanation: 'Ganga is the longest river flowing entirely within India (2,525 km). Brahmaputra is longer but flows through Tibet and Bangladesh.',
          explanationHindi: 'गंगा पूरी तरह से भारत में बहने वाली सबसे लंबी नदी है (2,525 किमी)। ब्रह्मपुत्र लंबी है लेकिन तिब्बत और बांग्लादेश से बहती है।',
          difficulty: 'EASY',
          year: 2022,
          shift: 2,
          isMirrorQuestion: false,
        }
      ],
    },
  },
  // CHSL Questions
  CHSL: {
    'reasoning-chsl': {
      'analogy': [
        {
          questionText: 'Doctor : Hospital :: Teacher : ?',
          questionTextHindi: 'डॉक्टर : अस्पताल :: शिक्षक : ?',
          optionsJson: [
            { text: 'School', isCorrect: true },
            { text: 'Student', isCorrect: false },
            { text: 'Book', isCorrect: false },
            { text: 'Class', isCorrect: false }
          ],
          correctAnswer: 'School',
          explanation: 'Doctor works in Hospital, Teacher works in School.',
          explanationHindi: 'डॉक्टर अस्पताल में काम करता है, शिक्षक स्कूल में काम करता है।',
          difficulty: 'EASY',
          year: 2023,
          shift: 1,
          isMirrorQuestion: false,
        }
      ],
    },
    'quant-chsl': {
      'number-system': [
        {
          questionText: 'The sum of first 20 natural numbers is:',
          questionTextHindi: 'प्रथम 20 प्राकृतिक संख्याओं का योग है:',
          optionsJson: [
            { text: '210', isCorrect: true },
            { text: '200', isCorrect: false },
            { text: '220', isCorrect: false },
            { text: '190', isCorrect: false }
          ],
          correctAnswer: '210',
          explanation: 'Sum = n(n+1)/2 = 20×21/2 = 210',
          explanationHindi: 'योग = n(n+1)/2 = 20×21/2 = 210',
          difficulty: 'EASY',
          year: 2022,
          shift: 1,
          isMirrorQuestion: false,
        }
      ],
    },
  },
  // MTS Questions
  MTS: {
    'reasoning-mts': {
      'analogy': [
        {
          questionText: 'Fish : Water :: Bird : ?',
          questionTextHindi: 'मछली : पानी :: चिड़िया : ?',
          optionsJson: [
            { text: 'Air/Sky', isCorrect: true },
            { text: 'Tree', isCorrect: false },
            { text: 'Nest', isCorrect: false },
            { text: 'Egg', isCorrect: false }
          ],
          correctAnswer: 'Air/Sky',
          explanation: 'Fish lives in Water, Bird flies in Air/Sky.',
          explanationHindi: 'मछली पानी में रहती है, चिड़िया हवा/आकाश में उड़ती है।',
          difficulty: 'EASY',
          year: 2023,
          shift: 1,
          isMirrorQuestion: false,
        }
      ],
    },
  },
  // GD Questions
  GD: {
    'reasoning-gd': {
      'analogy': [
        {
          questionText: 'Pen : Write :: Knife : ?',
          questionTextHindi: 'कलम : लिखना :: चाकू : ?',
          optionsJson: [
            { text: 'Cut', isCorrect: true },
            { text: 'Sharp', isCorrect: false },
            { text: 'Steel', isCorrect: false },
            { text: 'Kitchen', isCorrect: false }
          ],
          correctAnswer: 'Cut',
          explanation: 'Pen is used to Write, Knife is used to Cut.',
          explanationHindi: 'कलम लिखने के लिए उपयोग होती है, चाकू काटने के लिए उपयोग होता है।',
          difficulty: 'EASY',
          year: 2023,
          shift: 1,
          isMirrorQuestion: false,
        }
      ],
    },
  },
  // STENO Questions
  STENO: {
    'english-steno': {
      'spot-error': [
        {
          questionText: 'Find the error: "The scissors (a) / is (b) / on the table (c) / No error (d)"',
          questionTextHindi: 'त्रुटि ढूंढें: "The scissors (a) / is (b) / on the table (c) / No error (d)"',
          optionsJson: [
            { text: '(b)', isCorrect: true },
            { text: '(a)', isCorrect: false },
            { text: '(c)', isCorrect: false },
            { text: '(d)', isCorrect: false }
          ],
          correctAnswer: '(b)',
          explanation: '"Scissors" is plural, so verb should be "are" not "is".',
          explanationHindi: '"Scissors" बहुवचन है, इसलिए क्रिया "are" होनी चाहिए "is" नहीं।',
          difficulty: 'EASY',
          year: 2023,
          shift: 1,
          isMirrorQuestion: false,
        }
      ],
    },
  },
};

async function main() {
  console.log('🌱 Starting comprehensive question seeding...');

  for (const [examCode, subjects] of Object.entries(questionsData)) {
    const exam = await prisma.exam.findUnique({ where: { code: examCode } });
    if (!exam) continue;

    for (const [subjectSlug, chapters] of Object.entries(subjects)) {
      const subject = await prisma.subject.findUnique({ where: { slug: subjectSlug } });
      if (!subject) continue;

      for (const [chapterSlug, questions] of Object.entries(chapters)) {
        const qs = questions as any;
        const chapter = await prisma.chapter.findUnique({ 
          where: { subjectId_slug: { subjectId: subject.id, slug: chapterSlug } } 
        });
        if (!chapter) continue;

        for (const q of qs) {
          // Check if question already exists (by text + exam + year + shift)
          const existing = await prisma.question.findFirst({
            where: {
              examId: exam.id,
              questionText: q.questionText,
              year: q.year,
              shift: String(q.shift),
            }
          });

          if (existing) {
            console.log(`  ⏭ Skipped existing: ${q.questionText.substring(0, 50)}...`);
            continue;
          }

          await prisma.question.create({
            data: {
              examId: exam.id,
              subjectId: subject.id,
              chapterId: chapter.id,
              questionText: q.questionText,
              questionTextHindi: q.questionTextHindi,
              optionsJson: q.optionsJson,
              correctAnswer: q.correctAnswer,
              explanation: q.explanation,
              explanationHindi: q.explanationHindi,
              difficulty: q.difficulty,
              year: q.year,
              shift: String(q.shift),
              // isMirrorQuestion: q.isMirrorQuestion,
              isApproved: true,
              isActive: true,
              answerVerificationStatus: 'VERIFIED',
            }
          });
          console.log(`  ✓ ${examCode} - ${subjectSlug} - ${chapterSlug} - ${q.questionText.substring(0, 40)}...`);
        }
      }
    }
  }

  console.log('\n✅ Question seeding completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
