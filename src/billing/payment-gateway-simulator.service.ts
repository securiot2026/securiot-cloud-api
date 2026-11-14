import { Injectable } from '@nestjs/common';

export type CardBrand = 'visa' | 'mastercard' | 'unknown';
export type DeclineReason = 'card_declined' | 'insufficient_funds' | 'expired_card' | 'unknown_test_card';

export interface GatewayResult {
  approved: boolean;
  reason?: DeclineReason;
}

const APPROVED_CARD = '4242424242424242';
const DECLINED_CARDS: Record<string, DeclineReason> = {
  '4000000000000002': 'card_declined',
  '4000000000009995': 'insufficient_funds',
  '4000000000000069': 'expired_card',
};

export function normalizeCardNumber(raw: string): string {
  return raw.replace(/[\s-]/g, '');
}

export function detectCardBrand(digits: string): CardBrand {
  if (digits.startsWith('4')) return 'visa';
  if (/^5[1-5]/.test(digits) || /^2(2[2-9]|[3-6]\d|7[01]|720)/.test(digits)) return 'mastercard';
  return 'unknown';
}

/**
 * SIMULATED payment gateway for a university project. It never contacts any
 * processor and never moves money. It only recognises four documented test card
 * numbers, so a real card number is always declined as `unknown_test_card`.
 * It keeps no state and never logs or stores what it receives.
 */
@Injectable()
export class PaymentGatewaySimulator {
  /** Fixed latency from BILLING_SIMULATED_LATENCY_MS, or a random 600 to 1200 ms when unset. */
  latencyMs(): number {
    const raw = process.env.BILLING_SIMULATED_LATENCY_MS;
    if (raw !== undefined && raw.trim() !== '') {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
    return 600 + Math.floor(Math.random() * 601);
  }

  async charge(cardNumber: string): Promise<GatewayResult> {
    const delay = this.latencyMs();
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    const digits = normalizeCardNumber(cardNumber);
    if (digits === APPROVED_CARD) return { approved: true };
    return { approved: false, reason: DECLINED_CARDS[digits] ?? 'unknown_test_card' };
  }
}
