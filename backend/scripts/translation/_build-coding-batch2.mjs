#!/usr/bin/env node
/* Build Coding-Decoding batch 2 (book_q 21..40) into pinnacle-enhanced/Coding-Decoding.json */
import fs from 'node:fs';

const SRC = 'extract/pinnacle/Coding-Decoding.json';
const OUT = 'extract/pinnacle-enhanced/Coding-Decoding.json';

const src = JSON.parse(fs.readFileSync(SRC, 'utf8')).filter(r => !r.has_fig);
const byBookQ = new Map(src.map(r => [r.book_q, r]));

const clean = (s) => (s || '')
  .replace(/\s*www\.ssccglpinnacle\.com.*$/is, '')
  .replace(/\s*Download Pinnacle.*$/is, '')
  .replace(/\s*Pinnacle Coding-Decoding.*$/is, '')
  .replace(/\s+/g, ' ')
  .trim();

// verified content for book_q 21..40
const C = {
  21: { ans:'B', diff:'medium',
    q_hi:'यदि A = 4 और C = 6 है, तो ‘Power’ को कैसे कोड किया जाएगा?',
    expl_en:'A=4 and C=6 means each letter = (its alphabet position + 3): A(1)+3=4, C(3)+3=6. Apply to POWER: P(16)+3=19, O(15)+3=18, W(23)+3=26, E(5)+3=8, R(18)+3=21. Join the numbers → 19-18-26-8-21 = 191826821.',
    expl_hi:'A=4 और C=6 का मतलब है हर अक्षर = (उसकी वर्णमाला स्थिति + 3): A(1)+3=4, C(3)+3=6. POWER पर लगाएँ: P(16)+3=19, O(15)+3=18, W(23)+3=26, E(5)+3=8, R(18)+3=21. संख्याओं को जोड़ें → 19-18-26-8-21 = 191826821.' },
  22: { ans:'B', diff:'easy',
    q_hi:'एक निश्चित कोड भाषा में ‘EXAMPLE’ को ‘DWZLOKD’ लिखा जाता है। तो ‘ELECTION’ को उसी भाषा में कैसे लिखा जाएगा?',
    expl_en:'Each letter of EXAMPLE is moved 1 step back: E→D, X→W, A→Z, M→L, P→O, L→K, E→D. Same rule (−1) on ELECTION: E→D, L→K, E→D, C→B, T→S, I→H, O→N, N→M = DKDBSHNM.',
    expl_hi:'EXAMPLE के हर अक्षर को 1 कदम पीछे किया गया है: E→D, X→W, A→Z, M→L, P→O, L→K, E→D. यही नियम (−1) ELECTION पर: E→D, L→K, E→D, C→B, T→S, I→H, O→N, N→M = DKDBSHNM.' },
  23: { ans:'D', diff:'easy',
    q_hi:'एक निश्चित कोड भाषा में ‘DEAR’ को ‘7465’ और ‘LIFE’ को ‘8394’ कोड किया जाता है। तो ‘IDEAL’ को उसी भाषा में कैसे कोड किया जाएगा?',
    expl_en:'From DEAR=7465: D=7, E=4, A=6, R=5. From LIFE=8394: L=8, I=3, F=9, E=4 (E=4 matches). So IDEAL = I(3) D(7) E(4) A(6) L(8) = 37468.',
    expl_hi:'DEAR=7465 से: D=7, E=4, A=6, R=5. LIFE=8394 से: L=8, I=3, F=9, E=4 (E=4 मेल खाता है). अतः IDEAL = I(3) D(7) E(4) A(6) L(8) = 37468.' },
  24: { ans:'A', diff:'medium',
    q_hi:'यदि किसी कोड में EARTH को FZSSI लिखा जाता है, तो कौन-सा शब्द XZUDS के रूप में कोडित होगा?',
    expl_en:'EARTH→FZSSI uses alternating shifts +1,−1,+1,−1,+1 (E+1=F, A−1=Z, R+1=S, T−1=S, H+1=I). To decode XZUDS reverse it: X−1=W, Z+1=A, U−1=T, D+1=E, S−1=R = WATER.',
    expl_hi:'EARTH→FZSSI में क्रमशः +1,−1,+1,−1,+1 का बदलाव है (E+1=F, A−1=Z, R+1=S, T−1=S, H+1=I). XZUDS को उलटने के लिए विपरीत करें: X−1=W, Z+1=A, U−1=T, D+1=E, S−1=R = WATER.' },
  25: { ans:'B', diff:'medium',
    q_hi:'यदि किसी कोड में EDITION को VWRGRLM लिखा जाता है, तो कौन-सा शब्द SLMVHGB के रूप में कोडित होगा?',
    expl_en:'This is the atbash cipher: each letter → (27 − its position), i.e. A↔Z, B↔Y … (E(5)→V(22), D(4)→W(23) confirm it). Decode SLMVHGB: S(19)→H, L(12)→O, M(13)→N, V(22)→E, H(8)→S, G(7)→T, B(2)→Y = HONESTY.',
    expl_hi:'यह atbash सिफर है: हर अक्षर → (27 − उसकी स्थिति), यानी A↔Z, B↔Y … (E(5)→V(22), D(4)→W(23) पुष्टि करते हैं). SLMVHGB को हल करें: S(19)→H, L(12)→O, M(13)→N, V(22)→E, H(8)→S, G(7)→T, B(2)→Y = HONESTY.' },
  26: { ans:'A', diff:'easy',
    q_hi:'एक निश्चित कोड भाषा में ‘ROCK’ को ‘3587’ और ‘TIDE’ को ‘4261’ लिखा जाता है। तो ‘DOCTOR’ को उसी भाषा में कैसे लिखा जाएगा?',
    expl_en:'From ROCK=3587: R=3, O=5, C=8, K=7. From TIDE=4261: T=4, I=2, D=6, E=1. So DOCTOR = D(6) O(5) C(8) T(4) O(5) R(3) = 658453.',
    expl_hi:'ROCK=3587 से: R=3, O=5, C=8, K=7. TIDE=4261 से: T=4, I=2, D=6, E=1. अतः DOCTOR = D(6) O(5) C(8) T(4) O(5) R(3) = 658453.' },
  27: { ans:'D', diff:'medium',
    q_hi:'एक निश्चित भाषा में JUSTICE को JSUTCIE कोड किया जाता है। उस भाषा में JUPITER को कैसे कोड किया जाएगा?',
    expl_en:'Positions 1,4,7 stay fixed; pairs (2,3) and (5,6) are swapped. Check: JUSTICE → J, S↔U, T, C↔I, E = JSUTCIE. Apply to JUPITER: J, U↔P→PU, I, T↔E→ET, R = J-P-U-I-E-T-R = JPUIETR.',
    expl_hi:'स्थान 1,4,7 अपनी जगह रहते हैं; जोड़े (2,3) और (5,6) आपस में बदल जाते हैं. जाँच: JUSTICE → J, S↔U, T, C↔I, E = JSUTCIE. JUPITER पर: J, U↔P→PU, I, T↔E→ET, R = J-P-U-I-E-T-R = JPUIETR.' },
  28: { ans:'B', diff:'medium',
    q_hi:'यदि AS = 19 और BAT = 40 है, तो BREAD को कैसे कोड करेंगे?',
    expl_en:'The code = product of the letters’ positions. AS = 1×19 = 19. BAT = 2×1×20 = 40. So BREAD = 2×18×5×1×4 = 720.',
    expl_hi:'कोड = अक्षरों की स्थितियों का गुणनफल. AS = 1×19 = 19. BAT = 2×1×20 = 40. अतः BREAD = 2×18×5×1×4 = 720.' },
  29: { ans:'D', diff:'medium',
    q_hi:'यदि किसी कोड में ‘HAMMER’ को ‘GBLNDS’ लिखा जाता है, तो ‘NEEDLE’ को कैसे कोड किया जाएगा?',
    expl_en:'Alternating shifts −1,+1,−1,+1,−1,+1 (H−1=G, A+1=B, M−1=L, M+1=N, E−1=D, R+1=S). Apply to NEEDLE: N−1=M, E+1=F, E−1=D, D+1=E, L−1=K, E+1=F = MFDEKF.',
    expl_hi:'क्रमशः −1,+1,−1,+1,−1,+1 का बदलाव (H−1=G, A+1=B, M−1=L, M+1=N, E−1=D, R+1=S). NEEDLE पर: N−1=M, E+1=F, E−1=D, D+1=E, L−1=K, E+1=F = MFDEKF.' },
  30: { ans:'C', diff:'medium',
    q_hi:'यदि X = 48 और ACT = 48 है, तो TALL = ?',
    expl_en:'The code = 2 × (sum of letter positions). X = 24, 2×24 = 48. ACT = 1+3+20 = 24, 2×24 = 48. So TALL = 20+1+12+12 = 45, 2×45 = 90.',
    expl_hi:'कोड = 2 × (अक्षरों की स्थितियों का योग). X = 24, 2×24 = 48. ACT = 1+3+20 = 24, 2×24 = 48. अतः TALL = 20+1+12+12 = 45, 2×45 = 90.' },
  31: { ans:'B', diff:'hard',
    q_hi:'एक कोड भाषा में TIGER को SUHJFHDFQS लिखा जाता है। उस भाषा में GINPQSRTDF को कैसे लिखा जाएगा?',
    expl_en:'Each letter becomes two letters: (letter−1)(letter+1). T→SU, I→HJ, G→FH, E→DF, R→QS. To decode, take each pair and its middle letter: GI→H, NP→O, QS→R, RT→S, DF→E = HORSE.',
    expl_hi:'हर अक्षर दो अक्षरों में बदलता है: (अक्षर−1)(अक्षर+1). T→SU, I→HJ, G→FH, E→DF, R→QS. हल करने के लिए हर जोड़े का बीच वाला अक्षर लें: GI→H, NP→O, QS→R, RT→S, DF→E = HORSE.' },
  32: { ans:'B', diff:'medium',
    q_hi:'एक कोड भाषा में TANK को 7-26-13-16 लिखा जाता है। उस भाषा में CARGO को कैसे लिखा जाएगा?',
    expl_en:'The code of each letter = 27 − its position. T(20)→7, A(1)→26, N(14)→13, K(11)→16. Apply to CARGO: C(3)→24, A(1)→26, R(18)→9, G(7)→20, O(15)→12 = 24-26-9-20-12.',
    expl_hi:'हर अक्षर का कोड = 27 − उसकी स्थिति. T(20)→7, A(1)→26, N(14)→13, K(11)→16. CARGO पर: C(3)→24, A(1)→26, R(18)→9, G(7)→20, O(15)→12 = 24-26-9-20-12.' },
  33: { ans:'D', diff:'hard',
    q_hi:'एक निश्चित भाषा में CADET को 31457 लिखा जाता है। उसी भाषा में DEFER को कैसे लिखा जाएगा?',
    expl_en:'From CADET=31457, the fixed values are C=3, A=1, D=4, E=5, T=7. In DEFER the two E’s must get the same digit, and D must be 4, E must be 5. Only option D (45659) satisfies all: D=4, E=5, F=6, E=5, R=9 (the repeated E is consistent and D,E match CADET). The other options break either D=4/E=5 or the equal-E rule.',
    expl_hi:'CADET=31457 से निश्चित मान हैं C=3, A=1, D=4, E=5, T=7. DEFER में दोनों E को एक ही अंक मिलना चाहिए, तथा D=4 और E=5 होना चाहिए. केवल विकल्प D (45659) सब शर्तें पूरी करता है: D=4, E=5, F=6, E=5, R=9 (दोहराया गया E समान है और D,E, CADET से मेल खाते हैं). बाकी विकल्प या तो D=4/E=5 तोड़ते हैं या समान-E नियम.' },
  34: { ans:'C', diff:'medium',
    q_hi:'यदि किसी कोड भाषा में WATER को XZUDS कोड किया जाता है, तो कौन-सा शब्द BMHKF के रूप में कोडित होगा?',
    expl_en:'WATER→XZUDS uses alternating shifts +1,−1,+1,−1,+1 (W+1=X, A−1=Z, T+1=U, E−1=D, R+1=S). Reverse on BMHKF: B−1=A, M+1=N, H−1=G, K+1=L, F−1=E = ANGLE.',
    expl_hi:'WATER→XZUDS में क्रमशः +1,−1,+1,−1,+1 (W+1=X, A−1=Z, T+1=U, E−1=D, R+1=S). BMHKF पर विपरीत करें: B−1=A, M+1=N, H−1=G, K+1=L, F−1=E = ANGLE.' },
  35: { ans:'A', diff:'easy',
    q_hi:'एक कोड भाषा में CERTAIN को DFSUBJO लिखा जाता है। इस भाषा में SUMMER को कैसे लिखा जाएगा?',
    expl_en:'Each letter is moved 1 step forward (+1): C→D, E→F, R→S, T→U, A→B, I→J, N→O. Apply to SUMMER: S→T, U→V, M→N, M→N, E→F, R→S = TVNNFS.',
    expl_hi:'हर अक्षर 1 कदम आगे (+1): C→D, E→F, R→S, T→U, A→B, I→J, N→O. SUMMER पर: S→T, U→V, M→N, M→N, E→F, R→S = TVNNFS.' },
  36: { ans:'A', diff:'medium',
    q_hi:'यदि A = 2, C = 4 है, तो PARTICLE = ?',
    expl_en:'A=2, C=4 means each letter = (its position + 1). PARTICLE: P(16)+1=17, A(1)+1=2, R(18)+1=19, T(20)+1=21, I(9)+1=10, C(3)+1=4, L(12)+1=13, E(5)+1=6. Join → 17-2-19-21-10-4-13-6 = 1721921104136.',
    expl_hi:'A=2, C=4 का मतलब हर अक्षर = (उसकी स्थिति + 1). PARTICLE: P(16)+1=17, A(1)+1=2, R(18)+1=19, T(20)+1=21, I(9)+1=10, C(3)+1=4, L(12)+1=13, E(5)+1=6. जोड़ें → 17-2-19-21-10-4-13-6 = 1721921104136.' },
  37: { ans:'B', diff:'medium',
    q_hi:'यदि AT = 20 और BEG = 70 है, तो BANK = ?',
    expl_en:'The code = product of letter positions. AT = 1×20 = 20. BEG = 2×5×7 = 70. So BANK = 2×1×14×11 = 308.',
    expl_hi:'कोड = अक्षरों की स्थितियों का गुणनफल. AT = 1×20 = 20. BEG = 2×5×7 = 70. अतः BANK = 2×1×14×11 = 308.' },
  38: { ans:'A', diff:'easy',
    q_hi:'एक निश्चित कोड भाषा में SON को 345 और ROAM को 6412 लिखा जाता है। तो RANSOM को उसी भाषा में कैसे लिखा जाएगा?',
    expl_en:'From SON=345: S=3, O=4, N=5. From ROAM=6412: R=6, O=4, A=1, M=2 (O=4 matches). So RANSOM = R(6) A(1) N(5) S(3) O(4) M(2) = 615342.',
    expl_hi:'SON=345 से: S=3, O=4, N=5. ROAM=6412 से: R=6, O=4, A=1, M=2 (O=4 मेल खाता है). अतः RANSOM = R(6) A(1) N(5) S(3) O(4) M(2) = 615342.' },
  39: { ans:'B', diff:'medium',
    q_hi:'यदि किसी भाषा में ‘foot’ को ‘elbow’, ‘elbow’ को ‘ankle’, ‘ankle’ को ‘palm’, ‘palm’ को ‘finger’ और ‘finger’ को ‘knee’ कहा जाता है, तो उस भाषा में अंगूठी किस पर पहनी जाएगी?',
    expl_en:'In real life a ring is worn on the finger. But in this language ‘finger’ is called ‘knee’. So one would wear a ring on what they call ‘knee’.',
    expl_hi:'वास्तव में अंगूठी उंगली (finger) पर पहनी जाती है. परंतु इस भाषा में ‘finger’ को ‘knee’ कहा जाता है. अतः अंगूठी ‘knee’ पर पहनी जाएगी.',
    opt_hi:{A:'टखना (Ankle)', B:'घुटना (Knee)', C:'हथेली (Palm)', D:'उंगली (Finger)'} },
  40: { ans:'B', diff:'medium',
    q_hi:'यदि किसी कोड में EDITION को VWRGRLM लिखा जाता है, तो कौन-सा शब्द SLMVHGB के रूप में कोडित होगा?',
    expl_en:'This is the atbash cipher (each letter → 27 − its position; A↔Z, B↔Y …). Decode SLMVHGB: S(19)→H, L(12)→O, M(13)→N, V(22)→E, H(8)→S, G(7)→T, B(2)→Y = HONESTY.',
    expl_hi:'यह atbash सिफर है (हर अक्षर → 27 − उसकी स्थिति; A↔Z, B↔Y …). SLMVHGB को हल करें: S(19)→H, L(12)→O, M(13)→N, V(22)→E, H(8)→S, G(7)→T, B(2)→Y = HONESTY.' },
};

