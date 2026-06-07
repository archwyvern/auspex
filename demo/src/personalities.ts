import { makeBursty, makeWander, type Personality } from './sim'

const space: Personality = {
  key: 'space',
  appName: 'Nebula Skirmish',
  fps: 60,
  main: {
    tid: 1,
    name: 'Main',
    zones: [
      {
        name: 'Frame',
        base: 0.2,
        children: [
          { name: 'Input', base: 0.15 },
          {
            name: 'Update',
            base: 0.3,
            children: [
              { name: 'AI', base: 0.8, jitter: 0.4 },
              {
                name: 'Physics',
                base: 0.2,
                children: [
                  { name: 'Broadphase', base: 0.45 },
                  { name: 'Narrowphase', base: 0.7, jitter: 0.5 },
                  { name: 'Solve', base: 0.9, jitter: 0.3 },
                ],
              },
              { name: 'Bullets', base: 0.5, jitter: 0.6 },
              { name: 'Animation', base: 0.4 },
            ],
          },
          { name: 'Audio', base: 0.15 },
          { name: 'UI', base: 0.3, jitter: 0.4 },
        ],
      },
    ],
  },
  render: {
    tid: 2,
    name: 'Render',
    zones: [
      {
        name: 'RenderFrame',
        base: 0.1,
        children: [
          { name: 'Cull', base: 0.6 },
          { name: 'Batch', base: 1.0, jitter: 0.3 },
          { name: 'Submit', base: 1.4, jitter: 0.3 },
          { name: 'Present', base: 1.2, jitter: 0.8 },
        ],
      },
    ],
  },
  jobs: [
    {
      tid: 3,
      name: 'Worker 0',
      zones: [
        { name: 'PhysicsTask', base: 0.9, jitter: 0.7 },
        { name: 'PathQuery', base: 0.5, jitter: 0.8, chance: 0.6 },
      ],
    },
    {
      tid: 4,
      name: 'Worker 1',
      zones: [{ name: 'PhysicsTask', base: 0.8, jitter: 0.7 }],
    },
  ],
  jobChance: 0.55,
  counters: [
    { name: 'entities', next: makeWander(1800, 25, 600, 4000) },
    { name: 'bullets', next: makeBursty(120, 38000, 0.012, 0.93) },
    { name: 'drawCalls', next: makeWander(540, 18, 200, 1200) },
  ],
  hitches: [{ name: 'AssetLoad', marker: true, meanIntervalMs: 9000, durationMs: [25, 60] }],
  gc: { limitMb: 512, floorMb: 180, ratePerSec: 22, pauseMs: [8, 28] },
}

const city: Personality = {
  key: 'city',
  appName: 'Gridlock',
  fps: 30,
  main: {
    tid: 1,
    name: 'Main',
    zones: [
      {
        name: 'Frame',
        base: 0.3,
        children: [
          { name: 'Input', base: 0.1 },
          {
            name: 'Simulation',
            base: 0.5,
            children: [
              { name: 'Citizens', base: 6.0, jitter: 0.3 },
              { name: 'Traffic', base: 5.0, jitter: 0.4 },
              { name: 'Economy', base: 2.0, jitter: 0.25 },
            ],
          },
          { name: 'UI', base: 1.5, jitter: 0.3 },
        ],
      },
    ],
  },
  render: {
    tid: 2,
    name: 'Render',
    zones: [
      {
        name: 'RenderFrame',
        base: 0.2,
        children: [
          { name: 'Cull', base: 2.0, jitter: 0.3 },
          { name: 'Draw', base: 5.0, jitter: 0.3 },
          { name: 'Present', base: 1.5, jitter: 0.5 },
        ],
      },
    ],
  },
  counters: [
    { name: 'citizens', next: makeWander(52000, 40, 50000, 80000) },
    { name: 'vehicles', next: makeWander(7400, 60, 4000, 12000) },
  ],
  hitches: [{ name: 'Autosave', marker: true, meanIntervalMs: 20000, durationMs: [80, 150] }],
  gc: { limitMb: 1024, floorMb: 400, ratePerSec: 35, pauseMs: [15, 45] },
}

const server: Personality = {
  key: 'server',
  appName: 'Relay Server',
  fps: 20,
  main: {
    tid: 1,
    name: 'Main',
    zones: [
      {
        name: 'Tick',
        base: 0.2,
        children: [
          { name: 'Net', base: 0.8, jitter: 0.5 },
          {
            name: 'World',
            base: 0.3,
            children: [
              { name: 'Entities', base: 3.0, jitter: 0.5 },
              { name: 'Pathfinding', base: 4.0, jitter: 0.8 },
            ],
          },
          { name: 'Persistence', base: 0.5, chance: 0.15 },
        ],
      },
    ],
  },
  counters: [
    { name: 'players', next: makeWander(42, 1.5, 0, 64) },
    { name: 'packetsIn', next: makeWander(900, 80, 100, 2400) },
  ],
  hitches: [{ name: 'WorldSave', marker: true, meanIntervalMs: 30000, durationMs: [100, 250] }],
  gc: { limitMb: 256, floorMb: 100, ratePerSec: 8, pauseMs: [5, 15] },
}

const jitter: Personality = {
  key: 'jitter',
  appName: 'Stutterbug',
  fps: 60,
  main: {
    tid: 1,
    name: 'Main',
    zones: [
      {
        name: 'Frame',
        base: 0.2,
        children: [
          { name: 'Update', base: 3.0, jitter: 0.2 },
          { name: 'Effects', base: 2.0, jitter: 0.3 },
        ],
      },
    ],
  },
  render: {
    tid: 2,
    name: 'Render',
    zones: [
      {
        name: 'RenderFrame',
        base: 0.1,
        children: [{ name: 'Draw', base: 4.0, jitter: 0.3 }],
      },
    ],
  },
  counters: [{ name: 'particles', next: makeBursty(2000, 90000, 0.02, 0.9) }],
  hitches: [{ name: 'Spike', meanIntervalMs: 4000, durationMs: [20, 35] }],
  // 1.5s of clean pacing alternating with 1.5s of blown budget: the bad phase
  // pushes the ~5.2ms main thread to ~17.7ms, past the 16.6ms budget, so
  // frames visibly slip instead of just getting fatter.
  frameScale: frame => (Math.floor(frame / 90) % 2 === 0 ? 0.85 : 3.4),
}

export const personalities: Personality[] = [space, city, server, jitter]
