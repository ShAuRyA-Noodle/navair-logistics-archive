/** Reversible stages shared by the WebGL geometry and the page composition. */
export function transitionAt(progress: number) {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  const ease = (start: number, end: number) => {
    const t = Math.max(0, Math.min(1, (p - start) / (end - start)));
    return t * t * t * (t * (t * 6 - 15) + 10);
  };
  return { centre: ease(0, 0.28), flatten: ease(0.3, 0.68), dock: ease(0.7, 0.96), copy: ease(0.78, 0.98) };
}

/** Equirectangular projection shared by land, markers and route endpoints. */
export function flatLocation(latitude: number, longitude: number): [number, number, number] {
  return [longitude / 180 * 1.35, latitude / 180 * 1.35, 0.04];
}

/** Keep southern cities intact; feather the Antarctic fringe in the flat view. */
export function flatLandOpacity(latitude: number) {
  const t = Math.max(0, Math.min(1, (latitude + 66) / 8));
  return t * t * (3 - 2 * t);
}
