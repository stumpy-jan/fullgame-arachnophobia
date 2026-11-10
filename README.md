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
- `src/lab.js`: the floor plan, flat-topped props, lights. Everything walkable is a flat-topped box or
  cylinder, rasterised into a 10 cm height grid, so `heightAt(x, z)` is a lookup. Partition walls are 1.2 m thick and walkable: feet plant on them and the body rises over them (it samples the ground ahead, so it lifts before it gets there). Only the outer shell holds it in.
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
