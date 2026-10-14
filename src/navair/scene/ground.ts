/**
 * Ground: the plan-view road network, quay apron, slab bands (the black
 * ground strip seen in elevation), yard stack and the scenery of the port /
 * logistics world.
 *
 *   plan      road network (one road system) + 3D roadside props near the
 *             junction, the gate and the port approach (plan / pitch-rise views)
 *   corridor  roadside world for the yaw-90 elevation (grounded weak perspective):
 *             foreground furniture, midground warehouses / RTG yard, hazed skyline
 *   quay      apron, landside yard, fence and high masts (plan + berth aerial)
 *
 * Prop builders live in ./props/.
 */

import { Node3 } from '../engine/engine';
import { rect, stroke } from '../engine/art';
import { rng } from '../engine/math';
import { BOX, C } from '../world';
import { LIVERY, container } from '../machines/container';
import { APRON_Z1, EXIT_Z, HALF, LANE_X, PORT_X0, PORT_X1, QUAY_EDGE_Z, START_Z, TURN_CX, TURN_CZ, TURN_R, TURN_Z } from './route';
import { BRANCH_LEN, RP, VERGE, roadPlanArt } from './props/roadplan';
import { fenceRun, guardrail, highMast, jerseyRun, roadSign, signGantry, streetLamp, type SignKind } from './props/street';
import { office, parkedTrailer, rtg, skyline, warehouse, yardBlock, BOX_TONES } from './props/yard';
import { FENDER, LAND, landsideArt, quayArt, terminalGate, yardDeckArt } from './props/port';

/* ------------------------------------------------------------------ plan */

/** Plan-art bounds (world X/Z) covered by the road face. */
const PX0 = LANE_X - 6000;
const PX1 = PORT_X1;
const PZ0 = TURN_Z - BRANCH_LEN - 2000;
const PZ1 = START_Z + 22000;

/* ----------------------------------------------------------------- bands */

/**
 * Elevation bands: the black ground strip. They are real faces of the ground
 * slab, so when the camera rises they foreshorten away exactly.
 */
function band(len: number, depth: number) {
  return rect(0, 0, len, depth, C.ink) + rect(0, 0, len, 5, '#23252B');
}

export interface Ground {
  root: Node3;
  /** Road slab (+X faces). Scale k[1] to deepen the band into the services panel. */
  slab: Node3;
  /** Yard slab (+Z face). */
  yardSlab: Node3;
  plan: Node3;
  quay: Node3;
  stack: Node3;
  hero: Node3;
  yardDecor: Node3;
  corridor: Node3;
}

export const SLAB = 300;

/** Road-side lines (world X). Far side = −X of the road (behind the truck in the yaw-90 elevation). */
const FAR_EDGE = LANE_X - HALF; // asphalt edge
const NEAR_EDGE = LANE_X + HALF;
const X_RAIL = FAR_EDGE - VERGE + 40; // guardrail at the back of the verge
const X_LAMP = FAR_EDGE - VERGE - 90;
const X_SIGN = FAR_EDGE - VERGE - 260;
const X_FENCE = FAR_EDGE - 1100;
/** Corridor (perspective scenery) ends here; nearer the junction the plan node carries the props. */
const Z_CUT = -24000;
const LAMP_PITCH = 3600;

