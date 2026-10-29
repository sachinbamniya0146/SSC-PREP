import { coreFromName, isSyllabusHeader, newChapterSlug, newSubjectSlug, pickSubject } from './syllabus-import-plan';

describe('syllabus importer decisions', () => {
  const subjects = [
    { id: 'plain', slug: 'reasoning', name: 'Reasoning', chapters: 0 },
    { id: 'sub', slug: 'sub-reasoning', name: 'Reasoning', chapters: 24 },
    { id: 'gk', slug: 'general_awareness', name: 'General Awareness', chapters: 30 },
  ];

  it('core key from a sheet / subject name', () => {
    expect(coreFromName('General Science')).toBe('general_science');
    expect(coreFromName('Banking & Financial Awareness')).toBe('banking_and_financial_awareness');
    expect(coreFromName(' Quant Aptitude ')).toBe('quant_aptitude');
  });

  it('a sheet goes to the subject (either spelling) that already holds the syllabus', () => {
    expect(pickSubject(['reasoning'], ['General Intelligence & Reasoning'], subjects, 'reasoning')?.id).toBe('sub');
    expect(pickSubject(['general_awareness'], [], subjects)?.id).toBe('gk');
    // equal chapter counts -> the Excel spelling (where uploaded questions live), then the preferred slug
    const tie = [
      { id: 'b', slug: 'english', name: 'English', chapters: 0 },
      { id: 'a', slug: 'sub-english', name: 'English', chapters: 0 },
    ];
    expect(pickSubject(['english'], [], tie, 'english')?.id).toBe('a');
    const tie2 = [
      { id: 'c', slug: 'hindi', name: 'Hindi', chapters: 0 },
      { id: 'd', slug: 'hindi-language', name: 'Hindi', chapters: 0 },
    ];
    expect(pickSubject(['hindi'], [], tie2, 'hindi')?.id).toBe('c');
  });

  it('falls back to the subject name, else null (a new subject is created)', () => {
    const subs = [{ id: 'c', slug: 'computer-knowledge', name: 'Computer Knowledge', chapters: 5 }];
    expect(pickSubject(['computer'], ['Computer Knowledge'], subs)?.id).toBe('c');
    expect(pickSubject(['general_science'], ['General Science'], subs)).toBeNull();
  });

  it('a new subject follows the database spelling', () => {
    expect(newSubjectSlug('general_science', ['reasoning', 'sub-english'])).toBe('sub-general_science');
    expect(newSubjectSlug('general_science', ['reasoning', 'english'])).toBe('general_science');
  });

  it('a new chapter follows its siblings (Master Package style or old style) and stays unique', () => {
    expect(newChapterSlug('Speed, Time & Distance', 'quantitative_aptitude', ['chap-percentage-quantitative_aptitude'], false)).toBe('chap-speed_time_and_distance-quantitative_aptitude');
    expect(newChapterSlug('Speed Time', 'quantitative_aptitude', ['percentage', 'profit-loss'], true)).toBe('speed-time');
    expect(newChapterSlug('Physics', 'general_science', [], true)).toBe('chap-physics-general_science');
    expect(newChapterSlug('Physics', 'general_science', [], false)).toBe('physics');
    expect(newChapterSlug('Physics', 'general_science', ['chap-physics-general_science'], true)).toBe('chap-physics-general_science-2');
  });

  it('only sheets with the syllabus header row are read (info sheets are skipped)', () => {
    expect(isSyllabusHeader(['S.No.', 'Chapter No.', 'Chapter', 'Topic', 'Sub-Topic'])).toBe(true);
    expect(isSyllabusHeader(['Exam', 'Stage', 'Subject', 'Chapters'])).toBe(false);
    expect(isSyllabusHeader(undefined)).toBe(false);
  });
});
