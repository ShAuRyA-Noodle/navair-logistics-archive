import * as THREE from 'three';
import { LAND_COORDINATES, COAST_COORDINATES } from './globe-land';

export type GlobeOptions = {
  onReady?: () => void;
  onError?: () => void;
  reducedMotion?: boolean;
};

export type GlobeController = {
  destroy(): void;
  setScroll(progress: number): void;
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
  let lastTime = 0;
  let autoYaw = 0;
  let autoResumeDelay = 0;
  let dragYaw = 0;
  let dragPitch = 0;
  let targetYaw = 0;
  let targetPitch = 0;
  let activePointer: number | null = null;
  let pointerX = 0;
  let pointerY = 0;
  let scroll = 0;
  let ready = false;
  let reducedMotion = Boolean(options.reducedMotion);
  let viewportWidth = 1;
  let viewportHeight = 1;
  let hostLeft = 0;
  let screenWidth = 1;
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
      vertexShader: surfaceVertex,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          float facing = max(0.0, vNormal.z);
          float rim = pow(1.0 - facing, 3.2);
          vec3 blue = vec3(0.014, 0.058, 0.17);
          vec3 warm = vec3(0.16, 0.035, 0.006);
          vec3 edge = mix(blue, warm, smoothstep(-0.15, 0.7, vNormal.y));
          float grain = fract(sin(dot(vPosition.xy, vec2(127.1, 311.7))) * 43758.5453);
          vec3 base = vec3(0.006, 0.008, 0.013) + grain * 0.002;
          gl_FragColor = vec4(base + edge * rim * 0.65, 1.0);
        }
      `,
    });
    globe.add(new THREE.Mesh(sphereGeometry, surface));

    const positions: number[] = [];
    const shades: number[] = [];
    const coastlineFlags: number[] = [];
    for (const [coordinates, coastline] of [[LAND_COORDINATES, false], [COAST_COORDINATES, true]] as const) {
      for (let index = 0; index < coordinates.length; index += 2) {
        const latitude = coordinates[index];
        const longitude = coordinates[index + 1];
        const point = location(latitude, longitude, 1.003);
        positions.push(point.x, point.y, point.z);
        const noise = Math.sin(latitude * 12.9898 + longitude * 78.233) * 43758.5453;
        shades.push(coastline ? 1.0 : 0.82 + (noise - Math.floor(noise)) * 0.18);
        coastlineFlags.push(coastline ? 1 : 0);
      }
    }
    const landGeometry = new THREE.BufferGeometry();
    landGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    landGeometry.setAttribute('shade', new THREE.Float32BufferAttribute(shades, 1));
    landGeometry.setAttribute('coastline', new THREE.Float32BufferAttribute(coastlineFlags, 1));
    const landMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uPointSize: { value: 2.0 } },
      vertexShader: `
        attribute float shade;
        attribute float coastline;
        uniform float uPointSize;
        varying float vShade;
        varying float vFacing;
        void main() {
          vec3 n = normalize(normalMatrix * normalize(position));
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vFacing = dot(n, normalize(-viewPosition.xyz));
          vShade = shade;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uPointSize * (2.28 / -viewPosition.z) * mix(1.0, 0.88, coastline);
        }
      `,
      fragmentShader: `
        varying float vShade;
        varying float vFacing;
        void main() {
          if (vFacing < 0.025) discard;
          float distance = length(gl_PointCoord - 0.5);
          float dotAlpha = 1.0 - smoothstep(0.30, 0.5, distance);
          float edge = smoothstep(0.015, 0.26, vFacing);
          gl_FragColor = vec4(vec3(1.0) * vShade, dotAlpha * edge);
        }
      `,
    });
    globe.add(new THREE.Points(landGeometry, landMaterial));

    // Camera-facing atmosphere uses analytical sphere falloff, avoiding a flat neon outline.
    const atmosphereGeometry = new THREE.PlaneGeometry(2.5, 2.5);
    const atmosphereMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `varying vec2 vPoint; void main() { vPoint = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        varying vec2 vPoint;
        void main() {
          float r = length(vPoint);
          float edge = exp(-pow((r - 1.003) / 0.017, 2.0));
          float halo = exp(-pow((r - 1.015) / 0.065, 2.0));
          float outer = smoothstep(0.935, 1.002, r);
          float vertical = vPoint.y / max(r, 0.001);
          vec3 blue = vec3(0.015, 0.19, 1.0);
          vec3 warm = vec3(1.0, 0.25, 0.032);
          vec3 color = mix(blue, warm, smoothstep(-0.24, 0.48, vertical));
          float intensity = 0.44 + 0.56 * abs(vertical);
          float opacity = (edge * 0.72 + halo * 0.22) * outer * intensity;
          gl_FragColor = vec4(color, opacity);
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
      element.style.cssText = 'position:absolute;left:0;top:0;z-index:2;display:block;opacity:0;transition:opacity .45s cubic-bezier(.22,1,.36,1);pointer-events:none;white-space:nowrap;padding:6px 9px;border-radius:7px;background:rgba(7,9,12,.76);border:1px solid rgba(255,255,255,.075);color:#fff8ef;font:400 10px/1.2 "IBM Plex Mono",monospace;letter-spacing:.025em;text-shadow:0 0 8px rgba(255,222,166,.16);will-change:transform,opacity';
      labelElements.push(element);
      host.appendChild(element);
      return { element, labelWidth: name.length * 6.3 + 20, position: location(latitude, longitude, 1.02) };
    });
    const projected = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const toCamera = new THREE.Vector3();
    function updateLabels() {
      globe.updateMatrixWorld();
      const occupied: { x: number; y: number }[] = [];
      for (const label of labels) {
        projected.copy(label.position).applyMatrix4(globe.matrixWorld);
        normal.copy(projected).normalize();
        toCamera.copy(camera.position).sub(projected).normalize();
        const facing = normal.dot(toCamera);
        projected.project(camera);
        const x = (projected.x * 0.5 + 0.5) * viewportWidth + 8;
        const y = (-projected.y * 0.5 + 0.5) * viewportHeight - 8;
        const show = occupied.length < (isMobile ? 4 : 8) && facing > 0.2 && x + hostLeft > 4 && x + hostLeft + label.labelWidth < screenWidth - 4 && x > 0 && x < viewportWidth - 80 && y > 0 && y < viewportHeight - 20 && !occupied.some((point) => Math.abs(point.x - x) < 125 && Math.abs(point.y - y) < 28);
        label.element.style.opacity = show ? String(THREE.MathUtils.smoothstep(facing, 0.2, 0.42)) : '0';
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
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        attribute float routePhase;
        varying float vAlong;
        varying float vPhase;
        void main() {
          vAlong = uv.x;
          vPhase = routePhase;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying float vAlong;
        varying float vPhase;
        void main() {
          // The head clears the destination before resetting at the origin.
          float head = fract(uTime / 4.8 + vPhase) * 1.4 - 0.06;
          float behind = head - vAlong;
          float streak = smoothstep(0.0, 0.018, behind)
            * (1.0 - smoothstep(0.035, 0.34, behind));
          float tip = exp(-pow((behind - 0.023) / 0.024, 2.0));
          float middle = sin(vAlong * 3.14159);
          vec3 gold = mix(vec3(0.95, 0.48, 0.015), vec3(1.0, 0.78, 0.08), middle);
          vec3 color = mix(gold, vec3(1.0, 0.84, 0.18), streak);
          color = mix(color, vec3(1.0, 0.95, 0.60), tip * 0.9);
          gl_FragColor = vec4(color, 0.22 + streak * 0.78);
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
      globe.add(new THREE.Mesh(geometry, routeMaterial));
    }
    const nodeGeometry = new THREE.SphereGeometry(0.008, 12, 8);
    const nodeMaterial = new THREE.MeshBasicMaterial({ color: 0xffad32 });
    for (const [, latitude, longitude] of labelPlaces) {
      const node = new THREE.Mesh(nodeGeometry, nodeMaterial);
      node.position.copy(location(latitude, longitude, 1.011));
      globe.add(node);
    }
    // All marker halos share one draw call and are occluded by the globe surface.
    const glowGeometry = new THREE.BufferGeometry();
    glowGeometry.setAttribute('position', new THREE.Float32BufferAttribute(
      labelPlaces.flatMap(([, latitude, longitude]) => location(latitude, longitude, 1.014).toArray()), 3,
    ));
    const glowMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uSize: { value: 24 } },
      vertexShader: `uniform float uSize; void main() { vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_PointSize = uSize * (2.28 / -p.z); }`,
      fragmentShader: `void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float glow = exp(-r * r * 5.5) * (1.0 - smoothstep(0.65, 1.0, r)); gl_FragColor = vec4(1.0, 0.36, 0.025, glow * 0.38); }`,
    });
    globe.add(new THREE.Points(glowGeometry, glowMaterial));
    function draw() {
      if (destroyed || contextLost) return;
      try {
        renderer.render(scene, camera);
        updateLabels();
        if (!ready) {
          ready = true;
          host.dataset.globePoints = String(positions.length / 3);
          host.dataset.globeDrawCalls = String(renderer.info.render.calls);
          options.onReady?.();
        }
      } catch {
        contextLost = true;
        ready = false;
        labelElements.forEach((element) => { element.style.opacity = '0'; });
        options.onError?.();
      }
    }
    function applyRotation() {
      globe.rotation.y = -1.03 + autoYaw + dragYaw + scroll * 0.2;
      globe.rotation.x = 0.14 + dragPitch + scroll * 0.055;
    }
    function tick(now: number) {
      frame = 0;
      if (destroyed || !visible || document.hidden || contextLost) return;
      const delta = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 1 / 60;
      lastTime = now;
      const animate = !paused && !reducedMotion;
      if (animate) {
        routeMaterial.uniforms.uTime.value += delta;
        autoResumeDelay = Math.max(0, autoResumeDelay - delta);
        if (activePointer === null && autoResumeDelay === 0) autoYaw += delta * 0.09;
      }
      const smoothing = reducedMotion ? 1 : 1 - Math.exp(-(activePointer === null ? 18 : 32) * delta);
      dragYaw += (targetYaw - dragYaw) * smoothing;
      dragPitch += (targetPitch - dragPitch) * smoothing;
      applyRotation();
      draw();
      const settling = Math.abs(targetYaw - dragYaw) + Math.abs(targetPitch - dragPitch) > 0.0001;
      if (!contextLost && (animate || activePointer !== null || settling)) frame = requestAnimationFrame(tick);
    }
    function resume() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
      if (!destroyed && visible && !document.hidden && !contextLost) frame = requestAnimationFrame(tick);
    }
    function onPointerDown(event: PointerEvent) {
      if (event.pointerType === 'touch' || event.button !== 0 || activePointer !== null || contextLost) return;
      activePointer = event.pointerId;
      pointerX = event.clientX;
      pointerY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = 'grabbing';
      event.preventDefault();
      resume();
    }
    function onPointerMove(event: PointerEvent) {
      if (event.pointerId !== activePointer) return;
      const sensitivity = Math.PI / Math.max(viewportWidth, 320);
      targetYaw += (event.clientX - pointerX) * sensitivity;
      targetPitch += (event.clientY - pointerY) * sensitivity;
      pointerX = event.clientX;
      pointerY = event.clientY;
    }
    function onPointerEnd(event: PointerEvent) {
      if (event.pointerId !== activePointer) return;
      activePointer = null;
      autoResumeDelay = 0.9;
      renderer.domElement.style.cursor = 'grab';
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    }
    function resize() {
      if (destroyed) return;
      const { width, height, left } = host.getBoundingClientRect();
      hostLeft = left;
      screenWidth = window.innerWidth;
      if (!width || !height) return;
      viewportWidth = width;
      viewportHeight = height;
      camera.aspect = width / height;
      camera.fov = camera.aspect >= 1 ? 55 : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(55 / 2)) / camera.aspect));
      camera.updateProjectionMatrix();
      const mobile = window.matchMedia('(max-width: 767px)').matches;
      isMobile = mobile;
      camera.position.z = mobile ? 2.7 : window.matchMedia('(max-width: 1024px)').matches ? 2.8 : 2.28;
      atmosphere.scale.setScalar(camera.position.z / Math.sqrt(camera.position.z * camera.position.z - 1));
      const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.5);
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
      labelElements.forEach((element) => { element.style.opacity = '0'; });
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      options.onError?.();
    }
    function onRestored() {
      contextLost = false;
      ready = false;
      resize();
      resume();
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
    resume();
    return {
      setScroll(progress) {
        if (reducedMotion) return;
        scroll = Number.isFinite(progress) ? THREE.MathUtils.clamp(progress, 0, 1) : 0;
      },
      setReducedMotion(value) {
        reducedMotion = value;
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
