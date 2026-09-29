import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { invalidateStaffAccess } from '../common/guards/roles.guard';
import { StaffPermissionValue } from './dto/staff.dto';

const STAFF_SELECT = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  permissions: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Admin-managed staff: give any registered student a department role
 * (Questions / Practice / Vocabulary / Support) by email, change it, or
 * take it back. Access changes take effect within seconds (RolesGuard reads
 * role/permissions live from the DB).
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  private normEmail(email: string) {
    return email.trim().toLowerCase();
  }

  /** All current staff (moderators) with how much each has uploaded. */
  async list() {
    const staff = await this.prisma.user.findMany({
      where: { role: 'MODERATOR' },
      select: {
        ...STAFF_SELECT,
        _count: { select: { uploadBatches: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true, email: true, fullName: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      staff: staff.map((s) => ({
        id: s.id,
        email: s.email,
        fullName: s.fullName,
        permissions: s.permissions,
        createdAt: s.createdAt,
        uploads: s._count.uploadBatches,
      })),
      admins,
    };
  }

  /** Preview a user by email before granting access. */
  async lookup(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: this.normEmail(email) },
      select: STAFF_SELECT,
    });
    if (!user) {
      throw new NotFoundException(
        'Is email se koi account nahi mila. Student ko pehle app par signup karne bolein, phir yahan access dein.',
      );
    }
    return user;
  }

  async grant(actorId: string, email: string, permissions: StaffPermissionValue[]) {
    const target = await this.prisma.user.findUnique({
      where: { email: this.normEmail(email) },
      select: { id: true, email: true, role: true },
    });
    if (!target) {
      throw new NotFoundException(
        'Is email se koi account nahi mila. Student ko pehle app par signup karne bolein, phir yahan access dein.',
      );
    }
    if (target.role === 'ADMIN') {
      throw new BadRequestException('Ye account already ADMIN hai — use department access ki zaroorat nahi.');
    }
    if (target.id === actorId) {
      throw new ForbiddenException('Aap apna khud ka access change nahi kar sakte.');
    }
    const updated = await this.prisma.user.update({
      where: { id: target.id },
      data: { role: 'MODERATOR', permissions: { set: permissions } },
      select: STAFF_SELECT,
    });
    invalidateStaffAccess(target.id);
    await this.audit.log({
      userId: actorId,
      action: target.role === 'MODERATOR' ? 'STAFF_PERMISSIONS_UPDATED' : 'STAFF_GRANTED',
      targetEntity: 'User',
      entityId: target.id,
      metadataJson: { email: target.email, permissions, previousRole: target.role },
    });
    return updated;
  }

  async update(actorId: string, userId: string, permissions: StaffPermissionValue[], note?: string) {
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true } });
    if (!target) throw new NotFoundException('User not found');
    if (target.role !== 'MODERATOR') {
      throw new BadRequestException('Ye user staff nahi hai. Pehle "Add Staff" se access dein.');
    }
    if (target.id === actorId) {
      throw new ForbiddenException('Aap apna khud ka access change nahi kar sakte.');
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { permissions: { set: permissions } },
      select: STAFF_SELECT,
    });
    invalidateStaffAccess(userId);
    await this.audit.log({
      userId: actorId,
      action: 'STAFF_PERMISSIONS_UPDATED',
      targetEntity: 'User',
      entityId: userId,
      metadataJson: { email: target.email, permissions, note: note ?? null },
    });
    return updated;
  }

  /** Take staff access back — account returns to a normal student. */
  async revoke(actorId: string, userId: string) {
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true } });
    if (!target) throw new NotFoundException('User not found');
    if (target.role === 'ADMIN') throw new ForbiddenException('ADMIN account ka access yahan se hata nahi sakte.');
    if (target.id === actorId) throw new ForbiddenException('Aap apna khud ka access change nahi kar sakte.');
    if (target.role !== 'MODERATOR') throw new BadRequestException('Ye user pehle se staff nahi hai.');
    await this.prisma.user.update({
      where: { id: userId },
      data: { role: 'STUDENT', permissions: { set: [] } },
    });
    invalidateStaffAccess(userId);
    await this.audit.log({
      userId: actorId,
      action: 'STAFF_REVOKED',
      targetEntity: 'User',
      entityId: userId,
      metadataJson: { email: target.email },
    });
    return { ok: true };
  }
}
