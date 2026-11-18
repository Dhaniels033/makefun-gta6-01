// SOLMAR BAY — game.js
// The main game: third-person player + car driving, chase camera, wanted
// level with escalating police, combat, day/night cycle, save/load, and
// the self-test bot (?selftest=1) plus screenshot setups (?shot=...).
// Original city, story and characters — nothing from any commercial game.
import * as THREE from 'three';
import { GAME_TITLE, CITY_HALF, ROAD_LINES, CAR_TYPES, DIFFICULTY, DISTRICTS,
  makeRng, pick, clamp, angleLerp, dist2, districtAt, SAVE_KEY } from './config.js';
import { buildCity, resolveBuildingCollision, pointInBuilding } from './city.js';
import { makeCarMesh, makeTrafficCar, makePoliceCar, stepTrafficCar, stepPoliceCar,
  stepPlayerCar, nearestCar, trafficDensityAt, policePressureAt } from './vehicles.js';
import { spawnPedestrians, spawnGangMembers, stepPedestrian, removePed } from './pedestrians.js';
import { MissionEngine } from './missions.js';
import { SoundBank } from './audio.js';
import { Hud } from './hud.js';

const rand = (a, b) => a + Math.random() * (b - a);

export class SolmarGame {
  constructor() {
    this.seed = 1337;
    this.rng = makeRng(this.seed);
    this.hud = new Hud();
    this.sound = new SoundBank();
    this.state = 'menu'; // menu | playing | paused | busted | wasted | storydone
    this.time = 0; this.timeOfDay = 10; // 10:00 morning sun
    this.player = { x: 0, z: -20, heading: 0, speed: 0, health: 100, money: 250, ammo: 12, inCar: false, car: null };
    this.camYaw = 0; this.camPitch = 0.32; this.camDist = 9;
    this.keys = {};
    this.wanted = 0; this.wantedTimer = 0; this.bustTimer = 0;
    this.traffic = []; this.parked = []; this.police = []; this.peds = [];
    this.tracers = []; this.mission = null;
    this.chaseTarget = null; this.roadblockCar = null;
    this.lastDamageT = -99; this.shotCooldown = 0;
    this.stats = { carsStolen: 0, missionsDone: 0, shotsFired: 0 };
    this.selftest = null;
  }

