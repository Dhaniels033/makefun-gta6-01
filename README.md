# SOLMAR BAY

An original open-world crime game in the spirit of GTA 6, built for the make.fun gta6-01 bounty: a 400×400 m coastal city to explore on foot and by car, with traffic AI, pedestrians, car theft, a 1–5 star wanted system with police chases and roadblocks, 6 story missions, a district-control mechanic that flips rival districts to the player's gold, combat, a live minimap HUD, day/night cycle, synthesized sound, and a start screen with save/load. No Rockstar Games names, characters, maps or assets — the city, story, vehicles and art are all original.

[![gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun)
[![rank](https://make.fun/badge/gta6-01/Dhaniels033/makefun-gta6-01/rank.svg)](https://make.fun)
[![reward](https://make.fun/badge/gta6-01/Dhaniels033/makefun-gta6-01/reward.svg)](https://make.fun)

## How it was made

`game/` is a static three.js game (vendored as `game/vendor/three.module.min.js`) with its own city, traffic, pedestrian, police, mission and audio systems in `game/src/`. `main.ts` (Node standard library only) copies `game/` and `screenshots/` to the output directory and writes `dossier.json` with the kit's vendored `makefun-game.ts` library. The four screenshots in `screenshots/` are real renders of the game in headless Chromium. It was play-tested headlessly with `tools/playtest.mjs` (16/16 checks, 0 console errors).

Play it: `node serve.ts`, then open http://localhost:8080.

Run the hand-in: `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts`

See the competition at [make.fun](https://make.fun).