const records = [];
for (let bq = 21; bq <= 40; bq++) {
  const s = byBookQ.get(bq);
  const c = C[bq];
  const oa = clean(s.a), ob = clean(s.b), oc = clean(s.c), od = clean(s.d);
  const optHi = c.opt_hi || { A: oa, B: ob, C: oc, D: od }; // codes don't translate; body-parts do (Q39)
  records.push({
    book_q: bq,
    q: clean(s.q),
    q_hi: c.q_hi,
    exam: s.exam, date: s.date, shift: s.shift, year: s.year,
    opt_a: oa, opt_b: ob, opt_c: oc, opt_d: od,
    opt_a_hi: optHi.A, opt_b_hi: optHi.B, opt_c_hi: optHi.C, opt_d_hi: optHi.D,
    ans: c.ans,
    expl_en: c.expl_en,
    expl_hi: c.expl_hi,
    trick_en: '', trick_hi: '',
    diff: c.diff,
    topic: 'Reasoning — Coding-Decoding',
    has_fig: false,
  });
}

const existing = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const existingBookQ = new Set(existing.map(r => r.book_q));
const toAdd = records.filter(r => !existingBookQ.has(r.book_q));
const merged = existing.concat(toAdd);
fs.writeFileSync(OUT, JSON.stringify(merged, null, 2) + '\n');
console.log(`existing=${existing.length}  added=${toAdd.length}  total=${merged.length}`);
console.log('sample (book_q 33):');
console.log(JSON.stringify(merged.find(r => r.book_q === 33), null, 2));
