# Handoff: Arachnophobia

For an agent picking this project up on a new machine. Read this first, then `Design/DESIGN.md` (what the game is
and every design decision) and `README.md` (how the code works, file by file). `assets/pilot/README.md` has the AI
art pipeline and what was learned making each asset.

## What it is, where it stands

A top-down roguelike in three.js. You are a giant mutant spider breaking out of a secret lab: smash out of your
tank, tear down 2-3 lock machines, and escape through the security door into daylight. About 15-minute runs,
pure roguelike, a new procedurally generated facility every run.

Playable end to end: title, a run, pause/settings, death or escape with a summary. Built:

- **The spider**: fully procedural animation, IK legs with foothold planning that steps over walls and props,
  body-height constraints, strikes, leaps; swappable AI-made body parts (`?spider=procedural|abdomen|carapace|both`).
- **The facility**: generated from a seed (`src/world/generate.js`): 20-26 rooms, doors, a start bay on the south
  wall, the exit on the north. The first rooms are empty, then sparse, then furnished and guarded.
- **People**: scientists (flee, alert people nearby) and soldiers in hazmat suits (shoot; concrete stops bullets),
  sculpted procedural rigs, batched.
- **Combat**: an automatic slash (one kills a scientist, two a soldier), killing blows tear bodies apart, feeding.
- **Mutations**: one per body slot, picked from 3 at specimen vats: Devour (Q), Pounce or Scythes (E), Rear quills.
- **Look**: post pass, pooled lights, a GPU liquid simulation across the floor (blood, vat fluid, oil), gore,
  battle damage (bullet holes, casings, glass, scorch), VFX for every action, synthesised sound.

Not built yet, in the order the user and I discussed: more mutations (only Maw, Forelegs and Abdomen have any;
Carapace, Hind legs and Glands have none), upgrades once all six slots are full (vats just heal for now), an
enemy ramp later in a run (riot shields, flamethrowers, turrets/drones, walker mechs), the third lock type.

## Get it running on a new machine

1. **Node** 20 or newer, then `npm install`, then `npm run dev`. Vite serves on **port 5391** (`vite.config.js`).
   Open http://localhost:5391/.
2. **A Chromium browser for the tools**: the headless tools use Edge at
   `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe` (some fall back to Chrome). On another OS, change
   `executablePath` in `tools/*.mjs`.
3. Everything the game needs is in the repo: textures (`public/textures`, Poly Haven CC0), the KTX2 transcoder
   (`public/basis`), the head scan (`public/models/LeePerrySmith.glb`, CC BY: `CREDITS.md`), every AI model
   (`public/models/props`). Only the asset pipeline needs more (below).

## Map of the code

| | |
|---|---|
| `src/main.js` | Boots everything, the run's frame (title/play/pause/over), input, camera, the main loop, events. URL switches at the top |
| `src/spider.js` | The spider: build (parts, sockets), foothold planning, IK and the knee swing that keeps legs out of the body, strikes, `joints()` |
| `src/mutations.js` | Mutations as data: slot, part, power or auto, cooldown. Quills |
| `src/world/` | `layout.js` (the hand-made lab and the layout format), `generate.js` (generated facilities), `gym.js`, `kit.js` (one builder per piece type), `world.js` (builds a layout; height field, collision, line of fire, walk grid, pooled lights), `floors.js`, `models.js` (AI model loading and fitting) |
| `src/people/` | `people.js` (behaviour, shooting, gore), `sculpted.js` (the rigs, severable parts, AI gear), `rigs.js` (instanced batching), `pathmaps.js` (Dijkstra maps), `types.js` |
| `src/fx.js` | Particles (metre-sized), shot streaks and smoke trails, swipes, rings |
| `src/spill.js` | The liquids on the floor: GPU sim, floor shader patch |
| `src/damage.js` | Bullet holes, casings, glass, scorch |
| `src/hud.js`, `src/menu.js`, `src/settings.js`, `src/icons.js` | HUD, screens, settings (kept in the browser), SVG icons |
| `src/audio.js` | Synthesised sound (Web Audio), buses for the volume settings |
| `src/post.js` | The post pass (HDR, bloom/haze, ACES, colour grade that leaves strong reds alone, grain) |
| `zoo.html`, `src/zoo/` | The people and AI props side by side for review |

## URL switches (the useful ones)

`?seed=N` replay a facility · `?lab` the hand-made lab · `?gym` an empty obstacle course with a spider-version
picker (V) · `?spider=procedural|abdomen|carapace|both` · `?mut=devour,quills,scythes,pounce` start with mutations
· `?play` skip the title · `?god` no damage · `?nopeople` · `?auto` autopilot tour (`?dev` for P to toggle) ·
`?at=x,z,heading` start position · `?eye=x,y,z&look=x,y,z` fixed debug camera · `?shot` fixed time step, no HUD
(captures) · `?nopost` · `?nogear` procedural soldier gear · `?noavoid` legs may pass through the body ·
`?measure`, `?bodycheck` per-frame measurements for the tools.

## Checking a change (do this before every commit)

The dev server must be running. All headless, all print numbers; send the user screenshots.

