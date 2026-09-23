import { Body, PHYSICS, stepBodies, throwBodies } from '../src/components/dice/physics';

const bounds = { width: 360, height: 300 };
const seeded = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

function simulate(bodies: Body[], maxFrames = 2000) {
  let wallHits = 0;
  let diceHits = 0;
  for (let frame = 0; frame < maxFrames; frame++) {
    const r = stepBodies(bodies, 1 / 60, bounds);
    wallHits += r.wallHits;
    diceHits += r.diceHits;
    for (const b of bodies) {
      expect(b.x).toBeGreaterThanOrEqual(b.r - 1e-6);
      expect(b.x).toBeLessThanOrEqual(bounds.width - b.r + 1e-6);
      expect(b.y).toBeGreaterThanOrEqual(b.r - 1e-6);
      expect(b.y).toBeLessThanOrEqual(bounds.height - b.r + 1e-6);
    }
    if (r.settled) return { frame, wallHits, diceHits };
  }
  throw new Error('os dados nunca pararam');
}

describe('física dos dados', () => {
  it('um arremesso forte bate nas bordas, nunca sai da tela e para em poucos segundos', () => {
    const bodies = throwBodies(1, bounds, { x: 180, y: 250 }, { vx: 2500, vy: -2500 }, 28, seeded(1));
    const { frame, wallHits } = simulate(bodies);
    expect(wallHits).toBeGreaterThan(0);
    expect(frame / 60).toBeLessThan(6);
  });

  it('vários dados colidem entre si e terminam sem se sobrepor', () => {
    const bodies = throwBodies(6, bounds, { x: 180, y: 150 }, { vx: 0, vy: 0 }, 26, seeded(7));
    const { diceHits } = simulate(bodies);
    expect(diceHits).toBeGreaterThan(0);
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i]!;
        const b = bodies[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r - 2);
      }
    }
  });

  it('toque sem arrasto ainda gera um arremesso com velocidade limitada', () => {
    const [body] = throwBodies(1, bounds, { x: 10, y: 10 }, { vx: 0, vy: 0 }, 28, seeded(3));
    const speed = Math.hypot(body!.vx, body!.vy);
    expect(speed).toBeGreaterThan(300);
    expect(speed).toBeLessThanOrEqual(PHYSICS.maxSpeed * 1.15 + 1);
    expect(body!.x).toBeGreaterThanOrEqual(28);
  });

  it('dt gigante (app em segundo plano) é limitado para não atravessar paredes', () => {
    const bodies: Body[] = [{ x: 100, y: 100, vx: 2500, vy: 0, angle: 0, av: 0, r: 20, resting: 0 }];
    stepBodies(bodies, 5, bounds);
    expect(bodies[0]!.x).toBeLessThanOrEqual(bounds.width - 20);
  });
});
