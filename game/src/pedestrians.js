// SOLMAR BAY — pedestrians.js
// Walking NPCs: they stroll the sidewalks on a seeded wander, flee from
// gunfire and speeding cars, and panic when the wanted level rises.
// A few of them are mission targets (gang members) with health bars.
import * as THREE from 'three';
import { makeRng, pick, clamp, dist2, ROAD_LINES, CITY_HALF } from './config.js';
import { resolveBuildingCollision } from './city.js';

const SHIRTS = [0xd84a4a, 0x4a7ed8, 0x4ad87a, 0xd8c84a, 0x9a4ad8, 0xe0e0e0, 0x333333, 0xd88a4a];

export function makePedMesh(shirtColor, gang = false) {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: pickColor() });
  function pickColor() { return [0xe8b88a, 0xc98a5a, 0x8a5a3a, 0xf0c8a0][Math.floor(Math.random() * 4)]; }
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.4),
    new THREE.MeshLambertMaterial({ color: gang ? 0xc02020 : shirtColor }));
  body.position.y = 1.05; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), skin);
  head.position.y = 1.75; head.castShadow = true; g.add(head);
  const legMat = new THREE.MeshLambertMaterial({ color: 0x2a2a3a });
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.6, 0.26), legMat);
    leg.position.set(0.16 * s, 0.3, 0); leg.name = s < 0 ? 'legL' : 'legR'; g.add(leg);
  }
  if (gang) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.15, 0.42),
      new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    band.position.y = 1.35; g.add(band);
  }
  return g;
}

export function spawnPedestrians(scene, count, seed) {
  const rng = makeRng(seed + 77);
  const peds = [];
  for (let i = 0; i < count; i++) {
    const mesh = makePedMesh(pick(rng, SHIRTS));
    scene.add(mesh);
    const road = pick(rng, ROAD_LINES);
    const along = (rng() * 2 - 1) * 160;
    const side = rng() < 0.5;
    const p = {
      mesh, kind: 'ped', gang: false, health: 30,
      x: side ? road + 7 : along, z: side ? along : road + 7,
      heading: rng() * Math.PI * 2, speed: 1.2 + rng() * 1.2,
      wanderT: 2 + rng() * 4, fleeing: 0, walkPhase: rng() * 6,
    };
    peds.push(p);
  }
  return peds;
}

export function spawnGangMembers(scene, x, z, count, rng) {
  const gang = [];
  for (let i = 0; i < count; i++) {
    const mesh = makePedMesh(0xc02020, true);
    scene.add(mesh);
    const gx = x + (rng() * 2 - 1) * 18, gz = z + (rng() * 2 - 1) * 18;
    gang.push({
      mesh, kind: 'gang', gang: true, health: 60,
      x: gx, z: gz, heading: rng() * Math.PI * 2, speed: 2.2,
      wanderT: 1, fleeing: 0, walkPhase: rng() * 6, shootT: 1 + rng() * 2,
    });
  }
  return gang;
}

export function stepPedestrian(p, dt, player, danger, colliders) {
  // Flee from the player when they are dangerous (shooting / speeding car).
  const d = Math.hypot(p.x - player.x, p.z - player.z);
  if (danger && d < 26) p.fleeing = 2.5;
  if (p.fleeing > 0) {
    p.fleeing -= dt;
    const away = Math.atan2(p.x - player.x, p.z - player.z);
    p.heading = away;
    p.speed = 5.5;
  } else {
    p.wanderT -= dt;
    if (p.wanderT <= 0) { p.wanderT = 2 + Math.random() * 4; p.heading += (Math.random() - 0.5) * 2.2; }
    p.speed = p.gang ? 2.2 : 1.6;
  }
  p.x += Math.sin(p.heading) * p.speed * dt;
  p.z += Math.cos(p.heading) * p.speed * dt;
  p.x = clamp(p.x, -CITY_HALF, CITY_HALF); p.z = clamp(p.z, -CITY_HALF, CITY_HALF);
  const pos = { x: p.x, z: p.z };
  resolveBuildingCollision(colliders, pos, 0.6);
  p.x = pos.x; p.z = pos.z;
  p.walkPhase += dt * p.speed * 2.2;
  p.mesh.position.set(p.x, 0, p.z);
  p.mesh.rotation.y = p.heading;
  const swing = Math.sin(p.walkPhase) * 0.5;
  const legL = p.mesh.getObjectByName('legL'), legR = p.mesh.getObjectByName('legR');
  if (legL) legL.rotation.x = swing;
  if (legR) legR.rotation.x = -swing;
}

export function removePed(scene, peds, p) {
  scene.remove(p.mesh);
  const i = peds.indexOf(p);
  if (i >= 0) peds.splice(i, 1);
}
