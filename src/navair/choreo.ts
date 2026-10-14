/**
 * The master timeline. Authored in seconds (≈ viewports of scroll).
 *
 * Every moving thing is a plain state object tweened by GSAP; the engine's
 * constraint pass turns state into node transforms each frame (vehicle poses,
 * route following + trailer articulation, the hero box's carrier, camera follow).
 */

import gsap from 'gsap';
import type { Engine, Node3 } from './engine/engine';
import { clamp, lerp, type V3 } from './engine/math';
import type { Ground } from './scene/ground';
import { CRANE_X, CRANE_Z, EXIT_Z, HALF, LANE_X, QUAY_EDGE_Z, ROUTE_LEN, S_TURN_IN, S_TURN_OUT, TURN_CX, TURN_CZ, routeAt, sAtZ } from './scene/route';
import type { ReachStacker } from './machines/reachstacker';
import type { Rig } from './machines/rig';
import { articulate } from './machines/rig';
import type { Ocean, Ship } from './machines/ship';
import type { StsCrane } from './machines/stscrane';
import { TRAIL_N } from './scene/oceanGL';
import { hullMotion } from './scene/water/waves';
import { waterGPU } from './scene/water/gpu';
import { BOX, RIG } from './world';
import { CHAPTERS, DURATION } from './story';

export interface Ctx {
  e: Engine;
  ground: Ground;
  reach: ReachStacker;
  rig: Rig;
  ship: Ship;
  ocean: Ocean;
  crane: StsCrane;
  hero: Node3;
  heroShadow: Node3;
  root: HTMLElement;
  q: (sel: string) => HTMLElement;
  qa: (sel: string) => HTMLElement[];
  mobile: boolean;
}

/** Berth camera yaw: land-east quadrant, so the crane boom runs diagonally. */
const BERTH_YAW = 75;

/** Named eases (Leon-style vocabulary, our tuning). */
const E = {
  heavy: 'power2.inOut',
  settle: 'power3.out',
  ram: 'power1.inOut',
  latch: 'power4.out',
  glide: 'sine.inOut',
  drive: 'power1.inOut',
  arrive: 'power3.out',
  depart: 'power2.in',
};

