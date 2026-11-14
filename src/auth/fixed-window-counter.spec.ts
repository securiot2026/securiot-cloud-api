import { FixedWindowCounter } from './fixed-window-counter';

describe('FixedWindowCounter', () => {
  let now: number;
  let nowSpy: jest.SpyInstance;

  beforeEach(() => {
    now = 1_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('allows maxHits hits per window and denies the next one with a positive retryAfterSeconds', () => {
    const counter = new FixedWindowCounter(5, 15 * 60 * 1000);
    for (let i = 0; i < 5; i += 1) {
      expect(counter.hit('k').allowed).toBe(true);
    }
    now += 1000;
    const denied = counter.hit('k');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.retryAfterSeconds).toBe(15 * 60 - 1);
  });

  it('allows the key again after the window elapses', () => {
    const counter = new FixedWindowCounter(1, 1000);
    expect(counter.hit('k').allowed).toBe(true);
    expect(counter.hit('k').allowed).toBe(false);
    now += 1000;
    expect(counter.hit('k').allowed).toBe(true);
  });

  it('keeps different keys independent', () => {
    const counter = new FixedWindowCounter(1, 1000);
    expect(counter.hit('a').allowed).toBe(true);
    expect(counter.hit('a').allowed).toBe(false);
    expect(counter.hit('b').allowed).toBe(true);
  });

  it('reset clears all keys', () => {
    const counter = new FixedWindowCounter(1, 1000);
    counter.hit('a');
    counter.reset();
    expect(counter.size).toBe(0);
    expect(counter.hit('a').allowed).toBe(true);
  });

  it('stays bounded: evicts expired keys first, then the oldest', () => {
    const counter = new FixedWindowCounter(1, 1000, 3);
    counter.hit('a'); // window ends at +1000
    now += 500;
    counter.hit('b'); // ends +1500
    now += 100;
    counter.hit('c'); // ends +1600
    expect(counter.size).toBe(3);

    now += 500; // a expired, b and c alive
    counter.hit('d');
    expect(counter.size).toBe(3);
    expect(counter.hit('b').allowed).toBe(false); // b survived the eviction (a was expired and went first)

    counter.hit('e'); // nothing expired now: the oldest live key is evicted
    expect(counter.size).toBe(3);
    expect(counter.hit('b').allowed).toBe(true); // b was the oldest and started a new window
  });
});
