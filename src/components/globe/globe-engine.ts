import * as THREE from 'three';
import { LAND_COORDINATES, COAST_COORDINATES } from './globe-land';
import { flatLandOpacity, flatLocation, transitionAt } from './globe-transition';
import { placeMapLabel, type LabelBox } from './map-label-layout';

import { COUNTRIES, COUNTRY_BY_CODE } from './countries';
import { countryPosition, selectedRouteGeometry } from './selected-route';

export const GLOBE_RENDER_ORDER = { shell: -1, land: 0 } as const;

export type GlobeOptions = {
  onReady?: () => void;
  onError?: () => void;
  reducedMotion?: boolean;
};

export type GlobeController = {
  destroy(): void;
  setScroll(progress: number): void;
  setRoute(originCode: string, destinationCode: string): void;
  setPaused(paused: boolean): void;
  setReducedMotion(value: boolean): void;
};

function location(latitude: number, longitude: number, radius = 1) {
  const lat = THREE.MathUtils.degToRad(latitude);
  const lon = THREE.MathUtils.degToRad(longitude);
  return new THREE.Vector3(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)).multiplyScalar(radius);
}

const surfaceVertex = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** An original, locally rendered globe. Routes are illustrative, not service claims. */
export function createGlobe(host: HTMLElement, options: GlobeOptions = {}): GlobeController {
  let destroyed = false;
  let paused = false;
  let visible = true;
  let contextLost = false;
  let frame = 0;
  let readinessFrame = 0;
  let lastTime = 0;
  let autoYaw = 0;
  let autoResumeDelay = 0;
  let autoSpeed = 0.095;
  let dragYaw = 0;
  let dragPitch = 0;
  let targetYaw = 0;
  let targetPitch = 0;
  let activePointer: number | null = null;
  let pointerX = 0;
  let pointerY = 0;
  let scroll = 0;
  let ready = false;
  let prepared = false;
  const morph = { value: 0 };
  const focus = { value: 0 };
  let focusTarget = 0;
  let reducedMotion = Boolean(options.reducedMotion);
  let viewportWidth = 1;
  let viewportHeight = 1;
  let restingCameraZ = 2.28;
  let isMobile = false;
  const labelElements: HTMLElement[] = [];
  let removeListeners = () => {};
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 20);
  camera.position.z = 2.28;
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  let resizeObserver: ResizeObserver | undefined;
  let intersectionObserver: IntersectionObserver | undefined;
  try {
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;pointer-events:auto;cursor:grab;touch-action:pan-y';
    host.appendChild(renderer.domElement);
    const globe = new THREE.Group();
    globe.rotation.set(0.14, -1.03, -0.12);
    scene.add(globe);
    const sphereGeometry = new THREE.SphereGeometry(1, 80, 64);
    const surface = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: { uOpacity: { value: 1 } },
      vertexShader: surfaceVertex,
      fragmentShader: `
        uniform float uOpacity;
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          float facing = max(0.0, vNormal.z);
          float rim = pow(1.0 - facing, 3.2);
          vec3 blue = vec3(0.014, 0.058, 0.17);
          vec3 warm = vec3(0.035, 0.09, 0.26);
          vec3 edge = mix(blue, warm, smoothstep(-0.15, 0.7, vNormal.y));
          float grain = fract(sin(dot(vPosition.xy, vec2(127.1, 311.7))) * 43758.5453);
          vec3 base = vec3(0.006, 0.008, 0.013) + grain * 0.002;
          gl_FragColor = vec4(base + edge * rim * 0.85, uOpacity);
        }
      `,
    });
    const shell = new THREE.Mesh(sphereGeometry, surface);
    // Transparent objects otherwise sort by rotated bounding-centre depth.
    // Land does not write depth, so a later shell would erase its front-facing dots.
    shell.renderOrder = GLOBE_RENDER_ORDER.shell;
    globe.add(shell);

    const positions: number[] = [];
    const flatPositions: number[] = [];
    const flatOpacities: number[] = [];
    const shades: number[] = [];
    const coastlineFlags: number[] = [];
    for (const [coordinates, coastline] of [[LAND_COORDINATES, false], [COAST_COORDINATES, true]] as const) {
      for (let index = 0; index < coordinates.length; index += 2) {
        const latitude = coordinates[index];
        const longitude = coordinates[index + 1];
        const point = location(latitude, longitude, 1.003);
        positions.push(point.x, point.y, point.z);
        flatPositions.push(...flatLocation(latitude, longitude));
        flatOpacities.push(flatLandOpacity(latitude));
        const noise = Math.sin(latitude * 12.9898 + longitude * 78.233) * 43758.5453;
        shades.push(coastline ? 1.0 : 0.82 + (noise - Math.floor(noise)) * 0.18);
        coastlineFlags.push(coastline ? 1 : 0);
      }
    }
    const landGeometry = new THREE.BufferGeometry();
    landGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    landGeometry.setAttribute('flatPosition', new THREE.Float32BufferAttribute(flatPositions, 3));
    landGeometry.setAttribute('flatOpacity', new THREE.Float32BufferAttribute(flatOpacities, 1));
    landGeometry.setAttribute('shade', new THREE.Float32BufferAttribute(shades, 1));
    landGeometry.setAttribute('coastline', new THREE.Float32BufferAttribute(coastlineFlags, 1));
    const landMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uPointSize: { value: 2.0 }, uMorph: morph, uFocus: focus },
      vertexShader: `
        attribute vec3 flatPosition;
        attribute float flatOpacity;
        uniform float uMorph;
        attribute float shade;
        attribute float coastline;
        uniform float uPointSize;
        varying float vShade;
        varying float vFacing;
        varying float vOpacity;
        void main() {
          vec3 n = normalize(normalMatrix * normalize(position));
          vec4 worldPosition = mix(modelMatrix * vec4(position, 1.0), vec4(flatPosition, 1.0), uMorph);
          vec4 viewPosition = viewMatrix * worldPosition;
          vFacing = mix(dot(n, normalize(-viewPosition.xyz)), 1.0, uMorph);
          vShade = shade;
          vOpacity = mix(1.0, flatOpacity, uMorph);
          gl_Position = projectionMatrix * viewPosition;
          gl_PointSize = uPointSize * (2.28 / -viewPosition.z) * mix(1.0, 0.88, coastline);
        }
      `,
      fragmentShader: `
        uniform float uFocus;
        varying float vShade;
        varying float vFacing;
        varying float vOpacity;
        void main() {
          if (vFacing < 0.025) discard;
          float distance = length(gl_PointCoord - 0.5);
          float dotAlpha = 1.0 - smoothstep(0.30, 0.5, distance);
          float edge = smoothstep(0.015, 0.26, vFacing);
          gl_FragColor = vec4(vec3(0.89, 0.95, 1.0) * min(1.0, vShade * 1.16), dotAlpha * edge * vOpacity * mix(1.0, 0.28, uFocus));
        }
      `,
    });
    const land = new THREE.Points(landGeometry, landMaterial);
    land.renderOrder = GLOBE_RENDER_ORDER.land;
    land.frustumCulled = false; // Unfolding extends beyond the original sphere bounds.
    globe.add(land);

    // Camera-facing atmosphere uses analytical sphere falloff, avoiding a flat neon outline.
    const atmosphereGeometry = new THREE.PlaneGeometry(2.5, 2.5);
    const atmosphereMaterial = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 1 } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `varying vec2 vPoint; void main() { vPoint = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform float uOpacity;
        varying vec2 vPoint;
        void main() {
          float r = length(vPoint);
          float edge = exp(-pow((r - 1.003) / 0.017, 2.0));
          float halo = exp(-pow((r - 1.015) / 0.065, 2.0));
          float outer = smoothstep(0.935, 1.002, r);
          float vertical = vPoint.y / max(r, 0.001);
          vec3 blue = vec3(0.03, 0.21, 0.84);
          vec3 warm = vec3(0.38, 0.62, 0.96);
          vec3 color = mix(blue, warm, smoothstep(-0.24, 0.48, vertical));
          float intensity = 0.44 + 0.56 * abs(vertical);
          float opacity = (edge * 0.72 + halo * 0.22) * outer * intensity;
          gl_FragColor = vec4(color, opacity * uOpacity);
        }
      `,
    });
    const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
    atmosphere.scale.setScalar(camera.position.z / Math.sqrt(camera.position.z * camera.position.z - 1));
    atmosphere.renderOrder = 3;
    scene.add(atmosphere);

    const labelPlaces: [string, number, number][] = [
      ['INDIA', 28.61, 77.21], ['UAE', 25.2, 55.27], ['SINGAPORE', 1.35, 103.82],
      ['UNITED KINGDOM', 51.5, -0.12], ['GERMANY', 50.11, 8.68], ['KENYA', -1.29, 36.82],
      ['CHINA', 31.23, 121.47], ['AUSTRALIA', -33.87, 151.21], ['UNITED STATES', 40.71, -74],
      ['CANADA', 45.5, -73.57], ['MEXICO', 19.43, -99.13], ['BRAZIL', -23.55, -46.63],
      ['ARGENTINA', -34.6, -58.38], ['CHILE', -33.45, -70.67], ['COLOMBIA', 4.71, -74.07],
      ['SOUTH AFRICA', -26.2, 28.04], ['NIGERIA', 6.52, 3.38], ['EGYPT', 30.04, 31.24],
      ['MOROCCO', 33.57, -7.59], ['TURKEY', 41.01, 28.98], ['SAUDI ARABIA', 24.71, 46.68],
      ['JAPAN', 35.68, 139.69], ['SOUTH KOREA', 37.57, 126.98], ['INDONESIA', -6.21, 106.85],
      ['NEW ZEALAND', -36.85, 174.76], ['KAZAKHSTAN', 43.24, 76.89], ['SWEDEN', 59.33, 18.07],
    ];
    const labels = labelPlaces.map(([name, latitude, longitude]) => {
      const element = document.createElement('span');
      element.textContent = name;
      element.setAttribute('aria-hidden', 'true');
      element.style.cssText = 'position:absolute;left:0;top:0;z-index:2;display:block;opacity:0;transition:opacity .45s cubic-bezier(.22,1,.36,1);pointer-events:none;white-space:nowrap;padding:6px 9px;border-radius:7px;background:rgba(7,9,12,.76);border:1px solid rgba(255,255,255,.075);color:#fff8ef;font:400 10px/1.2 "Inter Variable",sans-serif;letter-spacing:.025em;text-shadow:0 0 8px rgba(205,231,255,.2);will-change:transform,opacity';
      labelElements.push(element);
      host.appendChild(element);
      return { element, labelWidth: name.length * 6.3 + 20, position: location(latitude, longitude, 1.02), flat: new THREE.Vector3(...flatLocation(latitude, longitude)) };
    });
    const mobileLabelOrder = [8, 3, 0, 7, 11, 15, 24, 6];
    const mobileLabels = [...mobileLabelOrder.map(index => labels[index]), ...labels.filter((_, index) => !mobileLabelOrder.includes(index))];
    const projected = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const toCamera = new THREE.Vector3();
    function updateLabels() {
      globe.updateMatrixWorld();
      const occupied: { x: number; y: number }[] = [];
      const bounds = host.getBoundingClientRect();
      const displayScale = bounds.width / viewportWidth;
      const mobileMap = isMobile && morph.value > 0.95;
      const screenBoxes: LabelBox[] = [];
      for (const label of mobileMap ? mobileLabels : labels) {
        projected.copy(label.position).applyMatrix4(globe.matrixWorld);
        normal.copy(projected).normalize();
        toCamera.copy(camera.position).sub(projected).normalize();
        const facing = THREE.MathUtils.lerp(normal.dot(toCamera), 1, morph.value);
        projected.lerp(label.flat, morph.value).project(camera);
        const x = (projected.x * 0.5 + 0.5) * viewportWidth + 8;
        const y = (-projected.y * 0.5 + 0.5) * viewportHeight - 8;
        if (mobileMap) {
          const box = screenBoxes.length < 8 ? placeMapLabel(bounds.left + (x - 8) * displayScale, bounds.top + (y + 8) * displayScale, label.labelWidth, window.innerWidth, screenBoxes) : null;
          label.element.style.transformOrigin = 'top left';
          label.element.style.opacity = box ? String((1 - focus.value) * THREE.MathUtils.smoothstep(morph.value, 0.95, 1)) : '0';
          if (box) {
            label.element.style.transform = `translate3d(${(box.x - bounds.left) / displayScale}px,${(box.y - bounds.top) / displayScale}px,0) scale(${1 / displayScale})`;
            screenBoxes.push(box);
          }
          continue;
        }
        const show = occupied.length < (isMobile ? 4 : 8) && facing > 0.2 && bounds.left + x * displayScale > 4 && bounds.left + (x + label.labelWidth) * displayScale < window.innerWidth - 4 && x > 0 && x < viewportWidth - 80 && y > 0 && y < viewportHeight - 20 && !occupied.some((point) => Math.abs(point.x - x) < 125 && Math.abs(point.y - y) < 28);
        label.element.style.opacity = show ? String(THREE.MathUtils.smoothstep(facing, 0.2, 0.42) * (1 - Math.sin(morph.value * Math.PI)) * (1 - focus.value)) : '0';
        label.element.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
        if (show) {
          occupied.push({ x, y });
        }
      }
    }
    // One coordinate source for markers, labels, and both ends of every route.
    const countryPositions = labelPlaces.map(([, latitude, longitude]) => location(latitude, longitude));
    const links = [[0, 1], [0, 2], [0, 3], [1, 5], [2, 6], [2, 7], [3, 8], [1, 4]];
    // Attach each remaining country to the nearest member of the connected network.
    for (let index = 9; index < countryPositions.length; index++) {
      let nearest = 0;
      for (let candidate = 1; candidate < index; candidate++) {
        if (countryPositions[index].distanceToSquared(countryPositions[candidate])
          < countryPositions[index].distanceToSquared(countryPositions[nearest])) nearest = candidate;
      }
      links.push([nearest, index]);
    }
    const routeMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uMorph: morph, uOpacity: { value: 1 }, uSeam: { value: -1 } },
      vertexShader: `
        attribute vec3 flatPosition;
        uniform float uMorph;
        attribute float routePhase;
        varying float vAlong;
        varying float vPhase;
        void main() {
          vAlong = uv.x;
          vPhase = routePhase;
          vec4 worldPosition = mix(modelMatrix * vec4(position, 1.0), vec4(flatPosition, 1.0), uMorph);
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uOpacity;
        uniform float uSeam;
        uniform float uMorph;
        varying float vAlong;
        varying float vPhase;
        void main() {
          if (uMorph > 0.95 && uSeam >= 0.0 && abs(vAlong - uSeam) < 0.012) discard;
          // The head clears the destination before resetting at the origin.
          float head = fract(uTime / 4.8 + vPhase) * 1.4 - 0.06;
          float behind = head - vAlong;
          float streak = smoothstep(0.0, 0.018, behind)
            * (1.0 - smoothstep(0.035, 0.34, behind));
          float tip = exp(-pow((behind - 0.023) / 0.024, 2.0));
          float middle = sin(vAlong * 3.14159);
          vec3 gold = mix(vec3(0.65, 0.46, 0.13), vec3(1.0, 0.77, 0.08), middle);
          vec3 color = mix(gold, vec3(1.0, 0.86, 0.39), streak);
          color = mix(color, vec3(1.0, 0.96, 0.80), tip * 0.9);
          gl_FragColor = vec4(color, (0.22 + streak * 0.78) * uOpacity);
        }
      `,
    });
    for (const [routeIndex, [from, to]] of links.entries()) {
      const start = countryPositions[from];
      const end = countryPositions[to];
      const angle = start.angleTo(end);
      const points = Array.from({ length: 65 }, (_, index) => {
        const t = index / 64;
        const direction = start.clone().multiplyScalar(Math.sin((1 - t) * angle)).addScaledVector(end, Math.sin(t * angle)).divideScalar(Math.sin(angle));
        return direction.normalize().multiplyScalar(1.011 + Math.sin(Math.PI * t) * (0.02 + 0.01 * start.distanceTo(end)));
      });
      const curve = new THREE.CatmullRomCurve3(points);
      const geometry = new THREE.TubeGeometry(curve, 80, 0.00135, 4, false);
      geometry.setAttribute('routePhase', new THREE.Float32BufferAttribute(
        new Float32Array(geometry.attributes.position.count).fill(routeIndex / links.length), 1,
      ));
      const flatStart = new THREE.Vector3(...flatLocation(labelPlaces[from][1], labelPlaces[from][2]));
      const flatEnd = new THREE.Vector3(...flatLocation(labelPlaces[to][1], labelPlaces[to][2]));
      const flatRoute: number[] = [];
      const vertex = new THREE.Vector3();
      for (let i = 0; i < geometry.attributes.position.count; i++) {
        const t = geometry.attributes.uv.getX(i);
        const offset = vertex.fromBufferAttribute(geometry.attributes.position, i).sub(curve.getPointAt(t));
        flatRoute.push(
          THREE.MathUtils.lerp(flatStart.x, flatEnd.x, t) + offset.x,
          THREE.MathUtils.lerp(flatStart.y, flatEnd.y, t) + Math.sin(Math.PI * t) * flatStart.distanceTo(flatEnd) * 0.12 + offset.y,
          0.045 + offset.z,
        );
      }
      geometry.setAttribute('flatPosition', new THREE.Float32BufferAttribute(flatRoute, 3));
      const route = new THREE.Mesh(geometry, routeMaterial);
      route.frustumCulled = false;
      globe.add(route);
    }
    const nodeGeometry = new THREE.SphereGeometry(0.008, 12, 8);
    const nodeMaterial = new THREE.MeshBasicMaterial({ color: 0xffc400, transparent: true });
    const nodes = labelPlaces.map(([, latitude, longitude]) => {
      const node = new THREE.Mesh(nodeGeometry, nodeMaterial);
      node.position.copy(location(latitude, longitude, 1.011));
      scene.add(node);
      return { node, sphere: location(latitude, longitude, 1.011), flat: new THREE.Vector3(...flatLocation(latitude, longitude)) };
    });
    // All marker halos share one draw call and are occluded by the globe surface.
    const glowGeometry = new THREE.BufferGeometry();
    glowGeometry.setAttribute('position', new THREE.Float32BufferAttribute(
      labelPlaces.flatMap(([, latitude, longitude]) => location(latitude, longitude, 1.014).toArray()), 3,
    ));
    glowGeometry.setAttribute('flatPosition', new THREE.Float32BufferAttribute(labelPlaces.flatMap(([, lat, lon]) => flatLocation(lat, lon)), 3));
    const glowMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uSize: { value: 24 }, uMorph: morph, uFocus: focus },
      vertexShader: `uniform float uSize; uniform float uMorph; attribute vec3 flatPosition; void main() { vec4 p = viewMatrix * mix(modelMatrix * vec4(position, 1.0), vec4(flatPosition, 1.0), uMorph); gl_Position = projectionMatrix * p; gl_PointSize = uSize * (2.28 / -p.z); }`,
      fragmentShader: `uniform float uFocus; void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float glow = exp(-r * r * 5.5) * (1.0 - smoothstep(0.65, 1.0, r)); gl_FragColor = vec4(0.95, 0.7, 0.18, glow * 0.38 * (1.0 - uFocus)); }`,
    });
    const halos = new THREE.Points(glowGeometry, glowMaterial);
    halos.frustumCulled = false;
    globe.add(halos);
    // Every selectable country has one batched marker, including small territories.
    const countryGeometry = new THREE.BufferGeometry();
    countryGeometry.setAttribute('position', new THREE.Float32BufferAttribute(COUNTRIES.flatMap(c => countryPosition(c).toArray()), 3));
    countryGeometry.setAttribute('flatPosition', new THREE.Float32BufferAttribute(COUNTRIES.flatMap(c => flatLocation(c.latitude, c.longitude)), 3));
    const selectedFlags = new THREE.Float32BufferAttribute(new Float32Array(COUNTRIES.length), 1);
    countryGeometry.setAttribute('selected', selectedFlags);
    const countryMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uMorph: morph, uFocus: focus, uSize: { value: 5 } },
      vertexShader: `attribute vec3 flatPosition; attribute float selected; uniform float uMorph; uniform float uFocus; uniform float uSize; varying float vSelected; varying float vOpacity;
        void main() { vSelected = selected; vOpacity = mix(uMorph * 0.55, mix(0.07, 1.0, selected), uFocus);
          vec4 world = mix(modelMatrix * vec4(position,1.0),vec4(flatPosition,1.0),uMorph);
          gl_Position = projectionMatrix * viewMatrix * world;
          gl_PointSize = uSize * mix(1.0, 2.6, selected * uFocus); }`,
      fragmentShader: `varying float vSelected; varying float vOpacity; void main() { float r=length(gl_PointCoord-.5); float alpha=1.0-smoothstep(.22,.5,r); gl_FragColor=vec4(mix(vec3(.4,.57,.8),vec3(1.,.78,.15),vSelected),alpha*vOpacity); }`,
    });
    const countryDots = new THREE.Points(countryGeometry, countryMaterial);
    countryDots.frustumCulled = false;
    globe.add(countryDots);
    const selectedMaterial = routeMaterial.clone();
    selectedMaterial.uniforms.uMorph = morph;
    selectedMaterial.uniforms.uTime = routeMaterial.uniforms.uTime;
    selectedMaterial.uniforms.uOpacity.value = 1;
    let selectedMesh: THREE.Mesh | null = null;
    let selectedCodes = '';
    const selectedLabels = [0, 1].map(() => {
      const element = document.createElement('span');
      element.setAttribute('aria-hidden', 'true');
      element.style.cssText = 'position:absolute;left:0;top:0;opacity:0;pointer-events:none;white-space:nowrap;padding:8px 11px;border:1px solid #bf9d4c66;border-radius:8px;background:#101319e8;color:#ffe3a0;font:500 12px/1.3 "Inter Variable",sans-serif;transition:opacity .3s;z-index:3';
      host.appendChild(element); labelElements.push(element);
      return { element, country: COUNTRIES[0], active: false };
    });
    function setRoute(originCode: string, destinationCode: string) {
      const codes = originCode + ':' + destinationCode;
      if (selectedCodes === codes) return;
      selectedCodes = codes;
      const from = COUNTRY_BY_CODE.get(originCode), to = COUNTRY_BY_CODE.get(destinationCode);
      focusTarget = from || to ? 1 : 0;
      COUNTRIES.forEach((country, i) => selectedFlags.setX(i, country.code === from?.code || country.code === to?.code ? 1 : 0));
      selectedFlags.needsUpdate = true;
      if (selectedMesh) { globe.remove(selectedMesh); selectedMesh.geometry.dispose(); selectedMesh = null; }
      if (from && to) {
        const route = selectedRouteGeometry(from, to);
        if (route) {
          selectedMaterial.uniforms.uSeam.value = route.seam;
          selectedMesh = new THREE.Mesh(route.geometry, selectedMaterial);
          selectedMesh.frustumCulled = false; selectedMesh.renderOrder = 1;
          globe.add(selectedMesh);
        }
      }
      [from, to].forEach((country, i) => {
        selectedLabels[i].active = Boolean(country) && !(i === 1 && from?.code === to?.code);
        if (country) { selectedLabels[i].country = country; selectedLabels[i].element.textContent = country.name; }
      });
      if (reducedMotion) focus.value = focusTarget;
      resume();
    }
    function draw() {
      if (destroyed || contextLost || !prepared) return;
      try {
        const transition = transitionAt(scroll);
        morph.value = transition.flatten;
        camera.position.z = THREE.MathUtils.lerp(restingCameraZ, 3.2, transition.centre);
        atmosphere.scale.setScalar(camera.position.z / Math.sqrt(camera.position.z * camera.position.z - 1));
        routeMaterial.uniforms.uOpacity.value = 1 - focus.value * 0.96;
        nodeMaterial.opacity = 1 - focus.value;
        surface.uniforms.uOpacity.value = 1 - THREE.MathUtils.smoothstep(morph.value, 0, 0.65);
        surface.depthWrite = morph.value < 0.01;
        atmosphereMaterial.uniforms.uOpacity.value = 1 - THREE.MathUtils.smoothstep(morph.value, 0, 0.75);
        globe.updateMatrixWorld();
        for (const { node, sphere, flat } of nodes) node.position.copy(sphere).applyMatrix4(globe.matrixWorld).lerp(flat, morph.value);
        renderer.render(scene, camera);
        updateLabels();
        for (const label of selectedLabels) {
          const point = countryPosition(label.country).applyMatrix4(globe.matrixWorld).lerp(new THREE.Vector3(...flatLocation(label.country.latitude, label.country.longitude)), morph.value).project(camera);
          const x = (point.x * 0.5 + 0.5) * viewportWidth;
          const y = (-point.y * 0.5 + 0.5) * viewportHeight;
          if (isMobile && morph.value > 0.95) {
            const bounds = host.getBoundingClientRect();
            const scale = bounds.width / viewportWidth;
            const labelWidth = label.element.offsetWidth;
            const screenX = Math.max(8 + labelWidth / 2, Math.min(window.innerWidth - 8 - labelWidth / 2, bounds.left + x * scale));
            label.element.style.transformOrigin = 'top left';
            label.element.style.transform = `translate3d(${(screenX - bounds.left) / scale}px,${y - 17}px,0) scale(${1 / scale}) translate(-50%,-100%)`;
          } else {
            label.element.style.transform = `translate3d(${x}px,${y - 17}px,0) translate(-50%,-100%)`;
          }
          label.element.style.opacity = label.active && morph.value > 0.9 ? String(focus.value) : '0';
        }
        if (!ready) {
          ready = true;
          host.dataset.globePoints = String(positions.length / 3);
          host.dataset.globeDrawCalls = String(renderer.info.render.calls);
          readinessFrame = requestAnimationFrame(() => {
            readinessFrame = requestAnimationFrame(() => {
              readinessFrame = 0;
              if (!destroyed && !contextLost) options.onReady?.();
            });
          });
        }
      } catch {
        contextLost = true;
        ready = false;
        labelElements.forEach((element) => { element.style.opacity = '0'; });
        options.onError?.();
      }
    }
    function applyRotation() {
      globe.rotation.y = -1.03 + autoYaw + dragYaw;
      globe.rotation.x = 0.14 + dragPitch;
    }
    function tick(now: number) {
      frame = 0;
      if (destroyed || !visible || document.hidden || contextLost || !prepared) return;
      const delta = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 1 / 60;
      lastTime = now;
      focus.value = reducedMotion ? focusTarget : THREE.MathUtils.damp(focus.value, focusTarget, 7, delta);
      const animate = !paused && !reducedMotion;
      if (animate) {
        routeMaterial.uniforms.uTime.value += delta;
        autoResumeDelay = Math.max(0, autoResumeDelay - delta);
        const targetSpeed = activePointer === null && autoResumeDelay === 0 ? 0.095 : 0;
        autoSpeed += (targetSpeed - autoSpeed) * (1 - Math.exp(-10 * delta));
        if (activePointer === null && scroll < 0.001) autoYaw += delta * autoSpeed;
      }
      const smoothing = reducedMotion ? 1 : 1 - Math.exp(-(activePointer === null ? 20 : 36) * delta);
      dragYaw += (targetYaw - dragYaw) * smoothing;
      dragPitch += (targetPitch - dragPitch) * smoothing;
      applyRotation();
      draw();
      const settling = Math.abs(focusTarget - focus.value) > 0.001 || Math.abs(targetYaw - dragYaw) + Math.abs(targetPitch - dragPitch) > 0.0001;
      if (!contextLost && (animate || activePointer !== null || settling)) frame = requestAnimationFrame(tick);
    }
    function resume() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
      if (!destroyed && visible && !document.hidden && !contextLost) frame = requestAnimationFrame(tick);
    }
    function onPointerDown(event: PointerEvent) {
      if (scroll > 0.001 || event.pointerType === 'touch' || event.button !== 0 || activePointer !== null || contextLost) return;
      activePointer = event.pointerId;
      autoSpeed = 0;
      pointerX = event.clientX;
      pointerY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = 'grabbing';
      event.preventDefault();
      resume();
    }
    function onPointerMove(event: PointerEvent) {
      if (event.pointerId !== activePointer) return;
      const sensitivity = Math.PI * 1.12 / Math.max(viewportWidth, 320);
      targetYaw += (event.clientX - pointerX) * sensitivity;
      targetPitch += (event.clientY - pointerY) * sensitivity;
      pointerX = event.clientX;
      pointerY = event.clientY;
    }
    function onPointerEnd(event: PointerEvent) {
      if (event.pointerId !== activePointer) return;
      activePointer = null;
      autoResumeDelay = 0.18;
      renderer.domElement.style.cursor = 'grab';
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    }
    function resize() {
      if (destroyed) return;
      // Composition transforms must not change the drawing buffer resolution.
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height) return;
      viewportWidth = width;
      viewportHeight = height;
      camera.aspect = width / height;
      camera.fov = camera.aspect >= 1 ? 55 : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(55 / 2)) / camera.aspect));
      camera.updateProjectionMatrix();
      const mobile = window.matchMedia('(max-width: 767px)').matches;
      isMobile = mobile;
      restingCameraZ = mobile ? 2.62 : window.matchMedia('(max-width: 1024px)').matches ? 2.72 : 2.22;
      camera.position.z = restingCameraZ;
      atmosphere.scale.setScalar(camera.position.z / Math.sqrt(camera.position.z * camera.position.z - 1));
      const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.5);
      countryMaterial.uniforms.uSize.value = Math.max(3, width * 0.004) * dpr;
      glowMaterial.uniforms.uSize.value = Math.max(12, Math.min(width, height) * 0.027) * dpr;
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      landMaterial.uniforms.uPointSize.value = Math.max(1.05, Math.min(width, height) * 0.0017) * dpr;
      draw();
    }
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      resume();
    }, { rootMargin: '100px' });
    intersectionObserver.observe(host);
    function onLost(event: Event) {
      event.preventDefault();
      contextLost = true;
      ready = false;
      cancelAnimationFrame(readinessFrame);
      labelElements.forEach((element) => { element.style.opacity = '0'; });
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      options.onError?.();
    }
    function prepare() {
      prepared = false;
      void renderer.compileAsync(scene, camera).then(() => {
        if (destroyed || contextLost) return;
        prepared = true;
        resize();
        resume();
      }).catch(() => { if (!destroyed) options.onError?.(); });
    }
    function onRestored() {
      contextLost = false;
      ready = false;
      prepare();
    }
    removeListeners = () => {
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerEnd);
      renderer.domElement.removeEventListener('pointercancel', onPointerEnd);
      renderer.domElement.removeEventListener('lostpointercapture', onPointerEnd);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', resume);
      renderer.domElement.removeEventListener('webglcontextlost', onLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onRestored);
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerEnd);
    renderer.domElement.addEventListener('pointercancel', onPointerEnd);
    renderer.domElement.addEventListener('lostpointercapture', onPointerEnd);
    renderer.domElement.addEventListener('webglcontextlost', onLost);
    renderer.domElement.addEventListener('webglcontextrestored', onRestored);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('resize', resize, { passive: true });
    resize();
    prepare();
    return {
      setRoute,
      setScroll(progress) {
        if (reducedMotion) return;
        scroll = Number.isFinite(progress) ? THREE.MathUtils.clamp(progress, 0, 1) : 0;
        renderer.domElement.style.cursor = scroll > 0.001 ? 'default' : 'grab';
        if (!frame) { applyRotation(); draw(); }
      },
      setReducedMotion(value) {
        reducedMotion = value;
        if (value) scroll = 0;
        applyRotation();
        draw();
        resume();
      },
      setPaused(value) {
        paused = value;
        resume();
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        cancelAnimationFrame(frame);
        cancelAnimationFrame(readinessFrame);
        resizeObserver?.disconnect();
        intersectionObserver?.disconnect();
        removeListeners();
        const geometries = new Set<THREE.BufferGeometry>();
        const materials = new Set<THREE.Material>();
        scene.traverse((object) => {
          if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
            geometries.add(object.geometry);
            const list = Array.isArray(object.material) ? object.material : [object.material];
            list.forEach((material) => materials.add(material));
          }
        });
        geometries.forEach((geometry) => geometry.dispose());
        materials.forEach((material) => material.dispose());
        selectedMaterial.dispose();
        scene.clear();
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
        labelElements.forEach((element) => element.remove());
        delete host.dataset.globePoints;
        delete host.dataset.globeDrawCalls;
      },
    };
  } catch (error) {
    destroyed = true;
    cancelAnimationFrame(frame);
    cancelAnimationFrame(readinessFrame);
    removeListeners();
    labelElements.forEach((element) => element.remove());
    resizeObserver?.disconnect();
    intersectionObserver?.disconnect();
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        object.geometry.dispose();
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.forEach((material) => material.dispose());
      }
    });
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
    throw error;
  }
}