export function createGround(): Ground {
  const root = new Node3('ground');

  /* ======================================================== plan road */
  const plan = root.node('plan');
  plan.face({
    o: [PX0, 0, PZ0],
    a: [1, 0, 0],
    b: [0, 0, 1],
    w: PX1 - PX0,
    h: PZ1 - PZ0,
    art: roadPlanArt({ ox: PX0, oz: PZ0 }, { xEnd: PORT_X1 }),
    double: true,
    layer: -9,
    shade: 0,
    name: 'road-plan',
  });
  buildPlanProps(plan);

  /* ======================================================== quay / port */
  const quay = root.node('quay');
  quay.face({
    o: [PORT_X0, 0, QUAY_EDGE_Z - FENDER],
    a: [1, 0, 0],
    b: [0, 0, 1],
    w: PORT_X1 - PORT_X0,
    h: APRON_Z1 - QUAY_EDGE_Z + FENDER,
    art: quayArt(),
    double: true,
    layer: -9.5,
    shade: 0,
    name: 'quay',
  });
  buildPort(quay);

  /* ======================================================== slabs */
  // Road slab: +X-facing band along the road's near edge (x = LANE_X + HALF).
  const slab = root.node('slab', [LANE_X + HALF, 0, 0]);
  const zA = TURN_Z - 4000, zB = START_Z + 30000;
  slab.face({
    o: [0, 0, zB],
    a: [0, 0, -1],
    b: [0, -1, 0],
    w: zB - zA,
    h: SLAB,
    art: band(zB - zA, SLAB),
    layer: -10,
    shade: 0,
    name: 'slab-x',
  });

  // Yard slab: +Z-facing band for the yaw-0 elevation.
  const yardSlab = root.node('yard-slab', [0, 0, 1800]);
  yardSlab.face({
    o: [-12000, 0, 0],
    a: [1, 0, 0],
    b: [0, -1, 0],
    w: 17000,
    h: SLAB,
    art: band(17000, SLAB),
    layer: -10,
    shade: 0,
    name: 'slab-z',
  });

  /* ---------------- yard stack: containers end-on (long axis along Z) */
  const stack = root.node('stack');
  const endOn = -90; // local +X (doors) → world +Z, toward the yaw-0 camera
  const navy = stack.add(container('stack-navy', LIVERY.navy));
  navy.p = [0, 0, 0];
  navy.r.y = endOn;
  const orange = stack.add(container('stack-orange', LIVERY.orange));
  orange.p = [BOX.W + 18, 0, 0];
  orange.r.y = endOn;
  const hero = root.add(container('hero', LIVERY.hero));
  hero.p = [0, BOX.H, 0];
  hero.r.y = endOn;

  // Yard deck: a light concrete plane so machines stand on something in 3/4 views.
  const yardDecor = root.node('yard-decor');
  {
    const x0 = -12000, x1 = 5000, z0 = -9000, z1 = 1800;
    const w = x1 - x0, h = z1 - z0;
    yardDecor.face({
      o: [x0, 0, z0],
      a: [1, 0, 0],
      b: [0, 0, 1],
      w,
      h,
      art: yardDeckArt(w, h, x0, z0),
      double: true,
      layer: -9.8,
      shade: 0,
      name: 'yard-deck',
    });
  }

  // A hazed port skyline far behind the stack (weak perspective), so the opening
  // chapter already sits in a place. Faces +Z (the stack chapter looks along −Z).
  {
    const sky = yardDecor.node('yard-sky');
    sky.persp = true;
    const R = rng(5);
    const items: [number, number, 'sts' | 'shed' | 'masts' | 'silo', number, number][] = [
      [-2500, -22000, 'sts', 0.84, 0.42],
      [4200, -22000, 'sts', 0.84, 0.42],
      [9000, -15000, 'masts', 0.8, 0.55],
      [12000, -18000, 'shed', 0.8, 0.6],
    ];
    for (const [x, z, kind, hz, s] of items) {
      const n = skyline(sky, `ysky-${x}`, [x, 0, z], kind, { haze: hz, seed: R });
      n.r.y = -90; // local +X (the drawing's front) → world +Z
      n.s = s;
    }
  }

  /* ======================================================== corridor */
  const corridor = root.node('corridor');
  corridor.persp = true;
  buildCorridor(corridor);
  // The road surface under the truck for the low-pitch elevation (orthographic, same
  // palette as the plan road, which paints over it once it appears).
  {
    const rd = corridor.node('corridor-road');
    rd.persp = false;
    const z0 = START_Z + 20000, z1 = Z_CUT - 8000;
    const L = z0 - z1, Wd = 2 * HALF + 2 * VERGE;
    const eo = VERGE + 40;
    rd.face({
      o: [FAR_EDGE - VERGE, 0, z0],
      a: [0, 0, -1],
      b: [1, 0, 0],
      w: L,
      h: Wd,
      art:
        rect(0, 0, L, Wd, RP.verge) +
        rect(0, VERGE - 26, L, 2 * HALF + 52, RP.kerb) +
        rect(0, VERGE, L, 2 * HALF, RP.asphalt) +
        stroke(`M0 ${eo}H${L}M0 ${Wd - eo}H${L}`, RP.edge, 14) +
        stroke(`M0 ${VERGE + (2 * HALF) / 3}H${L}M0 ${VERGE + (4 * HALF) / 3}H${L}`, RP.dash, 22, { 'stroke-dasharray': '300 420' }),
      double: true,
      layer: -9.2,
      shade: 0,
      name: 'corridor-road',
    });
  }

  return { root, slab, yardSlab, plan, quay, stack, hero, yardDecor, corridor };
}

