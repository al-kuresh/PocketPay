import type { AuditLog, Prisma } from '../../generated/prisma/client';
import { prisma } from '../../lib/prisma';
import { dhakaDateRange } from '../../utils/time';
import { pageArgs, toPage } from './admin.shared';
import type { AuditListQuery } from './admin.schemas';

const NEWEST_FIRST = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
const withActor = { actor: { select: { id: true, name: true, role: true } } } as const;
type AuditRow = AuditLog & { actor: { id: string; name: string; role: string } | null };

// An allowlist, as toPublicUser. Metadata is shown as written: writers keep it to ids, actions
// and reasons (never an NID, PIN, token or URL).
const toAuditItem = (a: AuditRow) => ({
  id: a.id,
  createdAt: a.createdAt,
  action: a.action,
  actor: a.actor,
  targetType: a.targetType,
  targetId: a.targetId,
  metadata: a.metadata,
  ip: a.ip,
});

/** The audit log, newest first, keyset-paged. */
export async function listAudit(q: AuditListQuery) {
  const where: Prisma.AuditLogWhereInput = {
    actorId: q.actorId,
    targetId: q.targetId,
    action: q.action,
    createdAt: dhakaDateRange(q.from, q.to),
  };
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: NEWEST_FIRST,
    include: withActor,
    ...pageArgs(q.cursor, q.limit),
  });
  const { page, nextCursor } = toPage(rows, q.cursor, q.limit);
  return { items: page.map(toAuditItem), nextCursor };
}

/** The last `n` audit rows about one user (target), newest first. */
export async function recentAuditFor(userId: string, n = 10) {
  const rows = await prisma.auditLog.findMany({
    where: { targetId: userId },
    orderBy: NEWEST_FIRST,
    include: withActor,
    take: n,
  });
  return rows.map(toAuditItem);
}
