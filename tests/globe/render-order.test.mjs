import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { WebGLRenderLists } from 'three/src/renderers/webgl/WebGLRenderLists.js';
import { GLOBE_RENDER_ORDER } from '../../src/components/globe/globe-engine.ts';

test('transparent shell stays behind dots for every relative rotated depth', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const material = new THREE.ShaderMaterial({ transparent: true });
  const geometry = new THREE.BufferGeometry();
  const shell = new THREE.Mesh(geometry, material);
  const land = new THREE.Points(geometry, material);
  shell.renderOrder = GLOBE_RENDER_ORDER.shell;
  land.renderOrder = GLOBE_RENDER_ORDER.land;
  const lists = new WebGLRenderLists();
  for (const depth of [-0.1, -0.001, 0, 0.001, 0.1]) {
    const list = lists.get(scene, 0);
    list.init();
    list.push(shell, geometry, material, 0, 0, null, camera);
    list.push(land, geometry, material, 0, depth, null, camera);
    list.sort();
    assert.equal(list.transparent[0].object, shell);
    assert.equal(list.transparent[1].object, land);
  }
  geometry.dispose();
  material.dispose();
  lists.dispose();
});