/* ------------------------------------------------------------ corridor */

/**
 * Roadside world for the yaw-90 elevation. The camera sits on +X looking −X;
 * the truck drives −Z (screen right). Everything stands on the far side of the
 * road so nothing crosses in front of the rig; depth layers:
 *   foreground  guardrail / jersey barrier, lamps, signs, fence
 *   midground   distribution centre with docks + trailers, RTG block, offices
 *   background  hazed port skyline (STS cranes, silos, sheds, stacks, masts)
 * The handover zone (z ≈ 0, where the reach stacker works) is kept clear.
 */
function buildCorridor(cor: Node3) {
  const R = rng(19);
  const zClear0 = 2600, zClear1 = -2800; // reach-stacker working zone

  /* foreground */
  jerseyRun(cor, 'jersey-a', [X_RAIL, 0, zClear1], 7600, { striped: true });
  guardrail(cor, 'rail-a', [X_RAIL, 0, zClear1 - 7800], zClear1 - 7800 - Z_CUT - 200);
  for (let z = zClear1 - 400, i = 0; z > Z_CUT + 600; z -= LAMP_PITCH, i++) streetLamp(cor, `lamp-c${i}`, [X_LAMP, 0, z], 0, { arm: 330 });
  const kinds: SignKind[] = ['speed', 'km', 'port', 'km', 'yard', 'km'];
  for (let z = zClear1 - 2200, i = 0; z > Z_CUT + 1500; z -= 4300, i++) {
    roadSign(cor, `sign-c${i}`, [X_SIGN - (kinds[i % kinds.length] === 'km' ? -120 : 0), 0, z], kinds[i % kinds.length], { km: 3 + i });
  }
  for (let z = zClear1 - 200, i = 0; z > Z_CUT; z -= 6000, i++) fenceRun(cor, `fence-c${i}`, [X_FENCE, 0, z], 5900);

  /* midground */
  // Distribution centre with a dock run and parked trailers.
  {
    const L = 7600, zc = -3600 - L / 2, xf = -4300;
    warehouse(cor, 'dc-1', [xf, 0, zc], { len: L, H: 1050, depth: 3200, docks: 8, full: true, seed: R });
    // Trailers backed onto docks 2, 3, 5, 7 (nose toward the road).
    const docks = 8, office = Math.min(1400, L * 0.22), pitch = (L - office - 260 - 200) / docks;
    for (const [k, i] of [[1, 0], [2, 1], [4, 2], [6, 3]] as const) {
      const u = 260 + k * pitch + 150; // dock centre along the facade (u runs −Z)
      parkedTrailer(cor, `dc1-tr${i}`, [xf, 0, zc + L / 2 - u], BOX_TONES[(i * 3 + 1) % BOX_TONES.length], { reefer: i === 1 });
    }
  }
  // RTG container block.
  {
    const zc = -13600;
    const tiers = [4, 4, 3, 4, 2, 3];
    yardBlock(cor, 'blk-c1', [-4200, 0, zc], { rows: 6, bays: 3, tiers, seed: R, side: true, seg: 3 });
    rtg(cor, 'rtg-c1', [-4700, 0, zc], { span: 2150, H: 1850, trolleyZ: 300, hoist: 1300 });
    yardBlock(cor, 'blk-c2', [-4400, 0, zc - 2500], { rows: 5, bays: 3, tiers: [2, 3, 3, 1, 2], seed: R, side: true, seg: 3 });
  }
  // Cross-dock shed + port services office.
  warehouse(cor, 'xd-1', [-5200, 0, -19400], { len: 4200, H: 850, depth: 2200, docks: 5, full: true, seed: R, name2: 'NAVAIR CROSS-DOCK', tone: '#DADDE1' });
  parkedTrailer(cor, 'xd1-tr0', [-5200, 0, -18420], C.boxNavy);
  office(cor, 'office-c1', [-3900, 0, -22600], { len: 2200, H: 780, depth: 1400, label: 'NAVAIR PORT SERVICES' });

  /* background skyline (hazed), spread well past both ends for parallax */
  // [x, z, kind, haze, scale]: the skyline is drawn smaller than life so it stays a
  // low horizon band behind the midground instead of towering over the rig.
  const bg: [number, number, 'sts' | 'silo' | 'shed' | 'masts' | 'stack', number, number][] = [
    [-16000, 9000, 'shed', 0.74, 0.7],
    [-22000, -1500, 'sts', 0.8, 0.5],
    [-22000, -8600, 'sts', 0.8, 0.5],
    [-12500, -6000, 'masts', 0.72, 0.7],
    [-15000, -15000, 'silo', 0.72, 0.5],
    [-16000, -20500, 'shed', 0.74, 0.7],
    [-22000, -25000, 'sts', 0.8, 0.5],
    [-17000, -31000, 'shed', 0.74, 0.7],
    [-12500, -34000, 'masts', 0.72, 0.7],
    [-22000, -40000, 'sts', 0.8, 0.5],
  ];
  bg.forEach(([x, z, kind, hz, s], i) => {
    const n = skyline(cor, `sky-${i}`, [x, 0, z], kind, { haze: hz, seed: R, w: kind === 'stack' ? 7000 : undefined });
    n.s = s;
  });
}

