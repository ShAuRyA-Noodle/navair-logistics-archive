export type LabelBox = { x: number; y: number; width: number; height: number };

/** Place labels in screen pixels so scaling the canvas never shrinks their text. */
export function placeMapLabel(x: number, y: number, width: number, viewportWidth: number, occupied: LabelBox[]): LabelBox | null {
  const height = 24;
  const clampX = (left: number) => Math.max(8, Math.min(viewportWidth - width - 8, left));
  const candidates = [
    { x: clampX(x + 7), y: y - height - 5 },
    { x: clampX(x - width - 7), y: y - height - 5 },
    { x: clampX(x + 7), y: y + 7 },
    { x: clampX(x - width - 7), y: y + 7 },
  ];
  for (const candidate of candidates) {
    const box = { ...candidate, width, height };
    if (!occupied.some(other => box.x < other.x + other.width + 5 && box.x + width + 5 > other.x && box.y < other.y + other.height + 5 && box.y + height + 5 > other.y)) return box;
  }
  return null;
}