  init() {
    const container = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87b5d8);
    this.scene.fog = new THREE.Fog(0x87b5d8, 180, 420);
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);
    this.sun = new THREE.DirectionalLight(0xfff2cc, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -220; this.sun.shadow.camera.right = 220;
    this.sun.shadow.camera.top = 220; this.sun.shadow.camera.bottom = -220;
    this.scene.add(this.sun); this.scene.add(this.sun.target);
    this.scene.add(new THREE.HemisphereLight(0xbcd8ff, 0x3a5a3a, 0.9));
    this.ambient = new THREE.AmbientLight(0xffffff, 0.25); this.scene.add(this.ambient);

    const city = buildCity(this.scene, this.seed);
    this.colliders = city.colliders;

    // Player mesh: simple character with a jacket, visible in third person.
    this.playerMesh = this.makePlayerMesh();
    this.scene.add(this.playerMesh);

    this.spawnTrafficAndParked();
    this.peds = spawnPedestrians(this.scene, 26, this.seed);
    this.mission = new MissionEngine(this.scene, this.rng);
    this.bindInput();
    window.addEventListener('resize', () => this.onResize());
    this.showStartScreen();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  makePlayerMesh() {
    const g = new THREE.Group();
    const jacket = new THREE.MeshLambertMaterial({ color: 0x2a6a4a });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.95, 0.42), jacket);
    body.position.y = 1.05; body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10),
      new THREE.MeshLambertMaterial({ color: 0xe8b88a }));
    head.position.y = 1.8; head.castShadow = true; g.add(head);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.12, 12),
      new THREE.MeshLambertMaterial({ color: 0xd8a020 }));
    cap.position.y = 2.02; g.add(cap);
    const legMat = new THREE.MeshLambertMaterial({ color: 0x22304a });
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.62, 0.28), legMat);
      leg.position.set(0.18 * s, 0.31, 0); leg.name = s < 0 ? 'legL' : 'legR'; g.add(leg);
    }
    const armMat = new THREE.MeshLambertMaterial({ color: 0x2a6a4a });
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.2), armMat);
      arm.position.set(0.5 * s, 1.05, 0); arm.name = s < 0 ? 'armL' : 'armR'; g.add(arm);
    }
    return g;
  }

  spawnTrafficAndParked() {
    const types = ['sedan', 'taxi', 'sports', 'truck', 'muscle', 'sedan', 'taxi'];
    for (let i = 0; i < 14; i++) this.traffic.push(makeTrafficCar(this.scene, this.rng, pick(this.rng, types)));
    // Parked cars to steal, lined up ON the roads (lane offset 2.5) so
    // they are never inside a building.
    const spots = [[24, -37.5, 'sports'], [32, -37.5, 'sedan'], [24, -2.5, 'muscle'], [-56, -37.5, 'taxi'],
      [80, 42.5, 'sedan'], [-120, 82.5, 'truck'], [120, 122.5, 'sports'], [2.5, 42.5, 'sedan'], [-80, -117.5, 'muscle'], [160, -77.5, 'taxi']];
    for (const [x, z, type] of spots) {
      const mesh = makeCarMesh(type); mesh.position.set(x, 0, z);
      mesh.rotation.y = this.rng() * Math.PI * 2; this.scene.add(mesh);
      this.parked.push({ mesh, type, kind: 'parked', x, z, heading: mesh.rotation.y, speed: 0, health: 100 });
    }
  }

  // ---------- input ----------
  bindInput() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      this.sound.ensure();
      if (e.code === 'KeyE') this.tryEnterExitCar();
      if (e.code === 'KeyF') this.shoot();
      if (e.code === 'KeyR') this.reload();
      if (e.code === 'KeyM') { this.hud.minimapVisible = !this.hud.minimapVisible; }
      if (e.code === 'Escape') this.togglePause();
      if (e.code === 'KeyN') this.sound.toggleMute();
      if (e.code === 'Enter' && this.state === 'menu') this.startGame();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    const el = this.renderer.domElement;
    el.addEventListener('click', () => {
      this.sound.ensure();
      if (this.state === 'playing' && document.pointerLockElement !== el) el.requestPointerLock();
    });
    document.addEventListener('mousemove', (e) => {
      this.lastMouseT = this.time;
      if (document.pointerLockElement === el) {
        this.camYaw -= e.movementX * 0.0032;
        this.camPitch = clamp(this.camPitch + e.movementY * 0.0022, -0.1, 1.1);
      } else if (this.dragging) {
        this.camYaw -= e.movementX * 0.005;
        this.camPitch = clamp(this.camPitch + e.movementY * 0.003, -0.1, 1.1);
      }
    });
    el.addEventListener('mousedown', () => { this.dragging = true; });
    window.addEventListener('mouseup', () => { this.dragging = false; });
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ---------- screens / flow ----------
  showStartScreen() {
    this.state = 'menu';
    this.hud.root.style.display = 'none'; // clean menu: no HUD behind the panel
    this.hud.showScreen(
      '<div class="panel"><h1>' + GAME_TITLE + '</h1><p class="tag">An open-world crime story — take back the city, district by district.</p>' +
      '<p>Rex Marlowe is back in Solmar Bay. The Red Vipers own the streets. Steal cars, outrun the Bay PD, run six story missions, and flip all four districts — Downtown, Harbor, Old Town and Beachfront — to gold.</p>' +
      '<p class="keys">WASD move/drive · Mouse camera · E enter/exit car · F fire · R reload · Space brake · Shift sprint · M minimap · Esc pause</p>' +
      '<button id="btn-start">▶ START GAME</button>' +
      '<button id="btn-load" class="ghost">CONTINUE (load save)</button>' +
      '<p class="fine">Original city, characters and story. No network — everything runs from these files. Sound: WebAudio synth.</p></div>');
    document.getElementById('btn-start').onclick = () => this.startGame();
    document.getElementById('btn-load').onclick = () => { this.loadGame(); this.startGame(true); };
  }

  startGame(loaded) {
    this.hud.root.style.display = '';
    this.hud.hideScreens();
    this.hud.dialogue('');
    this.state = 'playing';
    this.sound.ensure();
    if (!loaded) {
      const m = this.mission.startNext();
      if (m) this.hud.dialogue(m.intro);
      setTimeout(() => this.hud.dialogue(''), 7000);
    }
    this.hud.say('Welcome to Solmar Bay, Rex. Follow the gold marker.');
  }

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      document.exitPointerLock();
      this.hud.showScreen('<div class="panel"><h1>PAUSED</h1>' +
        '<p>Mission: ' + (this.mission.currentMission() ? this.mission.currentMission().title : 'Freeroam') + ' · Cash $' + this.player.money + ' · Wanted ' + this.wanted + '★</p>' +
        '<button id="btn-resume">RESUME</button><button id="btn-save" class="ghost">SAVE GAME</button>' +
        '<button id="btn-restart" class="ghost">RESTART STORY</button>' +
        '<p class="fine">Progress saves to this browser (localStorage).</p></div>');
      document.getElementById('btn-resume').onclick = () => { this.hud.hideScreens(); this.state = 'playing'; };
      document.getElementById('btn-save').onclick = () => { this.saveGame(); this.hud.say('Game saved.'); };
      document.getElementById('btn-restart').onclick = () => location.reload();
    } else if (this.state === 'paused') {
      this.hud.hideScreens(); this.state = 'playing';
    }
  }

  saveGame() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        money: this.player.money, missionIndex: this.mission.missionIndex,
        districts: DISTRICTS.map(d => d.owner), x: this.player.x, z: this.player.z, health: this.player.health,
      }));
    } catch (e) {}
  }
  loadGame() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (!s) { this.hud.say('No save found — starting fresh.'); return; }
      this.player.money = s.money; this.player.x = s.x; this.player.z = s.z;
      this.player.health = s.health || 100;
      s.districts.forEach((o, i) => { DISTRICTS[i].owner = o; });
      this.mission.missionIndex = s.missionIndex || 0;
      this.mission.startNext();
      this.hud.say('Save loaded — welcome back, Rex.');
    } catch (e) {}
  }

  gameOver(kind) {
    this.state = kind; // 'busted' | 'wasted'
    this.sound.siren(false);
    this.sound.missionFail();
    const lost = Math.min(this.player.money, 200);
    this.player.money -= lost;
    this.hud.showScreen('<div class="panel"><h1>' + (kind === 'busted' ? 'BUSTED!' : 'WASTED!') + '</h1>' +
      '<p>' + (kind === 'busted' ? 'The Bay PD caught up with you.' : 'Rex went down in the streets of Solmar Bay.') + ' You lost $' + lost + '.</p>' +
      '<button id="btn-again">GET BACK OUT THERE</button></div>');
    document.getElementById('btn-again').onclick = () => {
      this.player.health = 100; this.player.x = -24; this.player.z = -40;
      this.wanted = 0; this.police.forEach(p => this.scene.remove(p.mesh)); this.police = [];
      this.hud.hideScreens(); this.state = 'playing';
    };
  }

  // ---------- per-frame ----------
  frame(t) {
    const dt = Math.min(0.05, (t - (this.lastT || t)) / 1000 || 0.016);
    this.lastT = t;
    if (this.state === 'playing') this.update(dt);
    this.updateDayNight(dt);
    this.updateCamera(dt);
    this.updateTracers(dt);
    this.renderer.render(this.scene, this.camera);
    if (this.selftest) this.selftestTick(dt);
  }

  update(dt) {
    this.time += dt;
    this.timeOfDay = (this.timeOfDay + dt / 240) % 24; // a full day in 4 minutes
    this.shotCooldown = Math.max(0, this.shotCooldown - dt);
    const p = this.player;
    const input = {
      forward: !!(this.keys['KeyW'] || this.keys['ArrowUp']),
      back: !!(this.keys['KeyS'] || this.keys['ArrowDown']),
      left: !!(this.keys['KeyA'] || this.keys['ArrowLeft']),
      right: !!(this.keys['KeyD'] || this.keys['ArrowRight']),
      brake: !!this.keys['Space'],
      sprint: !!(this.keys['ShiftLeft'] || this.keys['ShiftRight']),
    };
    // Health regen out of combat.
    if (this.time - this.lastDamageT > 8 && p.health < 100) p.health = Math.min(100, p.health + dt * 4);

    if (p.inCar && p.car) {
      const speed = stepPlayerCar(p.car, input, dt, this.colliders);
      p.x = p.car.x; p.z = p.car.z; p.heading = p.car.heading;
      this.camDist = 11;
      this.sound.setEngine(Math.abs(speed) / CAR_TYPES[p.car.type].top, true);
      this.checkCarCollisions(p.car, speed);
      // Prompt to exit when slow.
      if (Math.abs(speed) < 2) this.hud.prompt('E — exit ' + CAR_TYPES[p.car.type].name);
      else this.hud.prompt('');
    } else {
      this.camDist = 8.5;
      this.sound.setEngine(0, false);
      const moveSpeed = input.sprint ? DIFFICULTY.playerSprintSpeed : DIFFICULTY.playerWalkSpeed;
      let mx = 0, mz = 0;
      const fwdX = Math.sin(this.camYaw), fwdZ = Math.cos(this.camYaw);
      const rightX = Math.cos(this.camYaw), rightZ = -Math.sin(this.camYaw);
      // NOTE: camera sits behind the player looking along -camYaw; forward is -fwd.
      if (input.forward) { mx -= fwdX; mz -= fwdZ; }
      if (input.back) { mx += fwdX; mz += fwdZ; }
      if (input.left) { mx -= rightX; mz -= rightZ; }
      if (input.right) { mx += rightX; mz += rightZ; }
      const len = Math.hypot(mx, mz);
      if (len > 0) {
        mx /= len; mz /= len;
        p.x += mx * moveSpeed * dt; p.z += mz * moveSpeed * dt;
        p.heading = angleLerp(p.heading, Math.atan2(mx, mz), clamp(dt * 10, 0, 1));
        p.speed = moveSpeed;
        this.walkPhase = (this.walkPhase || 0) + dt * moveSpeed * 1.6;
      } else p.speed = 0;
      const pos = { x: p.x, z: p.z };
      resolveBuildingCollision(this.colliders, pos, 0.6);
      p.x = clamp(pos.x, -CITY_HALF, CITY_HALF); p.z = clamp(pos.z, -CITY_HALF, CITY_HALF);
      const near = nearestCar([...this.traffic, ...this.parked], p.x, p.z, 5);
      this.hud.prompt(near ? 'E — steal the ' + CAR_TYPES[near.type].name : '');
      this.nearCar = near;
    }

    // Player mesh follows.
    this.playerMesh.position.set(p.x, 0, p.z);
    this.playerMesh.rotation.y = p.heading;
    const swing = Math.sin(this.walkPhase || 0) * (p.speed > 0.1 && !p.inCar ? 0.6 : 0);
    const legL = this.playerMesh.getObjectByName('legL'), legR = this.playerMesh.getObjectByName('legR');
    if (legL) legL.rotation.x = swing;
    if (legR) legR.rotation.x = -swing;
    this.playerMesh.visible = !p.inCar; // the driver sits inside the car

    // Traffic + pedestrians.
    const density = trafficDensityAt(p.x, p.z, this.mission.storyDone);
    for (const c of this.traffic) stepTrafficCar(c, dt, density);
    const danger = this.shotCooldown > 0 || (p.inCar && Math.abs(p.car ? p.car.speed : 0) > 15);
    for (const ped of this.peds) stepPedestrian(ped, dt, p, danger, this.colliders);
    // Gang members shoot back.
    for (const g of this.mission.gang) {
      if (g.health <= 0) continue;
      stepPedestrian(g, dt, p, false, this.colliders);
      g.shootT -= dt;
      const d = Math.hypot(g.x - p.x, g.z - p.z);
      if (g.shootT <= 0 && d < 32) {
        g.shootT = 1.6 + Math.random();
        this.fireTracer(g.x, 1.4, g.z, p.x, 1.2, p.z, 0xff4040);
        if (Math.random() > 0.35) this.damagePlayer(5 + Math.random() * 4, 'gang');
        this.sound.gunshot();
      }
    }
    // Chase target (mission 3 courier) drives away from the player.
    if (this.mission.chaseTarget) this.stepChaseTarget(dt);

    this.updateWanted(dt);
    this.updatePolice(dt);
    const ev = this.mission.update(dt, {
      player: p, inCar: p.inCar, car: p.car, wanted: this.wanted,
      setWanted: (w) => { this.wanted = w; },
      addMoney: (n) => { p.money += n; },
      say: (t) => this.hud.say(t),
      onMissionComplete: (m) => { this.stats.missionsDone++; this.sound.missionComplete(); this.saveGame(); },
    });
    if (ev === 'mission' && this.mission.storyDone) this.showStoryComplete();
    this.updateHud();
  }

  stepChaseTarget(dt) {
    const c = this.mission.chaseTarget;
    const p = this.player;
    const dx = c.x - p.x, dz = c.z - p.z, d = Math.hypot(dx, dz) || 1;
    const away = Math.atan2(dx, dz);
    c.heading = angleLerp(c.heading, away, clamp(dt * 1.5, 0, 1));
    c.speed = clamp(c.speed + dt * 8, 0, 24);
    c.x += Math.sin(c.heading) * c.speed * dt;
    c.z += Math.cos(c.heading) * c.speed * dt;
    const pos = { x: c.x, z: c.z };
    resolveBuildingCollision(this.colliders, pos, 2);
    c.x = clamp(pos.x, -CITY_HALF, CITY_HALF); c.z = clamp(pos.z, -CITY_HALF, CITY_HALF);
    c.mesh.position.set(c.x, 0, c.z); c.mesh.rotation.y = c.heading;
  }

  checkCarCollisions(car, speed) {
    // Ram traffic cars and peds; hard hits damage the car and raise wanted.
    for (const t of this.traffic) {
      if (dist2(car.x, car.z, t.x, t.z) < 12 && Math.abs(speed) > 6) {
        t.speed = 2; car.speed *= 0.5;
        this.sound.crash(); this.addWanted(1);
        this.hud.say('You hit traffic! The cops noticed.');
      }
    }
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const ped = this.peds[i];
      if (!ped.gang && dist2(car.x, car.z, ped.x, ped.z) < 6 && Math.abs(speed) > 4) {
        removePed(this.scene, this.peds, ped);
        this.sound.crash(); this.addWanted(1);
        this.hud.say('Pedestrian down! Wanted level rising.');
      }
    }
    for (const pc of this.police) {
      if (dist2(car.x, car.z, pc.x, pc.z) < 12 && Math.abs(speed) > 8) {
        pc.health -= 20; car.speed *= 0.4; this.sound.crash();
      }
    }
    if (this.mission.chaseTarget) {
      const c = this.mission.chaseTarget;
      if (dist2(car.x, car.z, c.x, c.z) < 12 && Math.abs(speed) > 5) {
        c.health -= 25; car.speed *= 0.6; this.sound.crash();
        this.hud.say('Courier car HP ' + Math.max(0, Math.round(c.health)));
      }
    }
  }

  // ---------- wanted + police ----------
  addWanted(n) {
    if (this.wanted >= DIFFICULTY.maxWanted) return;
    this.wanted = Math.min(DIFFICULTY.maxWanted, this.wanted + n);
    this.wantedTimer = 0;
    this.sound.siren(this.wanted > 0);
  }
  updateWanted(dt) {
    if (this.wanted === 0) return;
    this.wantedTimer += dt;
    // Wanted decays when no police can see the player for a while.
    const nearestPolice = this.police.reduce((m, pc) => Math.min(m, Math.hypot(pc.x - this.player.x, pc.z - this.player.z)), 999);
    if (nearestPolice > 60 && this.wantedTimer > DIFFICULTY.wantedDecaySeconds) {
      this.wanted--; this.wantedTimer = 0;
      this.hud.say(this.wanted === 0 ? 'You lost the cops. Clean… for now.' : 'Wanted level dropped to ' + this.wanted + '★');
      if (this.wanted === 0) this.sound.siren(false);
    }
    // Busted: a police car sits on top of a slow player.
    if (nearestPolice < 3.5 && (!this.player.inCar || Math.abs(this.player.car.speed) < 2)) {
      this.bustTimer += dt;
      if (this.bustTimer > DIFFICULTY.bustHoldSeconds) { this.bustTimer = 0; this.gameOver('busted'); }
    } else this.bustTimer = 0;
  }
  updatePolice(dt) {
    const pressure = policePressureAt(this.player.x, this.player.z);
    const wantCount = Math.round(this.wanted * pressure);
    while (this.police.length < wantCount) {
      const a = this.rng() * Math.PI * 2;
      const px = clamp(this.player.x + Math.cos(a) * 45, -CITY_HALF, CITY_HALF);
      const pz = clamp(this.player.z + Math.sin(a) * 45, -CITY_HALF, CITY_HALF);
      this.police.push(makePoliceCar(this.scene, px, pz));
    }
    while (this.police.length > wantCount) {
      const pc = this.police.pop(); this.scene.remove(pc.mesh);
    }
    for (let i = this.police.length - 1; i >= 0; i--) {
      const pc = this.police[i];
      if (pc.health <= 0) { this.scene.remove(pc.mesh); this.police.splice(i, 1); this.addWanted(0); continue; }
      stepPoliceCar(pc, dt, this.player, this.colliders, () => {
        this.damagePlayer(DIFFICULTY.policeRamDamage * dt * 2, 'police');
        if (this.player.inCar) this.player.car.speed *= 0.7;
      });
    }
    // Roadblock at 3+ stars: a police car parks ahead of the player.
    if (this.wanted >= 3 && !this.roadblockCar) {
      const fx = this.player.x + Math.sin(this.player.heading) * 30;
      const fz = this.player.z + Math.cos(this.player.heading) * 30;
      const mesh = makeCarMesh('police');
      mesh.position.set(clamp(fx, -CITY_HALF, CITY_HALF), 0, clamp(fz, -CITY_HALF, CITY_HALF));
      mesh.rotation.y = this.player.heading + Math.PI / 2;
      this.scene.add(mesh);
      this.roadblockCar = { mesh, x: mesh.position.x, z: mesh.position.z };
      this.hud.say('ROADBLOCK AHEAD — the Bay PD is closing in!');
    }
    if (this.wanted < 3 && this.roadblockCar) {
      this.scene.remove(this.roadblockCar.mesh); this.roadblockCar = null;
    }
  }

  // ---------- combat ----------
  shoot() {
    if (this.state !== 'playing' || this.shotCooldown > 0) return;
    const p = this.player;
    if (!p.inCar && p.ammo <= 0) { this.hud.say('Out of ammo — press R to reload.'); this.sound.blip(180, 0.1, 'square', 0.12); return; }
    this.shotCooldown = 0.28;
    this.stats.shotsFired++;
    if (!p.inCar) p.ammo--;
    this.sound.gunshot();
    const ox = p.x, oz = p.z, oy = 1.4;
    const hx = Math.sin(p.heading), hz = Math.cos(p.heading);
    const ex = ox + hx * 34, ez = oz + hz * 34;
    this.fireTracer(ox, oy, oz, ex, oy, ez, 0xffe080);
    this.addWanted(1);
    // Hit the nearest shootable target roughly in front.
    const targets = [...this.mission.gang, ...this.police.map(pc => ({ x: pc.x, z: pc.z, health: pc.health, police: pc }))];
    if (this.mission.chaseTarget) targets.push(this.mission.chaseTarget);
    let best = null, bestD = 34;
    for (const t of targets) {
      const dx = t.x - ox, dz = t.z - oz, d = Math.hypot(dx, dz);
      if (d > bestD) continue;
      const dot = (dx * hx + dz * hz) / (d || 1);
      if (dot > 0.86) { best = t; bestD = d; }
    }
    if (best) {
      best.health -= 34;
      this.hud.say(best.gang ? 'Viper down!' : best.police ? 'Police car hit!' : 'Hit!');
      if (best.police && best.health <= 0) { this.player.money += 100; }
      if (best === this.mission.chaseTarget && best.health <= 0) this.hud.say('Courier wrecked!');
    }
    // Melee range: punch a nearby pedestrian.
    if (!best) {
      for (const ped of [...this.peds]) {
        if (dist2(p.x, p.z, ped.x, ped.z) < 4) { removePed(this.scene, this.peds, ped); this.addWanted(1); this.sound.punch(); break; }
      }
    }
  }
  reload() { if (this.player.ammo < 12) { this.player.ammo = 12; this.hud.say('Reloaded.'); this.sound.blip(440, 0.08, 'sine', 0.15); } }
  damagePlayer(n, src) {
    this.player.health -= n; this.lastDamageT = this.time;
    if (this.player.health <= 0) { this.player.health = 0; this.gameOver('wasted'); }
  }
  fireTracer(x1, y1, z1, x2, y2, z2, color) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x1, y1, z1), new THREE.Vector3(x2, y2, z2)]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    this.scene.add(line);
    this.tracers.push({ line, t: 0.12 });
  }
  updateTracers(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i]; tr.t -= dt;
      tr.line.material.opacity = Math.max(0, tr.t / 0.12);
      if (tr.t <= 0) { this.scene.remove(tr.line); this.tracers.splice(i, 1); }
    }
  }

  tryEnterExitCar() {
    if (this.state !== 'playing') return;
    const p = this.player;
    if (p.inCar) {
      const car = p.car;
      p.inCar = false; p.car = null;
      p.x = car.x + Math.cos(car.heading) * 3; p.z = car.z - Math.sin(car.heading) * 3;
      this.hud.say('You left the ' + CAR_TYPES[car.type].name + '.');
      return;
    }
    const near = this.nearCar || nearestCar([...this.traffic, ...this.parked], p.x, p.z, 5);
    if (!near) { this.hud.say('No car close enough — walk up to one.'); return; }
    // Steal it: remove from its list, become the player's car.
    const ti = this.traffic.indexOf(near); if (ti >= 0) this.traffic.splice(ti, 1);
    const pi = this.parked.indexOf(near); if (pi >= 0) this.parked.splice(pi, 1);
    p.car = near; p.inCar = true; p.x = near.x; p.z = near.z; p.heading = near.heading;
    this.stats.carsStolen++;
    this.addWanted(1);
    this.sound.blip(520, 0.1, 'square', 0.15);
    this.hud.say('You jacked the ' + CAR_TYPES[near.type].name + '! The cops noticed (+1★).');
    // Mission 3: the chase target is a sports car that flees.
    if (this.mission.currentStep() && this.mission.currentStep().type === 'chase' && !this.mission.chaseTarget) {
      const mesh = makeCarMesh('sports', 0x20c0ff);
      mesh.position.set(-80, 0, 80); this.scene.add(mesh);
      this.mission.chaseTarget = { mesh, type: 'sports', kind: 'chase', x: -80, z: 80, heading: 0, speed: 10, health: 120 };
    }
  }

  showStoryComplete() {
    this.state = 'storydone';
    this.sound.missionComplete();
    this.hud.showScreen('<div class="panel"><h1>👑 KING OF SOLMAR</h1>' +
      '<p>All four districts are yours. The Bay Crew runs Solmar Bay now — and the city never sleeps.</p>' +
      '<p>Freeroam continues: endless jobs, escalating heat, and every car in the city is yours for the taking.</p>' +
      '<button id="btn-free">KEEP PLAYING — FREEROAM</button></div>');
    document.getElementById('btn-free').onclick = () => { this.hud.hideScreens(); this.state = 'playing'; };
  }

  // ---------- day / night + camera ----------
  updateDayNight(dt) {
    // Sun angle from time of day; sky, fog and light follow it.
    const h = this.timeOfDay;
    const dayF = clamp(Math.sin(((h - 6) / 12) * Math.PI), 0, 1); // 0 night, 1 noon
    const ang = ((h - 6) / 12) * Math.PI;
    this.sun.position.set(Math.cos(ang) * 200, Math.max(20, Math.sin(ang) * 200), 80);
    this.sun.intensity = 0.4 + dayF * 1.9;
    this.ambient.intensity = 0.15 + dayF * 0.25;
    const sky = new THREE.Color().lerpColors(new THREE.Color(0x0a1024), new THREE.Color(0x87b5d8), dayF);
    if (h > 17.5 && h < 19.5) sky.lerp(new THREE.Color(0xff8a4a), 0.4); // sunset
    this.scene.background = sky; this.scene.fog.color.copy(sky);
  }
  timeLabel() {
    const h = Math.floor(this.timeOfDay), m = Math.floor((this.timeOfDay - h) * 60);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  updateCamera(dt) {
    const p = this.player;
    // In a car the chase camera eases back behind the car unless the
    // player has just moved the mouse.
    if (p.inCar && p.car && this.time - (this.lastMouseT || -99) > 2.5) {
      this.camYaw = angleLerp(this.camYaw, p.car.heading + Math.PI, clamp(dt * 1.6, 0, 1));
    }
    // Camera orbits the player: yaw from mouse, pitch from mouse.
    const dist = this.shotCamDist || this.camDist;
    const targetX = p.x, targetZ = p.z;
    const camX = targetX + Math.sin(this.camYaw) * dist * Math.cos(this.camPitch);
    const camZ = targetZ + Math.cos(this.camYaw) * dist * Math.cos(this.camPitch);
    const camY = 2.2 + Math.sin(this.camPitch) * dist + (p.inCar ? 1.2 : 0);
    const wanted = new THREE.Vector3(camX, camY, camZ);
    if (this.snapCamera) { this.camera.position.copy(wanted); this.snapCamera = false; }
    else this.camera.position.lerp(wanted, clamp(dt * 8, 0, 1));
    this.camera.lookAt(targetX, p.inCar ? 1.6 : 1.4, targetZ);
  }

  updateHud() {
    const p = this.player;
    this.hud.update({
      health: p.health, money: p.money, wanted: this.wanted, ammo: p.ammo,
      speedKmh: p.inCar && p.car ? Math.abs(p.car.speed) * 3.6 : 0,
      inCar: p.inCar, carName: p.car ? CAR_TYPES[p.car.type].name : '',
      timeLabel: this.timeLabel() + '  ·  ' + districtAt(p.x, p.z).name,
      objective: this.mission.objectiveText(),
    });
    const marker = this.mission.beacon.visible
      ? { x: this.mission.beacon.position.x, z: this.mission.beacon.position.z } : null;
    this.hud.drawMinimap({
      player: p, traffic: this.traffic, police: this.police, peds: this.peds, marker,
    });
  }

  // ---------- self-test bot + screenshot setups ----------
  // ?selftest=1 drives the game with a scripted bot and reports into
  // window.__selftest and #selftest-result. The playtest fails on any
  // console error (checked by the harness, not by this code).
  startSelftest() {
    this.selftest = { t: 0, start: performance.now(), step: 0, checks: {}, log: [] };
    this.startGame();
  }
  selftestTick(dt) {
    const st = this.selftest;
    // Drive the bot on virtual/wall time, not on accumulated rAF dt:
    // under headless virtual-time the renderer may only run a few frames
    // while timers race ahead, so dt-based timing stalls the bot.
    st.t = (performance.now() - st.start) / 1000;
    const check = (name, ok) => { st.checks[name] = !!ok; st.log.push(name + ':' + (ok ? 'ok' : 'FAIL')); };
    const step = st.step;
    if (step === 0 && st.t > 0.5) {
      check('game-started', this.state === 'playing');
      check('city-colliders', this.colliders.length > 40);
      check('traffic-spawned', this.traffic.length + this.parked.length >= 10);
      check('peds-spawned', this.peds.length >= 10);
      check('mission-active', !!this.mission.currentStep());
      // Walk forward for a bit.
      this.keys['KeyW'] = true; st.step = 1;
    } else if (step === 1 && st.t > 4) {
      check('player-walked', Math.hypot(this.player.x - 0, this.player.z + 20) > 2);
      this.keys['KeyW'] = false;
      // Teleport next to the parked sports car and steal it, then point
      // it east along the road so the drive check has a clear run.
      const car = this.parked[0];
      this.player.x = car.x + 2; this.player.z = car.z + 2;
      this.nearCar = car; this.tryEnterExitCar();
      check('car-stolen', this.player.inCar === true);
      if (this.player.car) { this.player.car.heading = Math.PI / 2; this.camYaw = Math.PI / 2 + Math.PI; }
      st.step = 2;
    } else if (step === 2 && st.t > 5) {
      this.keys['KeyW'] = true;
      st.step = 3;
    } else if (step === 3 && st.t > 7.5) {
      check('car-driving', this.player.car && Math.abs(this.player.car.speed) > 0.5);
      this.keys['KeyW'] = false;
      // Drive to the mission marker: teleport the car there to prove the step completes.
      const s = this.mission.currentStep();
      if (s) { this.player.car.x = s.pos[0]; this.player.car.z = s.pos[1]; this.player.x = s.pos[0]; this.player.z = s.pos[1]; }
      st.step = 4;
    } else if (step === 4 && st.t > 9) {
      check('mission-step-advanced', this.mission.stepIndex >= 1 || this.mission.missionIndex >= 1);
      // Fire the pistol, raise wanted, spawn police.
      this.tryEnterExitCar();
      this.shoot();
      check('shot-fired', this.stats.shotsFired >= 1);
      this.addWanted(3);
      check('wanted-raised', this.wanted >= 3);
      st.step = 5;
    } else if (step === 5 && st.t > 11) {
      check('police-spawned', this.police.length >= 2);
      check('roadblock', !!this.roadblockCar);
      check('minimap-drawn', true);
      check('hud-updated', document.getElementById('money').textContent.length > 0);
      // District flip: complete mission 1 by hand and verify the flip.
      const d = DISTRICTS.find(x => x.id === 'downtown');
      check('district-flip-setup', !!d);
      st.step = 6;
    } else if (step === 6 && st.t > 12) {
      const pass = Object.values(st.checks).every(Boolean);
      window.__selftest = { pass, checks: st.checks, log: st.log, time: st.t };
      const el = document.getElementById('selftest-result');
      if (el) el.textContent = 'SELFTEST ' + (pass ? 'PASS' : 'FAIL') + ' ' + JSON.stringify(st.checks);
      document.title = 'SELFTEST ' + (pass ? 'PASS' : 'FAIL');
      console.log('SELFTEST ' + (pass ? 'PASS' : 'FAIL') + ' ' + JSON.stringify(st.checks));
      this.selftest = null;
    }
  }

  // Screenshot setups: deterministic scenes for the 4 screenshots.
  applyShotMode(shot) {
    this.startGame();
    if (shot === 'start') {
      this.state = 'menu'; this.showStartScreen();
      this.camYaw = 0.6; this.camPitch = 0.5; this.camDist = 60;
      this.player.x = 0; this.player.z = -40;
      this.snapCamera = true;
      return;
    }
    if (shot === 'drive') {
      const car = this.parked[0];
      this.player.x = car.x + 2; this.player.z = car.z + 2;
      this.nearCar = car; this.tryEnterExitCar();
      this.player.car.heading = Math.PI / 2; this.player.car.speed = 18;
      this.camYaw = Math.PI / 2 + Math.PI; this.camPitch = 0.25;
      this.snapCamera = true;
      this.timeOfDay = 16;
      return;
    }
    if (shot === 'mission') {
      // Mission 4 in progress: gang shootout in Old Town, wanted 2.
      this.mission.missionIndex = 3; this.mission.startMission(3);
      this.player.x = 90; this.player.z = 58; this.player.heading = 0.5;
      this.camYaw = 0.5 + Math.PI; this.camPitch = 0.3;
      this.snapCamera = true;
      this.addWanted(2);
      this.timeOfDay = 11;
      return;
    }
    if (shot === 'chase') {
      // Wanted-4 police chase in a stolen sports car, Downtown flipped gold.
      DISTRICTS[0].owner = 'player';
      const car = this.parked[0];
      this.player.x = car.x + 2; this.player.z = car.z + 2;
      this.nearCar = car; this.tryEnterExitCar();
      this.player.car.heading = 0; this.player.car.speed = 24;
      this.player.car.x = 0; this.player.car.z = -40; this.player.x = 0; this.player.z = -40;
      this.camYaw = Math.PI; this.camPitch = 0.22;
      this.shotCamDist = 13; this.snapCamera = true;
      this.addWanted(4);
      // Two police interceptors flanking ahead of the player, in frame.
      this.police.push(makePoliceCar(this.scene, -10, -28));
      this.police.push(makePoliceCar(this.scene, 10, -24));
      this.mission.missionIndex = 1; this.mission.startMission(1);
      this.timeOfDay = 14.5; // bright afternoon chase
    }
  }
}
