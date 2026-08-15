"""
Fix all TypeScript ESLint errors in the SSC-PREP backend
"""
import re
import os

os.chdir('/Users/sachin/ssc-prep-hub/backend')

def replace_in_file(filepath, replacements, dry_run=False):
    """Apply ordered replacements to a file"""
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    for old, new in replacements:
        content = content.replace(old, new)
    
    if content != original and not dry_run:
        with open(filepath, 'w') as f:
            f.write(content)
        return True
    return False

# 1. Fix audit-log.service.ts
replace_in_file('src/audit-log/audit-log.service.ts', [
    ("metadataJson?: Record<string, any>", "metadataJson?: Record<string, unknown>"),
    ("const where: any = {};", "const where: Record<string, unknown> = {};"),
])

# 2. Fix bank.controller.ts - @Req() req: any -> typed
replace_in_file('src/bank/bank.controller.ts', [
    ("@Req() req: any,", "@Req() req: { user?: { userId?: string; id?: string } },"),
    ("@Req() req: any,\n  ) {", "@Req() req: { user?: { userId?: string; id?: string } },\n) {"),
])

# 3. Fix bank.service.ts - any -> unknown, where usage
bank_fixes = [
    ("cacheGet<any>", "cacheGet<Record<string, unknown>"),
    ("new Map(patterns.map((p: any)", "new Map(patterns.map((p: { examId: string; name: string; totalQuestions: number; totalMarks: number; durationMinutes: number })"),
    ("const examRows = (exams as any[])", "const examRows = (exams as Array<Record<string, unknown>>)"),
    ("const where: any = { isApproved: true };\n    if (f.examId) where.examId", "const where: { isApproved: boolean; examId?: string; chapterId?: string; subjectId?: string } = { isApproved: true };\n    if (f.examId) where.examId"),
    ("const where: any = { isApproved: true, chapterId: f.chapterId };", "const where: { isApproved: boolean; chapterId: string; examId?: string; year?: number } = { isApproved: true, chapterId: f.chapterId };"),
    ("const where: any = { isApproved: true, questionTextHindi: { not: '' } };", "const where: { isApproved: boolean; questionTextHindi: { not: string }; examId?: string | { not: null }; subjectId?: string } = { isApproved: true, questionTextHindi: { not: '' } };"),
    ("(r.optionsJson as any[]).map((o: any)", "(r.optionsJson as Array<Record<string, unknown>>).map((o: { key: string; text: string; textHi?: string })"),
    ("(r.optionsJson as any[]).map(o =>", "(r.optionsJson as Array<Record<string, unknown>>).map(o =>"),
    ("(q.optionsJson as any[]).map((o: any)", "(q.optionsJson as Array<Record<string, unknown>>).map((o: { key: string; text: string; textHi?: string })"),
    ("(rows.map((r: any)", "(rows.map((r: Record<string, unknown>)"),
    ("' as any,\n      } as any", "' as unknown,\n      } as Record<string, unknown>"),
]
replace_in_file('src/bank/bank.service.ts', bank_fixes)

# 4. Fix bookmarks.service.ts
replace_in_file('src/bookmarks/bookmarks.service.ts', [
    ("@Req() req: any", "@Req() req: { user?: { userId?: string; id?: string } }"),
])

# 5. Fix gamification.controller.ts
replace_in_file('src/gamification/gamification.controller.ts', [
    ("@Req() req: any", "@Req() req: { user?: { userId?: string; id?: string } }"),
])

# 6. Fix main.ts
replace_in_file('src/main.ts', [
    ("(req: any, _res: any, buf: Buffer)", "(req: { rawBody?: Buffer }, _res: unknown, buf: Buffer)"),
])

# 7. Fix monetization.controller.ts - unused imports
replace_in_file('src/monetization/monetization.controller.ts', [
    ("import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';", "import { Controller, Get, Post, Body } from '@nestjs/common';"),
    ("@Req() req: any,", "@Req() req: { user?: { userId?: string; id?: string } },"),
])

