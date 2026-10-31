export interface HitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface Entry {
  count: number;
  windowEnd: number;
}

/**
 * In-memory fixed-window counter. A key's window starts at its first hit and lasts windowMs.
 * Memory is bounded by maxKeys: when a new key would exceed it, expired keys are dropped first,
 * then the oldest one. State is per process and lost on restart.
 */
export class FixedWindowCounter {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly maxHits: number,
    private readonly windowMs: number,
    private readonly maxKeys: number = 10000,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  hit(key: string): HitResult {
    const now = Date.now();
    let entry = this.entries.get(key);

    if (entry && entry.windowEnd <= now) {
      this.entries.delete(key);
      entry = undefined;
    }
    if (!entry) {
      this.makeRoom(now);
      entry = { count: 0, windowEnd: now + this.windowMs };
      this.entries.set(key, entry);
    }

    entry.count += 1;
    return {
      allowed: entry.count <= this.maxHits,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.windowEnd - now) / 1000)),
    };
  }

  reset(): void {
    this.entries.clear();
  }

  private makeRoom(now: number): void {
    if (this.entries.size < this.maxKeys) {
      return;
    }
    for (const [key, entry] of this.entries) {
      if (entry.windowEnd <= now) {
        this.entries.delete(key);
      }
    }
    // Map iteration follows insertion order, and keys are (re)inserted when their window starts,
    // so the first key is the oldest.
    while (this.entries.size >= this.maxKeys) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}
