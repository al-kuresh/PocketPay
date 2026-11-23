import type { Prisma, PrismaClient } from '../generated/prisma/client';

export interface AuditEntry {
  actorId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: object;
  ip?: string;
}

/** Append one row to audit_logs. Pass a transaction client to make it part of that transaction. */
export async function writeAudit(
  db: PrismaClient | Prisma.TransactionClient,
  entry: AuditEntry,
): Promise<void> {
  await db.auditLog.create({
    data: { ...entry, metadata: entry.metadata as Prisma.InputJsonValue | undefined },
  });
}
