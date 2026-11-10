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

- `src/spider.js`: the spider is animated entirely in code. Eight two-bone IK legs; each foot stays planted
  until it lags too far behind its rest spot, then steps in an arc that clears whatever is in between. A leg
  only lifts while its neighbours are down (wave gait). The body rides above its feet, tilts with them,
  bobs on footfalls; the abdomen hangs off a spring.
- `src/lab.js`: the floor plan, flat-topped props, lights. Everything walkable is a flat-topped box or
  cylinder, so `heightAt(x, z)` is the highest top under a point. Partition walls are 1.2 m thick and walkable: feet plant on them and the body rises over them (it samples the ground ahead, so it lifts before it gets there). Only the outer shell holds it in.
- `src/textures.js`: every texture is painted in code at load (concrete, wall panels, rack LEDs, screens,
  the spider's legs and veined abdomen).
- `src/post.js`: after Skyward's post pass: HDR scene, quarter/sixteenth-res Gaussian haze and bloom,
  vignette, ACES, a gradient map in colour-blend mode, grain, dither.

## Screenshots

`node tools/shot.mjs "<query>" <name> <t1,t2,...>` drives headless Edge against the dev server and saves
`shots/<name>_<t>.png` at those game times (the game steps a fixed 1/60 s with `?shot`, so they repeat).
