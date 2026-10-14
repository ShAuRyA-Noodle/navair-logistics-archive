/**
 * Lab registry: every machine registers a builder so /lab can inspect it at
 * any yaw / pitch / pose. Keep builders pure and deterministic.
 */

import type { Node3 } from '../engine/engine';
import { LIVERY, container } from './container';
import { createGround } from '../scene/ground';

export interface LabControl {
  key: string;
  min: number;
  max: number;
  step?: number;
  value: number;
}

export interface LabEntry {
  title: string;
  build: () => {
    root: Node3;
    /** Apply control values to the rig. */
    pose?: (v: Record<string, number>) => void;
    /** Camera target (world cm) and zoom that frames the machine. */
    frame: { tx: number; ty: number; tz: number; zoom: number };
    /** Optional per-frame ambient animation (seconds). */
    tick?: (t: number) => void;
  };
  controls?: LabControl[];
}

export const REGISTRY: Record<string, LabEntry> = {
  container: {
    title: "40' HC container — hero livery",
    build: () => ({ root: container('box', LIVERY.hero), frame: { tx: 0, ty: 145, tz: 0, zoom: 1.1 } }),
  },
  ground: {
    title: 'World — ground, yard, road network',
    build: () => ({ root: createGround().root, frame: { tx: 200, ty: 300, tz: 0, zoom: 0.35 } }),
  },
  containerNavy: {
    title: "40' HC container — navy",
    build: () => ({ root: container('box', LIVERY.navy), frame: { tx: 0, ty: 145, tz: 0, zoom: 1.1 } }),
  },
};
