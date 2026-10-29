/**
 * Marking-scheme PRESETS for the SSC exams (researched 28 Oct 2026).
 *
 * Every number below was read from an SSC notice / scheme-of-examination PDF where possible
 * (verification 'OFFICIAL'); the rest was cross-checked on several coaching sites only
 * (verification 'SECONDARY' — the admin must compare it with the notice before trusting it).
 * Anything that could not be verified at all (Junior Hindi Translator: two sites disagree on 100 vs 200
 * questions) is deliberately NOT in this list. Nothing here is invented.
 *
 * What a sync does (planPresetSync, pure — see exam-presets.spec.ts):
 *   - an existing active pattern of the same exam + tier + paper is UPDATED in its marking fields only
 *     (questions, marks, negative marking, total, duration); its lock / scribe settings, per-section timers
 *     and name are the admin's and are kept;
 *   - when no such pattern exists a new one is CREATED (lock + timers exactly as the notice says);
 *   - the exam row is missing -> skipped and reported, nothing is created.
 */
import { readPatternSections } from './section-plan';
import { findExamBySlugs, subjectCoreKey } from './slug-core';

export type PresetVerification = 'OFFICIAL' | 'SECONDARY';
export type PresetTier = 'TIER_1' | 'TIER_2' | null;
export type PresetPaper = 'PAPER_1' | 'PAPER_2' | 'PAPER_3';

export interface PresetSection {
  name: string;
  subjectSlug?: string | null;
  questions: number;
  marks: number;
  durationMinutes?: number;
  /** Only set when a section's penalty differs from the pattern-wide one (MTS). */
  negativeMarks?: number;
}

export interface ExamPreset {
  key: string;
  examSlugs: string[];
  name: string;
  match: { tier: PresetTier; paper: PresetPaper };
  totalQuestions: number;
  totalMarks: number;
  durationMinutes: number;
  negativeMarks: number;
  sections: PresetSection[];
  /** CREATE only: applied when the notice prescribes sectional timers. Never changed on an existing pattern. */
  lockSections: boolean;
  scribeExtraMinutes: number;
  verification: PresetVerification;
  source: string;
  remark?: string;
}

export const PRESETS_VERIFIED_ON = '28 Oct 2026';

const SUB = {
  reasoning: 'reasoning',
  ga: 'general_awareness',
  quant: 'quantitative_aptitude',
  english: 'english',
  computer: 'computer',
  // S42: subjects of the other exams (created by the S43 syllabus workbook; either spelling matches, see slug-core)
  science: 'general_science',
  hindi: 'hindi',
  maths: 'mathematics',
} as const;

const RRB_SATHEE = 'rrb.iitk.ac.in SATHEE (IIT Kanpur, Govt of India initiative)';

const CGL_SCHEME = 'ssc.gov.in CGL Scheme of Examination (Static/CGL.pdf) + CGL 2025 notice para 13.7-13.8';
const CHSL_SCHEME = 'ssc.gov.in CHSL Scheme of Examination (Static/CHSL.pdf) + CHSL 2026 notice para 13.8-13.9';
const CPO_SCHEME = 'ssc.gov.in SI Delhi Police & CAPFs 2025 notice (scheme of examination)';

