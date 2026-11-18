// SOLMAR BAY — city.js
// Builds the whole city from the seeded RNG: ground, roads, buildings,
// trees, lamps, beach and water, the garage, the bank, the tower and the
// district beacons. Also answers collision queries (is this point inside
// a building?) so the player, cars and NPCs never drive through walls.
import * as THREE from 'three';
import { CITY_HALF, ROAD_LINES, ROAD_WIDTH, makeRng, pick, clamp } from './config.js';

export function buildCity(scene, seed) {
  const rng = makeRng(seed);
  const colliders = []; // {x,z,hx,hz} axis-aligned building boxes
  const palette = [0x8a7f74, 0x6b7f8a, 0x9a8a6a, 0x7a6a8a, 0x5f7a6a, 0xa08a7a, 0x4a5a7a, 0x8a5a4a];

  // Ground: grass-green base with a sandy beach strip at the south edge.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY_HALF * 2 + 120, CITY_HALF * 2 + 120),
    new THREE.MeshLambertMaterial({ color: 0x5d8a4a }));
  ground.rotation.x = -Math.PI / 2; ground.position.z = 20; ground.receiveShadow = true;
  scene.add(ground);
  const beach = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY_HALF * 2 + 120, 34),
    new THREE.MeshLambertMaterial({ color: 0xe8d29a }));
  beach.rotation.x = -Math.PI / 2; beach.position.set(0, 0.05, CITY_HALF + 18); beach.receiveShadow = true;
  scene.add(beach);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY_HALF * 2 + 400, 200),
    new THREE.MeshLambertMaterial({ color: 0x2a7ab0, transparent: true, opacity: 0.9 }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, 0.02, CITY_HALF + 130);
  scene.add(water);

  // Roads: dark strips + centre dashes, one per grid line both ways.
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x2e2e33 });
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xd8d8a0 });
  const L = CITY_HALF * 2;
  for (const c of ROAD_LINES) {
    for (const horizontal of [true, false]) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(L, ROAD_WIDTH), roadMat);
      road.rotation.x = -Math.PI / 2;
      road.position.set(horizontal ? 0 : c, 0.08, horizontal ? c : 0);
      if (!horizontal) road.rotation.z = Math.PI / 2;
      road.receiveShadow = true; scene.add(road);
      for (let d = -CITY_HALF + 10; d < CITY_HALF; d += 16) {
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.4), dashMat);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(horizontal ? d : c, 0.1, horizontal ? c : d);
        if (!horizontal) dash.rotation.z = Math.PI / 2;
        scene.add(dash);
      }
    }
  }

  // Buildings: one per block cell, skipped on roads, the park and landmarks.
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffe9a0 });
  const park = { x: 0, z: 0 };
  function isLandmark(bx, bz) {
    return (Math.abs(bx - -24) < 22 && Math.abs(bz - -56) < 22) ||
      (Math.abs(bx - 0) < 22 && Math.abs(bz - 150) < 22) ||
      (Math.abs(bx - 40) < 22 && Math.abs(bz - -120) < 22);
  }
  const blockCentres = [];
  for (let i = 0; i < ROAD_LINES.length - 1; i++) {
    blockCentres.push((ROAD_LINES[i] + ROAD_LINES[i + 1]) / 2);
  }
  for (const cx of blockCentres) for (const cz of blockCentres) {
    if (Math.abs(cx - park.x) < 25 && Math.abs(cz - park.z) < 25) continue; // central park
    if (isLandmark(cx, cz)) continue;
    if (cz > 165) continue; // beach
    const w = 18 + rng() * 8, d = 18 + rng() * 8, h = 8 + rng() * rng() * 34;
    const mat = new THREE.MeshLambertMaterial({ color: pick(rng, palette) });
    const b = new THREE.Mesh(boxGeo, mat);
    b.scale.set(w, h, d); b.position.set(cx, h / 2, cz); b.castShadow = true; b.receiveShadow = true;
    scene.add(b);
    // Roof rim + lit windows on the tall ones.
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 1, 0.8, d + 1),
      new THREE.MeshLambertMaterial({ color: 0x333338 }));
    roof.position.set(cx, h + 0.4, cz); scene.add(roof);
    if (h > 20) {
      for (let k = 0; k < 4; k++) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), winMat);
        win.position.set(cx - w / 2 + 3 + k * 5, h * (0.4 + rng() * 0.4), cz + d / 2 + 0.06);
        scene.add(win);
      }
    }
    colliders.push({ x: cx, z: cz, hx: w / 2 + 0.6, hz: d / 2 + 0.6 });
  }

  // Central park: trees, pond, paths.
  const pond = new THREE.Mesh(new THREE.CircleGeometry(12, 24),
    new THREE.MeshLambertMaterial({ color: 0x3a8ac0 }));
  pond.rotation.x = -Math.PI / 2; pond.position.set(0, 0.12, 0); scene.add(pond);
  for (let i = 0; i < 26; i++) addTree(scene, -28 + rng() * 56, -28 + rng() * 56, rng);

  // Landmark buildings with signs (canvas textures, drawn locally).
  addLandmark(scene, colliders, -24, -56, 20, 10, 16, 0xd8a020, 'DARIO\u2019S GARAGE');
  addLandmark(scene, colliders, 0, 150, 24, 14, 18, 0x2a6a9a, 'BEACHFRONT BANK');
  addLandmark(scene, colliders, 40, -120, 18, 46, 18, 0x3a3a4a, 'BAYVIEW TOWER');
  // Safehouse (small, gold roof) near the garage.
  addLandmark(scene, colliders, -56, -24, 12, 6, 10, 0x8a6a2a, 'SAFEHOUSE');

  // Street lamps along the roads.
  const lampMat = new THREE.MeshLambertMaterial({ color: 0x222226 });
  const lampHeadMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  for (const c of ROAD_LINES) for (let d = -160; d <= 160; d += 80) {
    for (const [lx, lz] of [[c + 6, d], [c - 6, d + 40]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 6, 6), lampMat);
      pole.position.set(lx, 3, lz); scene.add(pole);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), lampHeadMat);
      head.position.set(lx, 6.2, lz); scene.add(head);
    }
  }
  // Palm trees along the beach.
  for (let x = -170; x <= 170; x += 24) addTree(scene, x, 178, rng, true);

  return { colliders, rng };
}

