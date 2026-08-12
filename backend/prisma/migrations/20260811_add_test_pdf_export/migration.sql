-- CreateTable
CREATE TABLE "test_pdf_exports" (
    "id" TEXT NOT NULL,
    "testTemplateId" TEXT NOT NULL,
    "paperPdf" BYTEA,
    "answerKeyPdf" BYTEA,
    "questionSnapshot" JSONB,
    "pass1Field" BOOLEAN NOT NULL DEFAULT false,
    "pass2Structural" BOOLEAN NOT NULL DEFAULT false,
    "pass3SpotCheck" BOOLEAN NOT NULL DEFAULT false,
    "pass4Regression" BOOLEAN NOT NULL DEFAULT false,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "lastGeneratedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_pdf_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "test_pdf_exports_testTemplateId_key" ON "test_pdf_exports"("testTemplateId");

-- AddForeignKey
ALTER TABLE "test_pdf_exports" ADD CONSTRAINT "test_pdf_exports_testTemplateId_fkey" FOREIGN KEY ("testTemplateId") REFERENCES "test_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