export function buildMaster(ctx: Ctx) {
  const { e, ground, reach, rig, ship, ocean, crane, hero, heroShadow, mobile } = ctx;
  const cam = e.cam;
  const M = mobile ? 0.62 : 1; // zoom multiplier on narrow screens

  /* ---------------------------------------------------------------- state */
  const shot = { x: -300, y: 430, z: 0 };
  const follow = { w: 0, ox: 0, oy: 0, oz: 0 };
  const slabK = { v: 1 };
  const truck = { s: 0, bounce: 0, nod: 0 };
  const carry = { mode: 'stack' as 'stack' | 'reach' | 'truck' | 'crane' | 'ship' };
  const sea = { dist: 0, speed: 0 };
  const chase = { w: 0 };
  const flags = { speedo: 0 };

  // Handover: truck rear-axle position such that boxSeat() centre is at z = 0.
  // Heading 90 → forward = −Z. kingpin z = zr − kingpinX; box z = kingpin z − boxX (boxX < 0 so behind).
  const zr = 0 + RIG.kingpinX + RIG.boxX; // box z = zr − kingpinX − boxX = 0
  const sHand = sAtZ(zr);

  // Articulation table along the whole route.
  const art = articulate((s) => routeAt(s), ROUTE_LEN + 4000, 20, 90);
  const trailerAt = (s: number) => {
    const i = clamp(s / (art.s[1] - art.s[0]), 0, art.s.length - 1.0001);
    const i0 = Math.floor(i), f = i - i0;
    return lerp(art.trailer[i0], art.trailer[Math.min(i0 + 1, art.trailer.length - 1)], f);
  };

  // Ship: moored parallel to the quay (bow → +X), hero slot directly seaward of the crane.
  const shipBase = { x: 0, z: 0 };
  {
    ship.root.r.y = 0;
    const q = ship.root.p;
    q[0] = 0;
    q[2] = QUAY_EDGE_Z - 170 - ship.BEAM / 2;
    const s0 = ship.slot();
    q[0] = CRANE_X - s0.p[0];
    shipBase.x = q[0];
    shipBase.z = q[2];
  }
  // Crane: trolley parked over the truck lane, spreader high.
  const laneLocal = EXIT_Z - CRANE_Z;
  Object.assign(crane.pose, { trolley: laneLocal, hoist: 2600, twist: 0 });

  // Initial poses.
  // The machine idles in frame at load, beside the stack; scrolling puts it to work.
  Object.assign(reach.pose, { x: -1650, z: 0, heading: 0, boom: 6, ext: 0, spread: 1, spreaderYaw: 0, twist: 0, dip: 0 });

  /* ------------------------------------------------------------ constraints */
  let steady: V3 | null = null;
  // Sea motion repaints the world canvas every frame, even with the scroll idle.
  // On integrated / mobile GPUs, or once the frame governor has had to lower the
  // world's resolution, the device can't afford that: the hull lies still (eased
  // to rest), so an idle frame costs only the water pass.
  const dpr0 = e.dpr;
  let motionK = waterGPU.weak ? 0 : 1;
  e.constrain(() => {
    reach.apply();
    crane.apply();

    const p = routeAt(truck.s);
    rig.pose.x = p.x;
    rig.pose.z = p.z;
    rig.pose.heading = p.heading;
    rig.pose.trailerHeading = trailerAt(truck.s);
    rig.pose.dist = truck.s;
    rig.pose.bounce = truck.bounce;
    rig.pose.nod = truck.nod;
    // Steering follows curvature: +/-  while inside the arc.
    const inTurn = truck.s > S_TURN_IN - 300 && truck.s < S_TURN_OUT + 300;
    rig.pose.steer = inTurn ? -14 * Math.sin(clamp((truck.s - (S_TURN_IN - 300)) / (S_TURN_OUT - S_TURN_IN + 600), 0, 1) * Math.PI) : 0;
    rig.apply();

    // Departure: the ship swings away from the quay onto a curved course.
    const sp = shipPath(sea.dist);
    ship.root.p[0] = shipBase.x + sp.x;
    ship.root.p[1] = 0;
    ship.root.p[2] = shipBase.z + sp.z;
    ship.root.r = { x: 0, y: sp.yaw, z: 0 };
    // The camera follows the box's STEADY pose (before sea motion), so the hull
    // visibly rides the swell instead of the whole world bobbing round it.
    steady = carry.mode === 'ship' ? ship.slot().p : null;
    // Seakeeping: heave / pitch / roll from the very wave function the water
    // shader draws (scene/water/waves.ts), on the same clock (real seconds), so
    // the hull and the water agree. Moored (speed 0) the ship lies still, which
    // also keeps the berth frames free of repaints. Plus heel in the turn.
    motionK = clamp(motionK + (waterGPU.weak || e.dpr < dpr0 - 0.01 ? -0.02 : 0.01), 0, 1);
    if (sea.speed > 0.001 && ocean.root.visible && motionK > 0) {
      const yr = (sp.yaw * Math.PI) / 180;
      const m = hullMotion([ship.root.p[0] / 100, ship.root.p[2] / 100], [Math.cos(yr), -Math.sin(yr)], ship.LOA / 100, ship.BEAM / 100, performance.now() / 1000, QUAY_EDGE_Z / 100);
      const k0 = clamp(sea.speed / 0.3, 0, 1);
      const k = k0 * k0 * (3 - 2 * k0) * motionK * motionK * (3 - 2 * motionK);
      const heel = 1.5 * sea.speed * sea.speed * yawRate(sea.dist);
      ship.root.p[1] = m.heave * 100 * k;
      ship.root.r.z = clamp(m.pitch * 0.9 + 0.15 * sea.speed, -2.5, 2.5) * k;
      ship.root.r.x = clamp(-m.roll * 1.5 + heel, -4, 4) * k;
    }

    // Hero box carrier.
    let pos: V3, yaw: number, lift = 0;
    // Full rotation when the carrier swings/tilts the load (reach stacker, crane).
    let rot: { x: number; y: number; z: number } | null = null;
    if (carry.mode === 'stack') {
      pos = [0, BOX.H, 0];
      yaw = -90;
    } else if (carry.mode === 'reach') {
      const s = reach.seat();
      pos = s.p;
      yaw = s.yaw;
      rot = s.r ?? null;
    } else if (carry.mode === 'truck') {
      const s = rig.boxSeat();
      pos = s.p;
      yaw = s.yaw;
    } else if (carry.mode === 'crane') {
      const s = crane.seat();
      pos = s.p;
      yaw = s.yaw;
      rot = s.r ?? null;
      lift = Math.max(0, s.p[1] - RIG.deckY);
    } else {
      const s = ship.slot();
      pos = s.p;
      yaw = s.yaw + 180; // doors aft, like every other box on deck
    }
    hero.p = pos;
    if (rot) Object.assign(hero.r, rot);
    else hero.r = { x: 0, y: yaw, z: 0 };
    // Ground shadow while the crane carries it over the apron: offset by height along the light.
    heroShadow.p = [pos[0] + lift * 0.3, 2, pos[2] + lift * 0.42];
    heroShadow.r.y = yaw;
    heroShadow.opacity = carry.mode === 'crane' && pos[2] > QUAY_EDGE_Z ? clamp(1 - lift / 3200, 0.2, 1) * 0.85 : 0;

    // Camera follow.
    let fx = shot.x, fy = shot.y, fz = shot.z;
    ground.slab.k = [1, slabK.v, 1];
    if (follow.w > 0) {
      // The camera follows the hero box itself, whoever carries it.
      const tp = steady ?? hero.p;
      fx = lerp(shot.x, tp[0] + follow.ox, follow.w);
      fy = lerp(shot.y, tp[1] + follow.oy, follow.w);
      fz = lerp(shot.z, tp[2] + follow.oz, follow.w);
    }
    cam.tx = fx;
    cam.ty = fy;
    cam.tz = fz;
    // Chase: sit behind the stern (camera yaw = ship yaw − 90).
    if (chase.w > 0) cam.yaw = lerp(BERTH_YAW, sp.yaw - 90, chase.w);
  });

  /* ----------------------------------------------------------------- timeline */
  const tl = gsap.timeline({ paused: true, defaults: { ease: E.heavy } });
  const T = Object.fromEntries(CHAPTERS.map((c) => [c.id, c.t])) as Record<string, number>;

  const camTo = (vars: Partial<typeof cam>, at: number, dur: number, ease = E.heavy) => {
    const v: Record<string, number | string> = { ...vars, duration: dur, ease };
    if (vars.zoom !== undefined) v.zoom = vars.zoom * M;
    return tl.to(cam, v, at);
  };
  const shotTo = (vars: Partial<typeof shot>, at: number, dur: number, ease = E.heavy) => tl.to(shot, { ...vars, duration: dur, ease }, at);
  const reachTo = (vars: Partial<ReachStacker['pose']>, at: number, dur: number, ease = E.ram) =>
    tl.to(reach.pose, { ...vars, duration: dur, ease }, at);
  const reachReach = (dx: number, y: number, at: number, dur: number, ease = E.ram) => {
    const s = reach.solve(dx, y);
    return reachTo({ boom: s.boom, ext: s.ext }, at, dur, ease);
  };
  const vis = (n: Node3, on: boolean, at: number) => tl.set(n, { visible: on }, at);
  /** Damped pendulum as scrubbable keyframes: each value is a half-swing extreme. */
  const swing = (target: object, key: string, at: number, extremes: number[], half: number) => {
    extremes.forEach((v, i) => tl.to(target, { [key]: v, duration: half, ease: 'sine.inOut' }, at + i * half));
  };
  const fade = (n: Node3, to: number, at: number, dur: number) => tl.to(n, { opacity: to, duration: dur, ease: 'none' }, at);

  // Camera initial: United Carriers' grammar. A long lens at the load's eye level,
  // nearly side-on, machine left of the load and the boom behind the box, so the
  // container is never occluded. The camera holds still while the machine works.
  Object.assign(cam, { yaw: 7, pitch: 3, roll: 0, zoom: 0.54 * M, ax: mobile ? 0.5 : 0.57, ay: 0.7 });
  Object.assign(shot, { x: -720, y: 470, z: 0 });

  /* ================================================== 1 · THE STACK (0 → 3.2) */
  // Initial visibility is applied directly: a set() at t = 0 never renders at progress 0.
  ground.corridor.visible = false;
  rig.root.visible = false;
  ship.root.visible = false;
  ocean.root.visible = false;
  ground.quay.visible = false;
  ground.plan.visible = false;
  crane.root.visible = false;

  // Approach: drive up to the stack; boom rises and the spreader telescopes 20' → 40'.
  reach.pose.spread = 0.25;
  reachTo({ x: -450 }, 0.3, 2.3, E.heavy);
  tl.to(reach.pose, { dip: -0.9, duration: 0.22, ease: 'power2.out', yoyo: true, repeat: 1 }, 2.55); // brake nod
  reachTo({ spread: 1 }, 1.1, 1.2, E.ram);
  reachReach(450, BOX.H * 2 + 300, 0.9, 2.1, E.ram);
  // Locked shot: the camera does not move while the machine works.

  /* ================================================== 2 · FIRST LIFT (3.2 → 7.4) */
  const L0 = T.lift;
  // Spreader descends, settles, twistlocks turn, the machine takes the weight — camera still.
  reachReach(450, BOX.H * 2 + 45, L0 + 0.05, 0.6, 'power2.inOut');
  reachReach(450, BOX.H * 2, L0 + 0.65, 0.3, 'power3.out');
  reachTo({ twist: 1 }, L0 + 1.0, 0.4, E.latch);
  tl.set(carry, { mode: 'reach' }, L0 + 1.4);
  // Hoist: the weight comes on as the box breaks free (body pitch compensated in solve()).
  tl.to(reach.pose, { load: 1, duration: 0.6, ease: 'power2.inOut' }, L0 + 1.5);
  {
    const s1 = reach.solve(450, BOX.H * 2 + 560, 1);
    reachTo({ boom: s1.boom, ext: s1.ext }, L0 + 1.5, 2.1, 'power2.inOut');
  }
  // The one big move — hold, snap, settle: the camera orbits AROUND THE LOAD with a
  // sharp push-in as the hoist gets going, then eases to broadside.
  tl.to(follow, { w: 1, ox: 0, oy: 60, oz: 0, duration: 0.9, ease: 'power3.out' }, L0 + 2.4);
  camTo({ zoom: 1.02, ay: 0.46, ax: 0.5, pitch: 2 }, L0 + 2.4, 1.1, 'expo.out');
  camTo({ yaw: 90 }, L0 + 2.4, 2.9, 'power2.inOut');
  // Reverse away with the box held high (along the view axis once broadside).
  reachTo({ x: -1400 }, L0 + 3.0, 2.2, E.heavy);
  // The hanging load lags the machine: swings back as it pulls away, forward as it brakes.
  swing(reach.pose, 'swayX', L0 + 3.0, [-2.2, 1.1, -0.5, 0.2, 0], 0.4);
  swing(reach.pose, 'swayX', L0 + 5.0, [1.6, -0.8, 0.35, 0], 0.4);

  /* ================================================== 3 · HANDOVER (7.4 → 12) */
  const H0 = T.handover;
  // While the box fills the frame the stack is below the bottom edge: it leaves in a
  // clean cut, never a ghosted fade.
  // Scenery changes ride the camera move: the yard dissolves and the road world
  // resolves in while the orbit sweeps, so no frame ever pops.
  fade(ground.stack, 0, L0 + 2.95, 0.55);
  fade(ground.yardDecor, 0, L0 + 2.95, 0.55);
  tl.set(ground.stack, { visible: false }, L0 + 3.55);
  tl.set(ground.yardDecor, { visible: false }, L0 + 3.55);
  vis(ground.corridor, true, L0 + 3.0);
  tl.fromTo(ground.corridor, { opacity: 0 }, { opacity: 1, duration: 0.6, ease: 'power1.inOut', immediateRender: false }, L0 + 3.0);
  // Locked front elevation; pull back to reveal the truck rolling in beneath the load.
  shotTo({ x: -950, y: 560, z: -250 }, L0 + 3.5, 0.01, 'none'); // while locked on the box (follow w = 1)
  tl.to(follow, { w: 0, duration: 1.9, ease: E.heavy }, H0 + 0.6);
  camTo({ zoom: 0.5, ay: 0.66, ax: mobile ? 0.5 : 0.6 }, H0 + 0.6, 1.9, E.heavy);
  vis(rig.root, true, H0 + 0.5);
  tl.fromTo(truck, { s: sHand - 9000 }, { s: sHand, duration: 1.9, ease: E.arrive }, H0 + 0.5);
  tl.to(truck, { nod: 1.6, duration: 0.25, ease: 'power2.out' }, H0 + 2.25);
  tl.to(truck, { nod: 0, duration: 0.7, ease: 'elastic.out(1,0.45)' }, H0 + 2.5);
  // Lower onto the trailer (solve() targets the spreader underside).
  {
    const a = reach.solve(450, RIG.deckY + BOX.H + 60, 1), b = reach.solve(450, RIG.deckY + BOX.H, 1);
    reachTo({ boom: a.boom, ext: a.ext }, H0 + 2.55, 0.8, 'power2.inOut');
    reachTo({ boom: b.boom, ext: b.ext }, H0 + 3.35, 0.25, 'power3.out');
  }
  tl.set(carry, { mode: 'truck' }, H0 + 3.55);
  tl.to(truck, { bounce: 7, duration: 0.18, ease: 'power2.in' }, H0 + 3.5);
  tl.to(truck, { bounce: 2.5, duration: 0.8, ease: 'elastic.out(1,0.4)' }, H0 + 3.68);
  reachTo({ twist: 0 }, H0 + 3.7, 0.3, E.latch);
  tl.to(reach.pose, { load: 0, duration: 0.4, ease: 'power2.out' }, H0 + 3.55);
  reachReach(450, RIG.deckY + BOX.H + 320, H0 + 4.0, 0.7, E.ram);

  /* ================================================== 4 · ON THE ROAD (12 → 18.2) */
  const R0 = T.road;
  reachTo({ x: -4600 }, R0 - 0.3, 1.9, E.heavy);
  tl.set(flags, { speedo: 1 }, R0);
  // Camera locks on the box and the scene rises: the ground band becomes the dark services panel.
  tl.to(follow, { w: 1, oz: -300, oy: 120, duration: 1.2, ease: E.heavy }, R0 - 0.2);
  camTo({ zoom: mobile ? 0.36 : 0.34, ay: mobile ? 0.34 : 0.4 }, R0, 1.4, E.heavy);
  tl.to(slabK, { v: 26, duration: 1.4, ease: E.heavy }, R0);
  // One continuous drive from the yard to the junction (slows for the turn).
  tl.to(truck, { s: S_TURN_IN - 600, duration: T.route + 2.4 - (R0 + 0.1), ease: 'sine.inOut' }, R0 + 0.1);
  tl.to(truck, { bounce: 0, duration: 0.5 }, R0 + 0.1);

  /* ================================================== 5 · THE ROUTE (18.2 → 25.6) */
  const P0 = T.route;
  // Side → plan, United Carriers style: first close in until the rig fills the frame
  // (band folds back to a thin kerb), then a pitch-only orbit straight up over it.
  tl.to(slabK, { v: 1, duration: 1.1, ease: E.heavy }, P0 - 1.9);
  camTo({ zoom: 0.5, ay: 0.52, ax: 0.5 }, P0 - 1.9, 1.2, E.heavy);
  tl.to(follow, { oz: 0, oy: 80, duration: 1.2, ease: E.heavy }, P0 - 1.9);
  camTo({ pitch: 90 }, P0 - 0.8, 1.8, 'power2.inOut');
  tl.to(follow, { oy: 0, oz: -500, duration: 1.8, ease: E.heavy }, P0 - 0.8);
  camTo({ zoom: 0.3 }, P0 + 0.6, 1.2, E.heavy);
  fade(ground.corridor, 0, P0 - 0.9, 1.1);
  tl.set(flags, { speedo: 1 }, P0);
  // Camera action 1: drift + slight roll while cruising.
  camTo({ roll: -5 }, P0 + 0.2, 1.4, E.glide);
  // Camera action 2: pull out to reveal the junction, stop following.
  camTo({ zoom: 0.17, roll: 0 }, P0 + 1.5, 1.6, E.heavy);
  tl.to(follow, { w: 0, duration: 1.4, ease: E.heavy }, P0 + 1.6);
  shotTo({ x: TURN_CX - 900, y: 0, z: TURN_CZ - 1400 }, P0 - 2, 0.01, 'none');
  // Camera action 3: the turn — articulation reads cleanly from a fixed camera.
  tl.to(truck, { s: S_TURN_OUT + 400, duration: 2.0, ease: 'power1.inOut' }, P0 + 2.4);
  camTo({ zoom: 0.21 }, P0 + 2.6, 1.8, E.heavy);
  // Camera action 4: re-acquire and ride the vertical road with the truck high in frame.
  tl.to(follow, { w: 1, ox: 900, oz: 1500, duration: 1.4, ease: E.heavy }, P0 + 4.3);
  camTo({ zoom: 0.19, ay: 0.36 }, P0 + 4.3, 1.4, E.heavy);
  tl.to(truck, { s: S_TURN_OUT + 6000, duration: 2.8, ease: 'none' }, P0 + 4.4);

  /* ================================================== 6 · THE BERTH (25.6 → 32.2) */
  const B0 = T.berth;
  const hoistTruck = RIG.deckY + BOX.H; // spreader underside on the truck box roof
  const slotY = ship.slot().p[1] + BOX.H; // spreader underside with the box seated in its slot
  const slotLocal = ship.slot().p[2] - CRANE_Z;
  tl.to(truck, { s: ROUTE_LEN, duration: 1.9, ease: E.arrive }, B0 - 0.4);
  tl.set(flags, { speedo: 0 }, B0 + 1.3);
  tl.to(truck, { nod: 1.2, duration: 0.25, ease: 'power2.out' }, B0 + 1.45);
  tl.to(truck, { nod: 0, duration: 0.7, ease: 'elastic.out(1,0.45)' }, B0 + 1.7);
  // The camera swoops from plan down into a 3/4 aerial from the land side.
  // The camera swoops down to a low, long-lens angle beside the quay and locks onto
  // the box: from here the container is the subject, never hidden by the crane.
  tl.to(follow, { w: 1, ox: 0, oy: 150, oz: 0, duration: 2.2, ease: E.heavy }, B0 - 0.2);
  camTo({ yaw: 115, pitch: 16, zoom: 0.34, ax: mobile ? 0.5 : 0.6, ay: 0.52 }, B0 - 0.2, 2.4, E.heavy);
  // Crane: spreader down onto the box, lock, hoist, trolley out, lower into the slot.
  tl.to(crane.pose, { hoist: hoistTruck + 50, duration: 0.8, ease: 'power2.inOut' }, B0 + 1.7);
  tl.to(crane.pose, { hoist: hoistTruck, duration: 0.25, ease: 'power3.out' }, B0 + 2.5);
  tl.to(crane.pose, { twist: 1, duration: 0.3, ease: E.latch }, B0 + 2.75);
  tl.set(carry, { mode: 'crane' }, B0 + 3.05);
  tl.to(truck, { bounce: -3, duration: 0.25, ease: 'power2.out' }, B0 + 3.1);
  tl.to(truck, { bounce: 0, duration: 0.6, ease: 'elastic.out(1,0.4)' }, B0 + 3.35);
  tl.to(crane.pose, { hoist: slotY + 900, duration: 1.0, ease: 'power2.inOut' }, B0 + 3.1);
  tl.to(crane.pose, { trolley: slotLocal, duration: 1.3, ease: 'power2.inOut' }, B0 + 3.7);
  swing(crane.pose, 'sway', B0 + 3.7, [2.4, -0.6], 0.55);
  swing(crane.pose, 'sway', B0 + 4.85, [-1.8, 0.8, 0], 0.3);
  // Glide with the load as the trolley runs out over the ship.
  // Drift round as the trolley runs out, so the box travels across the frame over the ship.
  camTo({ yaw: BERTH_YAW, pitch: 20, zoom: 0.3 }, B0 + 3.0, 3.0, E.glide);
  tl.to(crane.pose, { hoist: slotY + 40, duration: 0.7, ease: 'power2.inOut' }, B0 + 4.95);
  tl.to(crane.pose, { hoist: slotY, duration: 0.25, ease: 'power3.out' }, B0 + 5.6);
  tl.set(carry, { mode: 'ship' }, B0 + 5.85);
  tl.to(crane.pose, { twist: 0, duration: 0.3, ease: E.latch }, B0 + 5.9);
  tl.to(crane.pose, { hoist: slotY + 1100, duration: 0.8, ease: 'power2.inOut' }, B0 + 6.2);

  /* ================================================== 7 · OPEN WATER (32.2 → 39.5) */
  const S0 = T.sea;
  tl.to(sea, { speed: 1, duration: 2.6, ease: 'power1.in' }, S0 - 0.3);
  tl.to(sea, { dist: 110000, duration: 7.2, ease: 'power2.in' }, S0 - 0.3);
  // Chase: swing behind the stern and follow the box out to sea.
  tl.to(follow, { w: 1, ox: 2600, oy: 0, oz: 0, duration: 1.6, ease: E.heavy }, S0 - 0.3);
  tl.fromTo(chase, { w: 0 }, { w: 1, duration: 2.6, ease: E.heavy }, S0);
  camTo({ pitch: 30, zoom: 0.085, ax: mobile ? 0.5 : 0.74, ay: 0.4 }, S0, 3.0, E.heavy);
  camTo({ zoom: 0.055, pitch: 24 }, S0 + 3.0, 3.8, E.heavy);
  tl.to(follow, { ox: 5200, duration: 4, ease: E.heavy }, S0 + 2.6);
  tl.set(rig.root, { visible: false }, S0 + 3.0);

  /* ---------------------------------------------------- scene scoping (perf) */
  // Each scene only exists while it can be seen. set() reverts on scroll-back.
  const scope = (n: Node3, on: number, off?: number) => {
    tl.set(n, { visible: true }, on);
    if (off !== undefined) tl.set(n, { visible: false }, off);
  };
  // The whole port exists from the moment the plan world does, so nothing appears
  // in view; off-screen parts cost nothing (viewport culling).
  const portOn = T.road + 4.5;
  scope(ground.plan, portOn);
  scope(ground.quay, portOn);
  scope(ship.root, portOn);
  scope(ocean.root, portOn);
  scope(crane.root, portOn);
  // The flowing wave texture is the ocean's paint cost; at the berth the water is a
  // corner of the frame, so it only joins once the ship is under way.
  const flow = ocean.root.find('ocean-flow');
  if (flow) {
    flow.visible = false;
    tl.set(flow, { visible: true }, T.sea - 0.4);
    tl.fromTo(flow, { opacity: 0 }, { opacity: 1, duration: 0.8, ease: 'none' }, T.sea - 0.4);
  }
  tl.set(reach.root, { visible: false }, T.road + 1.7);
  tl.set(ground.corridor, { visible: false }, T.route + 0.3);
  tl.set(ground.slab, { visible: false }, T.route + 1.4);
  tl.set(ground.yardSlab, { visible: false }, T.handover + 2.0);

  /* ------------------------------------------------------------- DOM layer */
  buildDom(tl, ctx, T);

  // Stern trail for the WebGL wake: exact along the deterministic course, so
  // scrolling back rewinds the wake too.
  const SEG = 1500;
  const shipAt = (d: number) => {
    const sp = shipPath(Math.max(0, d));
    const yaw = (sp.yaw * Math.PI) / 180;
    const dir: [number, number] = [Math.cos(yaw), -Math.sin(yaw)];
    const c: [number, number] = [shipBase.x + sp.x, shipBase.z + sp.z];
    return { c, dir };
  };
  const oceanState = (time: number) => {
    const now = shipAt(sea.dist);
    const trail: [number, number][] = [];
    for (let i = 0; i < TRAIL_N; i++) {
      const s = shipAt(sea.dist - i * SEG);
      trail.push([s.c[0] - s.dir[0] * (ship.LOA / 2), s.c[1] - s.dir[1] * (ship.LOA / 2)]);
    }
    return { ship: now.c, dir: now.dir, speed: sea.speed, trail, time, dist: sea.dist };
  };

  return {
    oceanState,
    tl,
    state: { truck, carry, sea, flags, follow, shot },
    groundAnchor: (): V3 => {
      const b = rig.boxSeat().p;
      return [LANE_X + HALF, 0, b[2]];
    },
  };
}

