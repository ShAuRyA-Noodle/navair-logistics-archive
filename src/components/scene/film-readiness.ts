export type FilmReadiness = 'idle' | 'loading' | 'ready' | 'error';
let state: FilmReadiness = 'idle';
const listeners = new Set<() => void>();
export const filmReadiness = {
  get: () => state,
  server: (): FilmReadiness => 'idle',
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  set(next: FilmReadiness) { if (state === next) return; state = next; listeners.forEach(listener => listener()); },
};