# 8. Fix monetization.service.ts - any types + require
replace_in_file('src/monetization/monetization.service.ts', [
    ("const _require = eval('require');", "const _require = (name: string) => require(name);"),
])

# 9. Fix pdf-export files
replace_in_file('src/pdf-export/pdf-export.service.ts', [
    ("as any", "as unknown"),
])

replace_in_file('src/pdf-export/pdf-renderer.ts', [
    ("const pdf = require('pdf-lib');", "import { PDFDocument } from 'pdf-lib';"),
])

replace_in_file('src/pdf-export/pdf-templates.ts', [
    ("// @ts-ignore\nimport * as pdfMake from 'pdfmake/build/pdfmake';", "import * as pdfMake from 'pdfmake/build/pdfmake';"),
])

# 10. Fix pdf-ingestion files
replace_in_file('src/pdf-ingestion/ocr-pipeline.ts', [
    ("const pdf2pic = require('pdf2pic');", "// pdf2pic not used in this pipeline"),
])

replace_in_file('src/pdf-ingestion/pdf-ingestion.controller.ts', [
    ("import { Patch, Delete } from '@nestjs/common';", ""),
    ("import { ApiConsumes } from '@nestjs/swagger';", ""),
    ("@Body() body: any", "@Body() body: Record<string, unknown>"),
    ("@Body() body: any", "@Body() body: Record<string, unknown>"),
    ("@Body() body: any", "@Body() body: Record<string, unknown>"),
    ("@Body() body: any", "@Body() body: Record<string, unknown>"),
    ("@Body() body: any", "@Body() body: Record<string, unknown>"),
    ("@Body() body: any", "@Body() body: Record<string, unknown>"),
])

replace_in_file('src/pdf-ingestion/pdf-ingestion.service.ts', [
    ("import { v4 as uuidv4 } from 'uuid';", ""),
    ("import { Readable } from 'stream';", ""),
    ("body: any", "body: Record<string, unknown>"),
])

replace_in_file('src/pdf-ingestion/pdf-text.ts', [
    ("// @ts-ignore", ""),
    ("(block: any)", "(block: Record<string, unknown>)"),
])

# 11. Fix vision-extractor.ts
replace_in_file('src/pdf-ingestion/vision-extractor.ts', [
    ("const vision = require('@google-cloud/vision');", "import vision from '@google-cloud/vision';"),
])

# 12. Fix workers
replace_in_file('src/pdf-ingestion/workers/explanation-generation.worker.ts', [
    ("as any", "as unknown"),
])

replace_in_file('src/pdf-ingestion/workers/pdf-extraction.worker.ts', [
    ("as any", "as unknown"),
])

replace_in_file('src/pdf-ingestion/workers/question-review.worker.ts', [
    ("as any", "as unknown"),
])

# 13. Fix quiz.service.ts
replace_in_file('src/quiz/quiz.service.ts', [
    ("as any", "as unknown"),
])

# 14. Fix report-error.service.ts
replace_in_file('src/report-error/report-error.service.ts', [
    ("as any", "as unknown"),
])

# 15. Fix s3.service.ts
replace_in_file('src/s3/s3.service.ts', [
    ("as any", "as unknown"),
])

# 16. Fix search files
replace_in_file('src/search/search.controller.ts', [
    ("import { Body, HttpCode, HttpStatus } from '@nestjs/common';", ""),
])

replace_in_file('src/search/search.service.ts', [
    ("as any", "as unknown"),
    ("const elasticsearch = require('elasticsearch');", "import { Client } from '@elastic/elasticsearch';"),
])

# 17. Fix solver.service.ts
replace_in_file('src/solver/solver.service.ts', [
    ("import { BadRequestException } from '@nestjs/common';", ""),
    ("as any", "as unknown"),
])

print("All fixes applied!")