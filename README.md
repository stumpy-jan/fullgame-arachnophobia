# Arachnophobia (working title)

A top-down monster game in three.js: a giant mutant spider has broken out of its containment tank in an
underground lab. This is the first slice: the lab and the spider walking through it.

```sh
npm install
npm run dev        # http://localhost:5391
```

Controls: WASD / arrows move (screen-relative), Shift scuttles, P toggles the autopilot tour, 1 toggles the post pass.

URL switches: `?auto` autopilot, `?cam=height,back` camera distance, `?at=x,z,heading` start position, `?nopost`.

## How it works

- `src/spider.js`: the spider is animated entirely in code, after legged-robot foothold planning rather than the
  usual game spider. Three-segment legs (femur to a high knee, tibia, a near-vertical metatarsus). A foot is only
  placed where the *whole leg* clears the world by a margin; candidates are the nominal spot, obstacle tops met
  marching out from the hip (inset from edges), the floor before a face, and spots either side. No valid spot:
  the leg hovers and the others carry the body. Planted legs are re-checked a moment ahead and step before they
  would clip; swings go up-across-down over obstacles and are checked mid-swing. Body height: above what's
  under it (with look-ahead) and the crests its legs reach over, below what planted legs can reach.
- `src/world/`: the level, split so a procedural generator only has to produce data:
  - `layout.js`: a layout is plain data (bounds, typed rooms, wall centre lines, pieces `{ type, ...params }`,
    who spawns where, the spider's start). `makeLabLayout()` is the hand-made first lab.
  - `kit.js`: one builder per piece type (wall, column, bench, tank, rackRow, crateStack, drum, machine, lamp,
    beacon, tape, stencil ...). Builders make meshes and register what they occupy: flat-topped solids (what
    the spider stands on), bullet blockers, contact shadows. Dividing walls are an extruded concrete
    cross-section with closed ends; columns go at every wall end automatically.
  - `world.js`: `buildWorld(scene, layout)` builds any layout and serves the queries: `heightAt` (a 10 cm
    height grid), `shotHit` (line of fire vs walls, columns and tall props, height-aware), `collide` (outer
    shell), `nav` (a 0.5 m walk grid for people), `roomAt`.
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