/** Ship departure course: distance sailed → offset from the berth and yaw. */
// The course bears away from the quay (toward −Z = positive yaw).
function yawAt(s: number) {
  const t = clamp((s - 3000) / 36000, 0, 1);
  return 38 * t * t * (3 - 2 * t);
}
/** Turn rate along the course, normalised to 1 at its peak. */
function yawRate(s: number) {
  const t = clamp((s - 3000) / 36000, 0, 1);
  return 4 * t * (1 - t);
}

function shipPath(d: number) {
  const steps = Math.max(1, Math.ceil(d / 600));
  const h = d / steps;
  let x = 0, z = 0, yaw = 0;
  for (let i = 0; i < steps; i++) {
    const a = (yawAt(h * (i + 0.5)) * Math.PI) / 180;
    x += Math.cos(a) * h;
    z -= Math.sin(a) * h;
  }
  yaw = yawAt(d);
  return { x, z, yaw };
}

/* ---------------------------------------------------------------------- DOM */

function frameIn(tl: gsap.core.Timeline, el: HTMLElement, at: number, dur = 0.9) {
  const lines = Array.from(el.querySelectorAll<HTMLElement>('.ln-i'));
  const blocks = Array.from(el.querySelectorAll<HTMLElement>('[data-el]'));
  // Staggered fromTo only pre-renders the first target: set every start state explicitly.
  if (lines.length) gsap.set(lines, { yPercent: 140, backgroundPositionX: '100%' });
  if (blocks.length) gsap.set(blocks, { autoAlpha: 0, y: 28 });
  tl.set(el, { autoAlpha: 1 }, at);
  if (lines.length) tl.fromTo(lines, { yPercent: 140, backgroundPositionX: '100%' }, { yPercent: 0, backgroundPositionX: '0%', duration: dur, stagger: dur * 0.14, ease: 'power3.out' }, at);
  if (blocks.length) tl.fromTo(blocks, { autoAlpha: 0, y: 28 }, { autoAlpha: 1, y: 0, duration: dur * 0.8, stagger: dur * 0.1, ease: 'power3.out' }, at + dur * 0.25);
}