export const EXAM_PRESETS: ExamPreset[] = [
  {
    key: 'cgl-t1',
    examSlugs: ['cgl'],
    name: 'SSC CGL Tier 1',
    match: { tier: 'TIER_1', paper: 'PAPER_1' },
    totalQuestions: 100,
    totalMarks: 200,
    durationMinutes: 60,
    negativeMarks: 0.5,
    sections: [
      { name: 'General Intelligence & Reasoning', subjectSlug: SUB.reasoning, questions: 25, marks: 50 },
      { name: 'General Awareness', subjectSlug: SUB.ga, questions: 25, marks: 50 },
      { name: 'Quantitative Aptitude', subjectSlug: SUB.quant, questions: 25, marks: 50 },
      { name: 'English Comprehension', subjectSlug: SUB.english, questions: 25, marks: 50 },
    ],
    lockSections: false,
    scribeExtraMinutes: 0,
    verification: 'OFFICIAL',
    source: CGL_SCHEME,
    remark: '60 min for all four parts (80 min scribe). Negative 0.50 per wrong answer.',
  },
  {
    key: 'cgl-t2-p1',
    examSlugs: ['cgl'],
    name: 'SSC CGL Tier 2 Paper I',
    match: { tier: 'TIER_2', paper: 'PAPER_1' },
    totalQuestions: 150,
    totalMarks: 450,
    durationMinutes: 135,
    negativeMarks: 1,
    sections: [
      { name: 'Mathematical Abilities', subjectSlug: SUB.quant, questions: 30, marks: 90 },
      { name: 'Reasoning & General Intelligence', subjectSlug: SUB.reasoning, questions: 30, marks: 90 },
      { name: 'English Language & Comprehension', subjectSlug: SUB.english, questions: 45, marks: 135 },
      { name: 'General Awareness', subjectSlug: SUB.ga, questions: 25, marks: 75 },
      { name: 'Computer Knowledge', subjectSlug: SUB.computer, questions: 20, marks: 60 },
    ],
    lockSections: false,
    scribeExtraMinutes: 0,
    verification: 'OFFICIAL',
    source: CGL_SCHEME,
    remark: '3 marks per question, -1 per wrong answer in Sections I-III. Computer Knowledge is mandatory but qualifying. Session II (Data Entry Speed Test) is not marked.',
  },
  {
    key: 'cgl-t2-p2',
    examSlugs: ['cgl'],
    name: 'SSC CGL Tier 2 Paper II (Statistics)',
    match: { tier: 'TIER_2', paper: 'PAPER_2' },
    totalQuestions: 100,
    totalMarks: 200,
    durationMinutes: 120,
    negativeMarks: 0.5,
    sections: [{ name: 'Statistics', subjectSlug: null, questions: 100, marks: 200 }],
    lockSections: false,
    scribeExtraMinutes: 0,
    verification: 'OFFICIAL',
    source: CGL_SCHEME,
    remark: 'Only for JSO / Statistical Investigator Gr II candidates. 2 marks per question, -0.50 per wrong answer.',
  },
  {
    key: 'chsl-t1',
    examSlugs: ['chsl'],
    name: 'SSC CHSL Tier 1',
    match: { tier: 'TIER_1', paper: 'PAPER_1' },
    totalQuestions: 100,
    totalMarks: 200,
    durationMinutes: 60,
    negativeMarks: 0.5,
    sections: [
      { name: 'English Language (Basic Knowledge)', subjectSlug: SUB.english, questions: 25, marks: 50, durationMinutes: 15 },
      { name: 'General Intelligence', subjectSlug: SUB.reasoning, questions: 25, marks: 50, durationMinutes: 15 },
      { name: 'Quantitative Aptitude (Basic Arithmetic Skill)', subjectSlug: SUB.quant, questions: 25, marks: 50, durationMinutes: 15 },
      { name: 'General Awareness', subjectSlug: SUB.ga, questions: 25, marks: 50, durationMinutes: 15 },
    ],
    lockSections: true,
    scribeExtraMinutes: 5,
    verification: 'OFFICIAL',
    source: CHSL_SCHEME,
    remark: '2026 notice: 60 min with a 15-minute sectional timer per subject (80 min scribe = 20 per subject). Negative 0.50.',
  },
  {
    key: 'chsl-t2',
    examSlugs: ['chsl'],
    name: 'SSC CHSL Tier 2',
    match: { tier: 'TIER_2', paper: 'PAPER_1' },
    totalQuestions: 135,
    totalMarks: 405,
    durationMinutes: 135,
    negativeMarks: 1,
    sections: [
      { name: 'Mathematical Abilities', subjectSlug: SUB.quant, questions: 30, marks: 90, durationMinutes: 30 },
      { name: 'Reasoning & General Intelligence', subjectSlug: SUB.reasoning, questions: 30, marks: 90, durationMinutes: 30 },
      { name: 'English Language & Comprehension', subjectSlug: SUB.english, questions: 40, marks: 120, durationMinutes: 40 },
      { name: 'General Awareness', subjectSlug: SUB.ga, questions: 20, marks: 60, durationMinutes: 20 },
      { name: 'Computer Knowledge', subjectSlug: SUB.computer, questions: 15, marks: 45, durationMinutes: 15 },
    ],
    lockSections: true,
    scribeExtraMinutes: 0,
    verification: 'OFFICIAL',
    source: CHSL_SCHEME,
    remark: '3 marks per question, -1 per wrong answer in Sections I-III; every section must be qualified; Computer Knowledge is qualifying. Skill / typing test is not an MCQ and is not marked here.',
  },
  {
    key: 'mts',
    examSlugs: ['mts'],
    name: 'SSC MTS & Havaldar CBE',
    match: { tier: null, paper: 'PAPER_1' },
    totalQuestions: 90,
    totalMarks: 270,
    durationMinutes: 90,
    negativeMarks: 1,
    sections: [
      { name: 'Session I · Numerical & Mathematical Ability', subjectSlug: SUB.quant, questions: 20, marks: 60, negativeMarks: 0 },
      { name: 'Session I · Reasoning Ability & Problem Solving', subjectSlug: SUB.reasoning, questions: 20, marks: 60, negativeMarks: 0 },
      { name: 'Session II · General Awareness', subjectSlug: SUB.ga, questions: 25, marks: 75, negativeMarks: 1 },
      { name: 'Session II · English Language & Comprehension', subjectSlug: SUB.english, questions: 25, marks: 75, negativeMarks: 1 },
    ],
    lockSections: false,
    scribeExtraMinutes: 0,
    verification: 'OFFICIAL',
    source: 'ssc.gov.in MTS & Havaldar notice 27 Jun 2024 (para 14.6, 18.2-18.6)',
    remark: '3 marks per question. Session I (45 min): NO negative marking. Session II (45 min): -1 per wrong answer. Merit for MTS is Session II only.',
  },
  {
    key: 'cpo-p1',
    examSlugs: ['cpo'],
    name: 'SSC CPO SI Paper I',
    match: { tier: null, paper: 'PAPER_1' },
    totalQuestions: 200,
    totalMarks: 200,
    durationMinutes: 120,
    negativeMarks: 0.25,
    sections: [
      { name: 'General Intelligence & Reasoning', subjectSlug: SUB.reasoning, questions: 50, marks: 50, durationMinutes: 30 },
      { name: 'General Knowledge & General Awareness', subjectSlug: SUB.ga, questions: 50, marks: 50, durationMinutes: 30 },
      { name: 'Quantitative Aptitude', subjectSlug: SUB.quant, questions: 50, marks: 50, durationMinutes: 30 },
      { name: 'English Comprehension', subjectSlug: SUB.english, questions: 50, marks: 50, durationMinutes: 30 },
    ],
    lockSections: true,
    scribeExtraMinutes: 0,
    verification: 'OFFICIAL',
    source: CPO_SCHEME,
    remark: '1 mark per question, -0.25 per wrong answer; 2 hours with a 30-minute sectional timer per part.',
  },
  {
    key: 'cpo-p2',
    examSlugs: ['cpo'],
    name: 'SSC CPO SI Paper II',
    match: { tier: null, paper: 'PAPER_2' },
    totalQuestions: 200,
    totalMarks: 200,
    durationMinutes: 120,
    negativeMarks: 0.25,
    sections: [{ name: 'English Language & Comprehension', subjectSlug: SUB.english, questions: 200, marks: 200 }],
    lockSections: false,
    scribeExtraMinutes: 0,
    verification: 'OFFICIAL',
    source: CPO_SCHEME,
    remark: '1 mark per question, -0.25 per wrong answer. The notice also prints a 30-minute sectional timer per part; it is not modelled for this single-subject paper.',
  },
  {
    key: 'gd',
    examSlugs: ['gd', 'gd-constable', 'constable-gd'],
    name: 'SSC GD Constable CBE',
    match: { tier: null, paper: 'PAPER_1' },
    totalQuestions: 80,
    totalMarks: 160,
    durationMinutes: 60,
    negativeMarks: 0.25,
    sections: [
      { name: 'General Intelligence & Reasoning', subjectSlug: SUB.reasoning, questions: 20, marks: 40 },
      { name: 'General Knowledge & General Awareness', subjectSlug: SUB.ga, questions: 20, marks: 40 },
      { name: 'Elementary Mathematics', subjectSlug: SUB.quant, questions: 20, marks: 40 },
      { name: 'English / Hindi', subjectSlug: SUB.english, questions: 20, marks: 40 },
    ],
    lockSections: false,
    scribeExtraMinutes: 0,
    verification: 'OFFICIAL',
    source: 'ssc.gov.in Constable (GD) 2026 notice dated 01.12.2025 (para 12.1, 14.2)',
    remark: '2 marks per question, -0.25 per wrong answer (not 0.50), 60 minutes for all four parts.',
  },
  {
    key: 'steno',
    examSlugs: ['steno', 'stenographer', 'ssc-steno', 'stenographer-c-d'],
    name: 'SSC Stenographer Grade C & D CBT',
    match: { tier: null, paper: 'PAPER_1' },
    totalQuestions: 200,
    totalMarks: 200,
    durationMinutes: 120,
    negativeMarks: 0.25,
    sections: [
      { name: 'General Intelligence & Reasoning', subjectSlug: SUB.reasoning, questions: 50, marks: 50 },
      { name: 'General Awareness', subjectSlug: SUB.ga, questions: 50, marks: 50 },
      { name: 'English Language & Comprehension', subjectSlug: SUB.english, questions: 100, marks: 100 },
    ],
    lockSections: false,
    scribeExtraMinutes: 0,
    verification: 'SECONDARY',
    source: 'coaching sites (Mahendras 2026, PW, Embibe agree); official notice PDF could not be opened',
    remark: '1 mark per question, -0.25 per wrong answer, 2 hours (2h40 PwD). Skill test is qualifying only. Compare with the current notice.',
  },
  {
    key: 'je-p1',
    examSlugs: ['je', 'ssc-je', 'junior-engineer'],
    name: 'SSC JE Paper I',
    match: { tier: null, paper: 'PAPER_1' },
    totalQuestions: 200,
    totalMarks: 200,
    durationMinutes: 120,
    negativeMarks: 0.25,
    sections: [
      { name: 'General Intelligence & Reasoning', subjectSlug: SUB.reasoning, questions: 50, marks: 50 },
      { name: 'General Awareness', subjectSlug: SUB.ga, questions: 50, marks: 50 },
      { name: 'General Engineering', subjectSlug: null, questions: 100, marks: 100 },
    ],
    lockSections: false,
    scribeExtraMinutes: 0,
    verification: 'SECONDARY',
    source: 'Made Easy / coaching pattern pages; official notice PDF could not be opened',
    remark: '1 mark per question, -0.25 per wrong answer, 2 hours. Compare with the current notice.',
  },
  {
    key: 'je-p2',
    examSlugs: ['je', 'ssc-je', 'junior-engineer'],
    name: 'SSC JE Paper II',
    match: { tier: null, paper: 'PAPER_2' },
    totalQuestions: 100,
    totalMarks: 300,
    durationMinutes: 120,
    negativeMarks: 1,
    sections: [{ name: 'General Engineering (Civil / Electrical / Mechanical)', subjectSlug: null, questions: 100, marks: 300 }],
    lockSections: false,
    scribeExtraMinutes: 0,
    verification: 'SECONDARY',
    source: 'Made Easy / coaching pattern pages; official notice PDF could not be opened',
    remark: '3 marks per question, -1 per wrong answer, 2 hours. Compare with the current notice.',
  },
  {
    key: 'selection-post',
    examSlugs: ['selection-post', 'selection_post', 'selection'],
    name: 'SSC Selection Post CBT',
    match: { tier: null, paper: 'PAPER_1' },
    totalQuestions: 100,
    totalMarks: 200,
    durationMinutes: 60,
    negativeMarks: 0.5,
    sections: [
      { name: 'General Intelligence', subjectSlug: SUB.reasoning, questions: 25, marks: 50 },
      { name: 'General Awareness', subjectSlug: SUB.ga, questions: 25, marks: 50 },
      { name: 'Quantitative Aptitude (Basic Arithmetic Skill)', subjectSlug: SUB.quant, questions: 25, marks: 50 },
      { name: 'English Language (Basic Knowledge)', subjectSlug: SUB.english, questions: 25, marks: 50 },
    ],
    lockSections: false,
    scribeExtraMinutes: 0,
    verification: 'SECONDARY',
    source: 'IIT Kanpur SATHEE + Mahendras Phase XIV page; the notice PDF could not be opened',
    remark: 'Same pattern for Matriculation, Higher Secondary and Graduation levels (only difficulty differs). 2 marks, -0.50, 60 min (80 scribe).',
  },
  // ============================================================================================================
  // S42 (29 Oct 2026) - exams outside SSC. Every number below was read from the page named in `source`; NONE of these
  // was read from the official notice itself (RRB / IBPS / SBI / RBI / UPSC / UPPRPB PDFs could not be opened from here,
  // except the RRB JE CEN 03/2024 notice copy), so all are 'SECONDARY': compare with the current notice before trusting.
  // Not here on purpose (sources disagreed or gave no section split): RRB ALP CBT 2, banking / insurance MAINS,
  // LIC AAO / LIC Assistant, AFCAT, Agniveer, Coast Guard, CAPF AC, Delhi Police Head Constable, Bihar / Rajasthan /
  // MP / Haryana Police. The admin creates those patterns by hand (Admin -> Exam Patterns).
  // ============================================================================================================

  // ---- Railway (RRB / RPF): 1 mark per question, 1/3 mark deducted per wrong answer ----
  {
    key: 'rrb-ntpc-cbt1',
    examSlugs: ['rrb-ntpc', 'ntpc'],
    name: 'RRB NTPC CBT 1',
    match: { tier: 'TIER_1', paper: 'PAPER_1' },
    totalQuestions: 100,
    totalMarks: 100,
    durationMinutes: 90,
    negativeMarks: 1 / 3,
    sections: [
      { name: 'General Awareness', subjectSlug: SUB.ga, questions: 40, marks: 40 },
      { name: 'Mathematics', subjectSlug: SUB.quant, questions: 30, marks: 30 },
      { name: 'General Intelligence & Reasoning', subjectSlug: SUB.reasoning, questions: 30, marks: 30 },
    ],
    lockSections: false,
    scribeExtraMinutes: 30,
    verification: 'SECONDARY',
    source: RRB_SATHEE + ' (rrb-ntpc exam pattern)',
    remark: 'Same CBT 1 for Graduate and Under-Graduate posts. -1/3 per wrong answer as in every RRB CBT. 120 min with scribe.',
  },
  {
    key: 'rrb-ntpc-cbt2',
    examSlugs: ['rrb-ntpc', 'ntpc'],
    name: 'RRB NTPC CBT 2',
    match: { tier: 'TIER_2', paper: 'PAPER_1' },
    totalQuestions: 120,
    totalMarks: 120,
    durationMinutes: 90,
    negativeMarks: 1 / 3,
    sections: [
      { name: 'General Awareness', subjectSlug: SUB.ga, questions: 50, marks: 50 },
      { name: 'Mathematics', subjectSlug: SUB.quant, questions: 35, marks: 35 },
      { name: 'General Intelligence & Reasoning', subjectSlug: SUB.reasoning, questions: 35, marks: 35 },
    ],
    lockSections: false,
    scribeExtraMinutes: 30,
    verification: 'SECONDARY',
    source: RRB_SATHEE + ' (rrb-ntpc exam pattern)',
    remark: 'Post-wise CBT 2 papers have the same structure. Typing / CBAT tests are not MCQ papers and are not modelled.',
  },
  {
    key: 'rrb-group-d',
    examSlugs: ['rrb-group-d', 'group-d', 'rrb-gd'],
    name: 'RRB Group D CBT',
    match: { tier: null, paper: 'PAPER_1' },
    totalQuestions: 100,
    totalMarks: 100,
    durationMinutes: 90,
    negativeMarks: 1 / 3,
    sections: [
      { name: 'General Science', subjectSlug: SUB.science, questions: 25, marks: 25 },
      { name: 'Mathematics', subjectSlug: SUB.quant, questions: 25, marks: 25 },
      { name: 'General Intelligence & Reasoning', subjectSlug: SUB.reasoning, questions: 30, marks: 30 },
      { name: 'General Awareness & Current Affairs', subjectSlug: SUB.ga, questions: 20, marks: 20 },
    ],
    lockSections: false,
    scribeExtraMinutes: 30,
    verification: 'SECONDARY',
    source: RRB_SATHEE + ' (rrb-group-d exam pattern: "1/3 marks shall be deducted for each wrong answer")',
    remark: 'The notice calls the section split indicative (small variation possible).',
  },
  {
    key: 'rrb-alp-cbt1',
    examSlugs: ['rrb-alp', 'alp'],
    name: 'RRB ALP CBT 1',
    match: { tier: 'TIER_1', paper: 'PAPER_1' },
    totalQuestions: 75,
    totalMarks: 75,
    durationMinutes: 60,
    negativeMarks: 1 / 3,
    sections: [
      { name: 'Mathematics', subjectSlug: SUB.quant, questions: 25, marks: 25 },
      { name: 'Mental Ability (General Intelligence & Reasoning)', subjectSlug: SUB.reasoning, questions: 25, marks: 25 },
      { name: 'General Science', subjectSlug: SUB.science, questions: 25, marks: 25 },
    ],
    lockSections: false,
    scribeExtraMinutes: 20,
    verification: 'SECONDARY',
    source: 'pw.live RRB ALP exam pattern 2026 + testbook (CEN 01/2026: "General Awareness and Current Affairs section has been removed")',
    remark: 'Latest notice (CEN 01/2026). Older papers (CEN 01/2024, 01/2025) had Maths 20, Reasoning 25, Science 20, GA 10 - edit the pattern if your mocks are for those papers. CBT 2 (Part A 100 Q / 90 min, Part B 75 Q trade, qualifying) is not here: no official section split was found.',
  },
  {
    key: 'rrb-technician',
    examSlugs: ['rrb-technician', 'technician'],
    name: 'RRB Technician Grade III CBT',
    match: { tier: null, paper: 'PAPER_1' },
    totalQuestions: 100,
    totalMarks: 100,
    durationMinutes: 90,
    negativeMarks: 1 / 3,
    sections: [
      { name: 'Mathematics', subjectSlug: SUB.quant, questions: 25, marks: 25 },
      { name: 'General Intelligence & Reasoning', subjectSlug: SUB.reasoning, questions: 25, marks: 25 },
      { name: 'General Science', subjectSlug: SUB.science, questions: 40, marks: 40 },
      { name: 'General Awareness', subjectSlug: SUB.ga, questions: 10, marks: 10 },
    ],
    lockSections: false,
    scribeExtraMinutes: 30,
    verification: 'SECONDARY',
    source: RRB_SATHEE + ' (rrb-technician exam pattern, Grade III)',
    remark: 'Grade I Signal has another split (GA 10, Reasoning 15, Computers 20, Maths 20, Basic Science & Engineering 35) - create it by hand if needed. The page does not print the negative marking; -1/3 is the RRB rule, confirm in the notice.',
  },
  {
    key: 'rrb-je-cbt1',
    examSlugs: ['rrb-je'],
    name: 'RRB JE CBT 1',
    match: { tier: 'TIER_1', paper: 'PAPER_1' },
    totalQuestions: 100,
    totalMarks: 100,
    durationMinutes: 90,
    negativeMarks: 1 / 3,
    sections: [
      { name: 'Mathematics', subjectSlug: SUB.quant, questions: 30, marks: 30 },
      { name: 'General Intelligence & Reasoning', subjectSlug: SUB.reasoning, questions: 25, marks: 25 },
      { name: 'General Awareness', subjectSlug: SUB.ga, questions: 15, marks: 15 },
      { name: 'General Science', subjectSlug: SUB.science, questions: 30, marks: 30 },
    ],
    lockSections: false,
    scribeExtraMinutes: 30,
    verification: 'SECONDARY',
    source: 'RRB JE CEN 03/2024 notification (copy hosted by sscadda.com), 1st stage CBT table',
    remark: 'Section split is indicative per the notice. The excerpt read did not print the negative marking; -1/3 is the RRB rule, confirm in the notice.',
  },
  {
    key: 'rrb-je-cbt2',
    examSlugs: ['rrb-je'],
    name: 'RRB JE CBT 2',
    match: { tier: 'TIER_2', paper: 'PAPER_1' },
    totalQuestions: 150,
    totalMarks: 150,
    durationMinutes: 120,
    negativeMarks: 1 / 3,
    sections: [
      { name: 'General Awareness', subjectSlug: SUB.ga, questions: 15, marks: 15 },
      { name: 'Physics & Chemistry', subjectSlug: SUB.science, questions: 15, marks: 15 },
      { name: 'Basics of Computers and Applications', subjectSlug: SUB.computer, questions: 10, marks: 10 },
      { name: 'Basics of Environment and Pollution Control', subjectSlug: SUB.science, questions: 10, marks: 10 },
      { name: 'Technical Abilities', subjectSlug: null, questions: 100, marks: 100 },
    ],
    lockSections: false,
    scribeExtraMinutes: 40,
    verification: 'SECONDARY',
    source: 'RRB JE CEN 03/2024 notification (copy hosted by sscadda.com), 2nd stage CBT table',
    remark: 'Technical Abilities depends on the engineering branch, so it has no subject here (the mock cannot compose it automatically). Virtual calculator allowed.',
  },
  {
    key: 'rpf-constable',
    examSlugs: ['rpf-constable'],
    name: 'RPF Constable CBT',
    match: { tier: null, paper: 'PAPER_1' },
    totalQuestions: 120,
    totalMarks: 120,
    durationMinutes: 90,
    negativeMarks: 1 / 3,
    sections: [
      { name: 'General Awareness', subjectSlug: SUB.ga, questions: 50, marks: 50 },
      { name: 'Basic Arithmetic', subjectSlug: SUB.quant, questions: 35, marks: 35 },
      { name: 'General Intelligence & Reasoning', subjectSlug: SUB.reasoning, questions: 35, marks: 35 },
    ],
    lockSections: false,
    scribeExtraMinutes: 0,
    verification: 'SECONDARY',
    source: RRB_SATHEE + ' (rpf-constable exam pattern: "deduction of 1/3 mark")',
    remark: '10th standard level.',
  },
  {
    key: 'rpf-si',
    examSlugs: ['rpf-si'],
    name: 'RPF SI CBT',
    match: { tier: null, paper: 'PAPER_1' },
    totalQuestions: 120,
    totalMarks: 120,
    durationMinutes: 90,
    negativeMarks: 1 / 3,
    sections: [
      { name: 'General Awareness', subjectSlug: SUB.ga, questions: 50, marks: 50 },
      { name: 'Arithmetic', subjectSlug: SUB.quant, questions: 35, marks: 35 },
      { name: 'General Intelligence & Reasoning', subjectSlug: SUB.reasoning, questions: 35, marks: 35 },
    ],
    lockSections: false,
    scribeExtraMinutes: 0,
    verification: 'SECONDARY',
    source: RRB_SATHEE + ' (rpf-si exam pattern: marks 50 / 35 / 35, 1/3 negative)',
    remark: 'The page gives marks per section (1 mark per question), so questions = marks.',
  },

  // ---- Banking / Insurance PRELIMS: 1 mark per question, 0.25 deducted per wrong answer, sectional timers ----
  {
    key: 'ibps-po-pre',
    examSlugs: ['ibps-po'],
    name: 'IBPS PO Prelims',
    match: { tier: 'TIER_1', paper: 'PAPER_1' },
    totalQuestions: 100,
    totalMarks: 100,
    durationMinutes: 60,
    negativeMarks: 0.25,
    sections: [
      { name: 'English Language', subjectSlug: SUB.english, questions: 30, marks: 30, durationMinutes: 20 },
      { name: 'Quantitative Aptitude', subjectSlug: SUB.quant, questions: 35, marks: 35, durationMinutes: 20 },
      { name: 'Reasoning Ability', subjectSlug: SUB.reasoning, questions: 35, marks: 35, durationMinutes: 20 },
    ],
    lockSections: true,
    scribeExtraMinutes: 0,
    verification: 'SECONDARY',
    source: 'store.pw.live IBPS PO syllabus 2025 (prelims table)',
    remark: 'Mains changes almost every year (2025: Section A / B with 2-mark and 1-mark questions) - create the Mains pattern by hand from the notice.',
  },
  {
    key: 'ibps-clerk-pre',
    examSlugs: ['ibps-clerk'],
    name: 'IBPS Clerk Prelims',
    match: { tier: 'TIER_1', paper: 'PAPER_1' },
    totalQuestions: 100,
    totalMarks: 100,
    durationMinutes: 60,
    negativeMarks: 0.25,
    sections: [
      { name: 'English Language', subjectSlug: SUB.english, questions: 30, marks: 30, durationMinutes: 20 },
      { name: 'Numerical Ability', subjectSlug: SUB.quant, questions: 35, marks: 35, durationMinutes: 20 },
      { name: 'Reasoning Ability', subjectSlug: SUB.reasoning, questions: 35, marks: 35, durationMinutes: 20 },
    ],
    lockSections: true,
    scribeExtraMinutes: 0,
    verification: 'SECONDARY',
    source: 'edutap.in IBPS Clerk exam pattern 2026',
    remark: 'Mains not modelled (sources disagree on the section times).',
  },
  {
    key: 'ibps-rrb-po-pre',
    examSlugs: ['ibps-rrb-po'],
    name: 'IBPS RRB PO Prelims',
    match: { tier: 'TIER_1', paper: 'PAPER_1' },
    totalQuestions: 80,
    totalMarks: 80,
    durationMinutes: 45,
    negativeMarks: 0.25,
    sections: [
      { name: 'Reasoning', subjectSlug: SUB.reasoning, questions: 40, marks: 40 },
      { name: 'Quantitative Aptitude', subjectSlug: SUB.quant, questions: 40, marks: 40 },
    ],
    lockSections: false,
    scribeExtraMinutes: 0,
    verification: 'SECONDARY',
    source: 'bankersadda.com IBPS RRB syllabus (80 questions, 80 marks, 45 minutes, 2 sections, -0.25)',
    remark: 'One composite 45-minute timer, sectional cut-off. 40 + 40 is the usual split; the page gave only the totals.',
  },
  {
    key: 'ibps-rrb-clerk-pre',
    examSlugs: ['ibps-rrb-clerk'],
    name: 'IBPS RRB Clerk Prelims',
    match: { tier: 'TIER_1', paper: 'PAPER_1' },
    totalQuestions: 80,
    totalMarks: 80,
    durationMinutes: 45,
    negativeMarks: 0.25,
    sections: [
      { name: 'Reasoning Ability', subjectSlug: SUB.reasoning, questions: 40, marks: 40 },
      { name: 'Numerical Ability', subjectSlug: SUB.quant, questions: 40, marks: 40 },
    ],
    lockSections: false,
    scribeExtraMinutes: 0,
    verification: 'SECONDARY',
    source: 'bankersadda.com IBPS RRB syllabus (80 questions, 80 marks, 45 minutes, 2 sections, -0.25)',
    remark: 'Office Assistant (Multipurpose). One composite 45-minute timer. 40 + 40 is the usual split; the page gave only the totals.',
  },
  {
    key: 'sbi-po-pre',
    examSlugs: ['sbi-po'],
    name: 'SBI PO Prelims',
    match: { tier: 'TIER_1', paper: 'PAPER_1' },
    totalQuestions: 100,
    totalMarks: 100,
    durationMinutes: 60,
    negativeMarks: 0.25,
    sections: [
      { name: 'English Language', subjectSlug: SUB.english, questions: 40, marks: 40, durationMinutes: 20 },
      { name: 'Quantitative Aptitude', subjectSlug: SUB.quant, questions: 30, marks: 30, durationMinutes: 20 },
      { name: 'Reasoning Ability', subjectSlug: SUB.reasoning, questions: 30, marks: 30, durationMinutes: 20 },
    ],
    lockSections: true,
    scribeExtraMinutes: 0,
    verification: 'SECONDARY',
    source: 'oliveboard.in "SBI PO 2025 changes" (2025 pattern: English 40, Quant 30, Reasoning 30) + careers360 (same split)',
    remark: 'Before 2025 the split was 30 / 35 / 35. Mains (2025: 170 Q, 200 marks, 3 h) is not modelled.',
  },
  {
    key: 'sbi-clerk-pre',
    examSlugs: ['sbi-clerk'],
    name: 'SBI Clerk Prelims',
    match: { tier: 'TIER_1', paper: 'PAPER_1' },
    totalQuestions: 100,
    totalMarks: 100,
    durationMinutes: 60,
    negativeMarks: 0.25,
    sections: [
      { name: 'English Language', subjectSlug: SUB.english, questions: 30, marks: 30, durationMinutes: 20 },
      { name: 'Numerical Ability', subjectSlug: SUB.quant, questions: 35, marks: 35, durationMinutes: 20 },
      { name: 'Reasoning Ability', subjectSlug: SUB.reasoning, questions: 35, marks: 35, durationMinutes: 20 },
    ],
    lockSections: true,
    scribeExtraMinutes: 0,
    verification: 'SECONDARY',
    source: 'store.pw.live SBI Clerk exam pattern',
    remark: 'Junior Associates. Mains (190 Q, 200 marks, 2 h 40 min) is not modelled.',
  },
  {
    key: 'rbi-assistant-pre',
    examSlugs: ['rbi-assistant'],
    name: 'RBI Assistant Prelims',
    match: { tier: 'TIER_1', paper: 'PAPER_1' },
    totalQuestions: 100,
    totalMarks: 100,
    durationMinutes: 60,
    negativeMarks: 0.25,
    sections: [
      { name: 'English Language', subjectSlug: SUB.english, questions: 30, marks: 30, durationMinutes: 20 },
      { name: 'Numerical Ability', subjectSlug: SUB.quant, questions: 35, marks: 35, durationMinutes: 20 },
      { name: 'Reasoning Ability', subjectSlug: SUB.reasoning, questions: 35, marks: 35, durationMinutes: 20 },
    ],
    lockSections: true,
    scribeExtraMinutes: 0,
    verification: 'SECONDARY',
    source: 'testbook.com RBI Assistant syllabus & exam pattern',
  },
  {
    key: 'rbi-grade-b-p1',
    examSlugs: ['rbi-grade-b'],
    name: 'RBI Grade B Phase I',
    match: { tier: 'TIER_1', paper: 'PAPER_1' },
    totalQuestions: 200,
    totalMarks: 200,
    durationMinutes: 120,
    negativeMarks: 0.25,
    sections: [
      { name: 'General Awareness', subjectSlug: SUB.ga, questions: 80, marks: 80, durationMinutes: 25 },
      { name: 'Reasoning', subjectSlug: SUB.reasoning, questions: 60, marks: 60, durationMinutes: 45 },
      { name: 'English Language', subjectSlug: SUB.english, questions: 30, marks: 30, durationMinutes: 25 },
      { name: 'Quantitative Aptitude', subjectSlug: SUB.quant, questions: 30, marks: 30, durationMinutes: 25 },
    ],
    lockSections: true,
    scribeExtraMinutes: 0,
    verification: 'SECONDARY',
    source: 'practicemock.com RBI Grade B exam pattern (Phase 1, 2026)',
    remark: 'Phase I is qualifying (sectional + overall cut-off). Phase II (descriptive + ESI / F&M) is not modelled.',
  },
  {
    key: 'niacl-ao-pre',
    examSlugs: ['niacl-ao'],
    name: 'NIACL AO Prelims',
    match: { tier: 'TIER_1', paper: 'PAPER_1' },
    totalQuestions: 100,
    totalMarks: 100,
    durationMinutes: 60,
    negativeMarks: 0.25,
    sections: [
      { name: 'English Language', subjectSlug: SUB.english, questions: 30, marks: 30, durationMinutes: 20 },
      { name: 'Quantitative Aptitude', subjectSlug: SUB.quant, questions: 35, marks: 35, durationMinutes: 20 },
      { name: 'Reasoning Ability', subjectSlug: SUB.reasoning, questions: 35, marks: 35, durationMinutes: 20 },
    ],
    lockSections: true,
    scribeExtraMinutes: 0,
    verification: 'SECONDARY',
    source: 'embibe.com NIACL AO exam pattern',
  },
  {
    key: 'niacl-assistant-pre',
    examSlugs: ['niacl-assistant'],
    name: 'NIACL Assistant Prelims',
    match: { tier: 'TIER_1', paper: 'PAPER_1' },
    totalQuestions: 100,
    totalMarks: 100,
    durationMinutes: 60,
    negativeMarks: 0.25,
    sections: [
      { name: 'English Language', subjectSlug: SUB.english, questions: 30, marks: 30, durationMinutes: 20 },
      { name: 'Numerical Ability', subjectSlug: SUB.quant, questions: 35, marks: 35, durationMinutes: 20 },
      { name: 'Reasoning', subjectSlug: SUB.reasoning, questions: 35, marks: 35, durationMinutes: 20 },
    ],
    lockSections: true,
    scribeExtraMinutes: 0,
    verification: 'SECONDARY',
    source: 'embibe.com NIACL Assistant prelims exam pattern',
  },

  // ---- Defence (UPSC): one third of the question's marks deducted per wrong answer ----
  {
    key: 'cds-p1',
    examSlugs: ['cds', 'upsc-cds'],
    name: 'UPSC CDS Paper I (English)',
    match: { tier: null, paper: 'PAPER_1' },
    totalQuestions: 120,
    totalMarks: 100,
    durationMinutes: 120,
    negativeMarks: Math.round((100 / 120 / 3) * 10000) / 10000,
    sections: [{ name: 'English', subjectSlug: SUB.english, questions: 120, marks: 100 }],
    lockSections: false,
    scribeExtraMinutes: 0,
    verification: 'SECONDARY',
    source: 'career.aglasem.com CDS exam pattern ("one third of the marks assigned to a question is deducted")',
    remark: 'Each paper is a separate 2-hour session. 100 / 120 = 0.833 marks per question, -0.278 per wrong answer.',
  },
  {
    key: 'cds-p2',
    examSlugs: ['cds', 'upsc-cds'],
    name: 'UPSC CDS Paper II (General Knowledge)',
    match: { tier: null, paper: 'PAPER_2' },
    totalQuestions: 120,
    totalMarks: 100,
    durationMinutes: 120,
    negativeMarks: Math.round((100 / 120 / 3) * 10000) / 10000,
    sections: [{ name: 'General Knowledge', subjectSlug: SUB.ga, questions: 120, marks: 100 }],
    lockSections: false,
    scribeExtraMinutes: 0,
    verification: 'SECONDARY',
    source: 'career.aglasem.com CDS exam pattern',
  },
  {
    key: 'cds-p3',
    examSlugs: ['cds', 'upsc-cds'],
    name: 'UPSC CDS Paper III (Elementary Mathematics)',
    match: { tier: null, paper: 'PAPER_3' },
    totalQuestions: 100,
    totalMarks: 100,
    durationMinutes: 120,
    negativeMarks: Math.round((1 / 3) * 10000) / 10000,
    sections: [{ name: 'Elementary Mathematics', subjectSlug: SUB.quant, questions: 100, marks: 100 }],
    lockSections: false,
    scribeExtraMinutes: 0,
    verification: 'SECONDARY',
    source: 'career.aglasem.com CDS exam pattern',
    remark: 'IMA / INA / AFA only (OTA candidates write Papers I and II).',
  },
  {
    key: 'nda-p1',
    examSlugs: ['nda', 'upsc-nda'],
    name: 'UPSC NDA Paper I (Mathematics)',
    match: { tier: null, paper: 'PAPER_1' },
    totalQuestions: 120,
    totalMarks: 300,
    durationMinutes: 150,
    negativeMarks: Math.round((2.5 / 3) * 10000) / 10000,
    sections: [{ name: 'Mathematics', subjectSlug: SUB.maths, questions: 120, marks: 300 }],
    lockSections: false,
    scribeExtraMinutes: 0,
    verification: 'SECONDARY',
    source: 'pwonlyias.com UPSC NDA exam pattern (2.5 marks, -0.83)',
    remark: 'Class 11-12 Mathematics (subject "Mathematics", not the SSC Quantitative Aptitude).',
  },
  {
    key: 'nda-p2',
    examSlugs: ['nda', 'upsc-nda'],
    name: 'UPSC NDA Paper II (General Ability Test)',
    match: { tier: null, paper: 'PAPER_2' },
    totalQuestions: 150,
    totalMarks: 600,
    durationMinutes: 150,
    negativeMarks: Math.round((4 / 3) * 10000) / 10000,
    sections: [
      { name: 'Part A · English', subjectSlug: SUB.english, questions: 50, marks: 200 },
      { name: 'Part B · General Knowledge', subjectSlug: SUB.ga, questions: 100, marks: 400 },
    ],
    lockSections: false,
    scribeExtraMinutes: 0,
    verification: 'SECONDARY',
    source: 'pwonlyias.com UPSC NDA exam pattern (4 marks, -1.33; English 50 Q / 200, GK 100 Q / 400)',
    remark: 'GK covers Physics, Chemistry, General Science, History, Geography and current events (all under General Awareness here).',
  },

  // ---- State police ----
  {
    key: 'up-police-constable',
    examSlugs: ['up-police-constable', 'uppc'],
    name: 'UP Police Constable Written Exam',
    match: { tier: null, paper: 'PAPER_1' },
    totalQuestions: 150,
    totalMarks: 300,
    durationMinutes: 120,
    negativeMarks: 0.5,
    sections: [
      { name: 'General Knowledge', subjectSlug: SUB.ga, questions: 38, marks: 76 },
      { name: 'General Hindi', subjectSlug: SUB.hindi, questions: 37, marks: 74 },
      { name: 'Numerical & Mental Ability', subjectSlug: SUB.quant, questions: 38, marks: 76 },
      { name: 'Mental Aptitude / IQ / Reasoning', subjectSlug: SUB.reasoning, questions: 37, marks: 74 },
    ],
    lockSections: false,
    scribeExtraMinutes: 0,
    verification: 'SECONDARY',
    source: 'oliveboard.in UP Police Constable syllabus (38 / 37 / 38 / 37, +2 / -0.5) + aglasem (150 Q, 300 marks, 2 h, -0.5)',
    remark: 'Hindi questions are written in Hindi; they still need the English text column filled (the Hindi gate applies to every subject except English).',
  },
  {
    key: 'up-police-si',
    examSlugs: ['up-police-si', 'upsi'],
    name: 'UP Police SI Written Exam',
    match: { tier: null, paper: 'PAPER_1' },
    totalQuestions: 160,
    totalMarks: 400,
    durationMinutes: 120,
    negativeMarks: 0,
    sections: [
      { name: 'General Hindi', subjectSlug: SUB.hindi, questions: 40, marks: 100 },
      { name: 'Basic Law / Constitution / General Knowledge', subjectSlug: SUB.ga, questions: 40, marks: 100 },
      { name: 'Numerical & Mental Ability', subjectSlug: SUB.quant, questions: 40, marks: 100 },
      { name: 'Mental Aptitude / IQ / Reasoning', subjectSlug: SUB.reasoning, questions: 40, marks: 100 },
    ],
    lockSections: false,
    scribeExtraMinutes: 0,
    verification: 'SECONDARY',
    source: 'career.aglasem.com UP Police SI exam pattern (4 x 40 Q, 2.5 marks each, "no negative marking")',
    remark: 'Sectional minimum 35% applies. No negative marking per the source - confirm in the current notice.',
  },

  // ---- SSC: Delhi Police ----
  {
    key: 'dp-constable',
    examSlugs: ['dp', 'delhi-police', 'delhi-police-constable'],
    name: 'Delhi Police Constable CBE',
    match: { tier: null, paper: 'PAPER_1' },
    totalQuestions: 100,
    totalMarks: 100,
    durationMinutes: 90,
    negativeMarks: 0.25,
    sections: [
      { name: 'General Knowledge / Current Affairs', subjectSlug: SUB.ga, questions: 50, marks: 50 },
      { name: 'Reasoning', subjectSlug: SUB.reasoning, questions: 25, marks: 25 },
      { name: 'Numerical Ability', subjectSlug: SUB.quant, questions: 15, marks: 15 },
      { name: 'Computer Fundamentals', subjectSlug: SUB.computer, questions: 10, marks: 10 },
    ],
    lockSections: false,
    scribeExtraMinutes: 0,
    verification: 'SECONDARY',
    source: 'oliveboard.in SSC Delhi Police Constable exam pattern 2025',
    remark: 'Constable (Executive). Head Constable has a different paper - create it by hand.',
  },
];

