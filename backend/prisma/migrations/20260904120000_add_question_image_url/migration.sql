/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import * as XLSX from 'xlsx';
import * as mammoth from 'mammoth';
import { randomUUID } from 'crypto';
import { normalizeDiagramType, parseDiagramLabels, DIAGRAM_TYPES } from './diagram-types';

export interface BulkUploadQuestion {
  examId: string;
  subjectId: string;
  chapterId: string;
  topicId?: string;
  subTopicId?: string;
  questionText: string;
  questionTextHindi?: string;
  // Session 22 — set only when the QUESTION STEM itself is a Venn/figure
  // diagram (rare — most diagram questions put the diagram in the OPTIONS
  // instead, see options[].diagramType below). Codes: diagram-types.ts.
  questionDiagramType?: string;
  questionDiagramLabels?: string[];
  // Session 24 — for diagram types that AREN'T simple Venn circles (mirror
  // image, figure series, embedded figures, paper folding, dice/clock) —
  // a real uploaded image URL for the question stem. See S3Service.
  questionImageUrl?: string;
  // Session 25 — the SELF-CONTAINED alternative to questionImageUrl: put
  // the raw image data directly in the JSON (base64-encoded, no data:
  // URL prefix) instead of uploading it separately first. createQuestion()
  // uploads it to S3 automatically and fills in questionImageUrl for you.
  // Ideal when an AI tool (e.g. Claude reading scanned exam-book photos)
  // is generating the whole bulk-upload JSON in one shot — no separate
  // "upload image, get URL, paste URL back" round trip needed. Excel/CSV
  // don't support this (impractical to paste base64 into a spreadsheet
  // cell) — use questionImageUrl there instead.
  questionImageBase64?: string;
  questionImageMimeType?: string; // e.g. "image/png" — defaults to image/png if omitted
  options: {
    key: string;
    text: string;
    textHi?: string;
    // Session 22 — when set, THIS OPTION is a rendered diagram (the far
    // more common case — e.g. "select the correct Venn diagram", where
    // each of A/B/C/D is a different circle arrangement). `text` may be
    // empty when diagramType is set; it no longer needs to hold a caption.
    diagramType?: string;
    diagramLabels?: string[];
    // Session 24 — real uploaded image (mirror image / figure series /
    // etc). Mutually exclusive with diagramType in practice.
    imageUrl?: string;
    // Session 25 — self-contained base64 alternative, see
    // questionImageBase64 above for the full explanation.
    imageBase64?: string;
    imageMimeType?: string;
  }[];
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
  constructor(private prisma: PrismaService, private s3: S3Service) {}

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
          'questionDiagramType', 'questionDiagramLabels',
          'optionA*', 'optionA_Hindi',
          'optionB*', 'optionB_Hindi',
          'optionC*', 'optionC_Hindi',
          'optionD*', 'optionD_Hindi',
          'optionDiagramTypes', 'optionDiagramLabels',
          'questionImageUrl', 'optionImageUrls',
          'correctAnswer*', 'explanation', 'explanationHindi',
          'year', 'shift', 'paperCode', 'marks', 'negativeMarks',
          'difficulty'
        ],
        sampleRows: [
          JSON.stringify([
            'cgl-exam-id', 'quantitative-aptitude-id', 'arithmetic-id', 'percentage', 'percentage-basics',
            'What is 20% of 150?', '150 का 20% क्या है?',
            '', '',
            '30', '30',
            '25', '25',
            '35', '35',
            '40', '40',
            '', '',
            '', '',
            'A', 'Multiply 150 by 0.20', '150 को 0.20 से गुणा करें',
            '2023', 'Shift 1', 'PAPER-1', '2', '0.5',
            'EASY'
          ]),
          // Session 22 — Venn/figure diagram question sample. Every
          // ordinary question above leaves the 4 diagram columns blank
          // (as shown); this row demonstrates the OPTIONS-are-diagrams
          // case (the common one). See "Diagram question types" sheet.
          JSON.stringify([
            'cgl-exam-id', 'reasoning-id', 'venn-diagrams-id', '', '',
            'उस वेन आरेख का चयन करें जो निम्नलिखित के बीच संबंध को सर्वोत्तम रूप से दर्शाता है। टिकट, हवाई जहाज, रेल', '',
            '', '',
            '', '',
            '', '',
            '', '',
            '', '',
            'V1|V3|V6|V2', 'टिकट,हवाई जहाज,रेल|टिकट,हवाई जहाज,रेल|टिकट,हवाई जहाज,रेल|टिकट,हवाई जहाज,रेल',
            '', '',
            'A', 'टिकट, हवाई जहाज और रेल तीनों एक-दूसरे से संबंधित हैं (यात्रा से जुड़े)', '',
            '2019', '', '', '2', '0.5',
            'MEDIUM'
          ])
        ],
        description: 'Excel template for bulk question upload. Required fields marked with *. Hindi fields are optional. Diagram columns are optional — see "Diagram question types" sheet for valid codes (V1-V8).'
      },
      csv: {
        headers: [
          'examId*', 'subjectId*', 'chapterId*', 'topicId', 'subTopicId',
          'questionText*', 'questionTextHindi',
          'questionDiagramType', 'questionDiagramLabels',
          'optionA*', 'optionA_Hindi',
          'optionB*', 'optionB_Hindi',
          'optionC*', 'optionC_Hindi',
          'optionD*', 'optionD_Hindi',
          'optionDiagramTypes', 'optionDiagramLabels',
          'questionImageUrl', 'optionImageUrls',
          'correctAnswer*', 'explanation', 'explanationHindi',
          'year', 'shift', 'paperCode', 'marks', 'negativeMarks',
          'difficulty'
        ],
        sampleRows: [
          JSON.stringify([
            'cgl-exam-id', 'quantitative-aptitude-id', 'arithmetic-id', 'percentage', 'percentage-basics',
            'What is 20% of 150?', '150 का 20% क्या है?',
            '', '',
            '30', '30',
            '25', '25',
            '35', '35',
            '40', '40',
            '', '',
            '', '',
            'A', 'Multiply 150 by 0.20', '150 को 0.20 से गुणा करें',
            '2023', 'Shift 1', 'PAPER-1', '2', '0.5',
            'EASY'
          ]),
          JSON.stringify([
            'cgl-exam-id', 'reasoning-id', 'venn-diagrams-id', '', '',
            'उस वेन आरेख का चयन करें जो निम्नलिखित के बीच संबंध को सर्वोत्तम रूप से दर्शाता है। टिकट, हवाई जहाज, रेल', '',
            '', '',
            '', '',
            '', '',
            '', '',
            '', '',
            'V1|V3|V6|V2', 'टिकट,हवाई जहाज,रेल|टिकट,हवाई जहाज,रेल|टिकट,हवाई जहाज,रेल|टिकट,हवाई जहाज,रेल',
            '', '',
            'A', 'टिकट, हवाई जहाज और रेल तीनों एक-दूसरे से संबंधित हैं (यात्रा से जुड़े)', '',
            '2019', '', '', '2', '0.5',
            'MEDIUM'
          ])
        ],
        description: 'CSV template for bulk question upload. Use comma separation. Required fields marked with *. Diagram columns are optional — see "Diagram question types" sheet for valid codes (V1-V8).'
      },
      text: {
        headers: [
          'examId*', 'subjectId*', 'chapterId*', 'topicId', 'subTopicId',
          'questionText*', 'questionTextHindi',
          'questionDiagramType', 'questionDiagramLabels',
          'optionA*', 'optionA_Hindi',
          'optionB*', 'optionB_Hindi',
          'optionC*', 'optionC_Hindi',
          'optionD*', 'optionD_Hindi',
          'optionDiagramTypes', 'optionDiagramLabels',
          'questionImageUrl', 'optionImageUrls',
          'correctAnswer*', 'explanation', 'explanationHindi',
          'year', 'shift', 'paperCode', 'marks', 'negativeMarks',
          'difficulty'
        ],
        sampleRows: [
          JSON.stringify([
            'cgl-exam-id', 'quantitative-aptitude-id', 'arithmetic-id', 'percentage', 'percentage-basics',
            'What is 20% of 150?', '150 का 20% क्या है?',
            '', '',
            '30', '30',
            '25', '25',
            '35', '35',
            '40', '40',
            '', '',
            '', '',
            'A', 'Multiply 150 by 0.20', '150 को 0.20 से गुणा करें',
            '2023', 'Shift 1', 'PAPER-1', '2', '0.5',
            'EASY'
          ]),
          JSON.stringify([
            'cgl-exam-id', 'reasoning-id', 'venn-diagrams-id', '', '',
            'उस वेन आरेख का चयन करें जो निम्नलिखित के बीच संबंध को सर्वोत्तम रूप से दर्शाता है। टिकट, हवाई जहाज, रेल', '',
            '', '',
            '', '',
            '', '',
            '', '',
            '', '',
            'V1|V3|V6|V2', 'टिकट,हवाई जहाज,रेल|टिकट,हवाई जहाज,रेल|टिकट,हवाई जहाज,रेल|टिकट,हवाई जहाज,रेल',
            '', '',
            'A', 'टिकट, हवाई जहाज और रेल तीनों एक-दूसरे से संबंधित हैं (यात्रा से जुड़े)', '',
            '2019', '', '', '2', '0.5',
            'MEDIUM'
          ])
        ],
        description: 'Tab-separated text template for bulk question upload. Use tabs between fields. Required fields marked with *. Diagram columns are optional — see "Diagram question types" sheet for valid codes (V1-V8).'
      },
      json: {
        headers: [
          'examId*', 'subjectId*', 'chapterId*', 'topicId', 'subTopicId',
          'questionText*', 'questionTextHindi',
          'questionDiagramType', 'questionDiagramLabels',
          'options*', 'questionImageUrl', 'correctAnswer*', 'explanation', 'explanationHindi',
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
          }),
          // Session 22 — same Venn/figure diagram sample as the other
          // formats, but shown in JSON's natural nested shape: each
          // option object just carries diagramType/diagramLabels instead
          // of a real "text" — this is actually the EASIEST format for an
          // AI tool (e.g. Claude reading scanned exam-book photos) to
          // emit directly, since it doesn't need the pipe/comma encoding
          // that the flat Excel/CSV/text columns require.
          JSON.stringify({
            examId: 'cgl-exam-id',
            subjectId: 'reasoning-id',
            chapterId: 'venn-diagrams-id',
            questionText: 'उस वेन आरेख का चयन करें जो निम्नलिखित के बीच संबंध को सर्वोत्तम रूप से दर्शाता है। टिकट, हवाई जहाज, रेल',
            options: [
              { key: 'A', text: '', diagramType: 'V1', diagramLabels: ['टिकट', 'हवाई जहाज', 'रेल'] },
              { key: 'B', text: '', diagramType: 'V3', diagramLabels: ['टिकट', 'हवाई जहाज', 'रेल'] },
              { key: 'C', text: '', diagramType: 'V6', diagramLabels: ['टिकट', 'हवाई जहाज', 'रेल'] },
              { key: 'D', text: '', diagramType: 'V2', diagramLabels: ['टिकट', 'हवाई जहाज', 'रेल'] }
            ],
            correctAnswer: 'A',
            explanation: 'टिकट, हवाई जहाज और रेल तीनों एक-दूसरे से संबंधित हैं (यात्रा से जुड़े)',
            year: 2019,
            marks: 2,
            negativeMarks: 0.5,
            difficulty: 'MEDIUM'
          })
        ],
        description: 'JSON Lines format - one JSON object per line. Each object contains all question fields including options array. Diagram options carry diagramType/diagramLabels instead of text — see "Diagram question types" for valid codes (V1-V8).'
      }
    };
  }

  /**
   * Session 22 — the fixed Venn/figure-diagram taxonomy, exposed for the
   * admin help endpoints (GET /admin/help/formats, /admin/help/prompts) so
   * an admin (or an AI tool being prompted to generate questions) can see
   * every valid diagramType code and what it looks like, without reading
   * source code. Kept here (not duplicated) — re-exports diagram-types.ts.
   */
  getDiagramTypesHelp() {
    return {
      description:
        'Venn/figure-diagram questions (e.g. "select the correct Venn diagram") are stored as a TYPE CODE + up to 3 labels, ' +
        'never as an image file — the frontend renders crisp SVG from (type, labels) at zero storage cost. Use these codes in ' +
        'the questionDiagramType / optionDiagramTypes columns (Excel/CSV/Text) or the diagramType field on an option (JSON).',
      types: DIAGRAM_TYPES,
      bulkUploadColumns: {
        'questionDiagramType / questionDiagramLabels': 'Set ONLY when the question STEM itself is the diagram (rare).',
        'optionDiagramTypes': 'Pipe-separated, one code per option in A,B,C,D order, e.g. "V1|V3|V6|V2". Leave a slot empty for a plain-text option.',
        'optionDiagramLabels': 'Pipe-separated groups matching the same A,B,C,D order; labels within one option are comma-separated, e.g. "a,b,c|x,y,z|,|p,q,r".',
      },
      // Session 24 — mirror image / figure series / embedded figures /
      // paper folding / dice-clock etc. can't be reduced to a type-code
      // taxonomy like Venn diagrams — they need a real picture instead.
      nonVennDiagramTypes: {
        description:
          'For diagram types that are NOT simple Venn circles (mirror image, figure series, embedded figures, paper ' +
          'folding, dice/clock, counting figures, etc.), there are TWO ways to get the image in — pick whichever fits ' +
          'your workflow:',
        method1_uploadThenReference: {
          description:
            'Upload the real image first via POST /bank/admin/upload/question-image (one image per call, max 5MB, ' +
            'png/jpg/webp/svg) — it returns a URL. Then put that URL in the questionImageUrl (stem is the image) or ' +
            'optionImageUrls (pipe-separated per option, same A,B,C,D order as optionDiagramTypes) column of a normal ' +
            'bulk Excel/CSV/JSON upload, exactly like the Venn diagramType codes. Best when images are already hosted ' +
            'somewhere, or you\'re filling in the Excel/CSV template by hand.',
          uploadEndpoint: 'POST /bank/admin/upload/question-image (multipart/form-data, field name "file")',
        },
        // Session 25 — the self-contained alternative: no separate upload
        // step, no round trip. Ideal for an AI tool generating the whole
        // bulk-upload file in one shot from scanned exam-book photos.
        method2_base64InJson: {
          description:
            'JSON upload ONLY (not Excel/CSV — impractical to paste base64 into a spreadsheet cell). Put the raw image ' +
            'bytes directly in the question JSON as base64 (no "data:image/png;base64," prefix needed, though it\'s ' +
            'tolerated): questionImageBase64 / questionImageMimeType for a stem image, or imageBase64 / imageMimeType ' +
            'on an individual option object. createQuestion() uploads it to S3 and fills in the URL automatically — ' +
            'the whole question (text + images) goes up in ONE upload call, no separate "upload image, get URL, paste ' +
            'URL back" round trip. mimeType defaults to image/png if omitted; allowed: image/png, image/jpeg, ' +
            'image/webp, image/svg+xml; 5MB limit per image, same as method 1.',
          example: {
            questionText: 'नीचे दिए गए चार आकृतियों में से दर्पण-प्रतिबिंब (mirror image) चुनें।',
            options: [
              { key: 'A', text: '', imageBase64: '<base64 bytes of option A image>', imageMimeType: 'image/png' },
              { key: 'B', text: '', imageBase64: '<base64 bytes of option B image>', imageMimeType: 'image/png' },
              { key: 'C', text: '', imageBase64: '<base64 bytes of option C image>', imageMimeType: 'image/png' },
              { key: 'D', text: '', imageBase64: '<base64 bytes of option D image>', imageMimeType: 'image/png' },
            ],
            correctAnswer: 'B',
          },
        },
      },
    };
  }

  /**
   * Session 25 — decodes a base64 image string and uploads it to S3,
   * exactly like uploadQuestionImage() does for a multipart file upload.
   * Shared by createQuestion() (self-contained JSON bulk upload) so both
   * paths (separate upload-then-reference, and embed-directly-in-JSON)
   * go through the same size/type validation and S3 key scheme.
   */
  private async uploadBase64Image(base64: string, mimeType?: string): Promise<string> {
    const mt = mimeType || 'image/png';
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];
    if (!allowedTypes.includes(mt)) {
      throw new Error(`Unsupported image type "${mt}" in base64 image data. Allowed: ${allowedTypes.join(', ')}.`);
    }
    // Accept both a bare base64 string and a full "data:image/png;base64,...." URL.
    const cleaned = base64.includes(',') && base64.trim().startsWith('data:') ? base64.split(',')[1] : base64;
    let buffer: Buffer;
    try {
      buffer = Buffer.from(cleaned, 'base64');
    } catch {
      throw new Error('Invalid base64 image data.');
    }
    if (!buffer.length) {
      throw new Error('Base64 image data decoded to an empty file.');
    }
    const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB — same limit as the multipart upload endpoint
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new Error(`Base64 image too large (${Math.round(buffer.length / 1024)} KB) — max 5 MB.`);
    }
    const ext = mt.split('/')[1]?.replace('svg+xml', 'svg') || 'png';
    const key = `question-images/${randomUUID()}.${ext}`;
    return this.s3.uploadQuestionImage(key, buffer, mt);
  }

  /**
   * Session 24 — for diagram question types that AREN'T simple Venn
   * circles (mirror image, figure series, embedded figures, paper
   * folding, dice/clock — genuinely arbitrary shapes). Admin (or an AI
   * tool acting on the admin's behalf) uploads ONE image at a time here
   * and gets back a URL; that URL then goes straight into the
   * questionImageUrl / optionImageUrls column of a normal bulk Excel/CSV/
   * JSON upload (same two-step pattern as the diagram-type codes: get the
   * reference value first, then reference it in the bulk file).
   *
   * Deliberately kept as a single-image endpoint rather than a bulk
   * zip-of-images uploader — that would need a new unzip dependency this
   * sandbox couldn't verify end-to-end (no network to npm install/test
   * it). A script/UI can call this endpoint in a loop for hundreds of
   * images; a true bulk zip-batch endpoint is a good next-session addition
   * once that can be tested against a real npm install.
   *
   * Session 25 — this is now the SECOND way to get an image in (see
   * questionImageBase64 / option.imageBase64 for the self-contained,
   * single-request alternative that's ideal for AI-generated bulk JSON).
   */
  async uploadQuestionImage(file: { buffer: Buffer; mimetype: string; originalname: string }): Promise<{ url: string; key: string }> {
    if (!file || !file.buffer?.length) {
      throw new BadRequestException('No image file provided.');
    }
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException(`Unsupported image type "${file.mimetype}". Allowed: ${allowedTypes.join(', ')}.`);
    }
    const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB — question figures are small line-art, not photos
    if (file.buffer.length > MAX_IMAGE_BYTES) {
      throw new BadRequestException(`Image too large (${Math.round(file.buffer.length / 1024)} KB) — max 5 MB.`);
    }
    const ext = (file.originalname.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const key = `question-images/${randomUUID()}.${ext}`;
    const url = await this.s3.uploadQuestionImage(key, file.buffer, file.mimetype);
    return { url, key };
  }

  /**
   * Generate Excel template file for download.
   *
   * BUGFIX (this session — "example file ka guide" gap): the "Reference
   * IDs" sheet below used to be hard-coded placeholder rows —
   * literally the string '...' repeated — instead of real data, even
   * though the admin API to fetch real exam/subject/chapter/topic/
   * sub-topic IDs was one query away. An admin downloading this template
   * for the first time had a sheet that LOOKED like it should contain the
   * IDs they need but told them nothing; they had to separately call 4-5
   * different admin endpoints (or open Manage Chapters) just to find one
   * valid chapterId. Made async and now genuinely populates this sheet
   * with every real exam/subject/chapter/topic/sub-topic name+ID pair
   * currently in the database, so the downloaded file is a real,
   * self-contained example/guide — not just a shape with a promise to go
   * look elsewhere.
   */
  async generateExcelTemplate(): Promise<Buffer> {
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
      ['2. Hindi fields (questionTextHindi, optionX_Hindi, explanationHindi) are optional,'],
      ['   BUT a question with no questionTextHindi is saved as UNPUBLISHED (not shown to'],
      ['   students) until a Hindi translation is added — this is intentional (bilingual gate).'],
      ['3. correctAnswer must be A, B, C, or D — and that option\'s text must not be blank.'],
      ['4. difficulty must be EASY, MEDIUM, or HARD'],
      ['5. year should be a valid year (e.g., 2023, 2024) — set this to enable Year-wise PYQ tests.'],
      ['6. shift + paperCode are optional but help students filter/identify the exact paper.'],
      ['7. marks default to 1, negativeMarks default to 0.25'],
      ['8. examId, subjectId, chapterId MUST exactly match an existing ID — see the'],
      ['   "Reference IDs" sheet (next tab) for every real ID currently in the database.'],
      ['9. topicId and subTopicId are optional but recommended — Year-wise custom tests let'],
      ['   students filter down to a specific topic, which only works if this is set.'],
      ['10. Duplicate questions (same text + same options + same answer) are auto-detected'],
      ['    and rejected on upload — re-uploading the same file twice is safe, nothing'],
      ['    gets duplicated in the question bank.'],
      [''],
      ['Want to see everything already in the question bank before adding more?'],
      ['Use the "⬇️ Download Full Question Bank" button next to this template download —'],
      ['it exports every existing question in this exact same format.'],
    ];
    const instrSheet = XLSX.utils.aoa_to_sheet(instructions);
    XLSX.utils.book_append_sheet(workbook, instrSheet, 'Instructions');

    // Reference data sheet — populated with REAL ids/names from the DB.
    const [exams, subjects, chapters, topics, subTopics] = await Promise.all([
      this.prisma.exam.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.subject.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.chapter.findMany({ select: { id: true, name: true, subjectId: true }, orderBy: { name: 'asc' } }),
      this.prisma.topic.findMany({ select: { id: true, name: true, chapterId: true }, orderBy: { name: 'asc' } }),
      this.prisma.subTopic.findMany({ select: { id: true, name: true, topicId: true }, orderBy: { name: 'asc' } }),
    ]);

    const refData: (string | number)[][] = [
      ['Reference: Valid Exam IDs'],
      ['examId', 'name'],
      ...(exams.length ? exams.map(e => [e.id, e.name]) : [['(no exams yet)', '']]),
      [''],
      ['Reference: Valid Subject IDs'],
      ['subjectId', 'name'],
      ...(subjects.length ? subjects.map(s => [s.id, s.name]) : [['(no subjects yet)', '']]),
      [''],
      ['Reference: Valid Chapter IDs'],
      ['chapterId', 'name', 'subjectId'],
      ...(chapters.length ? chapters.map(c => [c.id, c.name, c.subjectId]) : [['(no chapters yet)', '', '']]),
      [''],
      ['Reference: Valid Topic IDs'],
      ['topicId', 'name', 'chapterId'],
      ...(topics.length ? topics.map(t => [t.id, t.name, t.chapterId]) : [['(no topics yet)', '', '']]),
      [''],
      ['Reference: Valid Sub-Topic IDs'],
      ['subTopicId', 'name', 'topicId'],
      ...(subTopics.length ? subTopics.map(t => [t.id, t.name, t.topicId]) : [['(no sub-topics yet)', '', '']]),
    ];
    const refSheet = XLSX.utils.aoa_to_sheet(refData);
    XLSX.utils.book_append_sheet(workbook, refSheet, 'Reference IDs');

    // Session 22 — Diagram question types sheet: every valid diagramType
    // code, so an admin (or an AI tool filling this template from scanned
    // photos) knows exactly what to put in questionDiagramType /
    // optionDiagramTypes without reading source code.
    const diagramSheetData: (string | number)[][] = [
      ['Diagram question types (Venn/figure-based reasoning MCQs)'],
      [''],
      ['These codes go in the questionDiagramType / optionDiagramTypes columns on the'],
      ['main sheet. Diagrams render as SVG from (code + labels) — never upload an image.'],
      [''],
      ['code', 'description'],
      ...DIAGRAM_TYPES.map((d) => [d.code, d.description]),
      [''],
      ['optionDiagramTypes example (4 options, pipe-separated, A,B,C,D order):'],
      ['V1|V3|V6|V2'],
      [''],
      ['optionDiagramLabels example (matches the same order; comma-separates the'],
      ['labels inside one diagram; leave a slot empty for a plain-text option):'],
      ['टिकट,हवाई जहाज,रेल|टिकट,हवाई जहाज,रेल|टिकट,हवाई जहाज,रेल|टिकट,हवाई जहाज,रेल'],
    ];
    const diagramSheet = XLSX.utils.aoa_to_sheet(diagramSheetData);
    XLSX.utils.book_append_sheet(workbook, diagramSheet, 'Diagram question types');

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * NEW (this session) — export every existing question in the bank, in the
   * exact same column shape as the upload templates, so the admin can:
   *  (a) see everything already in the bank in one file before adding more,
   *  (b) sanity-check/spot-fix answers or Hindi translations offline, and
   *  (c) know at a glance what NOT to re-type — the upload path already
   *      auto-skips exact duplicates (checkDuplicate()), but reviewing this
   *      export first avoids wasting time typing something that's already
   *      there.
   * Supports the same optional filters as the rest of the bank module
   * (examId/subjectId/chapterId/year) so a full-bank export isn't the only
   * option on a large bank. Capped at 20,000 rows per export as a sane
   * safety limit — filter down (by exam/year) for anything bigger.
   */
  async exportQuestionBank(
    filters: { examId?: string; subjectId?: string; chapterId?: string; year?: number },
    format: 'json' | 'excel' | 'csv',
  ): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const EXPORT_ROW_CAP = 20000;
    const where: any = {};
    if (filters.examId) where.examId = filters.examId;
    if (filters.subjectId) where.subjectId = filters.subjectId;
    if (filters.chapterId) where.chapterId = filters.chapterId;
    if (filters.year) where.year = filters.year;

    const questions = await this.prisma.question.findMany({
      where,
      orderBy: [{ year: 'desc' }, { createdAt: 'asc' }],
      take: EXPORT_ROW_CAP,
      select: {
        id: true,
        examId: true,
        subjectId: true,
        chapterId: true,
        topicId: true,
        subTopicId: true,
        questionText: true,
        questionTextHindi: true,
        optionsJson: true,
        correctAnswer: true,
        explanation: true,
        explanationHindi: true,
        year: true,
        shift: true,
        paperCode: true,
        marks: true,
        negativeMarks: true,
        difficulty: true,
        isApproved: true,
        reviewStatus: true,
        answerVerificationStatus: true,
      },
    });

    const rowsAsObjects = questions.map((q) => {
      const opts = (q.optionsJson as any[]) ?? [];
      const byKey = (k: string) => opts.find((o) => o.key === k) ?? { text: '', textHi: '' };
      return {
        id: q.id, // included for reference only — NOT a recognized upload column; harmless if re-uploaded, ignored by the parser
        examId: q.examId,
        subjectId: q.subjectId,
        chapterId: q.chapterId,
        topicId: q.topicId ?? '',
        subTopicId: q.subTopicId ?? '',
        questionText: q.questionText,
        questionTextHindi: q.questionTextHindi ?? '',
        optionA: byKey('A').text ?? '', optionA_Hindi: byKey('A').textHi ?? '',
        optionB: byKey('B').text ?? '', optionB_Hindi: byKey('B').textHi ?? '',
        optionC: byKey('C').text ?? '', optionC_Hindi: byKey('C').textHi ?? '',
        optionD: byKey('D').text ?? '', optionD_Hindi: byKey('D').textHi ?? '',
        correctAnswer: q.correctAnswer,
        explanation: q.explanation ?? '',
        explanationHindi: q.explanationHindi ?? '',
        year: q.year ?? '',
        shift: q.shift ?? '',
        paperCode: q.paperCode ?? '',
        marks: q.marks,
        negativeMarks: q.negativeMarks,
        difficulty: q.difficulty,
        // Status columns — informational only, ignored on re-upload:
        isPublishedToStudents: q.isApproved,
        reviewStatus: q.reviewStatus,
        answerVerificationStatus: q.answerVerificationStatus,
      };
    });

    const stamp = new Date().toISOString().slice(0, 10);

    if (format === 'json') {
      const buffer = Buffer.from(JSON.stringify(rowsAsObjects, null, 2), 'utf-8');
      return { buffer, contentType: 'application/json', filename: `question_bank_export_${stamp}.json` };
    }

    if (format === 'csv') {
      const headers = rowsAsObjects.length ? Object.keys(rowsAsObjects[0]) : [];
      const lines = [headers.join(',')];
      for (const row of rowsAsObjects) {
        lines.push(this.escapeCSVRow(headers.map((h) => String((row as any)[h] ?? ''))));
      }
      const buffer = Buffer.from(lines.join('\n'), 'utf-8');
      return { buffer, contentType: 'text/csv', filename: `question_bank_export_${stamp}.csv` };
    }

    // excel
    const workbook = XLSX.utils.book_new();
    const headers = rowsAsObjects.length
      ? Object.keys(rowsAsObjects[0])
      : ['id', 'examId', 'subjectId', 'chapterId', 'topicId', 'subTopicId', 'questionText', 'questionTextHindi',
         'optionA', 'optionA_Hindi', 'optionB', 'optionB_Hindi', 'optionC', 'optionC_Hindi', 'optionD', 'optionD_Hindi',
         'correctAnswer', 'explanation', 'explanationHindi', 'year', 'shift', 'paperCode', 'marks', 'negativeMarks',
         'difficulty', 'isPublishedToStudents', 'reviewStatus', 'answerVerificationStatus'];
    const sheetData = [headers, ...rowsAsObjects.map((row) => headers.map((h) => (row as any)[h]))];
    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Question Bank Export');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return { buffer, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: `question_bank_export_${stamp}.xlsx` };
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

    // Map column indices.
    // BUGFIX (bonus grep, item c — a "template" that its own parser
    // rejects): getTemplates()/generateExcelTemplate()/generateCSVTemplate()/
    // generateTextTemplate() all write the header row with a trailing `*`
    // on required columns ('examId*', 'optionA*', ...) as a visual "this is
    // required" marker. But this parser built headerMap from the RAW header
    // cells and only ever looked up unstarred keys ('examId', 'optionA',
    // ...) via parseQuestionRow()'s get(). An admin who downloaded the
    // app's own template, filled it in exactly as given, and re-uploaded it
    // always hit "Missing required column: examId" — the bundled template
    // could never actually be used. Strip a trailing '*' (plus whitespace)
    // when indexing headers so both starred and unstarred header rows work.
    const headerMap: Record<string, number> = {};
    headers.forEach((h, i) => { headerMap[String(h).trim().replace(/\*\s*$/, '')] = i; });

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
        const { published } = await this.createQuestion(question, adminId);
        result.created++;
        if (!published) {
          result.warnings.push({
            row: rowNum,
            message: 'Created but NOT published (no Hindi translation) — add questionTextHindi and re-review to make it live.',
          });
        }
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
        const { published } = await this.createQuestion(question, adminId);
        result.created++;
        if (!published) {
          result.warnings.push({
            row: rowNum,
            message: 'Created but NOT published (no Hindi translation) — add questionTextHindi and re-review to make it live.',
          });
        }
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

    // Session 22 — Venn/figure diagram OPTIONS (the common case: A/B/C/D
    // are each a different diagram, e.g. "select the correct Venn diagram").
    // Optional columns "optionDiagramTypes" (e.g. "V1|V3|V6|V2", one code
    // per option in A,B,C,D order — leave a slot empty for a plain-text
    // option) and "optionDiagramLabels" (e.g. "a,b,c|x,y|,|p,q,r", "|"
    // separates options, "," separates the labels within one option's
    // diagram). Both are entirely optional — absent for the ~99% of rows
    // that are ordinary text questions, so nothing breaks for those.
    const optionDiagramTypeParts = get('optionDiagramTypes').split('|');
    const optionDiagramLabelParts = get('optionDiagramLabels').split('|');
    const diagramTypeFor = (i: number) => normalizeDiagramType(optionDiagramTypeParts[i]?.trim() || undefined);
    const diagramLabelsFor = (i: number) => parseDiagramLabels(optionDiagramLabelParts[i]);

    // Session 24 — real-image OPTIONS (mirror image / figure series /
    // embedded figures / paper folding / dice/clock — shapes that can't be
    // reduced to the Venn type-code taxonomy). "optionImageUrls" is
    // pipe-separated, one URL per option in A,B,C,D order, same shape as
    // optionDiagramTypes above. Get URLs first via
    // POST /bank/admin/upload/question-image (one call per image), or
    // paste in URLs from your own image host.
    const optionImageUrlParts = get('optionImageUrls').split('|');
    const imageUrlFor = (i: number) => optionImageUrlParts[i]?.trim() || undefined;

    const options = [
      { key: 'A', text: get('optionA'), textHi: get('optionA_Hindi') || undefined, diagramType: diagramTypeFor(0), diagramLabels: diagramLabelsFor(0), imageUrl: imageUrlFor(0) },
      { key: 'B', text: get('optionB'), textHi: get('optionB_Hindi') || undefined, diagramType: diagramTypeFor(1), diagramLabels: diagramLabelsFor(1), imageUrl: imageUrlFor(1) },
      { key: 'C', text: get('optionC'), textHi: get('optionC_Hindi') || undefined, diagramType: diagramTypeFor(2), diagramLabels: diagramLabelsFor(2), imageUrl: imageUrlFor(2) },
      { key: 'D', text: get('optionD'), textHi: get('optionD_Hindi') || undefined, diagramType: diagramTypeFor(3), diagramLabels: diagramLabelsFor(3), imageUrl: imageUrlFor(3) },
    ];

    // Session 22 — rarer case: the QUESTION STEM itself is the diagram.
    const questionDiagramType = normalizeDiagramType(get('questionDiagramType') || undefined);
    const questionDiagramLabels = parseDiagramLabels(get('questionDiagramLabels'));
    // Session 24 — rarer case: the QUESTION STEM itself is a real image.
    const questionImageUrl = get('questionImageUrl') || undefined;

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
      questionDiagramType,
      questionDiagramLabels,
      questionImageUrl,
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
   * Validate all reference IDs.
   *
   * BUGFIX (Sachin's audit — "kis exam ka hai ye bhi find karna hai" /
   * galat exam-mapping wale questions): this used to push EVERY problem —
   * including an examId/subjectId/chapterId that doesn't exist at all, or a
   * chapter that belongs to a totally different subject — as a soft
   * `result.warnings` entry and then let createQuestion() run anyway. A
   * warning is easy to miss in a 500-row upload result, and unlike a bad
   * examId (which at least trips a Postgres FK violation inside
   * createQuestion() and gets caught as an error), a chapterId/subjectId
   * mismatch is between two otherwise-VALID ids — no FK violation fires,
   * so the row silently created a real, live question filed under the
   * wrong exam/subject with zero error and zero visible warning weight.
   * That is the exact "students dekhte hai galat exam ka question apne
   * exam mein" bug.
   *
   * Fix: every one of these is now a hard validation failure (thrown
   * Error), which the two call sites (processBulkQuestions /
   * processStructuredQuestions) already catch and record as
   * result.errors — so the row is REJECTED and never reaches
   * createQuestion(), instead of being silently created with wrong
   * mappings. Nothing here reduces validation strictness — it only
   * upgrades existing checks from "warn and continue" to "reject the row".
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
    void result; // kept in the signature to avoid touching both call sites' argument lists
    void rowNum;

    if (!question.examId || !examIds.has(question.examId)) {
      throw new Error(`examId "${question.examId}" not found in database — is exam ka koi question is exam ke test/mock me kabhi dikhega hi nahi, isliye row reject kiya gaya`);
    }
    if (!subjectIds.has(question.subjectId)) {
      throw new Error(`subjectId "${question.subjectId}" not found in database`);
    }
    if (!chapterIds.has(question.chapterId)) {
      throw new Error(`chapterId "${question.chapterId}" not found in database`);
    }
    const chapterSubject = chapterSubjectMap.get(question.chapterId);
    if (chapterSubject && chapterSubject !== question.subjectId) {
      throw new Error(
        `chapterId "${question.chapterId}" belongs to a DIFFERENT subject ("${chapterSubject}") than the subjectId "${question.subjectId}" given in this row — this is exactly the "galat subject me question dikhna" bug, row rejected. Fix the subjectId or chapterId in the sheet to match.`,
      );
    }
    if (question.topicId) {
      if (!topicIds.has(question.topicId)) {
        throw new Error(`topicId "${question.topicId}" not found in database`);
      }
      const topicChapter = topicChapterMap.get(question.topicId);
      if (topicChapter && topicChapter !== question.chapterId) {
        throw new Error(`topicId "${question.topicId}" belongs to chapter "${topicChapter}", not the chapterId "${question.chapterId}" given in this row`);
      }
    }
    if (question.subTopicId) {
      if (!subTopicIds.has(question.subTopicId)) {
        throw new Error(`subTopicId "${question.subTopicId}" not found in database`);
      }
      const subTopicTopic = subTopicTopicMap.get(question.subTopicId);
      if (subTopicTopic && subTopicTopic !== question.topicId) {
        throw new Error(`subTopicId "${question.subTopicId}" belongs to topic "${subTopicTopic}", not the topicId "${question.topicId}" given in this row`);
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
      // Session 22: fold diagramType into the signature too, so two
      // different diagram-only options (empty text, different diagram)
      // don't hash-collide as "duplicates" of each other.
      .map(o => `${o.key}:${o.text.trim().toLowerCase()}${o.diagramType ? ':' + o.diagramType : ''}${o.imageUrl ? ':' + o.imageUrl : ''}`)
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
   *
   * FIX (Session 6 bonus-grep item 8e — verification-gate bypass): this used
   * to unconditionally set isApproved: true (= live/published to students)
   * while ALSO writing answerVerificationStatus: 'UNVERIFIED_SINGLE_SOURCE'
   * and reviewStatus: 'PENDING' on the very same row — a direct contradiction
   * (a question can't simultaneously be "pending review" and "already live").
   * Every other path that publishes a question (question-review.worker.ts,
   * fixed in Session 6) requires a bilingual gate — Hindi translation present
   * — before it's allowed to go live; this manual admin bulk-upload path had
   * no such check at all, so an admin CSV/Excel/JSON-paste (including AI-
   * generated question sets pasted straight in, per the controller's own
   * comment) could publish English-only, single-source, never-cross-checked
   * answers straight to students with zero gate.
   *
   * Fix: reuse the same bilingual gate. A row only goes live immediately
   * (isApproved: true, reviewStatus: 'APPROVED') if it actually has a Hindi
   * translation. Without one, it's created as isApproved: false / reviewStatus
   * 'PENDING' — visible to admins/moderators to translate-and-approve, but
   * never served to students via PUBLISHED_QUESTION_WHERE until it clears
   * that gate. answerVerificationStatus stays 'UNVERIFIED_SINGLE_SOURCE'
   * either way (admin-typed data is still only a single, uncross-checked
   * source) — that label was already correct, only the two contradictory
   * "is it live" fields needed to agree with each other.
   */
  private async createQuestion(question: BulkUploadQuestion, adminId: string): Promise<{ published: boolean }> {
    // Session 25 — resolve any base64 images to real S3 URLs FIRST, before
    // any validation runs (so the "has an image" checks below see the
    // resolved questionImageUrl / option.imageUrl either way, regardless
    // of whether the caller supplied a URL or raw base64 data). This is
    // what makes a single self-contained JSON upload work end-to-end: an
    // AI tool (or admin) can put raw image bytes straight in the bulk
    // JSON instead of doing a separate "upload image, get URL, paste URL
    // back" round trip first.
    if (question.questionImageBase64 && !question.questionImageUrl) {
      question.questionImageUrl = await this.uploadBase64Image(question.questionImageBase64, question.questionImageMimeType);
    }
    for (const o of question.options) {
      if (o.imageBase64 && !o.imageUrl) {
        o.imageUrl = await this.uploadBase64Image(o.imageBase64, o.imageMimeType);
      }
    }

    // BUGFIX (this session — "student ko question dikhta hai par answer nahi
    // de pa raha" root cause #1): NOTHING anywhere in the 5 upload paths
    // (Excel/CSV/Text/JSON-file/JSON-paste/Word — they ALL funnel through
    // this one method) ever checked that questionText or all four option
    // texts were actually non-empty. parseQuestionRow() only validated that
    // correctAnswer was one of A/B/C/D — a row with a blank/typo'd optionC
    // cell (missing tab in a .txt paste, empty Excel cell, admin skipped a
    // field) sailed straight through, and if questionTextHindi happened to
    // be filled in, hasHindiTranslation made it isApproved: true — LIVE to
    // students — with a blank option button on the test screen. If that
    // blank option happened to be the correct one, the question became
    // mathematically impossible to answer correctly; if it was a distractor,
    // a student would think their screen was buggy. Same for a blank
    // questionText slipping through as a published no-text question card.
    // Gate this here, once, so every upload format is protected instead of
    // duplicating the check in parseQuestionRow (Excel/CSV/Text) AND
    // processStructuredQuestions (JSON/Word), which only cover a subset.
    if (!question.questionText || !question.questionText.trim()) {
      // Session 22/24: a diagram-stem or image-stem question can still
      // have short/empty link text, so this only blocks a TRULY blank
      // stem with no text AND no stem diagram AND no stem image either.
      if (!question.questionDiagramType && !question.questionImageUrl) {
        throw new Error('questionText is empty — question text cannot be blank.');
      }
    }
    // Session 22/24: an option counts as filled if it has non-empty TEXT,
    // *or* a valid diagramType, *or* a real imageUrl (a diagram/image
    // option can legitimately have empty text — the diagram/picture itself
    // is the answer choice).
    const missingOptions = question.options
      .filter((o) => (!o.text || !o.text.trim()) && !o.diagramType && !o.imageUrl)
      .map((o) => o.key);
    if (missingOptions.length > 0) {
      throw new Error(
        `Option${missingOptions.length > 1 ? 's' : ''} ${missingOptions.join(', ')} ${missingOptions.length > 1 ? 'are' : 'is'} empty — every option (A–D) needs text, a diagramType, or an imageUrl.`,
      );
    }
    const correctOption = question.options.find((o) => o.key === question.correctAnswer);
    if (!correctOption || (!correctOption.text.trim() && !correctOption.diagramType && !correctOption.imageUrl)) {
      throw new Error(`correctAnswer is "${question.correctAnswer}" but option ${question.correctAnswer} has no text, diagramType, or imageUrl.`);
    }

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
      // Session 22 — omit these keys entirely for ordinary text options
      // (rather than writing null/undefined) so optionsJson stays byte-
      // identical to before for the ~99% of non-diagram questions.
      ...(o.diagramType ? { diagramType: o.diagramType } : {}),
      ...(o.diagramLabels?.length ? { diagramLabels: o.diagramLabels } : {}),
      ...(o.imageUrl ? { imageUrl: o.imageUrl } : {}),
    }));

    // Create search hash for future duplicate detection
    const normalizedText = question.questionText.trim().toLowerCase();
    const optionsSignature = question.options
      .sort((a, b) => a.key.localeCompare(b.key))
      // Session 22: fold diagramType into the signature too, so two
      // different diagram-only options (empty text, different diagram)
      // don't hash-collide as "duplicates" of each other.
      .map(o => `${o.key}:${o.text.trim().toLowerCase()}${o.diagramType ? ':' + o.diagramType : ''}${o.imageUrl ? ':' + o.imageUrl : ''}`)
      .join('|');
    const searchHash = `${normalizedText}|${optionsSignature}|${question.correctAnswer}`;

    // Bilingual gate — same condition pdf-export.service.ts and
    // question-review.worker.ts use (questionTextHindi present and non-empty).
    const hasHindiTranslation = !!(question.questionTextHindi && question.questionTextHindi.trim() !== '');

    await this.prisma.question.create({
      data: {
        examId: question.examId,
        subjectId: question.subjectId,
        chapterId: question.chapterId,
        topicId: question.topicId,
        subTopicId: question.subTopicId,
        questionText: question.questionText,
        questionTextHindi: question.questionTextHindi || '',
        questionDiagramType: question.questionDiagramType || null,
        questionDiagramLabels: (question.questionDiagramLabels as any) || undefined,
        questionImageUrl: question.questionImageUrl || null,
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
        isApproved: hasHindiTranslation,
        answerVerificationStatus: 'UNVERIFIED_SINGLE_SOURCE',
        reviewStatus: hasHindiTranslation ? 'APPROVED' : 'PENDING',
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

    return { published: hasHindiTranslation };
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
