/**
 * PostgreSQL advisory locks for job coordination.
 * Prevents duplicate execution when multiple workers or processes could run the same job.
 */

import { getPrismaClient } from '../db/client';

const prisma = getPrismaClient();

/**
 * Acquire a session-level advisory lock for the given job name.
 * Returns true if lock was acquired, false if another process holds it.
 * Uses PostgreSQL hashtext() for a stable lock ID from the job name.
 */
export async function tryAcquireJobLock(jobName: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<[{ pg_try_advisory_lock: boolean }]>(
    `SELECT pg_try_advisory_lock(hashtext($1)::bigint) as "pg_try_advisory_lock"`,
    `futuro:${jobName}`
  );
  return rows[0]?.pg_try_advisory_lock ?? false;
}

/**
 * Release the session-level advisory lock. Call after job completes.
 */
export async function releaseJobLock(jobName: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `SELECT pg_advisory_unlock(hashtext($1)::bigint)`,
    `futuro:${jobName}`
  );
}

/**
 * Run a job with advisory lock. Skips execution if lock cannot be acquired.
 * Returns true if job ran, false if skipped.
 */
export async function withJobLock<T>(
  jobName: string,
  fn: () => Promise<T>
): Promise<{ ran: boolean; result?: T }> {
  const acquired = await tryAcquireJobLock(jobName);
  if (!acquired) {
    console.log(`[jobLock] Skipping ${jobName}: lock held by another process`);
    return { ran: false };
  }
  try {
    const result = await fn();
    return { ran: true, result };
  } finally {
    await releaseJobLock(jobName);
  }
}
