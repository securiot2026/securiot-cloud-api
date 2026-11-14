import { Injectable } from '@nestjs/common';
import { FixedWindowCounter, HitResult } from './fixed-window-counter';

export const RESET_RATE_WINDOW_MS = 15 * 60 * 1000;
export const FORGOT_MAX_PER_IP = 5;
export const FORGOT_MAX_PER_EMAIL = 5;
export const RESET_MAX_PER_IP = 10;

/**
 * Per-IP and per-email limits for the unauthenticated reset endpoints, in memory (no throttler
 * dependency). Counting happens whether or not the account exists, so a 429 reveals nothing.
 */
@Injectable()
export class PasswordResetRateLimiter {
  private readonly forgotByIp = new FixedWindowCounter(FORGOT_MAX_PER_IP, RESET_RATE_WINDOW_MS);
  private readonly forgotByEmail = new FixedWindowCounter(FORGOT_MAX_PER_EMAIL, RESET_RATE_WINDOW_MS);
  private readonly resetByIp = new FixedWindowCounter(RESET_MAX_PER_IP, RESET_RATE_WINDOW_MS);

  checkForgot(ip: string, email: string): HitResult {
    const byIp = this.forgotByIp.hit(ip);
    const byEmail = this.forgotByEmail.hit(email.trim().toLowerCase());
    return {
      allowed: byIp.allowed && byEmail.allowed,
      retryAfterSeconds: Math.max(
        byIp.allowed ? 0 : byIp.retryAfterSeconds,
        byEmail.allowed ? 0 : byEmail.retryAfterSeconds,
        1,
      ),
    };
  }

  checkReset(ip: string): HitResult {
    return this.resetByIp.hit(ip);
  }

  reset(): void {
    this.forgotByIp.reset();
    this.forgotByEmail.reset();
    this.resetByIp.reset();
  }
}