/* ------------------------------------------------------------ plan props */

/**
 * 3D roadside props that live with the plan road (visible from the late road
 * chapter on): the last stretch before the junction, the junction itself, the
 * gate and the exit road. They take over from the corridor at Z_CUT so the two
 * never double up.
 */
function buildPlanProps(plan: Node3) {
  const props = plan.node('plan-props');
  // Far side: lamps + guardrail continue straight along the main road and the branch.
  let i = 0;
  const zEnd = TURN_Z - 16000;
  for (let z = Z_CUT - 1000; z > zEnd; z -= LAMP_PITCH) streetLamp(props, `lamp-f${i++}`, [X_LAMP, 0, z], 0, { arm: 330, pool: true });
  guardrail(props, 'rail-f', [X_RAIL, 0, Z_CUT - 200], Z_CUT - 200 - zEnd, { plan: true });
  // Near side of the main straight: lamps staggered half a pitch, guardrail to the corner.
  const xNear = NEAR_EDGE + VERGE + 90;
  for (let z = Z_CUT - 1000 - LAMP_PITCH / 2; z > TURN_Z + 1200; z -= LAMP_PITCH) streetLamp(props, `lamp-n${i++}`, [xNear, 0, z], 180, { arm: 330, pool: true });
  {
    // Rotated 180°: faces −X (the road) and runs +Z from the corner.
    const g = guardrail(props, 'rail-n', [NEAR_EDGE + VERGE - 40, 0, TURN_Z + 600], Z_CUT - 1400 - (TURN_Z + 600), { plan: true });
    g.r.y = 180;
  }
  // Inner corner of the turn: lamps on the island, arms reaching over the curve.
  for (const th of [28, 62]) {
    const r = TURN_R - HALF - VERGE - 90;
    const t = (th * Math.PI) / 180;
    streetLamp(props, `lamp-k${th}`, [TURN_CX - r * Math.cos(t), 0, TURN_CZ - r * Math.sin(t)], 180 - th, { arm: 330, pool: true });
  }
  // Exit road: landside lamps (arm −Z) up to the gate.
  for (let x = TURN_CX + 1800; x < PORT_X0 - 200; x += LAMP_PITCH) streetLamp(props, `lamp-e${i++}`, [x, 0, EXIT_Z + HALF + VERGE + 90], 90, { arm: 330, pool: true });
  // Branch right side, past the island nose.
  for (let z = TURN_Z - 7000; z > zEnd; z -= LAMP_PITCH) streetLamp(props, `lamp-b${i++}`, [xNear, 0, z], 180, { arm: 330, pool: true });

  // Sign gantry over the approach: left lane straight on, right lanes to the port.
  signGantry(props, 'gantry-1', [FAR_EDGE - 350, 0, TURN_Z + 3900], 2 * HALF + 700, [
    { x: 330, w: 520, top: 'YARD 05', sub: 'Customs · Empty depot', arrow: 'up' },
    { x: 900, w: 780, top: 'PORT TERMINAL 3', sub: 'Berths 1–6 · Gate 3', arrow: 'right' },
  ]);
  // Terminal gate where the road enters the apron.
  terminalGate(plan, PORT_X0 + 120);
}

