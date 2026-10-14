/**
 * Dot-matrix icons (our own). Each glyph is a small bitmap; '#' = dot.
 * Rendered as SVG circles so they stay crisp and can animate per dot.
 */

const GLYPHS: Record<string, string[]> = {
  pin: [
    '....###....',
    '..#######..',
    '.###...###.',
    '.##.....##.',
    '.##..#..##.',
    '.##.....##.',
    '..##...##..',
    '...##.##...',
    '....###....',
    '.....#.....',
    '...#####...',
  ],
  globe: [
    '...#####...',
    '.##..#..##.',
    '.#..###..#.',
    '#..#.#.#..#',
    '###########',
    '#..#.#.#..#',
    '###########',
    '#..#.#.#..#',
    '.#..###..#.',
    '.##..#..##.',
    '...#####...',
  ],
  headset: [
    '...#####...',
    '.##.....##.',
    '.#.......#.',
    '#.........#',
    '###.....###',
    '###.....###',
    '###.....###',
    '.##.....##.',
    '.........#.',
    '.......##..',
    '.....##....',
  ],
  box: [
    '###########',
    '#.#.#.#.#.#',
    '#.#.#.#.#.#',
    '#.#.#.#.#.#',
    '#.#.#.#.#.#',
    '###########',
    '...........',
    '..#######..',
    '..#.....#..',
    '..#######..',
    '...........',
  ],
};

export function dotIcon(name: keyof typeof GLYPHS | string, size = 88) {
  const rows = GLYPHS[name] ?? GLYPHS.box;
  const n = rows.length;
  const cell = 100 / n;
  let dots = '';
  let ghost = '';
  rows.forEach((row, y) =>
    row.split('').forEach((ch, x) => {
      const cx = (x + 0.5) * cell, cy = (y + 0.5) * cell;
      if (ch === '#') dots += `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(cell * 0.36).toFixed(2)}"/>`;
      else ghost += `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(cell * 0.1).toFixed(2)}"/>`;
    }),
  );
  return `<svg class="dot-icon" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true"><g class="dot-icon__ghost">${ghost}</g><g class="dot-icon__on">${dots}</g></svg>`;
}
