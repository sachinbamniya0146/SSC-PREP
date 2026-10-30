import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { UserThrottlerGuard, limitResolver } from './common/guards/user-throttler.guard';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ReviewModule } from './review/review.module';
import { ReportErrorModule } from './report-error/report-error.module';
import { SupportChatModule } from './support-chat/support-chat.module';
import { TestsModule } from './tests/tests.module';
import { ReferralModule } from './referral/referral.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { QuizModule } from './quiz/quiz.module';
import { GamificationModule } from './gamification/gamification.module';
import { BookmarksModule } from './bookmarks/bookmarks.module';
import { VocabModule } from './vocab/vocab.module';
import { PushModule } from './push/push.module';
import { NotificationsModule } from './notifications/notifications.module';
import { StudyStatsModule } from './study-stats/study-stats.module';
import { StaffModule } from './staff/staff.module';
import { MocksModule } from './mocks/mocks.module';
import { BankModule } from './bank/bank.module';
import { StudyPlanModule } from './study-plan/study-plan.module';
import { PdfExportModule } from './pdf-export/pdf-export.module';
import { MonetizationModule } from './monetization/monetization.module';
import { S3Module } from './s3/s3.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { AdminModule } from './admin/admin.module';
import { SearchModule } from './search/search.module';
import { TelegramModule } from './telegram/telegram.module';
import { SolverModule } from './solver/solver.module';
import { PyqDateModule } from './pyq-dates/pyq-date.module';
import { ExplanationsModule } from './explanations/explanations.module';
import { FeaturesModule } from './features/features.module';
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
      useFactory: (_config: ConfigService, _reflector: Reflector) => ({
        // NOTE: no skipIf — even @Public() routes are throttled (anonymous: 60/min per IP).
        // S47: a logged-in student is counted per account (UserThrottlerGuard) with a larger budget (THROTTLE_USER_LIMIT, default 300/min),
        // so classmates sharing one IP can no longer lock each other out of scoring / autosave.
        // Auth routes get stricter per-route @Throttle overrides (signup 5/min, login 10/min).
        throttlers: [
          {
            ttl: 60_000,
            limit: limitResolver,
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
        maxRetriesPerRequest: null,
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
    VocabModule,
    PushModule,
    NotificationsModule,
    StudyStatsModule,
    StaffModule,
    QuizModule,
    MocksModule,
    BankModule,
    StudyPlanModule,
    PdfExportModule,
    MonetizationModule,
    S3Module,
    AuditLogModule,
    SolverModule,
    AdminModule,
    SearchModule,
    TelegramModule,
    ReviewModule,
    ReportErrorModule,
    SupportChatModule,
    PyqDateModule,
    ExplanationsModule,
    FeaturesModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: UserThrottlerGuard }, // global rate limit: 60/min per IP (anonymous), 300/min per student (logged in)
  ],
})
export class AppModule {}
