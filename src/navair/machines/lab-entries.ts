/**
 * Aggregates every machine's lab entries. Each machine module exports
 * `labEntries`; add one import line per module.
 */

import { REGISTRY as BASE } from './registry';
import { labEntries as reach } from './reachstacker';
import { labEntries as rig } from './rig';
import { labEntries as ship } from './ship';
import { labEntries as sts } from './stscrane';

export const REGISTRY = { ...BASE, ...reach, ...rig, ...ship, ...sts };
