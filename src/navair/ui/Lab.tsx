'use client';

/**
 * /lab — turntable inspector for every machine.
 *
 * URL params (for scripted screenshots):
 *   ?m=<key>&yaw=<deg>&pitch=<deg>&zoom=<mul>&grid=0&c_<control>=<value>&t=<seconds>
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Engine, Node3 } from '../engine/engine';
import { REGISTRY } from '../machines/lab-entries';
import { C } from '../world';

function groundGrid(): Node3 {
  const n = new Node3('lab-ground');
  const S = 4000;
  let d = '';
  for (let i = -S; i <= S; i += 100) d += `M${i + S} 0V${2 * S}M0 ${i + S}H${2 * S}`;
  let d5 = '';
  for (let i = -S; i <= S; i += 500) d5 += `M${i + S} 0V${2 * S}M0 ${i + S}H${2 * S}`;
  n.face({
    o: [-S, 0, -S],
    a: [1, 0, 0],
    b: [0, 0, 1],
    w: 2 * S,
    h: 2 * S,
    art:
      `<rect width="${2 * S}" height="${2 * S}" fill="${C.paper2}"/>` +
      `<path d="${d}" stroke="rgba(0,0,0,.06)" stroke-width="1.5" fill="none"/>` +
      `<path d="${d5}" stroke="rgba(0,0,0,.14)" stroke-width="2.5" fill="none"/>` +
      `<path d="M${S - 60} ${S}H${S + 60}M${S} ${S - 60}V${S + 60}" stroke="${C.signal}" stroke-width="4"/>`,
    double: true,
    layer: -10,
    shade: 0,
  });
  return n;
}

function LabInner() {
  const svgRef = useRef<SVGSVGElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const poseRef = useRef<((v: Record<string, number>) => void) | undefined>(undefined);
  const tickRef = useRef<((t: number) => void) | undefined>(undefined);

  const params = useMemo(() => new URLSearchParams(window.location.search), []);

  const keys = Object.keys(REGISTRY);
  const [key, setKey] = useState(() => params.get('m') ?? keys[0]);
  const [yaw, setYaw] = useState(() => Number(params.get('yaw') ?? 28));
  const [pitch, setPitch] = useState(() => Number(params.get('pitch') ?? 22));
  const [zoomMul, setZoomMul] = useState(() => Number(params.get('zoom') ?? 1));
  const [grid, setGrid] = useState(() => params.get('grid') !== '0');
  const entry = REGISTRY[key];
  const [vals, setVals] = useState<Record<string, number>>({});

  // Build scene when machine changes.
  useEffect(() => {
    const svg = svgRef.current!;
    svg.innerHTML = '';
    const e = new Engine(svg);
    const built = entry.build();
    if (grid) e.root.add(groundGrid());
    e.root.add(built.root);
    poseRef.current = built.pose;
    tickRef.current = built.tick;
    e.mount();
    const init: Record<string, number> = {};
    for (const c of entry.controls ?? []) {
      const q = params.get(`c_${c.key}`);
      init[c.key] = q !== null ? Number(q) : c.value;
    }
    setVals(init);
    built.pose?.(init);
    Object.assign(e.cam, built.frame, { ax: 0.5, ay: 0.55 });
    (e as Engine & { baseZoom: number }).baseZoom = built.frame.zoom;
    engineRef.current = e;
    const onResize = () => {
      const W = svg.clientWidth, H = svg.clientHeight;
      e.resize(W, H, H / 1080);
    };
    onResize();
    window.addEventListener('resize', onResize);
    let raf = 0;
    const t0 = performance.now();
    const fixedT = params.get('t');
    const loop = () => {
      const t = fixedT !== null ? Number(fixedT) : (performance.now() - t0) / 1000;
      tickRef.current?.(t);
      e.render();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    (window as unknown as { __lab: Engine }).__lab = e;
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, grid]);

  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.cam.yaw = yaw;
    e.cam.pitch = pitch;
    e.cam.zoom = (e as Engine & { baseZoom: number }).baseZoom * zoomMul;
  }, [yaw, pitch, zoomMul, key]);

  useEffect(() => {
    poseRef.current?.(vals);
  }, [vals]);

  const slider = (label: string, v: number, set: (n: number) => void, min: number, max: number, step = 1) => (
    <label className="lab__row" key={label}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(ev) => set(Number(ev.target.value))} />
      <output>{v.toFixed(step < 1 ? 2 : 0)}</output>
    </label>
  );

  return (
    <div className="lab">
      <svg ref={svgRef} className="lab__svg" />
      <div className="lab__panel">
        <select value={key} onChange={(ev) => setKey(ev.target.value)}>
          {keys.map((k) => (
            <option key={k} value={k}>
              {REGISTRY[k].title}
            </option>
          ))}
        </select>
        {slider('yaw', yaw, setYaw, -180, 180)}
        {slider('pitch', pitch, setPitch, -10, 90)}
        {slider('zoom', zoomMul, setZoomMul, 0.2, 4, 0.05)}
        <label className="lab__row">
          <span>grid</span>
          <input type="checkbox" checked={grid} onChange={(ev) => setGrid(ev.target.checked)} />
        </label>
        {(entry.controls ?? []).map((c) =>
          slider(c.key, vals[c.key] ?? c.value, (n) => setVals((p) => ({ ...p, [c.key]: n })), c.min, c.max, c.step ?? 1),
        )}
      </div>
    </div>
  );
}

/** Client-only: the lab reads URL params and builds DOM imperatively. */
export default function Lab() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready ? <LabInner /> : <div className="lab" />;
}
