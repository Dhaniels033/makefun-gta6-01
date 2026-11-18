// SOLMAR BAY — main.js
// Boot: build the game, honour ?selftest=1 and ?shot=<name> from the URL,
// and expose the game for the headless playtest.
import { SolmarGame } from './game.js';

const game = new SolmarGame();
game.init();
window.__game = game;

const params = new URLSearchParams(location.search);
const shot = params.get('shot');
const selftest = params.get('selftest');
if (selftest === '1') {
  game.startSelftest();
} else if (shot) {
  game.applyShotMode(shot);
}