/* ------------------------------------------------------------------ port */

function buildPort(quay: Node3) {
  const R = rng(77);
  // Landside yard blocks (rows along Z, bays along X) with RTGs.
  const rows = 6, pitchZ = BOX.W + 30, bayX = BOX.L + 40;
  const bw = rows * pitchZ;
  const zA = LAND.z0 + 1300 + bw / 2;
  const zB = zA + bw + 900;
  const blocks: { x0: number; x1: number; z0: number; z1: number }[] = [];
  const mk = (name: string, xFront: number, zc: number, bays: number, tiers: number[]) => {
    yardBlock(quay, name, [xFront, 0, zc], { rows, bays, tiers, seed: R, side: true, seg: 4 });
    blocks.push({ x0: xFront - bays * bayX, x1: xFront, z0: zc - bw / 2, z1: zc + bw / 2 });
  };
  mk('blk-p1', 18700, zA, 8, [3, 4, 4, 3, 4, 2]);
  mk('blk-p2', 30300, zA, 8, [2, 3, 3, 4, 3, 3]);
  mk('blk-p3', 18700, zB, 8, [4, 3, 2, 3, 4, 4]);
  mk('blk-p4', 30300, zB, 8, [3, 3, 4, 2, 1, 3]);
  rtg(quay, 'rtg-p1', [12600, 0, zA], { span: 2150, H: 1850, trolleyZ: -350, hoist: 1500 });
  rtg(quay, 'rtg-p2', [26000, 0, zB], { span: 2150, H: 1850, trolleyZ: 420, hoist: 1200 });
  // Landside pavement.
  quay.face({
    o: [LAND.x0, 0, LAND.z0],
    a: [1, 0, 0],
    b: [0, 0, 1],
    w: LAND.x1 - LAND.x0,
    h: LAND.z1 - LAND.z0,
    art: landsideArt(blocks, [
      { x0: blocks[0].x0 - 600, x1: blocks[1].x1 + 600, z: zA - 1075 },
      { x0: blocks[0].x0 - 600, x1: blocks[1].x1 + 600, z: zA + 1075 },
      { x0: blocks[2].x0 - 600, x1: blocks[3].x1 + 600, z: zB + 1075 },
    ]),
    double: true,
    layer: -9.6,
    shade: 0,
    name: 'landside',
  });
  // Security fence along the apron boundary (gap at the gate road).
  for (let x = LAND.x1, k = 0; x > PORT_X0 + 1500; x -= 3000, k++) {
    const fnode = fenceRun(quay, `fence-p${k}`, [x, 0, APRON_Z1 + 120], Math.min(2980, x - PORT_X0 - 1500));
    fnode.r.y = 90;
  }
  // High-mast floodlights on the landside strip of the apron and in the yard.
  highMast(quay, 'mast-p1', [6200, 0, APRON_Z1 - 380]);
  highMast(quay, 'mast-p2', [23800, 0, APRON_Z1 - 380]);
  highMast(quay, 'mast-p3', [41400, 0, APRON_Z1 - 380]);
  highMast(quay, 'mast-p4', [19250, 0, zA + bw / 2 + 450]);
}
