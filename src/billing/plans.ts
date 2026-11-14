export type PlanId = 'basic' | 'standard' | 'plus';

export interface Plan {
  id: PlanId;
  name: string;
  monthlyPerCamera: number;
  installFeePerCamera: number;
  features: string[];
}

export const CURRENCY = 'PEN';
export const IGV_RATE = 0.18;
export const PLAN_IDS: PlanId[] = ['basic', 'standard', 'plus'];

export const PLANS: Plan[] = [
  {
    id: 'basic',
    name: 'Basic',
    monthlyPerCamera: 39,
    installFeePerCamera: 350,
    features: ['Person detection', 'Phone alerts', 'Web live view', 'Remote updates'],
  },
  {
    id: 'standard',
    name: 'Standard',
    monthlyPerCamera: 49,
    installFeePerCamera: 350,
    features: ['Everything in Basic', 'Installation by our team', 'Managed on-site unit', 'Phone support'],
  },
  {
    id: 'plus',
    name: 'Plus',
    monthlyPerCamera: 69,
    installFeePerCamera: 350,
    features: [
      'Everything in Standard',
      'Authorized staff recognition',
      'Door lock output',
      'Night support line',
    ],
  },
];

export function findPlan(id: string): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}