function addTree(scene, x, z, rng, palm = false) {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, palm ? 7 : 3.5, 6),
    new THREE.MeshLambertMaterial({ color: 0x6a4a2a }));
  trunk.position.set(x, (palm ? 7 : 3.5) / 2, z); trunk.castShadow = true; scene.add(trunk);
  const top = new THREE.Mesh(new THREE.ConeGeometry(palm ? 3 : 2.6, palm ? 3.5 : 4.5, 8),
    new THREE.MeshLambertMaterial({ color: palm ? 0x2a9a5a : 0x2f6a2f }));
  top.position.set(x, (palm ? 7 : 3.5) + 2, z); top.castShadow = true; scene.add(top);
}

function makeSignTexture(text) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#101018'; g.fillRect(0, 0, 512, 96);
  g.fillStyle = '#ffd23e'; g.font = 'bold 44px Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 50);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function addLandmark(scene, colliders, x, z, w, h, d, color, sign) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color }));
  b.position.set(x, h / 2, z); b.castShadow = true; b.receiveShadow = true; scene.add(b);
  const s = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.95, 3),
    new THREE.MeshBasicMaterial({ map: makeSignTexture(sign) }));
  s.position.set(x, h - 2, z + d / 2 + 0.1); scene.add(s);
  colliders.push({ x, z, hx: w / 2 + 0.6, hz: d / 2 + 0.6 });
}

// Collision: push a circle (x,z,r) out of every building box it overlaps.
export function resolveBuildingCollision(colliders, p, r) {
  for (const c of colliders) {
    const nx = clamp(p.x, c.x - c.hx, c.x + c.hx);
    const nz = clamp(p.z, c.z - c.hz, c.z + c.hz);
    const dx = p.x - nx, dz = p.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      p.x = nx + (dx / d) * r; p.z = nz + (dz / d) * r;
    } else if (d2 <= 0.0001) {
      // Centre inside the box: push out along the smallest axis.
      const px = c.hx + r - Math.abs(p.x - c.x), pz = c.hz + r - Math.abs(p.z - c.z);
      if (px < pz) p.x = c.x + (p.x >= c.x ? 1 : -1) * (c.hx + r);
      else p.z = c.z + (p.z >= c.z ? 1 : -1) * (c.hz + r);
    }
  }
}
export function pointInBuilding(colliders, x, z) {
  for (const c of colliders) if (Math.abs(x - c.x) < c.hx && Math.abs(z - c.z) < c.hz) return true;
  return false;
}
