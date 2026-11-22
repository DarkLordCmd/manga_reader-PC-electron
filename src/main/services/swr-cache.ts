/**
 * Stale-while-revalidate cache for catalog HTTP results.
 *
 * Opening a catalog page the user already visited used to pay a full API/Tor
 * round-trip (MangaDex/Senkuro/Remanga). A stale result is now returned
 * immediately while a single background request refreshes it for next time.
 * In-flight de-duplication also collapses the double requests that the UI
 * occasionally issues (source switch + filter debounce).
 */
export class SwrCache<T> {
  private entries = new Map<string, { at: number; value: T }>();
  private inFlight = new Map<string, Promise<T>>();

  constructor(
    private ttlMs: number,
    private maxEntries: number,
    private staleMaxMs = 24 * 60 * 60_000,
  ) {}

  clear(): void {
    this.entries.clear();
  }

  async get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit) {
      const age = Date.now() - hit.at;
      this.entries.delete(key);
      this.entries.set(key, hit);
      if (age < this.ttlMs) return hit.value;
      if (this.staleMaxMs > this.ttlMs && age < this.staleMaxMs) {
        this.refresh(key, load).catch(() => {
          /* stale value is already being served; keep it on failure */
        });
        return hit.value;
      }
    }
    return this.refresh(key, load);
  }

  private refresh(key: string, load: () => Promise<T>): Promise<T> {
    const busy = this.inFlight.get(key);
    if (busy) return busy;
    const p = (async () => {
      try {
        const value = await load();
        this.entries.delete(key);
        this.entries.set(key, { at: Date.now(), value });
        while (this.entries.size > this.maxEntries) {
          const oldest = this.entries.keys().next().value;
          if (oldest === undefined) break;
          this.entries.delete(oldest);
        }
        return value;
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, p);
    return p;
  }
}
