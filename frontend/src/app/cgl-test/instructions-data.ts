"use client";

import * as React from "react";

// ---- Types ----
export type CglQuestion = {
  id: string;
  questionText: string;
  questionTextHindi: string | null;
  options: { key: string; text: string; textHi: string | null }[];
  correctAnswer: string;
  explanation: string | null;
  explanationHindi: string | null;
  examName?: string;
  year?: number | null;
  marks: number;
  negativeMarks: number;
  subjectId: string;
};

export type CglSection = {
  part: string;
  name: string;
  subjectSlug: string;
  questionCount: number;
  marks: number;
  minutes: number;
  questions: CglQuestion[];
};

export type CglExam = {
  type: string;
  title: string;
  durationMinutes: number;
  totalQuestions: number;
  totalMarks: number;
  negativeMarks: number;
  sections: CglSection[];
};

const apiBase = () => process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";
const authHeaders = (): Record<string, string> => {
  const token = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

// ---- Instructions content (mirrors the real SSC CGL Tier 1 2025 screen) ----
export const INSTRUCTIONS: { en: string; hi: string }[] = [
  {
    en: "Duration: 1 hour (with sectional timer of 15 minutes for each subject)",
    hi: "समयाविध: 1 घंटा (प्रत्येक विषय के लिए 15 मिनट का अनुभागीय टाइमर)",
  },
  {
    en: "Total Questions: 100",
    hi: "कुल प्रश्न: 100",
  },
  {
    en: "Negative Marking: 0.50 marks deducted for each wrong answer.",
    hi: "ऋणात्मक अंकन: प्रत्येक गलत उत्तर पर 0.50 अंक काटे जाएंगे।",
  },
  {
    en: "Number of Sections displayed at any time: 1",
    hi: "किसी भी समय पर प्रदर्शित अनुभागों की संख्या: 1",
  },
];

export const SECTION_ROW = [
  { part: "A", name: "General Intelligence and Reasoning", q: 25, marks: 50, min: 15 },
  { part: "B", name: "General Awareness", q: 25, marks: 50, min: 15 },
  { part: "C", name: "Quantitative Aptitude", q: 25, marks: 50, min: 15 },
  { part: "D", name: "English Comprehension", q: 25, marks: 50, min: 15 },
];

export const TIMING_NOTES: { en: string; hi: string }[] = [
  {
    en: "The timer (top right) is server-controlled; Remaining time for the active section appears top right.",
    hi: "ऊपरी दाईं ओर कोने में टाइमर सर्वर-नियंत्रित है; वर्तमान सक्रिय अनुभाग का शेष समय वहीं दिखेगा।",
  },
  {
    en: "The active section auto-submits when its 15-minute timer ends, and the next section starts automatically — no manual submission required.",
    hi: "15 मिनट का समय समाप्त होने पर सक्रिय अनुभाग स्वतः सबमिट हो जाएगा और अगला अनुभाग स्वचालित रूप से शुरू हो जाएगा — मैनुअल सबमिशन की आवश्यकता नहीं है।",
  },
  {
    en: "At the end of all sections, the final exam auto-submits.",
    hi: "सभी अनुभागों के समाप्त होने पर, अंतिम परीक्षा स्वतः सबमिट हो जाएगी।",
  },
];

export const NAV_NOTES: { en: string; hi: string }[] = [
  {
    en: "Sections are locked strictly by time. You CANNOT move freely between sections. You can only move between questions within the currently active 15-minute section.",
    hi: "अनुभाग कड़ाई से समय द्वारा लॉक किए गए हैं। आप अनुभागों के बीच स्वतंत्र रूप से नहीं जा सकते। आप केवल वर्तमान में सक्रिय 15 मिनट के अनुभाग के प्रश्नों के बीच ही आगे-पीछे जा सकते हैं।",
  },
  {
    en: "Use Previous or Save & Next to move between questions within the active section; use Mark for Review to flag questions you wish to revisit later within that section's time.",
    hi: "सक्रिय अनुभाग के प्रश्नों के बीच जाने के लिए Previous या Save & Next का उपयोग करें; उस अनुभाग के समय के भीतर बाद में देखने के लिए Mark for Review बटन दबाएं।",
  },
  {
    en: "Once the 15-minute timer for a section expires, you cannot return to it under any circumstances.",
    hi: "एक बार किसी अनुभाग का 15 मिनट का टाइमर समाप्त हो जाने पर, आप किसी भी परिस्थिति में उस पर वापस नहीं जा सकते।",
  },
];

export const ANS_NOTES: { en: string; hi: string }[] = [
  {
    en: "Each question has four options, out of which only one is correct.",
    hi: "हर प्रश्न के चार विकल्प होते हैं, जिनमें से केवल एक ही सही होता है।",
  },
  {
    en: "Answers are saved only after clicking Save & Next.",
    hi: "उत्तर चुनें या बदलें, लेकिन Save & Next पर क्लिक करने के बाद ही उत्तर सुरक्षित होता है।",
  },
  {
    en: "To change a saved answer, revisit and update it, then save again (only within the active section's time).",
    hi: "अगर उत्तर बदलना है, तो प्रश्न पर फिर से जाकर नया उत्तर दें और फिर से सुरक्षित करें (केवल सक्रिय अनुभाग के समय के भीतर)।",
  },
];

export const LANG_NOTES: { en: string; hi: string }[] = [
  {
    en: "Only one comprehension section (English) appears; this cannot be changed during the exam.",
    hi: "केवल एक समझ-बूझ (कॉम्प्रिहेंशन) अनुभाग अंग्रेजी में दिखाई देगा; इसे परीक्षा के दौरान बदला नहीं जा सकता।",
  },
  {
    en: "Other MCQ sections may be displayed in English, Hindi, or both, based on your language selection.",
    hi: "अन्य MCQ अनुभाग अंग्रेजी, हिंदी या दोनों में दिख सकते हैं — आपके द्वारा की गई भाषा चयन के आधार पर।",
  },
  {
    en: "You can change your language selection during the examination for the active section.",
    hi: "आप भाषा चयन परीक्षा के दौरान सक्रिय अनुभाग के लिए बदल सकते हैं।",
  },
];
