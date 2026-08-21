import { Controller, Post, Body, UseGuards, Get, Query, Param, ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TicketCategory, TicketPriority } from '@prisma/client';

@Controller('support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private prisma: PrismaService) {}

  // ---- Create Support Ticket (User-facing) ----
  @Post('tickets')
  async createTicket(
    @CurrentUser() user: { id: string; email: string; fullName: string },
    @Body() body: { subject: string; description: string; category?: TicketCategory; priority?: TicketPriority },
  ) {
    if (!body.subject || !body.description) {
      throw new Error('Subject and description are required');
    }

    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId: user.id,
        email: user.email,
        name: user.fullName,
        subject: body.subject,
        description: body.description,
        category: body.category || 'GENERAL',
        priority: body.priority || 'MEDIUM',
        status: 'OPEN',
      },
    });

    return { ticket };
  }

  // ---- Get User's Tickets ----
  @Get('tickets')
  async getMyTickets(
    @CurrentUser() user: { id: string },
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('status') status?: string,
  ) {
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const skip = (pageNum - 1) * limitNum;

    const where: any = { userId: user.id };
    if (status) where.status = status;

    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return {
      tickets,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    };
  }

  // ---- Get Single Ticket (User-facing) ----
  @Get('tickets/:id')
  async getTicket(
    @CurrentUser() user: { id: string; role: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
    });
    if (!ticket) {
      throw new Error('Support ticket not found');
    }

    // Users can only see their own tickets, admins can see all
    if (user.role !== 'ADMIN' && user.role !== 'MODERATOR' && ticket.userId !== user.id) {
      throw new Error('Access denied');
    }

    return ticket;
  }

  // ---- Public Support Contact (No auth required) ----
  @Post('contact')
  async submitContactForm(
    @Body() body: { email: string; name: string; subject: string; description: string; category?: TicketCategory; priority?: TicketPriority },
  ) {
    if (!body.email || !body.name || !body.subject || !body.description) {
      throw new Error('All fields are required');
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email)) {
      throw new Error('Invalid email format');
    }

    // Check if user exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: body.email.toLowerCase() },
    });

    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId: existingUser?.id || null,
        email: body.email.toLowerCase(),
        name: body.name,
        subject: body.subject,
        description: body.description,
        category: body.category || 'GENERAL',
        priority: body.priority || 'MEDIUM',
        status: 'OPEN',
      },
    });

    return { success: true, ticketId: ticket.id, message: 'Your support request has been submitted. We will get back to you soon.' };
  }
}