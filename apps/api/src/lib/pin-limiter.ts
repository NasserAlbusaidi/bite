/**
 * Per-process PIN brute-force guard: 5 failures per (device, member) locks
 * that pair out for 5 minutes. A 4-digit PIN has 10k combinations, so this
 * caps an attacker with a stolen tablet at ~1.4k guesses/day per member.
 * Per-process is acceptable while we run one API instance; move to Postgres
 * when we scale out.
 */
export class PinLimiter {
	private failures = new Map<string, { count: number; until: number }>();
	constructor(
		private readonly max = 5,
		private readonly lockMs = 5 * 60_000,
	) {}

	isLocked(key: string, now = Date.now()): boolean {
		const f = this.failures.get(key);
		if (!f) return false;
		if (f.until && f.until <= now) {
			this.failures.delete(key);
			return false;
		}
		return f.count >= this.max;
	}

	fail(key: string, now = Date.now()): void {
		const f = this.failures.get(key) ?? { count: 0, until: 0 };
		f.count += 1;
		if (f.count >= this.max) f.until = now + this.lockMs;
		this.failures.set(key, f);
	}

	reset(key: string): void {
		this.failures.delete(key);
	}
}