function frameOut(tl: gsap.core.Timeline, el: HTMLElement, at: number, dur = 0.6) {
  const lines = Array.from(el.querySelectorAll<HTMLElement>('.ln-i'));
  const blocks = Array.from(el.querySelectorAll<HTMLElement>('[data-el]'));
  if (lines.length) tl.to(lines, { yPercent: -140, duration: dur, stagger: dur * 0.08, ease: 'power2.in' }, at);
  if (blocks.length) tl.to(blocks, { autoAlpha: 0, y: -22, duration: dur * 0.8, stagger: dur * 0.06, ease: 'power2.in' }, at);
  tl.set(el, { autoAlpha: 0 }, at + dur + 0.1);
}

function buildDom(tl: gsap.core.Timeline, ctx: Ctx, T: Record<string, number>) {
  const { q, qa, root } = ctx;
  const fr = (id: string) => q(`[data-fr="${id}"]`);

  // Hero is visible at load (the intro animates it in); it leaves on scroll.
  frameOut(tl, fr('hero'), 1.9, 0.8);

  frameIn(tl, fr('lift'), T.lift + 0.3);
  // Count-up stats, scrubbed.
  for (const dd of qa('.fr--lift [data-count]')) {
    const to = Number(dd.dataset.count);
    const dec = Number(dd.dataset.dec ?? 0);
    const suf = dd.dataset.suffix ?? '';
    const o = { v: 0 };
    tl.to(
      o,
      {
        v: to,
        duration: 1.05,
        ease: 'power2.out',
        onUpdate: () => {
          const s = o.v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suf;
          if (dd.textContent !== s) dd.textContent = s;
        },
      },
      T.lift + 0.8,
    );
  }
  frameOut(tl, fr('lift'), T.lift + 2.0, 0.5);

  frameIn(tl, fr('handover'), T.handover + 1.0);
  frameOut(tl, fr('handover'), T.road - 0.3);

  // Services panel: head + horizontal card pan.
  const panel = q('[data-el="panel"]');
  const cards = q('[data-el="cards"]');
  tl.set(panel, { autoAlpha: 1 }, T.road + 0.3);
  frameIn(tl, q('[data-el="panel-head"]'), T.road + 1.25, 0.9);
  tl.fromTo(cards, { x: () => window.innerWidth * 0.55 }, { x: () => -(cards.scrollWidth - window.innerWidth * 0.62), duration: 4.6, ease: 'none' }, T.road + 0.9);
  tl.fromTo(qa('.card'), { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, stagger: 0.35, duration: 0.6, ease: 'power3.out' }, T.road + 1.0);
  // Cards flip away backwards as the camera rises (UC's rotationX exit, ours on a hinge).
  tl.to(qa('.card'), { rotationX: -85, y: 120, autoAlpha: 0, transformOrigin: '50% 100%', stagger: 0.04, duration: 0.7, ease: 'power2.in' }, T.route - 2.2);
  tl.to(q('[data-el="panel-head"]'), { autoAlpha: 0, y: -30, duration: 0.5, ease: 'power2.in' }, T.route - 2.2);
  tl.set(panel, { autoAlpha: 0 }, T.route - 1.4);

  // Giant word crossing behind the truck.
  const word = q('[data-el="services-word"]');
  tl.set(word, { autoAlpha: 1 }, T.road + 0.4);
  tl.fromTo(word, { x: () => window.innerWidth }, { x: () => -word.scrollWidth, duration: 5.8, ease: 'none' }, T.road + 0.4);
  tl.set(word, { autoAlpha: 0 }, T.route - 1.8);

  frameIn(tl, fr('route'), T.route + 2.1);
  frameIn(tl, fr('features'), T.route + 1.3, 1.2);
  frameOut(tl, fr('route'), T.berth - 1.7);
  frameOut(tl, fr('features'), T.berth - 1.8);

  // Theme flips to light-on-dark once the ocean fills the frame.
  tl.call(() => root.classList.remove('is-dark'), undefined, T.sea - 0.61);
  tl.call(() => root.classList.add('is-dark'), undefined, T.sea - 0.59);

  frameIn(tl, fr('berth'), T.berth + 1.2);
  frameOut(tl, fr('berth'), T.sea - 0.6);
  frameIn(tl, fr('sea'), T.sea + 3.6, 1.1);

  // Keep the timeline exactly as long as the story.
  tl.set({}, {}, DURATION);
}
