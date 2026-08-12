-- CreateTable
CREATE TABLE "search_misses" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "exam" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_misses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "search_misses_query_idx" ON "search_misses"("query");

-- CreateIndex
CREATE INDEX "search_misses_createdAt_idx" ON "search_misses"("createdAt");

-- AddForeignKey
ALTER TABLE "search_misses" ADD CONSTRAINT "search_misses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

