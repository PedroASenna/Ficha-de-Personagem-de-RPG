/**
 * Física 2D mínima dos dados (corpos circulares), feita para rodar como worklet na UI thread
 * via useFrameCallback. Funções puras: testadas no Jest como TypeScript comum.
 */

export type Body = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  av: number;
  r: number;
  /** Quadros seguidos abaixo da velocidade de repouso. */
  resting: number;
};

export type Bounds = { width: number; height: number };

export const PHYSICS = {
  restitution: 0.62,
  wallFriction: 0.88,
  linearDamping: 1.4,
  angularDamping: 1.8,
  restSpeed: 22,
  restFrames: 14,
  maxSpeed: 2600,
  maxDt: 1 / 30,
} as const;

export type StepResult = { wallHits: number; diceHits: number; settled: boolean };

export function stepBodies(bodies: Body[], dtSeconds: number, bounds: Bounds): StepResult {
  'worklet';
  const dt = Math.min(dtSeconds, PHYSICS.maxDt);
  const damp = Math.exp(-PHYSICS.linearDamping * dt);
  const spinDamp = Math.exp(-PHYSICS.angularDamping * dt);
  let wallHits = 0;
  let diceHits = 0;

  for (const b of bodies) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.angle += b.av * dt;
    b.vx *= damp;
    b.vy *= damp;
    b.av *= spinDamp;

    // Bordas da tela: reflete a velocidade e perde energia; o atrito gira o dado.
    if (b.x - b.r < 0) {
      b.x = b.r;
      b.vx = Math.abs(b.vx) * PHYSICS.restitution;
      b.av += b.vy * 0.004;
      b.vy *= PHYSICS.wallFriction;
      wallHits++;
    } else if (b.x + b.r > bounds.width) {
      b.x = bounds.width - b.r;
      b.vx = -Math.abs(b.vx) * PHYSICS.restitution;
      b.av -= b.vy * 0.004;
      b.vy *= PHYSICS.wallFriction;
      wallHits++;
    }
    if (b.y - b.r < 0) {
      b.y = b.r;
      b.vy = Math.abs(b.vy) * PHYSICS.restitution;
      b.av -= b.vx * 0.004;
      b.vx *= PHYSICS.wallFriction;
      wallHits++;
    } else if (b.y + b.r > bounds.height) {
      b.y = bounds.height - b.r;
      b.vy = -Math.abs(b.vy) * PHYSICS.restitution;
      b.av += b.vx * 0.004;
      b.vx *= PHYSICS.wallFriction;
      wallHits++;
    }
  }

  // Colisão entre dados (massas iguais): separa e troca impulso na direção normal.
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]!;
      const c = bodies[j]!;
      const dx = c.x - a.x;
      const dy = c.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
      const overlap = a.r + c.r - dist;
      if (overlap <= 0) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      a.x -= (nx * overlap) / 2;
      a.y -= (ny * overlap) / 2;
      c.x += (nx * overlap) / 2;
      c.y += (ny * overlap) / 2;
      const vn = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
      if (vn < 0) {
        const impulse = (-(1 + PHYSICS.restitution) * vn) / 2;
        a.vx -= impulse * nx;
        a.vy -= impulse * ny;
        c.vx += impulse * nx;
        c.vy += impulse * ny;
        a.av -= impulse * 0.01;
        c.av += impulse * 0.01;
        diceHits++;
      }
    }
  }

  // A separação entre dados pode empurrar um deles para fora: devolve para dentro da bandeja.
  for (const b of bodies) {
    b.x = Math.min(bounds.width - b.r, Math.max(b.r, b.x));
    b.y = Math.min(bounds.height - b.r, Math.max(b.r, b.y));
  }

  let settled = bodies.length > 0;
  for (const b of bodies) {
    const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    b.resting = speed < PHYSICS.restSpeed && Math.abs(b.av) < 1.5 ? b.resting + 1 : 0;
    if (b.resting < PHYSICS.restFrames) settled = false;
  }
  return { wallHits, diceHits, settled };
}

/** Cria os corpos saindo do ponto do gesto, com leve espalhamento e giro. */
export function throwBodies(
  count: number,
  bounds: Bounds,
  origin: { x: number; y: number },
  velocity: { vx: number; vy: number },
  radius: number,
  random: () => number = Math.random,
): Body[] {
  const speed = Math.hypot(velocity.vx, velocity.vy);
  // Toque sem arrasto: joga numa direção aleatória com força média.
  const base =
    speed < 150
      ? { vx: (random() - 0.5) * 2400, vy: -(900 + random() * 900) }
      : { vx: velocity.vx, vy: velocity.vy };
  const scale = Math.min(1, PHYSICS.maxSpeed / Math.max(1, Math.hypot(base.vx, base.vy)));
  return Array.from({ length: count }, (_, i) => {
    const spread = (i - (count - 1) / 2) * radius * 1.2;
    return {
      x: Math.min(bounds.width - radius, Math.max(radius, origin.x + spread)),
      y: Math.min(bounds.height - radius, Math.max(radius, origin.y + (random() - 0.5) * radius)),
      vx: base.vx * scale * (0.85 + random() * 0.3),
      vy: base.vy * scale * (0.85 + random() * 0.3),
      angle: random() * Math.PI * 2,
      av: (random() - 0.5) * 30,
      r: radius,
      resting: 0,
    };
  });
}
