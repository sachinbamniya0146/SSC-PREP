import { Module } from '@nestjs/common';
import { SolverController } from './solver.controller';
import { SolverChatController } from './solver-chat.controller';
import { SolverService } from './solver.service';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [AuditLogModule],
  controllers: [SolverController, SolverChatController],
  providers: [SolverService],
  exports: [SolverService],
})
export class SolverModule {}