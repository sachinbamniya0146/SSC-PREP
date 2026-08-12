-- CreateIndex
CREATE INDEX "questions_examId_subjectId_isApproved_isActive_idx" ON "questions"("examId", "subjectId", "isApproved", "isActive");

-- CreateIndex
CREATE INDEX "test_attempts_testTemplateId_status_idx" ON "test_attempts"("testTemplateId", "status");