// ------------------------------------------------------------------------------------------------ classify

export interface PatternKey {
  tier: PresetTier;
  paper: PresetPaper;
}

/**
 * "SSC CGL 2026 — Tier 2 Paper I (Session I)" -> { TIER_2, PAPER_1 }. No tier word = no tier; no paper word = Paper 1.
 * S42: the stage words of other exams count too - "CBT 1" / "Prelims" / "Phase I" / "Stage I" = Tier 1 and
 * "CBT 2" / "Mains" / "Phase II" / "Stage II" = Tier 2 (RRB, IBPS, SBI, RBI), the same mapping the Master Package asks for.
 */
export function classifyPatternName(name: string): PatternKey {
  const n = String(name ?? '');
  const t2 = /tier[\s_-]*(2|ii)\b/i.test(n) || /\bcbt[\s_-]*(2|ii)\b/i.test(n) || /\bmains?\b/i.test(n) || /\b(phase|stage)[\s_-]*(2|ii)\b/i.test(n);
  const t1 = /tier[\s_-]*(1|i)\b/i.test(n) || /\bcbt[\s_-]*(1|i)\b/i.test(n) || /\bprelim(s|inary)?\b/i.test(n) || /\b(phase|stage)[\s_-]*(1|i)\b/i.test(n);
  const tier: PresetTier = t2 ? 'TIER_2' : t1 ? 'TIER_1' : null;
  const m = /paper[\s_-]*(1|2|3|iii|ii|i)\b/i.exec(n);
  const token = m ? m[1].toLowerCase() : '1';
  const paper: PresetPaper = token === '2' || token === 'ii' ? 'PAPER_2' : token === '3' || token === 'iii' ? 'PAPER_3' : 'PAPER_1';
  return { tier, paper };
}

