import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
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
}
