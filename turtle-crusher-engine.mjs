export const ROUND_MS = 30_000;
export const TARGET_MS = 1_500;

export class TurtleRound {
  constructor(random = Math.random) {
    this.random = random;
    this.state = 'ready';
    this.score = 0;
    this.hits = 0;
    this.tosses = 0;
    this.active = -1;
    this.lastHole = -1;
    this.remaining = ROUND_MS;
  }

  start(now) {
    this.state = 'running';
    this.score = this.hits = this.tosses = 0;
    this.active = this.lastHole = -1;
    this.remaining = ROUND_MS;
    this.endsAt = now + ROUND_MS;
    this.nextAt = now;
    this.tick(now);
  }

  tick(now) {
    if (this.state !== 'running') return;
    this.remaining = Math.max(0, this.endsAt - now);
    if (!this.remaining) {
      this.state = 'over';
      this.active = -1;
      return;
    }
    if (this.active !== -1 && now >= this.targetUntil) {
      this.active = -1;
      this.nextAt = now + 180;
    }
    if (this.active === -1 && now >= this.nextAt) {
      // Every new turtle uses a different hole, including with repeated random values.
      const choices = Array.from({ length: 9 }, (_, i) => i).filter(i => i !== this.lastHole);
      this.active = choices[Math.min(choices.length - 1, Math.floor(this.random() * choices.length))];
      this.lastHole = this.active;
      this.targetUntil = now + TARGET_MS;
    }
  }

  hit(hole, now) {
    this.tick(now);
    if (this.state !== 'running' || !Number.isInteger(hole) || hole < 0 || hole > 8) return false;
    this.tosses++;
    if (hole !== this.active) return false;
    this.hits++;
    this.score += 10;
    this.active = -1;
    this.nextAt = now + 500;
    return true;
  }

  pause(now) {
    this.tick(now);
    if (this.state !== 'running') return;
    this.state = 'paused';
    this.pausedAt = now;
  }

  resume(now) {
    if (this.state !== 'paused') return;
    const elapsed = now - this.pausedAt;
    this.endsAt += elapsed;
    this.nextAt += elapsed;
    this.targetUntil += elapsed;
    this.state = 'running';
  }
}
