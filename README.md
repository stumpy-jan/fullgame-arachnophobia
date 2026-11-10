# Arachnophobia (working title)

A top-down monster game in three.js: a giant mutant spider has broken out of its containment tank in an
underground lab. This is the first slice: the lab and the spider walking through it.

```sh
npm install
npm run dev        # http://localhost:5391
```

Controls: WASD / arrows move (screen-relative), Shift scuttles, Space or click impales (front legs on the move, front four standing still), P toggles the autopilot tour, 1 toggles the post pass, R restarts after death.

URL switches: `?auto` autopilot, `?autoattack` strike whenever possible, `?god` no damage, `?nopeople` empty lab, `?seed=N` replay a facility, `?lab` the hand-made lab, `?gym` an obstacle course with nobody in it (steps 0.4-3.2 m, walls, a tank, clutter; `world/gym.js`), `?spider=procedural|abdomen|carapace|both` which spider (the gym has buttons for these, V cycles; `?classic` = procedural), `?eye=x,y,z&look=x,y,z&hide` debug camera, `?cam=height,back` camera distance, `?at=x,z,heading` start position, `?nopost`.

## How it works

- `src/spider.js`: the spider is animated entirely in code, after legged-robot foothold planning rather than the
  usual game spider. Three-segment legs (femur to a high knee, tibia, a near-vertical metatarsus). A foot is only
  placed where the *whole leg* clears the world by a margin; candidates are the nominal spot, obstacle tops met
  marching out from the hip (inset from edges), the floor before a face, and spots either side. No valid spot:
  the leg hovers and the others carry the body. Planted legs are re-checked a moment ahead and step before they
  would clip; swings go up-across-down over obstacles and are checked mid-swing. Body height: above what's
  under it (with look-ahead) and the crests its legs reach over, below what planted legs can reach.
  The face: the upper half of a head scan (CREDITS.md), cut out, flattened, softened, its shut eyelids
  hollowed into sockets, set into the front of the carapace as a mask of its own chitin with two eyes.
- `src/world/`: the level, split so a procedural generator only has to produce data:
  - `layout.js`: a layout is plain data (bounds, typed rooms, wall centre lines, pieces `{ type, ...params }`,
    who spawns where, the spider's start). `makeLabLayout()` is the hand-made first lab.
  - `kit.js`: one builder per piece type (wall, column, bench, tank, rackRow, crateStack, drum, machine, lamp,
    beacon, tape, stencil ...). Builders make meshes and register what they occupy: flat-topped solids (what
    the spider stands on), bullet blockers, contact shadows. Dividing walls are an extruded concrete
    cross-section with closed ends; columns go at every wall end automatically.
  - `generate.js`: `makeFacility(seed)`, a generated facility in the same layout format (BSP rooms, doors on a
    spanning tree, depth from the start sets how full and guarded each room is). The default; `?lab` plays the
    hand-made lab instead. `node tools/plan.mjs <seed ...>` draws plans to shots/plan_<seed>.svg.
  - `world.js`: `buildWorld(scene, layout)` builds any layout and serves the queries: `heightAt` (a 10 cm
    height grid), `shotHit` (line of fire vs walls, columns and tall props, height-aware), `collide` (outer
    shell), `nav` (a 0.5 m walk grid for people), `roomAt`.
- `src/people/`: everyone who isn't the spider. `types.js` is data (scientists: harmless, wander, flee once the
  spider is within 22 m of walking distance or they hear shooting; soldiers in hazmat suits: close in, stop and
  fire bursts when they have a clear line within 26 m, back off when it's within 7 m). `pathmaps.js` builds
  Dijkstra maps on the world's walk grid (distance to the spider, and a flee map whose slopes lead round walls
  and through doors). `bodies.js` draws them as instanced procedural figures (no faces), animated in code.
  Bullets stop on concrete: `world.shotHit` is height-aware, so a wall hides the spider but the top of one doesn't.
- The goal: `kit.lock` pieces (a generator, bolt pumps) register as slash targets; each lock takes about 6 s
  of slashing, sparks on every blow and blows when done. When the last one goes the exit door (`kit.exitDoor`)
  sinks into the floor, daylight floods in, and walking out ends the run (ESCAPED). `node tools/goalcheck.mjs`
  plays that headless: tears down every lock, walks out, screenshots each step to shots/goal_*.png.
- `src/audio.js`: every sound is synthesised in Web Audio (footsteps, slash, impale, gunfire by distance, glass,
  metal, explosions, the door, quills) over a low facility hum and a far siren. It starts on the first key or click.
- `src/spill.js`: liquids on the floor, the whole level at once: a GPU texture (12.5 cm a texel) of blood,
  specimen fluid and oil, splatted into, flowing (excess over a thin film runs to neighbours; walls and props
  block it; a fixed floor bumpiness makes pools spread in lobes), drying to stains. The floor shaders read it.
- Gore: `people.sever` cuts a part off a sculpted rig (`rig.sever`: a stump shows) and throws a clone of it as a
  gib (`updateGibs`: bounces, bleeds, settles lying flat).
- `src/damage.js`: battle damage that stays: bullet holes (placed by marching the shot through the height field onto
  the real surface), casings, glass shards, scorch; all instanced ring buffers.
- The run's frame: `index.html` is black (a veil) from the first paint; `main.js` builds the level, compiles every
  shader (`compileAsync`) and draws behind it, then lifts it onto the title (the bay, slowly circled). `menu.js`: title,
  pause (Esc), settings, the end of a run with its summary. `settings.js`: volumes, post, shadows, resolution, shake,
  kept in the browser. `hud.js`: health, kills, locks; the slots as icons (`icons.js`) with keys, cooldown sweeps and
  tooltips; a prompt only when there's something to do (F to feed). `?play` skips the title.
- `src/fx.js`: soft particles sized in metres (sparks, dust, chips, smoke, blood, mist, fire, the spider's pink),
  rounds as streaks with smoke trails, swipe arcs, shockwave rings; drops that land go into the spill. Formerly: pooled tracers, muzzle flashes, sparks, ichor, blood and floor stains.
- The impale (`spider.strike`): each free leg rises over the nearest person in reach, stabs down (hit-stop,
  camera kick), carries them to the fangs and feeds (+8 health); then steps back down onto a foothold.
- `src/textures.js`: every texture is painted in code at load (concrete, wall panels, rack LEDs, screens,
  the spider's legs and veined abdomen).
- `src/post.js`: after Skyward's post pass: HDR scene, quarter/sixteenth-res Gaussian haze and bloom,
  vignette, ACES, a gradient map in colour-blend mode, grain, dither.

## Screenshots

`node tools/shot.mjs "<query>" <name> <t1,t2,...>` drives headless Edge against the dev server and saves
`shots/<name>_<t>.png` at those game times (the game steps a fixed 1/60 s with `?shot`, so they repeat).

## Leg clipping check

`node tools/clipcheck.mjs [seconds]` runs the autopilot headless and reports the share of frames in which any
leg segment or the body is inside an obstacle (and by how much, and whether a planted, swinging or hovering leg
or the body caused it). Before the foothold rework: 25% of frames. After: about 1%, in brief blips.