- `node tools/goalcheck.mjs`: a full run on seed 1 (tear down every lock, walk out). Must end `ESCAPED`.
- `node tools/clipcheck.mjs 60 "seed=1"`: legs clipping into the world on the autopilot tour (~3% is normal).
- `node tools/attachcheck.mjs 25`: every body part attached to its host, and legs-in-body, for each spider version
  and mutation set. Must print **all joints attached**. (See "The attachment rule".)
- `node tools/plan.mjs <seed ...>` then `node tools/_svg2png.mjs shots/plan_<seed>.svg`: a 2D plan of a facility.
- `node tools/_probe.mjs "<query>" shots/x.png <game seconds> "<js>"`: a screenshot at a game time, optionally
  evaluating JS first (e.g. `setInterval(()=>{game.spider.heading=0},4)` to pin the spider's facing for a portrait).
- `node tools/_fps.mjs "<query>"`: frame times (about 3-5 ms on the dev machine).
- Others in `tools/`: `_gore.mjs`, `_gore2.mjs` (staged kills, close camera), `_vat.mjs`, `_battle.mjs`,
  `_menus.mjs` (title, play, pause, settings, death), `_powers.mjs`, `_reap.mjs`, `shot.mjs` (`PAGE=zoo.html` for the zoo).

`window.game` exposes the spider, world, people, fx, spill, damage, state, mutations, camera.

## The attachment rule

The spider changes with every mutation and with the AI body parts, so nothing sits at fixed numbers. Sockets
(`spider.mounts`) are measured from the body actually built (the thorax or AI shell; the face mask, seated on it
when it loads; the mouth at the mask's chin). AI parts anchor at their root (`aiPart`/`mutationPart` take an
anchor). `spider.joints()` lists what every part hangs from. After the IK each knee swings round its hip-ankle
line until the leg clears every body part. `tools/attachcheck.mjs` must pass for every version and mutation.

## The AI art pipeline (only for making new assets)

Concept images and meshes come from the team's Modal app `assetgen`; finishing is Blender plus the team's
`game-dev-infrastructure` repo.

1. Python 3.12 with `pip install modal pillow`, then `modal token new` in the team's Modal workspace.
2. Blender 5.3 (the scripts expect `C:/Program Files/Blender Foundation/Blender 5.3/blender.exe`).
3. Clone `Third-Moment-HQ/game-dev-infrastructure` next to this repo (the finish script is
   `common/ai_assets/blender_finish.py`).
4. The native **gltfpack** (meshoptimizer releases, a build with BasisU) into `tools/bin/gltfpack.exe`; the npm one
   can't write KTX2.

Steps per asset (`assets/pilot/<name>/asset.json` holds the brief and finish settings):
`python tools/assetgen.py images <name> --seed N` → pick → `python tools/assetgen.py mesh <name>=img_X.png` →
render the raw mesh from every side (meshes come back with open or hollow hidden sides) →
`blender -b -P <infra>/common/ai_assets/blender_finish.py -- <asset folder> prepare`, then `look` →
`node tools/props.mjs <name>` (to `public/models/props`) → a `FIT` entry in `src/world/models.js` → use it.
Learnings (what prompts work, what fails) are in `assets/pilot/README.md`.

## Working with the user

- They make the design calls and like to see screenshots of everything; ask when a choice is theirs, otherwise
  pick and say so. Keep answers short.
- Commit locally as you go (clear messages: what changed, why, how it was checked). Push only when asked.
- The work was split into two sessions: gameplay (`src/` except the AI-part code) and art (`assets/pilot`,
  `public/models`, the pipeline tools, the zoo, `aiPart`/`mutationPart` placement). The art session worked on
  branch `art/carapace-gear` in a worktree and sent hookups; gameplay merged them **only with the user's own
  go-ahead**. On one machine, one agent can do both.
- Windows notes: the bash tool chokes on heredocs with mixed quotes; write scripts to a file and run them with
  node. Git may turn files to CRLF after merges; normalise before exact-text edits.

## Gotchas

- `?shot` runs a fixed 1/60 s step per frame, so game time can run ahead of real time: wait on `game.time`, not
  on timeouts.
- Without `?shot`/`?play`/`?auto`/`?gym` the game starts on the title, where the world (and `game.time`) holds.
- An idle spider turns to face the mouse ray's floor hit; pin `game.spider.heading` for portrait shots.
- The spider's body rides about 2.3 m up; aim debug cameras at y ~2.
- `?nopeople` also disables the slash and the powers (they need people).
- Lights are pooled (12 spots follow the spider); a far overview camera sees darkness. Use `tools/plan.mjs`.

## Where we left off

- On `main`, pushed: everything above.
- **Rejected heads**: the user turned down both alternatives to the face mask: a porcelain mask (`art/porcelain-head`) and
  a spider's eight glowing eyes (`0c710ea`). Both are local branches on the old machine. Don't bring either back; the
  scan-based face mask stays.
- Known rough edges: a rare frame where a rear femur goes into the swaying abdomen (up to ~35 cm); the AI lab
  trolley's lower frame is broken (a mesh flaw); the pink spider blood and the pounce ring may be too bright; the
  painted lab floor still shows a faint repeat.
- Open design questions (Design/DESIGN.md): confirm facing (movement direction while moving, mouse when slow), key
  layout for the six slots, mechs as the top enemy tier.