// ------------------------------------------------------------------------------------------------ sync planner

export interface ExistingPattern {
  id: string;
  examId: string;
  name: string;
  isActive: boolean;
  totalQuestions: number;
  totalMarks: number;
  durationMinutes: number;
  negativeMarks: number;
  sections: unknown;
  lockPreviousSections: boolean;
}

export interface PatternWrite {
  totalQuestions: number;
  totalMarks: number;
  durationMinutes: number;
  negativeMarks: number;
  sections: PresetSection[];
  sourceNote: string;
}

export interface SyncAction {
  kind: 'update' | 'create' | 'unchanged' | 'skip';
  presetKey: string;
  presetName: string;
  verification: PresetVerification;
  examId?: string;
  patternId?: string;
  patternName?: string;
  changes: string[];
  warnings: string[];
  write?: PatternWrite;
  /** create only */
  create?: PatternWrite & { name: string; lockPreviousSections: boolean; scribeExtraMinutes: number };
}

export function sourceNoteFor(p: ExamPreset): string {
  // The admin page shows a "Verified" badge for notes that start with VERIFIED (patterns/page.tsx isVerified()).
  const head =
    p.verification === 'OFFICIAL'
      ? `VERIFIED ${PRESETS_VERIFIED_ON} against official SSC notice: ${p.source}.`
      : `NOT VERIFIED against the SSC notice — coaching sources only (${PRESETS_VERIFIED_ON}): ${p.source}.`;
  return `${head} ${p.remark ?? ''}`.trim();
}

