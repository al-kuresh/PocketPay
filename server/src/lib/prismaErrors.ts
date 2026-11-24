/** Prisma 7 with a driver adapter: P2002 has no meta.target; the constraint name is here. */
export function violatedUniqueIndex(err: unknown): string | undefined {
  const e = err as {
    code?: string;
    meta?: { driverAdapterError?: { cause?: { constraint?: { index?: string } } } };
  };
  return e?.code === 'P2002' ? e.meta?.driverAdapterError?.cause?.constraint?.index : undefined;
}
