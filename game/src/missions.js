// SOLMAR BAY — missions.js
// The story engine: 6 missions with typed steps (goto / collect / chase /
// shoot / escape), dialogue, rewards, and the district flip. After the
// story, endless freeroam jobs spawn with escalating rewards. The engine
// owns the objective marker (a gold beacon + floating arrow) and reports
// everything the HUD and the self-test need to read.
import * as THREE from 'three';
import { MISSIONS, FREEROAM_JOBS, DISTRICTS, makeRng, pick, clamp, dist2 } from './config.js';
import { spawnGangMembers } from './pedestrians.js';

export class MissionEngine {
  constructor(scene, rng) {
    this.scene = scene; this.rng = rng;
    this.missionIndex = 0; this.stepIndex = 0; this.active = false;
    this.storyDone = false; this.freeroamJob = null; this.jobLevel = 0;
    this.collected = 0; this.chaseTarget = null; this.gang = [];
    this.collectibles = []; this.escapeTimer = 0;
    this.beacon = this.makeBeacon();
    scene.add(this.beacon);
    this.beacon.visible = false;
  }

  makeBeacon() {
    const g = new THREE.Group();
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, 30, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
    cyl.position.y = 15; g.add(cyl);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.25, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd23e }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.3; g.add(ring);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 2.4, 4),
      new THREE.MeshBasicMaterial({ color: 0xffd23e }));
    cone.rotation.x = Math.PI; cone.position.y = 7; cone.name = 'arrow'; g.add(cone);
    return g;
  }

  currentMission() { return MISSIONS[this.missionIndex] || null; }
  currentStep() {
    const m = this.currentMission();
    return m ? m.steps[this.stepIndex] : null;
  }
  objectiveText() {
    if (this.storyDone && this.freeroamJob) return this.freeroamJob.label + '  ($' + this.freeroamJob.reward + ')';
    if (this.storyDone) return 'Story complete — FREEROAM: take jobs, steal cars, rule Solmar Bay.';
    const s = this.currentStep();
    if (!s) return 'Talk to Dario to start the next mission.';
    let t = s.label;
    if (s.type === 'collect') t += '  (' + this.collected + '/' + s.count + ')';
    if (s.type === 'shoot') t += '  (' + (s.count - this.gangAlive()) + '/' + s.count + ')';
    if (s.type === 'chase' && this.chaseTarget) t += '  (car HP ' + Math.max(0, Math.round(this.chaseTarget.health)) + ')';
    return t;
  }
  gangAlive() { return this.gang.filter(g => g.health > 0).length; }

  startMission(i) {
    this.missionIndex = i; this.stepIndex = 0; this.active = true;
    this.collected = 0; this.setupStep();
    return MISSIONS[i];
  }
  startNext() {
    if (this.missionIndex >= MISSIONS.length) { this.finishStory(); return null; }
    return this.startMission(this.missionIndex);
  }

  setupStep() {
    this.clearStepObjects();
    const s = this.currentStep();
    if (!s) return;
    if (s.type === 'collect') {
      for (let k = 0; k < s.count; k++) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4),
          new THREE.MeshLambertMaterial({ color: 0xffd23e, emissive: 0x664400 }));
        const a = (k / s.count) * Math.PI * 2;
        mesh.position.set(s.pos[0] + Math.cos(a) * 9, 0.8, s.pos[1] + Math.sin(a) * 9);
        mesh.castShadow = true; this.scene.add(mesh);
        this.collectibles.push(mesh);
      }
    }
    if (s.type === 'shoot') {
      this.gang = spawnGangMembers(this.scene, s.pos[0], s.pos[1], s.count, this.rng);
    }
    if (s.type === 'escape') this.escapeTimer = 0;
  }

  clearStepObjects() {
    for (const m of this.collectibles) this.scene.remove(m);
    this.collectibles = [];
    for (const g of this.gang) this.scene.remove(g.mesh);
    this.gang = [];
    this.chaseTarget = null;
  }

  // Called every frame; returns an event string when something completes.
  update(dt, ctx) {
    // ctx: {player, inCar, car, wanted, setWanted, addMoney, say, onMissionComplete}
    const s = this.currentStep();
    if (!this.active || !s) {
      if (this.storyDone && !this.freeroamJob) this.spawnFreeroamJob(ctx);
      return null;
    }
    const px = ctx.player.x, pz = ctx.player.z;
    // Beacon follows the current objective.
    let tx = s.pos[0], tz = s.pos[1];
    if (s.type === 'chase' && this.chaseTarget) { tx = this.chaseTarget.x; tz = this.chaseTarget.z; }
    if (s.type === 'shoot' && this.gang.length) {
      const alive = this.gang.find(g => g.health > 0);
      if (alive) { tx = alive.x; tz = alive.z; }
    }
    if (s.type === 'collect' && this.collectibles.length) {
      const c = this.collectibles[0]; tx = c.position.x; tz = c.position.z;
    }
    this.beacon.position.set(tx, 0, tz);
    this.beacon.visible = true;
    const arrow = this.beacon.getObjectByName('arrow');
    if (arrow) { arrow.position.y = 7 + Math.sin(performance.now() / 300) * 0.8; arrow.rotation.y += dt * 2; }
    for (const m of this.collectibles) m.rotation.y += dt;

    if (s.type === 'goto') {
      const needCar = s.needCar && !ctx.inCar;
      if (dist2(px, pz, s.pos[0], s.pos[1]) < 49 && !needCar) return this.completeStep(ctx);
    }
    if (s.type === 'collect') {
      for (let i = this.collectibles.length - 1; i >= 0; i--) {
        const m = this.collectibles[i];
        if (dist2(px, pz, m.position.x, m.position.z) < 9) {
          this.scene.remove(m); this.collectibles.splice(i, 1);
          this.collected++; ctx.say('Picked up ' + this.collected + '/' + s.count);
          ctx.addMoney(50);
        }
      }
      if (this.collectibles.length === 0) return this.completeStep(ctx);
    }
    if (s.type === 'chase') {
      if (this.chaseTarget && this.chaseTarget.health <= 0) return this.completeStep(ctx);
    }
    if (s.type === 'shoot') {
      if (this.gang.length && this.gangAlive() === 0) return this.completeStep(ctx);
    }
    if (s.type === 'escape') {
      this.escapeTimer += dt;
      if (ctx.wanted === 0 && this.escapeTimer > 3) {
        if (dist2(px, pz, s.pos[0], s.pos[1]) < 64) return this.completeStep(ctx);
      }
    }
    return null;
  }

  completeStep(ctx) {
    const m = this.currentMission();
    this.stepIndex++;
    if (this.stepIndex >= m.steps.length) return this.completeMission(ctx);
    this.setupStep();
    ctx.say('Objective updated: ' + this.currentStep().label);
    return 'step';
  }

  completeMission(ctx) {
    const m = this.currentMission();
    ctx.addMoney(m.reward);
    // DISTRICT FLIP — the mechanic that changes the game.
    const d = DISTRICTS.find(x => x.id === m.district);
    if (d) d.owner = 'player';
    ctx.say('MISSION COMPLETE: ' + m.title + '  +$' + m.reward + ' — ' + (d ? d.name + ' is YOURS now!' : ''));
    this.clearStepObjects();
    this.beacon.visible = false;
    this.missionIndex++;
    this.stepIndex = 0;
    this.active = false;
    if (ctx.onMissionComplete) ctx.onMissionComplete(m);
    if (this.missionIndex >= MISSIONS.length) this.finishStory(ctx);
    return 'mission';
  }

  finishStory(ctx) {
    this.storyDone = true;
    if (ctx) ctx.say('STORY COMPLETE — Solmar Bay is yours, Rex. Freeroam jobs unlocked: the city never sleeps.');
  }

  spawnFreeroamJob(ctx) {
    this.jobLevel++;
    const job = pick(this.rng, FREEROAM_JOBS);
    const spot = pick(this.rng, [[-120, 120], [100, 80], [0, 132], [40, -104], [-24, -44]]);
    this.freeroamJob = {
      ...job, reward: job.reward + this.jobLevel * 100,
      pos: spot, count: job.type === 'shoot' ? 4 : job.type === 'rampage' ? 3 : 1, done: 0,
    };
    this.beacon.position.set(spot[0], 0, spot[1]); this.beacon.visible = true;
    if (ctx) ctx.say('FREEROAM JOB #' + this.jobLevel + ': ' + this.freeroamJob.label + '  ($' + this.freeroamJob.reward + ')');
  }

  completeFreeroamJob(ctx) {
    ctx.addMoney(this.freeroamJob.reward);
    ctx.say('JOB DONE +$' + this.freeroamJob.reward);
    this.freeroamJob = null; this.beacon.visible = false;
  }
}
