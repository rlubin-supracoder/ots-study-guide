export const WORLD = Object.freeze({ width: 420, height: 600, gravity: 720, jump: 510, boost: 870 });

export class OrbitGame {
  constructor(random = Math.random) { this.random = random; this.reset(); }
  reset() {
    this.player = { x: 194, y: 45, width: 32, height: 46, vx: 0, vy: WORLD.jump, facing: 1, boostTime: 0 };
    this.camera = 0; this.altitude = 0; this.score = 0; this.over = false; this.events = [];
    this.platforms = [{ x: 120, y: 26, width: 180, type: 'solid', vx: 0 }];
    this.nextY = 110; this.lastX = 168; this.sequence = 0;
    this.populate();
  }
  populate() {
    while (this.nextY < this.camera + WORLD.height + 220) {
      const difficulty = Math.min(1, this.nextY / 5500);
      const roll = this.random();
      const type = this.nextY < 360 ? 'solid' : roll < .15 + difficulty * .25 ? 'moving' : roll < .25 + difficulty * .3 ? 'vanish' : 'solid';
      const width = 82 - difficulty * 18;
      const x = Math.max(12, Math.min(WORLD.width - width - 12, this.lastX + (this.random() - .5) * 250));
      this.platforms.push({ x, y: this.nextY, width, type, vx: type === 'moving' ? (this.random() < .5 ? -1 : 1) * (32 + difficulty * 25) : 0, boost: type === 'solid' && this.sequence > 3 && this.random() < .16 });
      // A safe route remains available beside the fragile decoy platforms.
      if (this.sequence > 4 && this.random() < .3) {
        const decoyX = x < 180 ? Math.min(336, x + 160) : Math.max(10, x - 160);
        this.platforms.push({ x: decoyX, y: this.nextY + 28, width: 62, type: 'fragile', vx: 0 });
      }
      this.lastX = x;
      this.nextY += 58 + this.random() * 22 + difficulty * 15;
      this.sequence++;
    }
  }
  step(dt, direction = 0) {
    this.events = [];
    if (this.over) return;
    dt = Math.min(Math.max(dt, 0), 1 / 30);
    const p = this.player;
    const previousY = p.y;
    const axis = Math.max(-1, Math.min(1, direction));
    p.vx += axis * 1600 * dt;
    if (!axis) p.vx *= Math.exp(-11 * dt);
    p.vx = Math.max(-290, Math.min(290, p.vx));
    if (axis) p.facing = axis;
    p.x += p.vx * dt;
    if (p.x > WORLD.width) p.x -= WORLD.width + p.width;
    if (p.x + p.width < 0) p.x += WORLD.width + p.width;
    p.vy -= WORLD.gravity * dt;
    p.y += p.vy * dt;
    p.boostTime = Math.max(0, p.boostTime - dt);
    for (const platform of this.platforms) {
      platform.x += platform.vx * dt;
      if (platform.x < 6) { platform.x = 6; platform.vx = Math.abs(platform.vx); }
      if (platform.x + platform.width > WORLD.width - 6) { platform.x = WORLD.width - 6 - platform.width; platform.vx = -Math.abs(platform.vx); }
    }
    if (p.vy < 0) {
      const crossed = this.platforms.filter(platform => !platform.gone && previousY >= platform.y && p.y <= platform.y && p.x + p.width - 3 > platform.x && p.x + 3 < platform.x + platform.width).sort((a, b) => b.y - a.y);
      for (const platform of crossed) {
        const x = platform.x + platform.width / 2;
        if (platform.type === 'fragile') {
          platform.gone = true;
          this.events.push({ type: 'break', x, y: platform.y });
          continue;
        }
        const boosted = platform.boost && Math.abs(p.x + p.width / 2 - x) < 24;
        p.y = platform.y;
        p.vy = boosted ? WORLD.boost : WORLD.jump;
        p.boostTime = boosted ? .7 : 0;
        if (platform.type === 'vanish') platform.gone = true;
        this.events.push({ type: boosted ? 'boost' : 'bounce', x: p.x + p.width / 2, y: p.y });
        break;
      }
    }
    this.altitude = Math.max(this.altitude, p.y - 45);
    this.score = Math.floor(this.altitude);
    this.camera = Math.max(this.camera, p.y - WORLD.height * .52);
    this.platforms = this.platforms.filter(platform => platform.y > this.camera - 70 && !platform.gone);
    this.populate();
    if (p.y + p.height < this.camera - 40) { this.over = true; this.events.push({ type: 'over' }); }
  }
}
