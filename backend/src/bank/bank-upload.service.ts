/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as XLSX from 'xlsx';
import * as mammoth from 'mammoth';

export interface BulkUploadQuestion {
  examId: string;
  subjectId: string;
  chapterId: string;
  topicId?: string;
  subTopicId?: string;
  questionText: string;
  questionTextHindi?: string;
  options: { key: string; text: string; textHi?: string }[];
  correctAnswer: string;
  explanation?: string;
  explanationHindi?: string;
  year?: number;
  shift?: string;
  paperCode?: string;
  marks?: number;
  negativeMarks?: number;
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
}

export interface UploadResult {
  success: boolean;
  total: number;
  created: number;
  failed: number;
  errors: { row: number; error: string; data?: any }[];
  warnings: { row: number; message: string }[];
}

export interface QuestionTemplate {
  headers: string[];
  sampleRows: string[];
  description: string;
}

@Injectable()
export class BankUploadService {
  constructor(private prisma: PrismaService) {}

  /**
   * Validate and parse Excel file for bulk question upload
   */
  async uploadFromExcel(fileBuffer: Buffer, adminId: string): Promise<UploadResult> {
    try {
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      if (jsonData.length < 2) {
        throw new BadRequestException('Excel file must have at least a header row and one data row');
      }

      const headers = jsonData[0] as string[];
      const rows = jsonData.slice(1) as any[][];

      return this.processBulkQuestions(headers, rows, adminId);
    } catch (error: unknown) {
      if (error instanceof BadRequestException) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`Failed to parse Excel file: ${message}`);
    }
  }

  /**
   * Validate and parse CSV file for bulk question upload
   */
  async uploadFromCSV(fileBuffer: Buffer, adminId: string): Promise<UploadResult> {
    const text = fileBuffer.toString('utf-8');
    const lines = text.split('\n').map(line => line.trim()).filter(line => line);
    
    if (lines.length < 2) {
      throw new BadRequestException('CSV file must have at least a header row and one data row');
    }

    const headers = this.parseCSVLine(lines[0]);
    const rows = lines.slice(1).map(line => this.parseCSVLine(line));

    return this.processBulkQuestions(headers, rows, adminId);
  }

  /**
   * Parse text file for bulk question upload (tab-separated or JSON lines)
   */
  async uploadFromText(fileBuffer: Buffer, adminId: string): Promise<UploadResult> {
    const text = fileBuffer.toString('utf-8');
    
    // Try JSON lines format first
    if (text.trim().startsWith('[') || text.trim().startsWith('{')) {
      try {
        const questions = JSON.parse(text);
        return this.processStructuredQuestions(questions, adminId);
      } catch {
        // Fall through to tab-separated
      }
    }

    // Tab-separated format
    const lines = text.split('\n').map(line => line.trim()).filter(line => line);
    
    if (lines.length < 2) {
      throw new BadRequestException('Text file must have at least a header row and one data row');
    }

    const headers = lines[0].split('\t');
    const rows = lines.slice(1).map(line => line.split('\t'));

    return this.processBulkQuestions(headers, rows, adminId);
  }

  /**
   * Parse Word document for bulk question upload
   */
  async uploadFromWord(fileBuffer: Buffer, adminId: string): Promise<UploadResult> {
    try {
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      const text = result.value;
      
      // Parse Word document - expect tables or structured format
      const questions = this.parseWordDocument(text);
      return this.processStructuredQuestions(questions, adminId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`Failed to parse Word document: ${message}`);
    }
  }

  /**
   * Get downloadable template files for each format
   */
  getTemplates(): { [format: string]: QuestionTemplate } {
    return {
      excel: {
        headers: [
          'examId*', 'subjectId*', 'chapterId*', 'topicId', 'subTopicId',
          'questionText*', 'questionTextHindi',
          'optionA*', 'optionA_Hindi',
          'optionB*', 'optionB_Hindi',
          'optionC*', 'optionC_Hindi',
          'optionD*', 'optionD_Hindi',
          'correctAnswer*', 'explanation', 'explanationHindi',
          'year', 'shift', 'paperCode', 'marks', 'negativeMarks',
          'difficulty'
        ],
        sampleRows: [
          JSON.stringify([
            'cgl-exam-id', 'quantitative-aptitude-id', 'arithmetic-id', 'percentage', 'percentage-basics',
            'What is 20% of 150?', '150 का 20% क्या है?',
            '30', '30',
            '25', '25',
            '35', '35',
            '40', '40',
            'A', 'Multiply 150 by 0.20', '150 को 0.20 से गुणा करें',
            '2023', 'Shift 1', 'PAPER-1', '2', '0.5',
            'EASY'
          ])
        ],
        description: 'Excel template for bulk question upload. Required fields marked with *. Hindi fields are optional. No tags field in current schema.'
      },
      csv: {
        headers: [
          'examId*', 'subjectId*', 'chapterId*', 'topicId', 'subTopicId',
          'questionText*', 'questionTextHindi',
          'optionA*', 'optionA_Hindi',
          'optionB*', 'optionB_Hindi',
          'optionC*', 'optionC_Hindi',
          'optionD*', 'optionD_Hindi',
          'correctAnswer*', 'explanation', 'explanationHindi',
          'year', 'shift', 'paperCode', 'marks', 'negativeMarks',
          'difficulty'
        ],
        sampleRows: [
          JSON.stringify([
            'cgl-exam-id', 'quantitative-aptitude-id', 'arithmetic-id', 'percentage', 'percentage-basics',
            'What is 20% of 150?', '150 का 20% क्या है?',
            '30', '30',
            '25', '25',
            '35', '35',
            '40', '40',
            'A', 'Multiply 150 by 0.20', '150 को 0.20 से गुणा करें',
            '2023', 'Shift 1', 'PAPER-1', '2', '0.5',
            'EASY'
          ])
        ],
        description: 'CSV template for bulk question upload. Use comma separation. Required fields marked with *. No tags field in current schema.'
      },
      text: {
        headers: [
          'examId*', 'subjectId*', 'chapterId*', 'topicId', 'subTopicId',
          'questionText*', 'questionTextHindi',
          'optionA*', 'optionA_Hindi',
          'optionB*', 'optionB_Hindi',
          'optionC*', 'optionC_Hindi',
          'optionD*', 'optionD_Hindi',
          'correctAnswer*', 'explanation', 'explanationHindi',
          'year', 'shift', 'paperCode', 'marks', 'negativeMarks',
          'difficulty'
        ],
        sampleRows: [
          JSON.stringify([
            'cgl-exam-id', 'quantitative-aptitude-id', 'arithmetic-id', 'percentage', 'percentage-basics',
            'What is 20% of 150?', '150 का 20% क्या है?',
            '30', '30',
            '25', '25',
            '35', '35',
            '40', '40',
            'A', 'Multiply 150 by 0.20', '150 को 0.20 से गुणा करें',
            '2023', 'Shift 1', 'PAPER-1', '2', '0.5',
            'EASY'
          ])
        ],
        description: 'Tab-separated text template for bulk question upload. Use tabs between fields. Required fields marked with *. No tags field in current schema.'
      },
      json: {
        headers: [
          'examId*', 'subjectId*', 'chapterId*', 'topicId', 'subTopicId',
          'questionText*', 'questionTextHindi',
          'options*', 'correctAnswer*', 'explanation', 'explanationHindi',
          'year', 'shift', 'paperCode', 'marks', 'negativeMarks',
          'difficulty'
        ],
        sampleRows: [
          JSON.stringify({
            examId: 'cgl-exam-id',
            subjectId: 'quantitative-aptitude-id',
            chapterId: 'arithmetic-id',
            topicId: 'percentage',
            subTopicId: 'percentage-basics',
            questionText: 'What is 20% of 150?',
            questionTextHindi: '150 का 20% क्या है?',
            options: [
              { key: 'A', text: '30', textHi: '30' },
              { key: 'B', text: '25', textHi: '25' },
              { key: 'C', text: '35', textHi: '35' },
              { key: 'D', text: '40', textHi: '40' }
            ],
            correctAnswer: 'A',
            explanation: 'Multiply 150 by 0.20',
            explanationHindi: '150 को 0.20 से गुणा करें',
            year: 2023,
            shift: 'Shift 1',
            paperCode: 'PAPER-1',
            marks: 2,
            negativeMarks: 0.5,
            difficulty: 'EASY'
          })
        ],
        description: 'JSON Lines format - one JSON object per line. Each object contains all question fields including options array. No tags field in current schema.'
      }
    };
  }

  /**
   * Generate Excel template file for download
   */
  generateExcelTemplate(): Buffer {
    const template = this.getTemplates().excel;
    const workbook = XLSX.utils.book_new();
    
    // Main template sheet
    const sheetData = [template.headers, ...template.sampleRows.map(r => JSON.parse(r))];
    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Questions Template');

    // Instructions sheet
    const instructions = [
      ['SSC Prep Hub - Bulk Question Upload Template'],
      [''],
      ['Instructions:'],
      ['1. Fill in the required fields (marked with *) for each question'],
      ['2. Hindi fields (questionTextHindi, optionX_Hindi, explanationHindi) are optional'],
      ['3. correctAnswer must be A, B, C, or D'],
      ['4. difficulty must be EASY, MEDIUM, or HARD'],
      ['5. year should be a valid year (e.g., 2023, 2024)'],
      ['6. marks default to 1, negativeMarks default to 0.25'],
      ['7. examId, subjectId, chapterId must exist in the database'],
      ['8. topicId and subTopicId are optional but recommended for better organization'],
      [''],
      ['Get valid IDs from Admin API:'],
      ['- GET /api/v1/admin/exams'],
      ['- GET /api/v1/admin/subjects'],
      ['- GET /api/v1/admin/chapters'],
      ['- GET /api/v1/admin/topics'],
      ['- GET /api/v1/admin/sub-topics'],
    ];
    const instrSheet = XLSX.utils.aoa_to_sheet(instructions);
    XLSX.utils.book_append_sheet(workbook, instrSheet, 'Instructions');

    // Reference data sheet
    const refData = [
      ['Reference: Valid Exam IDs'],
      ['examId', 'name'],
      ['...', '...'],
      [''],
      ['Reference: Valid Subject IDs'],
      ['subjectId', 'name', 'examId'],
      ['...', '...', '...'],
      [''],
      ['Reference: Valid Chapter IDs'],
      ['chapterId', 'name', 'subjectId'],
      ['...', '...', '...'],
      [''],
      ['Reference: Valid Topic IDs'],
      ['topicId', 'name', 'chapterId'],
      ['...', '...', '...'],
      [''],
      ['Reference: Valid Sub-Topic IDs'],
      ['subTopicId', 'name', 'topicId'],
      ['...', '...', '...'],
    ];
    const refSheet = XLSX.utils.aoa_to_sheet(refData);
    XLSX.utils.book_append_sheet(workbook, refSheet, 'Reference IDs');

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Generate CSV template file for download
   */
  generateCSVTemplate(): Buffer {
    const template = this.getTemplates().csv;
    const lines = [template.headers.join(',')];
    template.sampleRows.forEach(row => lines.push(this.escapeCSVRow(JSON.parse(row))));
    return Buffer.from(lines.join('\n'), 'utf-8');
  }

  /**
   * Generate text template file for download
   */
  generateTextTemplate(): Buffer {
    const template = this.getTemplates().text;
    const lines = [template.headers.join('\t')];
    template.sampleRows.forEach(row => lines.push(JSON.parse(row).join('\t')));
    return Buffer.from(lines.join('\n'), 'utf-8');
  }

  /**
   * Generate JSON template file for download
   */
  generateJSONTemplate(): Buffer {
    const template = this.getTemplates().json;
    const lines = template.sampleRows;
    return Buffer.from(lines.join('\n'), 'utf-8');
  }

  /**
   * Process bulk questions from parsed headers and rows
   */
  private async processBulkQuestions(headers: string[], rows: any[][], adminId: string): Promise<UploadResult> {
    const requiredHeaders = ['examId', 'subjectId', 'chapterId', 'questionText', 'correctAnswer'];
    const optionHeaders = ['optionA', 'optionB', 'optionC', 'optionD'];

    // Map column indices
    const headerMap: Record<string, number> = {};
    headers.forEach((h, i) => { headerMap[h.trim()] = i; });

    // Validate required headers
    for (const req of requiredHeaders) {
      if (!(req in headerMap)) {
        throw new BadRequestException(`Missing required column: ${req}`);
      }
    }
    for (const opt of optionHeaders) {
      if (!(opt in headerMap)) {
        throw new BadRequestException(`Missing required column: ${opt}`);
      }
    }

    // Pre-fetch valid IDs
    const [exams, subjects, chapters, topics, subTopics] = await Promise.all([
      this.prisma.exam.findMany({ select: { id: true, name: true } }),
      this.prisma.subject.findMany({ select: { id: true, name: true } }),
      this.prisma.chapter.findMany({ select: { id: true, name: true, subjectId: true } }),
      this.prisma.topic.findMany({ select: { id: true, name: true, chapterId: true } }),
      this.prisma.subTopic.findMany({ select: { id: true, name: true, topicId: true } }),
    ]);

    const examIds = new Set(exams.map(e => e.id));
    const subjectIds = new Set(subjects.map(s => s.id));
    const chapterIds = new Set(chapters.map(c => c.id));
    const topicIds = new Set(topics.map(t => t.id));
    const subTopicIds = new Set(subTopics.map(t => t.id));
    const chapterSubjectMap = new Map(chapters.map(c => [c.id, c.subjectId]));
    const topicChapterMap = new Map(topics.map(t => [t.id, t.chapterId]));
    const subTopicTopicMap = new Map(subTopics.map(t => [t.id, t.topicId]));

    const result: UploadResult = {
      success: false,
      total: rows.length,
      created: 0,
      failed: 0,
      errors: [],
      warnings: [],
    };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // 1-indexed + header

      try {
        const question = this.parseQuestionRow(row, headerMap, rowNum);
        
        // Validate references
        this.validateReferences(question, examIds, subjectIds, chapterIds, topicIds, subTopicIds,
          chapterSubjectMap, topicChapterMap, subTopicTopicMap, result, rowNum);

        // Create question
        await this.createQuestion(question, adminId);
        result.created++;
      } catch (error) {
        result.failed++;
        result.errors.push({
          row: rowNum,
          error: error instanceof Error ? error.message : String(error),
          data: row,
        });
      }
    }

    result.success = result.failed === 0;
    return result;
  }

  /**
   * Process structured questions (JSON format)
   */
  private async processStructuredQuestions(questions: BulkUploadQuestion[], adminId: string): Promise<UploadResult> {
    const [exams, subjects, chapters, topics, subTopics] = await Promise.all([
      this.prisma.exam.findMany({ select: { id: true } }),
      this.prisma.subject.findMany({ select: { id: true } }),
      this.prisma.chapter.findMany({ select: { id: true, subjectId: true } }),
      this.prisma.topic.findMany({ select: { id: true, chapterId: true } }),
      this.prisma.subTopic.findMany({ select: { id: true, topicId: true } }),
    ]);

    const examIds = new Set(exams.map(e => e.id));
    const subjectIds = new Set(subjects.map(s => s.id));
    const chapterIds = new Set(chapters.map(c => c.id));
    const topicIds = new Set(topics.map(t => t.id));
    const subTopicIds = new Set(subTopics.map(t => t.id));
    const chapterSubjectMap = new Map(chapters.map(c => [c.id, c.subjectId]));
    const topicChapterMap = new Map(topics.map(t => [t.id, t.chapterId]));
    const subTopicTopicMap = new Map(subTopics.map(t => [t.id, t.topicId]));

    const result: UploadResult = {
      success: false,
      total: questions.length,
      created: 0,
      failed: 0,
      errors: [],
      warnings: [],
    };

    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      const rowNum = i + 1;

      try {
        this.validateReferences(question, examIds, subjectIds, chapterIds, topicIds, subTopicIds,
          chapterSubjectMap, topicChapterMap, subTopicTopicMap, result, rowNum);
        await this.createQuestion(question, adminId);
        result.created++;
      } catch (error) {
        result.failed++;
        result.errors.push({
          row: rowNum,
          error: error instanceof Error ? error.message : String(error),
          data: question,
        });
      }
    }

    result.success = result.failed === 0;
    return result;
  }

  /**
   * Parse a single row into a question object
   */
  private parseQuestionRow(row: any[], headerMap: Record<string, number>, _rowNum: number): BulkUploadQuestion {
    const get = (key: string): string => {
      const idx = headerMap[key];
      return idx !== undefined && row[idx] !== undefined ? String(row[idx]).trim() : '';
    };

    const options = [
      { key: 'A', text: get('optionA'), textHi: get('optionA_Hindi') || undefined },
      { key: 'B', text: get('optionB'), textHi: get('optionB_Hindi') || undefined },
      { key: 'C', text: get('optionC'), textHi: get('optionC_Hindi') || undefined },
      { key: 'D', text: get('optionD'), textHi: get('optionD_Hindi') || undefined },
    ];

    const correctAnswer = get('correctAnswer').toUpperCase();
    if (!['A', 'B', 'C', 'D'].includes(correctAnswer)) {
      throw new Error(`Invalid correctAnswer: must be A, B, C, or D (got ${correctAnswer})`);
    }

    const marks = parseFloat(get('marks')) || 1;
    const negativeMarks = parseFloat(get('negativeMarks')) || 0.25;
    const year = get('year') ? parseInt(get('year'), 10) : undefined;
    const difficulty = get('difficulty').toUpperCase() as 'EASY' | 'MEDIUM' | 'HARD' || 'MEDIUM';
    if (!['EASY', 'MEDIUM', 'HARD'].includes(difficulty)) {
      throw new Error(`Invalid difficulty: must be EASY, MEDIUM, or HARD (got ${difficulty})`);
    }

    return {
      examId: get('examId'),
      subjectId: get('subjectId'),
      chapterId: get('chapterId'),
      topicId: get('topicId') || undefined,
      subTopicId: get('subTopicId') || undefined,
      questionText: get('questionText'),
      questionTextHindi: get('questionTextHindi') || undefined,
      options,
      correctAnswer,
      explanation: get('explanation') || undefined,
      explanationHindi: get('explanationHindi') || undefined,
      year,
      shift: get('shift') || undefined,
      paperCode: get('paperCode') || undefined,
      marks,
      negativeMarks,
      difficulty,
    };
  }

  /**
   * Validate all reference IDs
   */
  private validateReferences(
    question: BulkUploadQuestion,
    examIds: Set<string>,
    subjectIds: Set<string>,
    chapterIds: Set<string>,
    topicIds: Set<string>,
    subTopicIds: Set<string>,
    chapterSubjectMap: Map<string, string>,
    topicChapterMap: Map<string, string>,
    subTopicTopicMap: Map<string, string>,
    result: UploadResult,
    rowNum: number
  ): void {
    if (!examIds.has(question.examId)) {
      result.warnings.push({ row: rowNum, message: `examId "${question.examId}" not found in database` });
    }
    if (!subjectIds.has(question.subjectId)) {
      result.warnings.push({ row: rowNum, message: `subjectId "${question.subjectId}" not found in database` });
    }
    if (!chapterIds.has(question.chapterId)) {
      result.warnings.push({ row: rowNum, message: `chapterId "${question.chapterId}" not found in database` });
    } else {
      const chapterSubject = chapterSubjectMap.get(question.chapterId);
      if (chapterSubject && chapterSubject !== question.subjectId) {
        result.warnings.push({ 
          row: rowNum, 
          message: `chapterId "${question.chapterId}" belongs to subject "${chapterSubject}", not "${question.subjectId}"` 
        });
      }
    }
    if (question.topicId && !topicIds.has(question.topicId)) {
      result.warnings.push({ row: rowNum, message: `topicId "${question.topicId}" not found in database` });
    }
    if (question.topicId) {
      const topicChapter = topicChapterMap.get(question.topicId);
      if (topicChapter && topicChapter !== question.chapterId) {
        result.warnings.push({ 
          row: rowNum, 
          message: `topicId "${question.topicId}" belongs to chapter "${topicChapter}", not "${question.chapterId}"` 
        });
      }
    }
    if (question.subTopicId && !subTopicIds.has(question.subTopicId)) {
      result.warnings.push({ row: rowNum, message: `subTopicId "${question.subTopicId}" not found in database` });
    }
    if (question.subTopicId) {
      const subTopicTopic = subTopicTopicMap.get(question.subTopicId);
      if (subTopicTopic && subTopicTopic !== question.topicId) {
        result.warnings.push({ 
          row: rowNum, 
          message: `subTopicId "${question.subTopicId}" belongs to topic "${subTopicTopic}", not "${question.topicId}"` 
        });
      }
    }
  }

  /**
   * Check if a duplicate question already exists in the database
   */
  private async checkDuplicate(question: BulkUploadQuestion): Promise<{ isDuplicate: boolean; existingQuestion?: any }> {
    // Create a search hash from question text, options, and correct answer for efficient duplicate detection
    const normalizedText = question.questionText.trim().toLowerCase();
    const optionsSignature = question.options
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(o => `${o.key}:${o.text.trim().toLowerCase()}`)
      .join('|');
    const searchHash = `${normalizedText}|${optionsSignature}|${question.correctAnswer}`;

    // First check by searchHash if it exists
    const existingByHash = await this.prisma.question.findFirst({
      where: { searchHash, isActive: true },
      select: { id: true, questionText: true, questionTextHindi: true, optionsJson: true, correctAnswer: true, explanation: true, explanationHindi: true, year: true, shift: true, paperCode: true, subjectId: true, chapterId: true, examId: true, createdAt: true },
    });

    if (existingByHash) {
      return { isDuplicate: true, existingQuestion: existingByHash };
    }

    // Fallback: check by exact text match + options + correct answer
    const existingByContent = await this.prisma.question.findFirst({
      where: {
        questionText: question.questionText,
        correctAnswer: question.correctAnswer,
        isActive: true,
      },
      select: { id: true, questionText: true, questionTextHindi: true, optionsJson: true, correctAnswer: true, explanation: true, explanationHindi: true, year: true, shift: true, paperCode: true, subjectId: true, chapterId: true, examId: true, createdAt: true },
    });

    if (existingByContent) {
      // Verify options match
      const existingOptions = existingByContent.optionsJson as any[];
      const newOptionsSorted = question.options
        .sort((a, b) => a.key.localeCompare(b.key))
        .map(o => `${o.key}:${o.text.trim()}|${o.textHi?.trim() || ''}`);
      const existingOptionsSorted = existingOptions
        .sort((a, b) => a.key.localeCompare(b.key))
        .map(o => `${o.key}:${o.text.trim()}|${o.textHi?.trim() || ''}`);

      if (JSON.stringify(newOptionsSorted) === JSON.stringify(existingOptionsSorted)) {
        return { isDuplicate: true, existingQuestion: existingByContent };
      }
    }

    return { isDuplicate: false };
  }

  /**
   * Create a question in the database
   */
  private async createQuestion(question: BulkUploadQuestion, adminId: string): Promise<void> {
    // Check for duplicates first
    const duplicateCheck = await this.checkDuplicate(question);
    if (duplicateCheck.isDuplicate) {
      const existing = duplicateCheck.existingQuestion!;
      throw new Error(
        `Duplicate question found (ID: ${existing.id}). ` +
        `Question: "${existing.questionText.substring(0, 80)}..." ` +
        `Already exists in database with same options and answer. ` +
        `Created at: ${existing.createdAt}`
      );
    }

    const optionsJson = question.options.map(o => ({
      key: o.key,
      text: o.text,
      textHi: o.textHi || '',
    }));

    // Create search hash for future duplicate detection
    const normalizedText = question.questionText.trim().toLowerCase();
    const optionsSignature = question.options
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(o => `${o.key}:${o.text.trim().toLowerCase()}`)
      .join('|');
    const searchHash = `${normalizedText}|${optionsSignature}|${question.correctAnswer}`;

    await this.prisma.question.create({
      data: {
        examId: question.examId,
        subjectId: question.subjectId,
        chapterId: question.chapterId,
        topicId: question.topicId,
        subTopicId: question.subTopicId,
        questionText: question.questionText,
        questionTextHindi: question.questionTextHindi || '',
        optionsJson: optionsJson as any,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation || '',
        explanationHindi: question.explanationHindi || '',
        year: question.year,
        shift: question.shift,
        paperCode: question.paperCode,
        marks: question.marks,
        negativeMarks: question.negativeMarks,
        difficulty: question.difficulty,
        isApproved: true,
        answerVerificationStatus: 'UNVERIFIED_SINGLE_SOURCE',
        reviewStatus: 'PENDING',
        searchHash,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'QUESTION_BULK_CREATED',
        targetEntity: 'Question',
        entityId: 'bulk',
        metadataJson: { questionText: question.questionText.substring(0, 100) } as any,
      },
    });
  }

  /**
   * Parse CSV line handling quoted fields
   */
  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result.map(s => s.trim());
  }

  /**
   * Escape CSV row for output
   */
  private escapeCSVRow(row: string[]): string {
    return row.map(cell => {
      if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
        return '"' + cell.replace(/"/g, '""') + '"';
      }
      return cell;
    }).join(',');
  }

  /**
   * Parse Word document text into structured questions
   */
  private parseWordDocument(text: string): BulkUploadQuestion[] {
    const questions: BulkUploadQuestion[] = [];
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    
    let currentQuestion: Partial<BulkUploadQuestion> = {};
    let options: { key: string; text: string; textHi?: string }[] = [];
    
    for (const line of lines) {
      // Look for question patterns
      if (line.match(/^Q\d*[\.\)]\s*/i) || line.match(/^Question[\s:]*/i)) {
        if (currentQuestion.questionText && options.length === 4) {
          currentQuestion.options = options;
          questions.push(currentQuestion as BulkUploadQuestion);
        }
        currentQuestion = {
          questionText: line.replace(/^Q\d*[\.\)]\s*/i, '').replace(/^Question[\s:]*/i, '').trim(),
          options: [],
        };
        options = [];
      } else if (line.match(/^[ABCD][\.\)]\s*/i)) {
        const key = line.charAt(0).toUpperCase();
        const text = line.substring(2).trim();
        options.push({ key, text, textHi: undefined });
      } else if (line.match(/^Answer[:)]/i)) {
        const answer = line.replace(/^Answer[:)]\s*/i, '').trim().toUpperCase();
        currentQuestion.correctAnswer = answer.charAt(0);
      } else if (line.match(/^Explanation[:)]/i)) {
        currentQuestion.explanation = line.replace(/^Explanation[:)]\s*/i, '').trim();
      } else if (line.match(/^Year[:)]/i)) {
        const year = parseInt(line.replace(/^Year[:)]\s*/i, '').trim(), 10);
        if (!isNaN(year)) currentQuestion.year = year;
      } else if (line.match(/^Difficulty[:)]/i)) {
        currentQuestion.difficulty = line.replace(/^Difficulty[:)]\s*/i, '').trim().toUpperCase() as any;
      }
    }
    
    // Add last question
    if (currentQuestion.questionText && options.length === 4) {
      currentQuestion.options = options;
      questions.push(currentQuestion as BulkUploadQuestion);
    }
    
    return questions;
  }
}