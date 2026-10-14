/**
 * NAVAIR world constants. 1 unit = 1 cm. Everything that more than one
 * machine or scene depends on lives here, so drawings line up exactly.
 */

export const C = {
  paper: '#F3F3EF',
  paper2: '#E9E9E3',
  ink: '#0D0E11',
  ink2: '#17181C',
  road: '#0E0F12',
  roadEdge: '#1B1D22',
  laneDash: '#2C2F36',
  concrete: '#D9D8D1',
  concrete2: '#CBCAC2',

  /** NAVAIR electric blue. */
  blue: '#0835B1', // site brand blue (was electric #1B2CFF in the standalone app)
  blueDeep: '#06267F',
  /** Signal orange. */
  signal: '#FF5A1F',
  hazard: '#F2B705',

  steel900: '#15171B',
  steel800: '#1F2227',
  steel700: '#2B2F36',
  steel600: '#3B4049',
  steel500: '#565C67',
  steel400: '#7A818D',
  steel300: '#A5ABB5',
  steel200: '#C8CDD4',
  steel100: '#E1E4E8',
  steel050: '#F0F2F4',

  rubber: '#16171A',
  rubber2: '#23252A',
  glass: '#2A3441',
  glassHi: '#5C6B7E',

  /** Container liveries. */
  boxWhite: '#E8E9E6',
  boxNavy: '#1D2A6B',
  boxOrange: '#E0521E',
  boxRed: '#C42A22',
  boxGreen: '#23803A',
  boxSky: '#2C74C4',
  boxPink: '#C9407B',
  boxMustard: '#C99A45',
  boxGrey: '#8E949C',

  ocean: '#0A2A66',
  oceanDeep: '#061C4A',
  foam: '#EAF3FF',
} as const;

/** ISO 668 40' high-cube. */
export const BOX = {
  L: 1219.2,
  W: 243.8,
  H: 289.6,
  /** 20' length for ship bays that mix sizes. */
  L20: 605.8,
} as const;

/**
 * Articulated rig: 4x2 cab-over tractor + 3-axle skeletal 40' trailer.
 *
 * TRACTOR space: origin = rear-axle centre on the ground, faces +X.
 * TRAILER space: origin = kingpin projected to the ground, trailer body runs −X.
 * The kingpin sits at tractor-space x = kingpinX, so the trailer origin in
 * world = tractor.toWorld([kingpinX, 0, 0]).
 */
export const RIG = {
  wheelR: 52,
  tyreW: 30,
  /** Tyre centre offset from centreline (outer duals on the rear). */
  trackZ: 95,
  /** Overall body width. */
  bodyW: 250,
  /** Tractor front axle x (tractor space). Rear axle is 0. */
  wheelbase: 380,
  /** Cab extents (tractor space). Cab-over: front bumper face at cabFront. */
  cabFront: 525,
  cabBack: 290,
  cabFloorY: 125,
  cabTop: 395,
  /** Chassis rear end (tractor space). */
  tractorRear: -110,
  /** Kingpin / fifth-wheel centre (tractor space) and fifth-wheel plate height. */
  kingpinX: 40,
  fifthY: 118,
  /** Trailer front (gooseneck nose) and rear, trailer space. */
  trailerFront: 80,
  trailerRear: -1285,
  /** Trailer axle x positions (trailer space). */
  trailerAxles: [-880, -1011, -1142] as readonly number[],
  /** Kingpin → middle-axle distance: the trailer's effective wheelbase for articulation. */
  trailerWB: 1011,
  /** Top of the trailer rails = container floor height. */
  deckY: 128,
  /** Container centre x on the trailer (trailer space). Doors face −X (rear). */
  boxX: -540,
} as const;

/** Road cross-section. */
export const ROAD = {
  /** Carriageway width. */
  W: 1400,
  /** Slab thickness shown as the black ground band in elevation. */
  slab: 300,
  laneDash: 300,
  laneGap: 420,
} as const;
