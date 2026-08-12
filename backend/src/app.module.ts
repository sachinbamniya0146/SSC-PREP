import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ReviewModule } from './review/review.module';
import { ReportErrorModule } from './report-error/report-error.module';
import { TestsModule } from './tests/tests.module';
import { ReferralModule } from './referral/referral.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { QuizModule } from './quiz/quiz.module';
import { GamificationModule } from './gamification/gamification.module';
import { BookmarksModule } from './bookmarks/bookmarks.module';
import { MocksModule } from './mocks/mocks.module';
import { BankModule } from './bank/bank.module';
import { StudyPlanModule } from './study-plan/study-plan.module';
import { PdfIngestionModule } from './pdf-ingestion/pdf-ingestion.module';
import { PdfExportModule } from './pdf-export/pdf-export.module';
import { MonetizationModule } from './monetization/monetization.module';
import { S3Module } from './s3/s3.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { AdminModule } from './admin/admin.module';
import { SearchModule } from './search/search.module';
import { TelegramModule } from './telegram/telegram.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { envValidationSchema } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validatePredefined: true,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, Reflector],
      useFactory: (config: ConfigService, reflector: Reflector) => ({
        // NOTE: no skipIf — even @Public() routes are throttled (global 60/min).
        // Auth routes get stricter per-route @Throttle overrides (signup 5/min, login 10/min).
        throttlers: [
          {
            ttl: 60_000,
            limit: 60,
          },
        ],
      }),
    }),
    // Global BullMQ connection - synchronous
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
        maxRetriesPerRequest: 3,
      },
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    TestsModule,
    ReferralModule,
    AnalyticsModule,
    GamificationModule,
    BookmarksModule,
    QuizModule,
    MocksModule,
    BankModule,
    StudyPlanModule,
    PdfIngestionModule,
    PdfExportModule,
    MonetizationModule,
    S3Module,
    AuditLogModule,
    AdminModule,
    SearchModule,
    TelegramModule,
    ReviewModule,
    ReportErrorModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard }, // global rate limit 60 req/min/IP
  ],
})
export class AppModule {}