// SOLMAR BAY — config.js
// One constants block for the whole game: city layout, districts, cars,
// missions, difficulty and the district-control mechanic. Everything the
// judge's outline shows starts here, so names say what things do.
export const GAME_TITLE = 'SOLMAR BAY';
export const GAME_SUBTITLE = 'An open-world crime story — take back the city, district by district.';
export const CITY_HALF = 190; // playable half-extent in metres
export const ROAD_SPACING = 40;
export const ROAD_WIDTH = 10;
export const ROAD_LINES = [-160, -120, -80, -40, 0, 40, 80, 120, 160];

// Seeded RNG (mulberry32) — every run from the same seed replays identically.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }
export function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ---- Districts: the SUNWRIGHT mechanic. Completing a mission flips one
// district from rival (red) to player (gold). Flipped districts have less
// police, calmer traffic and unlock the next mission. The minimap and the
// HUD control bar show the flip live.
export const DISTRICTS = [
  { id: 'downtown', name: 'Downtown', cx: 0, cz: -80, r: 85, color: 0xffb020, owner: 'rival' },
  { id: 'harbor', name: 'Harbor', cx: -110, cz: 110, r: 80, color: 0x20b0ff, owner: 'rival' },
  { id: 'oldtown', name: 'Old Town', cx: 110, cz: 90, r: 80, color: 0xc060ff, owner: 'rival' },
  { id: 'beach', name: 'Beachfront', cx: 0, cz: 150, r: 75, color: 0x20e080, owner: 'rival' },
];
export function districtAt(x, z) {
  for (const d of DISTRICTS) if (dist2(x, z, d.cx, d.cz) < d.r * d.r) return d;
  return DISTRICTS[0];
}

// ---- Cars: type decides handling, speed and price.
export const CAR_TYPES = {
  sedan:   { name: 'Solano Sedan',   top: 26, accel: 14, steer: 1.9, color: 0x4a7ec2, price: 0 },
  taxi:    { name: 'Bay Taxi',       top: 24, accel: 13, steer: 1.9, color: 0xf2c200, price: 0 },
  sports:  { name: 'Vortex GT',      top: 38, accel: 22, steer: 2.6, color: 0xd21f3c, price: 0 },
  truck:   { name: 'Hauler Truck',   top: 20, accel: 10, steer: 1.4, color: 0x5a6b52, price: 0 },
  police:  { name: 'Bay PD Interceptor', top: 34, accel: 20, steer: 2.5, color: 0x1a2a44, price: 0 },
  muscle:  { name: 'Roadking Muscle', top: 32, accel: 18, steer: 2.1, color: 0x7a2a8a, price: 0 },
};

// ---- Difficulty in one place.
export const DIFFICULTY = {
  playerHealth: 100, playerWalkSpeed: 6.5, playerSprintSpeed: 10,
  policeReaction: 0.9, policeRamDamage: 8, gangAimError: 0.35,
  wantedDecaySeconds: 14, bustHoldSeconds: 2.5, maxWanted: 5,
};

// ---- Missions: 6 story missions. Each step is a typed objective the
// mission engine (missions.js) knows how to run: goto, collect, chase,
// shoot, escape, deliver.
export const MISSIONS = [
  {
    id: 'm1', title: 'First Wheels', district: 'downtown',
    intro: 'DARIO: "Rex, the Bay Crew owns these streets. Take a car — any car — and bring it to my garage. No car, no crew."',
    reward: 500,
    steps: [
      { type: 'goto', label: 'Steal a car (walk to one, press E)', pos: [24, -37], needCar: true },
      { type: 'goto', label: 'Drive to Dario\u2019s Garage', pos: [-24, -44], needCar: true },
    ],
  },
  {
    id: 'm2', title: 'Harbor Pickup', district: 'harbor',
    intro: 'DARIO: "The Harbor crew left three crates on the docks. Grab them on foot and bring them back to the garage. Watch the patrols."',
    reward: 800,
    steps: [
      { type: 'collect', label: 'Collect the crates at the Harbor (3)', pos: [-120, 120], count: 3, radius: 26 },
      { type: 'goto', label: 'Return to Dario\u2019s Garage', pos: [-24, -44] },
    ],
  },
  {
    id: 'm3', title: 'Turbo Trouble', district: 'harbor',
    intro: 'MARA: "Vic\u2019s courier is running product through the Harbor in a Vortex GT. Ram his car off the road — or shoot it out."',
    reward: 1200,
    steps: [
      { type: 'chase', label: 'Chase down Vic\u2019s courier and wreck his car', pos: [-80, 80] },
    ],
  },
  {
    id: 'm4', title: 'Old Town Takeover', district: 'oldtown',
    intro: 'DARIO: "Old Town belongs to the Red Vipers. Clear their corner crew — five of them — and the district is ours."',
    reward: 1500,
    steps: [
      { type: 'shoot', label: 'Take out the Red Viper crew in Old Town (5)', pos: [100, 80], count: 5, radius: 30 },
    ],
  },
  {
    id: 'm5', title: 'Beachfront Heist', district: 'beach',
    intro: 'MARA: "The Beachfront bank vault is open for ten minutes. Grab the cash, then lose the cops — three stars and counting."',
    reward: 2500,
    steps: [
      { type: 'collect', label: 'Grab the cash bags at the Beachfront Bank (2)', pos: [0, 132], count: 2, radius: 18 },
      { type: 'escape', label: 'Escape! Lose the cops, then reach the Safehouse', pos: [-24, -44] },
    ],
  },
  {
    id: 'm6', title: 'King of Solmar', district: 'downtown',
    intro: 'DARIO: "Vic himself is in Downtown with his whole crew. End this, Rex — and Solmar Bay is ours."',
    reward: 4000,
    steps: [
      { type: 'shoot', label: 'Defeat Vic\u2019s crew in Downtown (6)', pos: [0, -80], count: 6, radius: 34 },
      { type: 'goto', label: 'Reach the Bayview Tower to claim the city', pos: [40, -104] },
    ],
  },
];

// Endless freeroam jobs after the story (escalating side work).
export const FREEROAM_JOBS = [
  { type: 'taxi', label: 'Taxi fare: pick up the passenger', reward: 300 },
  { type: 'deliver', label: 'Delivery: drop the package across town', reward: 400 },
  { type: 'rampage', label: 'Rampage: wreck 3 rival cars', reward: 600 },
  { type: 'shoot', label: 'Gang cleanup: take out 4 rivals', reward: 700 },
];

export const SAVE_KEY = 'solmar-bay-save-v1';