/**
 * Keep what the admin owns (timers, scribe minutes, names) while taking the marking numbers from the preset.
 * A preset section is matched to an existing one by subject slug, or by position when it has no subject.
 */
export function mergeSections(existing: unknown, preset: PresetSection[]): PresetSection[] {
  const old = readPatternSections(existing);
  const used = new Set<number>();
  return preset.map((ps, i) => {
    let at = -1;
    if (ps.subjectSlug) at = old.findIndex((o, j) => !used.has(j) && !!o.subjectSlug && subjectCoreKey(o.subjectSlug) === subjectCoreKey(ps.subjectSlug));
    else if (old[i] && !used.has(i) && !old[i].subjectSlug) at = i;
    const o = at >= 0 ? old[at] : undefined;
    if (at >= 0) used.add(at);
    const out: any = { name: o?.name || ps.name, subjectSlug: ps.subjectSlug ?? null, questions: ps.questions, marks: ps.marks };
    const dur = o?.durationMinutes && o.durationMinutes > 0 ? o.durationMinutes : ps.durationMinutes;
    if (dur && dur > 0) out.durationMinutes = dur;
    if (o?.scribeMinutes != null) out.scribeMinutes = o.scribeMinutes;
    if (ps.negativeMarks != null) out.negativeMarks = ps.negativeMarks;
    return out as PresetSection;
  });
}

