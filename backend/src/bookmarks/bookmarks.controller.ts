import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BookmarksService } from './bookmarks.service';

@Controller('bookmarks')
@UseGuards(JwtAuthGuard)
export class BookmarksController {
  constructor(private bookmarks: BookmarksService) {}

  @Post(':questionId/toggle')
  toggle(@CurrentUser() user: { userId: string }, @Param('questionId') questionId: string) {
    return this.bookmarks.toggle(user.userId, questionId);
  }

  @Get()
  list(@CurrentUser() user: { userId: string }) {
    return this.bookmarks.list(user.userId);
  }

  @Post(':questionId/note')
  saveNote(
    @CurrentUser() user: { userId: string },
    @Param('questionId') questionId: string,
    @Body() body: { content: string },
  ) {
    return this.bookmarks.saveNote(user.userId, questionId, body.content);
  }

  // NEW — clear a note without unbookmarking the question.
  @Delete(':questionId/note')
  deleteNote(@CurrentUser() user: { userId: string }, @Param('questionId') questionId: string) {
    return this.bookmarks.deleteNote(user.userId, questionId);
  }

  // NEW — "Practice my bookmarks": a ready-to-run practice set built from
  // everything the student has saved. Frontend stashes the response into
  // sessionStorage('ssc_sectional_set') and opens /test?sectional=1, same as
  // every other practice flow.
  @Get('practice-set')
  practiceSet(@CurrentUser() user: { userId: string }) {
    return this.bookmarks.practiceSet(user.userId);
  }
}
