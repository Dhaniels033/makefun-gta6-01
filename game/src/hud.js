// SOLMAR BAY — hud.js
// The whole 2D interface: health/money/wanted HUD, the live minimap
// (player, traffic, police, mission marker, district colours), the
// objective line, dialogue box, start screen, pause menu, and the
// busted / wasted / story-complete screens. All DOM + one canvas.
import { DISTRICTS, CITY_HALF } from './config.js';

export class Hud {
  constructor() {
    this.root = document.getElementById('hud');
    this.build();
    this.minimapVisible = true;
    this.messageTimer = null;
  }

  build() {
    this.root.innerHTML =
      '<div id="topbar"><div id="wanted"></div><div id="clock"></div><div id="money">$0</div></div>' +
      '<div id="healthbar"><div id="healthfill"></div><span id="healthtext">100</span></div>' +
      '<div id="ammo">PISTOL &#8734;</div>' +
      '<canvas id="minimap" width="200" height="200"></canvas>' +
      '<div id="districtbar"></div>' +
      '<div id="objective"></div>' +
      '<div id="prompt"></div>' +
      '<div id="message"></div>' +
      '<div id="dialogue"></div>' +
      '<div id="crosshair">+</div>' +
      '<div id="speedo"></div>' +
      '<div id="controls-hint">WASD move &nbsp;·&nbsp; Mouse camera &nbsp;·&nbsp; E enter/exit car &nbsp;·&nbsp; F fire/punch &nbsp;·&nbsp; R reload &nbsp;·&nbsp; Space brake &nbsp;·&nbsp; Shift sprint &nbsp;·&nbsp; M minimap &nbsp;·&nbsp; Esc pause</div>';
    this.mm = document.getElementById('minimap');
    this.mmCtx = this.mm.getContext('2d');
    this.screens = document.getElementById('screens');
  }

  say(text, ms) {
    const el = document.getElementById('message');
    el.textContent = text; el.style.opacity = '1';
    clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => { el.style.opacity = '0'; }, ms || 3600);
  }
  dialogue(text) {
    const el = document.getElementById('dialogue');
    el.textContent = text; el.style.display = text ? 'block' : 'none';
  }
  prompt(text) { document.getElementById('prompt').textContent = text || ''; }
  objective(text) { document.getElementById('objective').textContent = text || ''; }

  update(state) {
    // state: {health, money, wanted, ammo, speedKmh, inCar, carName, timeLabel, objective}
    document.getElementById('money').textContent = '$' + state.money.toLocaleString('en-US');
    const stars = '★'.repeat(state.wanted) + '☆'.repeat(5 - state.wanted);
    const w = document.getElementById('wanted');
    w.textContent = stars;
    w.style.color = state.wanted === 0 ? '#888' : state.wanted >= 3 ? '#ff3030' : '#ffd23e';
    document.getElementById('clock').textContent = state.timeLabel;
    document.getElementById('healthfill').style.width = Math.max(0, state.health) + '%';
    document.getElementById('healthfill').style.background = state.health > 50 ? '#37d67a' : state.health > 25 ? '#ffb020' : '#ff3030';
    document.getElementById('healthtext').textContent = Math.max(0, Math.round(state.health));
    document.getElementById('ammo').textContent = state.inCar ? state.carName : ('PISTOL  ' + state.ammo + ' / 12');
    document.getElementById('speedo').textContent = state.inCar ? Math.round(state.speedKmh) + ' km/h' : '';
    document.getElementById('crosshair').style.display = state.inCar ? 'none' : 'block';
    this.objective(state.objective);
    this.drawDistrictBar();
  }

  drawDistrictBar() {
    const el = document.getElementById('districtbar');
    el.innerHTML = DISTRICTS.map(d =>
      '<span class="dist ' + (d.owner === 'player' ? 'owned' : 'rival') + '">' + d.name + '</span>').join(' ');
  }

  // Live minimap: roads, districts, player arrow, cars, police, marker.
  drawMinimap(world) {
    if (!this.minimapVisible) { this.mm.style.display = 'none'; return; }
    this.mm.style.display = 'block';
    const g = this.mmCtx, S = 200, half = CITY_HALF + 20;
    const toMap = (x, z) => [((x + half) / (half * 2)) * S, ((z + half) / (half * 2)) * S];
    g.clearRect(0, 0, S, S);
    g.fillStyle = '#1c2b1a'; g.fillRect(0, 0, S, S);
    for (const d of DISTRICTS) {
      const [cx, cy] = toMap(d.cx, d.cz);
      g.beginPath(); g.arc(cx, cy, (d.r / (half * 2)) * S, 0, Math.PI * 2);
      g.fillStyle = d.owner === 'player' ? 'rgba(255,210,62,0.25)' : 'rgba(255,48,48,0.18)';
      g.fill();
    }
    g.strokeStyle = '#3a3a44'; g.lineWidth = 3;
    for (let c = -160; c <= 160; c += 40) {
      const [x1, y1] = toMap(c, -half), [x2, y2] = toMap(c, half);
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      const [x3, y3] = toMap(-half, c), [x4, y4] = toMap(half, c);
      g.beginPath(); g.moveTo(x3, y3); g.lineTo(x4, y4); g.stroke();
    }
    // Water strip at the bottom (south).
    g.fillStyle = '#2a7ab0'; g.fillRect(0, S - 8, S, 8);
    const dot = (x, z, color, r) => {
      const [mx, my] = toMap(x, z);
      g.fillStyle = color; g.beginPath(); g.arc(mx, my, r || 2.5, 0, Math.PI * 2); g.fill();
    };
    for (const c of world.traffic) dot(c.x, c.z, '#c8c8c8', 2);
    for (const p of world.police) dot(p.x, p.z, '#3060ff', 3.5);
    for (const p of world.peds) if (p.gang) dot(p.x, p.z, '#ff2020', 2.5);
    if (world.marker) {
      const [mx, my] = toMap(world.marker.x, world.marker.z);
      g.fillStyle = '#ffd23e';
      g.beginPath(); g.moveTo(mx, my - 7); g.lineTo(mx + 6, my + 5); g.lineTo(mx - 6, my + 5); g.closePath(); g.fill();
    }
    // Player arrow, rotated by heading.
    const [px, py] = toMap(world.player.x, world.player.z);
    g.save(); g.translate(px, py); g.rotate(Math.PI - world.player.heading);
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 6); g.lineTo(-5, 6); g.closePath(); g.fill();
    g.restore();
  }

  showScreen(html) { this.screens.innerHTML = html; this.screens.style.display = 'flex'; }
  hideScreens() { this.screens.style.display = 'none'; this.screens.innerHTML = ''; }
}
