import { PaymentGatewaySimulator, detectCardBrand, normalizeCardNumber } from './payment-gateway-simulator.service';

describe('PaymentGatewaySimulator', () => {
  const simulator = new PaymentGatewaySimulator();
  const original = process.env.BILLING_SIMULATED_LATENCY_MS;

  beforeEach(() => {
    process.env.BILLING_SIMULATED_LATENCY_MS = '0';
  });
  afterAll(() => {
    if (original === undefined) delete process.env.BILLING_SIMULATED_LATENCY_MS;
    else process.env.BILLING_SIMULATED_LATENCY_MS = original;
  });

  it('approves only 4242 4242 4242 4242', async () => {
    expect(await simulator.charge('4242424242424242')).toEqual({ approved: true });
    expect(await simulator.charge('4242 4242-4242 4242')).toEqual({ approved: true });
  });

  it.each([
    ['4000000000000002', 'card_declined'],
    ['4000 0000 0000 9995', 'insufficient_funds'],
    ['4000-0000-0000-0069', 'expired_card'],
  ])('declines %s with %s', async (number, reason) => {
    expect(await simulator.charge(number)).toEqual({ approved: false, reason });
  });

  it('declines any other number as unknown_test_card', async () => {
    expect(await simulator.charge('5555555555554444')).toEqual({ approved: false, reason: 'unknown_test_card' });
    expect(await simulator.charge('4111111111111111')).toEqual({ approved: false, reason: 'unknown_test_card' });
  });

  it('uses the configured latency and a 600 to 1200 ms default', () => {
    process.env.BILLING_SIMULATED_LATENCY_MS = '25';
    expect(simulator.latencyMs()).toBe(25);
    delete process.env.BILLING_SIMULATED_LATENCY_MS;
    for (let i = 0; i < 50; i++) {
      const ms = simulator.latencyMs();
      expect(ms).toBeGreaterThanOrEqual(600);
      expect(ms).toBeLessThanOrEqual(1200);
    }
  });

  it('normalizes numbers and detects the brand by prefix', () => {
    expect(normalizeCardNumber('4242 4242-4242 4242')).toBe('4242424242424242');
    expect(detectCardBrand('4242424242424242')).toBe('visa');
    expect(detectCardBrand('5555555555554444')).toBe('mastercard');
    expect(detectCardBrand('2223003122003222')).toBe('mastercard');
    expect(detectCardBrand('378282246310005')).toBe('unknown');
  });
});
