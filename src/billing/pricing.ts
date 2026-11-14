import { IGV_RATE, Plan } from './plans';

export interface Charge {
  subtotal: number;
  igv: number;
  total: number;
}

// Works in integer cents so binary floating point never leaks into the amounts.
// IGV is rounded half up to 2 decimals.
export function computeCharge(plan: Plan, cameras: number): Charge {
  const subtotalCents = Math.round(cameras * (plan.installFeePerCamera + plan.monthlyPerCamera) * 100);
  const igvCents = Math.round(subtotalCents * IGV_RATE + Number.EPSILON);
  return {
    subtotal: subtotalCents / 100,
    igv: igvCents / 100,
    total: (subtotalCents + igvCents) / 100,
  };
}
