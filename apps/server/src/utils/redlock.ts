import Redlock, { Lock } from 'redlock';
import Redis from 'ioredis';

// Redlock configuration for distributed locking
const REDLOCK_RETRY_DELAY = 200; // milliseconds
const REDLOCK_RETRY_COUNT = 3;
const REDLOCK_DRIFT_FACTOR = 0.01; // clock drift factor

// Singleton instance
let redlockInstance: Redlock | null = null;

/**
 * Initialize Redlock with Redis connection
 */
export function initializeRedlock(redis: Redis): Redlock {
  if (redlockInstance) {
    return redlockInstance;
  }

  redlockInstance = new Redlock(
    [redis], // Redis instances (can be multiple for redundancy)
    {
      // The expected clock drift; for more details see:
      // http://redis.io/topics/distlock
      driftFactor: REDLOCK_DRIFT_FACTOR, // multiplied by lock ttl to determine drift time

      // The max number of times Redlock will attempt to lock a resource
      retryCount: REDLOCK_RETRY_COUNT,

      // The time in ms between attempts
      retryDelay: REDLOCK_RETRY_DELAY, // time in ms

      // The max time in ms randomly added to retries
      // to improve performance under high contention
      // see https://www.awsarchitectureblog.com/2015/03/backoff.html
      retryJitter: 200, // time in ms

      // The minimum validity time for a lock to be considered valid
      // after accounting for clock drift
      automaticExtensionThreshold: 500, // time in ms
    }
  );

  // Handle errors
  redlockInstance.on('error', (error) => {
    console.error('Redlock error:', error);
  });

  return redlockInstance;
}

/**
 * Get Redlock instance (must be initialized first)
 */
export function getRedlock(): Redlock {
  if (!redlockInstance) {
    throw new Error('Redlock not initialized. Call initializeRedlock first.');
  }
  return redlockInstance;
}

/**
 * Acquire a distributed lock for a specific resource
 * @param resource The resource identifier to lock (e.g., "loan:1234")
 * @param ttl Lock duration in milliseconds
 * @returns Lock instance that must be unlocked when done
 */
export async function acquireLock(resource: string, ttl: number = 10000): Promise<Lock> {
  const redlock = getRedlock();
  return redlock.acquire([resource], ttl);
}

/**
 * Try to acquire a lock without retrying
 * @param resource The resource identifier to lock
 * @param ttl Lock duration in milliseconds
 * @returns Lock instance or null if lock couldn't be acquired
 */
export async function tryAcquireLock(resource: string, ttl: number = 10000): Promise<Lock | null> {
  const redlock = getRedlock();
  try {
    // Try once without retries
    const lock = await redlock.acquire([resource], ttl, { retryCount: 0 });
    return lock;
  } catch (error) {
    // Lock couldn't be acquired
    return null;
  }
}

/**
 * Execute a function with a distributed lock
 * @param resource The resource identifier to lock
 * @param fn Function to execute while holding the lock
 * @param ttl Lock duration in milliseconds
 * @returns Result of the function
 */
export async function withLock<T>(
  resource: string,
  fn: () => Promise<T>,
  ttl: number = 10000
): Promise<T> {
  const lock = await acquireLock(resource, ttl);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

/**
 * Try to execute a function with a distributed lock (non-blocking)
 * @param resource The resource identifier to lock
 * @param fn Function to execute while holding the lock
 * @param ttl Lock duration in milliseconds
 * @returns Result of the function or null if lock couldn't be acquired
 */
export async function tryWithLock<T>(
  resource: string,
  fn: () => Promise<T>,
  ttl: number = 10000
): Promise<T | null> {
  const lock = await tryAcquireLock(resource, ttl);
  if (!lock) {
    return null;
  }
  
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

/**
 * Generate a lock resource identifier for loan liquidation
 */
export function getLoanLockResource(loanPda: string): string {
  return `liquidation:loan:${loanPda}`;
}

/**
 * Generate a lock resource identifier for borrower liquidation
 * (prevents liquidating multiple loans for same borrower simultaneously)
 */
export function getBorrowerLockResource(borrowerWallet: string): string {
  return `liquidation:borrower:${borrowerWallet}`;
}

/**
 * Extend a lock's duration
 */
export async function extendLock(lock: Lock, ttl: number): Promise<Lock> {
  return lock.extend(ttl);
}