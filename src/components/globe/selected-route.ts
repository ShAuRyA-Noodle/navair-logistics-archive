import * as THREE from 'three';
import type { Country } from './countries';
import { flatLocation } from './globe-transition';

export function countryPosition(country: Country, radius = 1.016) {
  const lat = country.latitude * Math.PI / 180;
  const lon = country.longitude * Math.PI / 180;
  return new THREE.Vector3(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)).multiplyScalar(radius);
}

/** Stable even for near-antipodal countries. A flat dateline crossing has a seam. */
export function selectedRouteGeometry(from: Country, to: Country) {
  const start = countryPosition(from, 1), end = countryPosition(to, 1);
  const angle = start.angleTo(end);
  if (angle < 0.00001) return null;
  const tangent = end.clone().addScaledVector(start, -start.dot(end));
  if (tangent.lengthSq() < 1e-10) tangent.crossVectors(start, Math.abs(start.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0));
  tangent.normalize();
  const points = Array.from({ length: 97 }, (_, i) => {
    const t = i / 96;
    return start.clone().multiplyScalar(Math.cos(angle * t)).addScaledVector(tangent, Math.sin(angle * t)).multiplyScalar(1.016 + Math.sin(Math.PI * t) * 0.08);
  });
  const curve = new THREE.CatmullRomCurve3(points);
  const geometry = new THREE.TubeGeometry(curve, 128, 0.0026, 6, false);
  const deltaLon = ((to.longitude - from.longitude + 540) % 360) - 180;
  const rawEnd = from.longitude + deltaLon;
  const seam = rawEnd > 180 ? (180 - from.longitude) / deltaLon : rawEnd < -180 ? (-180 - from.longitude) / deltaLon : -1;
  const flat = [], offset = new THREE.Vector3();
  for (let i = 0; i < geometry.attributes.position.count; i++) {
    const t = geometry.attributes.uv.getX(i);
    const rawLon = from.longitude + deltaLon * t;
    const lon = ((rawLon + 540) % 360) - 180;
    const location = flatLocation(THREE.MathUtils.lerp(from.latitude, to.latitude, t), lon);
    offset.fromBufferAttribute(geometry.attributes.position, i).sub(curve.getPointAt(t));
    flat.push(location[0] + offset.x, location[1] + Math.sin(Math.PI * t) * Math.min(0.25, angle * 0.1) + offset.y, 0.055 + offset.z);
  }
  geometry.setAttribute('flatPosition', new THREE.Float32BufferAttribute(flat, 3));
  geometry.setAttribute('routePhase', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count), 1));
  return { geometry, seam };
}
