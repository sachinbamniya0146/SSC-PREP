import { Module } from '@nestjs/common';
import { BookmarksController } from './bookmarks.controller';
import { BookmarksService } from './bookmarks.service';

@Module({
  controllers: [BookmarksController],
  providers: [BookmarksService],
  // BUGFIX (2026-09 audit, same bug class as TestsService/DailyTestService/
  // TestStatsService found in tests.module.ts): BookmarksModule had NO
  // exports array at all, so BookmarksService could never be injected by
  // `imports: [BookmarksModule]` from any other module — NestJS would
  // throw "BookmarksService is not exported" the moment anything tried.
  // Nothing does yet, but review.service.ts's getAttemptedQuestionIds()
  // logic and bank.service.ts both already duplicate bookmark-adjacent
  // checks — the next feature to consolidate that (or a profile page
  // showing bookmark counts) will need this. Exporting now closes the
  // landmine before it's tripped.
  exports: [BookmarksService],
})
export class BookmarksModule {}
