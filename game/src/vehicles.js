// SOLMAR BAY — vehicles.js
// Car meshes, traffic AI (cars drive the road grid in lanes), parked cars
// to steal, and police cars that chase, ram and roadblock the player.
// Traffic density and police aggression read the district under the
// player, so flipping a district visibly changes the streets.
import * as THREE from 'three';
import { CAR_TYPES, ROAD_LINES, CITY_HALF, makeRng, pick, clamp, angleLerp, dist2, districtAt } from './config.js';
import { resolveBuildingCollision } from './city.js';

export function makeCarMesh(type, colorOverride) {
  const spec = CAR_TYPES[type] || CAR_TYPES.sedan;
  const color = colorOverride !== undefined ? colorOverride : spec.color;
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x182028 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 4.2), bodyMat);
  body.position.y = 0.55; body.castShadow = true; g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.0), glassMat);
  cabin.position.set(0, 1.15, -0.2); cabin.castShadow = true; g.add(cabin);
  if (type === 'truck') {
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.9, 2.2),
      new THREE.MeshLambertMaterial({ color: 0x3a3a3a }));
    bed.position.set(0, 1.1, 1.0); g.add(bed);
  }
  if (type === 'police') {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.25, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    bar.position.set(0, 1.55, -0.2); bar.name = 'lightbar'; g.add(bar);
    const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x2040ff }));
    bar2.position.set(0.8, 1.55, -0.2); g.add(bar2);
  }
  if (type === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25, 0.4),
      new THREE.MeshBasicMaterial({ color: 0xffe020 }));
    sign.position.set(0, 1.55, -0.2); g.add(sign);
  }
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  g.userData.wheels = [];
  for (const [wx, wz] of [[-0.95, 1.35], [0.95, 1.35], [-0.95, -1.35], [0.95, -1.35]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2; w.position.set(wx, 0.38, wz); g.add(w);
    g.userData.wheels.push(w);
  }
  return g;
}

// A traffic car drives a rectangular loop on one road lane.
export function makeTrafficCar(scene, rng, type) {
  const mesh = makeCarMesh(type);
  scene.add(mesh);
  const road = pick(rng, ROAD_LINES);
  const horizontal = rng() < 0.5;
  const dir = rng() < 0.5 ? 1 : -1;
  const lane = (rng() < 0.5 ? 2.5 : -2.5) * dir;
  const car = {
    mesh, type, kind: 'traffic', horizontal, dir, lane, road,
    speed: 8 + rng() * 7, x: (rng() * 2 - 1) * 160, z: (rng() * 2 - 1) * 160,
    heading: 0, health: 100, stuck: 0,
  };
  if (horizontal) { car.z = road + lane; car.heading = dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
  else { car.x = road + lane; car.heading = dir > 0 ? 0 : Math.PI; }
  return car;
}

export function stepTrafficCar(car, dt, trafficDensity) {
  const v = car.speed * trafficDensity;
  if (car.horizontal) car.x += Math.sin(car.heading) * v * dt;
  else car.z += Math.cos(car.heading) * v * dt;
  // Wrap around the city edge and pick a new road.
  if (car.horizontal && Math.abs(car.x) > CITY_HALF) { car.x = -Math.sign(car.x) * CITY_HALF; }
  if (!car.horizontal && Math.abs(car.z) > CITY_HALF) { car.z = -Math.sign(car.z) * CITY_HALF; }
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  for (const w of car.mesh.userData.wheels) w.rotation.x += v * dt * 2;
}

export function makePoliceCar(scene, x, z) {
  const mesh = makeCarMesh('police');
  scene.add(mesh);
  return { mesh, type: 'police', kind: 'police', x, z, heading: 0, speed: 0, health: 100, sirenPhase: 0 };
}

// Police chase: steer toward the player, ram on contact, and at 3+ stars
// one police car parks across the road ahead as a roadblock.
export function stepPoliceCar(car, dt, player, colliders, onRam) {
  const dx = player.x - car.x, dz = player.z - car.z;
  const d = Math.hypot(dx, dz) || 1;
  const want = Math.atan2(dx, dz);
  car.heading = angleLerp(car.heading, want, clamp(dt * 2.2, 0, 1));
  const target = clamp(d * 0.9, 6, CAR_TYPES.police.top);
  car.speed = car.speed + (target - car.speed) * clamp(dt * 1.2, 0, 1);
  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;
  const p = { x: car.x, z: car.z };
  resolveBuildingCollision(colliders, p, 2);
  car.x = clamp(p.x, -CITY_HALF, CITY_HALF); car.z = clamp(p.z, -CITY_HALF, CITY_HALF);
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  car.sirenPhase += dt * 6;
  const bar = car.mesh.getObjectByName('lightbar');
  if (bar) bar.material.color.setHex(Math.sin(car.sirenPhase) > 0 ? 0xff2020 : 0x2040ff);
  for (const w of car.mesh.userData.wheels) w.rotation.x += car.speed * dt * 2;
  if (d < 3.2) onRam(car);
}

// Player-driven car: arcade handling, different per type.
export function stepPlayerCar(car, input, dt, colliders) {
  const spec = CAR_TYPES[car.type];
  const fwd = input.forward ? 1 : input.back ? -0.55 : 0;
  car.speed += fwd * spec.accel * dt;
  if (!input.forward && !input.back) car.speed *= Math.max(0, 1 - dt * 0.8);
  if (input.brake) car.speed *= Math.max(0, 1 - dt * 3.5);
  car.speed = clamp(car.speed, -spec.top * 0.5, spec.top);
  const steerInput = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  const dirSign = car.speed >= 0 ? 1 : -1;
  car.heading += steerInput * spec.steer * dt * clamp(Math.abs(car.speed) / 8, 0, 1) * dirSign;
  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;
  const p = { x: car.x, z: car.z };
  const beforeX = p.x, beforeZ = p.z;
  resolveBuildingCollision(colliders, p, 2);
  if (p.x !== beforeX || p.z !== beforeZ) car.speed *= 0.4; // scrape a wall
  car.x = clamp(p.x, -CITY_HALF, CITY_HALF); car.z = clamp(p.z, -CITY_HALF, CITY_HALF);
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  // Body roll + wheel spin for feel.
  car.mesh.rotation.z = -steerInput * clamp(Math.abs(car.speed) / spec.top, 0, 1) * 0.05;
  for (const w of car.mesh.userData.wheels) w.rotation.x += car.speed * dt * 2;
  return Math.abs(car.speed);
}

export function nearestCar(cars, x, z, maxD) {
  let best = null, bestD = maxD * maxD;
  for (const c of cars) {
    const d = dist2(x, z, c.x, c.z);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

// How busy the streets are right now: player-owned districts calm down.
export function trafficDensityAt(x, z, storyDone) {
  const d = districtAt(x, z);
  let base = d.owner === 'player' ? 0.55 : 1.0;
  if (storyDone) base += 0.25; // freeroam gets busier
  return base;
}
export function policePressureAt(x, z) {
  const d = districtAt(x, z);
  return d.owner === 'player' ? 0.6 : 1.0;
}
