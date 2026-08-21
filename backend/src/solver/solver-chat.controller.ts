import { Controller, Post, Body, UseGuards, Get, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SolverService } from './solver.service';

@ApiTags('solver')
@Controller('solver')
export class SolverChatController {
  constructor(private readonly solverService: SolverService) {}

  /**
   * AI Doubt Solver - Chat endpoint for step-by-step question explanation with Hindi translation.
   * Uses the deterministic solver engine to compute and explain.
   */
  @Post('ask')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Ask AI to solve/explain a question step-by-step with Hindi translation' })
  async ask(
    @CurrentUser() user: { userId: string },
    @Body() body: {
      questionId?: string;
      questionText?: string;
      questionTextHindi?: string;
      options?: { key: string; text: string; textHi?: string }[];
      language?: 'en' | 'hi' | 'both';
    },
  ) {
    return this.solverService.askDoubt(user.userId, body);
  }

  /**
   * Get solver patterns/help for frontend to show what types of questions can be solved.
   */
  @Get('patterns')
  @Public()
  @ApiOperation({ summary: 'Get list of supported deterministic solver patterns' })
  getPatterns() {
    return this.solverService.getSupportedPatterns();
  }
}