const sig = (sections: unknown) =>
  JSON.stringify(
    readPatternSections(sections).map((s) => [s.subjectSlug ?? '', s.questions ?? 0, s.marks ?? 0, s.negativeMarks ?? null]),
  );

export function planPresetSync(input: {
  presets: ExamPreset[];
  exams: { id: string; slug: string }[];
  patterns: ExistingPattern[];
}): SyncAction[] {
  const out: SyncAction[] = [];
  for (const p of input.presets) {
    const base = { presetKey: p.key, presetName: p.name, verification: p.verification, changes: [] as string[], warnings: [] as string[] };
    const exam = findExamBySlugs(input.exams, p.examSlugs); // S41: "cgl" and "exam-cgl" are the same exam
    if (!exam) {
      out.push({ ...base, kind: 'skip', warnings: [`exam not found (looked for slug: ${p.examSlugs.join(', ')}) — create the exam first`] });
      continue;
    }
    const ofExam = input.patterns.filter((x) => x.examId === exam.id);
    const matches = ofExam.filter((x) => {
      if (!x.isActive) return false;
      const k = classifyPatternName(x.name);
      return k.tier === p.match.tier && k.paper === p.match.paper;
    });
    const write: PatternWrite = {
      totalQuestions: p.totalQuestions,
      totalMarks: p.totalMarks,
      durationMinutes: p.durationMinutes,
      negativeMarks: p.negativeMarks,
      sections: p.sections,
      sourceNote: sourceNoteFor(p),
    };

    if (matches.length === 0) {
      if (ofExam.some((x) => x.name === p.name)) {
        out.push({ ...base, examId: exam.id, kind: 'skip', warnings: [`an inactive pattern named "${p.name}" already exists — activate it (then sync again) or rename it`] });
        continue;
      }
      out.push({
        ...base,
        examId: exam.id,
        kind: 'create',
        changes: [`create "${p.name}" (${p.totalQuestions} Q, ${p.totalMarks} marks, -${p.negativeMarks})`],
        create: { ...write, name: p.name, lockPreviousSections: p.lockSections, scribeExtraMinutes: p.scribeExtraMinutes },
      });
      continue;
    }

    for (const m of matches) {
      const merged = mergeSections(m.sections, p.sections);
      const changes: string[] = [];
      const warnings: string[] = [];
      if (m.totalQuestions !== p.totalQuestions) changes.push(`questions ${m.totalQuestions} -> ${p.totalQuestions}`);
      if (m.totalMarks !== p.totalMarks) changes.push(`total marks ${m.totalMarks} -> ${p.totalMarks}`);
      if (m.durationMinutes !== p.durationMinutes) changes.push(`duration ${m.durationMinutes} -> ${p.durationMinutes} min`);
      if (Number(m.negativeMarks) !== p.negativeMarks) changes.push(`negative ${m.negativeMarks} -> ${p.negativeMarks}`);
      if (sig(m.sections) !== sig(merged)) changes.push('sections (questions / marks / per-section negative) differ');
      if (m.lockPreviousSections && readPatternSections(merged).some((s) => !((s.durationMinutes ?? 0) > 0))) {
        warnings.push('sections are locked but a section has no timer after the sync — set durationMinutes on it');
      }
      if (matches.length > 1) warnings.push(`${matches.length} active patterns describe this same tier/paper — deactivate the duplicates, otherwise paper lookups by tier cannot pick one`);
      out.push({
        ...base,
        examId: exam.id,
        patternId: m.id,
        patternName: m.name,
        kind: changes.length ? 'update' : 'unchanged',
        changes,
        warnings,
        write: { ...write, sections: merged },
      });
    }
  }
  return out;
}
