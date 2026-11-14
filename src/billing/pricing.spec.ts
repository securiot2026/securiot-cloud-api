import { computeCharge } from './pricing';
import { PLANS, findPlan } from './plans';

describe('computeCharge', () => {
  it('charges cameras x (install + monthly) plus 18 percent IGV', () => {
    expect(computeCharge(findPlan('basic')!, 1)).toEqual({ subtotal: 389, igv: 70.02, total: 459.02 });
    expect(computeCharge(findPlan('standard')!, 2)).toEqual({ subtotal: 798, igv: 143.64, total: 941.64 });
    expect(computeCharge(findPlan('plus')!, 8)).toEqual({ subtotal: 3352, igv: 603.36, total: 3955.36 });
  });

  it('rounds IGV to 2 decimals and keeps total equal to subtotal plus igv', () => {
    const plan = { ...PLANS[0], installFeePerCamera: 0.1, monthlyPerCamera: 0.1 };
    const charge = computeCharge(plan, 3);
    expect(charge.subtotal).toBe(0.6);
    expect(charge.igv).toBe(0.11);
    expect(charge.total).toBe(0.71);
  });

  it('rounds half up', () => {
    const plan = { ...PLANS[0], installFeePerCamera: 0, monthlyPerCamera: 0.25 };
    expect(computeCharge(plan, 1).igv).toBe(0.05);
  });
});
