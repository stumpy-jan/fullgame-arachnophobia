# Pilot: AI asset pipeline

Briefs for six pilot assets in the format of `Third-Moment-HQ/game-dev-infrastructure/common/ai_assets` (hero_asset.py).
Run each folder through the steps there (concept, pick, mesh, preview, finish, compress); the KTX2 `.glb` goes to
`public/models/props/`, and each becomes a kit piece in `src/world/kit.js` (props) or a part on the procedural skeleton in
`src/people/sculpted.js` (hood, rifle).

Budgets are in each `asset.json` (notes): the gameplay camera sees about 4 cm per pixel, so low triangle counts and 1K maps.

## Spider parts (second pilot)

Rigid parts for the procedural spider (`SPIDER_PARTS` in `src/spider.js`, fitted by `aiPart` to the box the
procedural part filled, under the spider's own satin material). What we learned:

- Say "spider" and the image model paints a whole spider, whatever else the prompt says. Describe the part as an
  object of its own: "a crab carapace shell coloured like a tarantula", "an egg-shaped segmented sac sculpture".
- Leg segments come out as lobster tails (animal words) or turned furniture (abstract words). At the gameplay
  camera a leg is about 5 px thick, so the procedural lathed legs stay.
- The mesher invents the side the image doesn't show, and sometimes leaves it open: two of three abdomen meshes
  had a hollow front end. Render every raw mesh from all sides (front, back, both flanks) before finishing.
- Spines and bristles widen the bounding box, so `aiPart` fits the 3rd to 97th percentile of the vertices.
- In use: the abdomen (`img_33_3`) and the carapace v2 (`img_77_0`, painted from straight above). `?spider=procedural|abdomen|carapace` for the others.

## Carapace v2 (top-down)

- Paint parts from the angle the game sees them. "Top-down photograph looking straight down ... orthographic top view"
  works: all 8 concepts came out from above. The v1 three-quarter concepts were lacquered black with orange flecks,
  which read as glassy amber in game.
- Colour and finish words matter more than the subject: "warm dark chocolate brown ... matte satin chitin covered in
  dense short velvety hair, no gloss, no shine, no translucency, no lacquer" took it from amber glass to brown chitin
  that matches the face mask. The look's `roughness` went from 0.42 to 0.65 as well.
- The mesher puts a top-down image upright, its dome facing +z and the image's top at +y. In the body frame that is
  `PART_TURN [-PI/2, 0, PI]` (the Z half-turn brings the image's top, the front, to +z).
- The mesher invents a pale belly for a shell seen only from above. It closes it (no holes on any of the three), but
  the pale colour shows as a thin rim at the edge.
- `tools/rawsides.py` renders a raw mesh from six sides (front, back, both flanks, top, under) on magenta with
  backface culling, so open sides show as holes: `blender -b -P tools/rawsides.py -- <raw.glb>` writes `<raw>_sides.png`.
- In use behind `?spider=carapace|both`: `img_77_0` (of `img_61_2`, `img_77_0`, `img_77_2`; `77_2` grew claws at the
  sides, `61_2` came out thin, with leg stubs).

## Soldier gear (hood v2, air tank, rifle)

Rigid parts for the sculpted soldier, worn in `src/people/sculpted.js` (`GEAR`: model, bone-local centre, turn, colour
scale): the hood on the head bone, the tank on the chest bone, the rifle in the gun group (the flash and laser move to its
muzzle). Each is counter-scaled for the body's scale and placed by its centre. They're used once loaded
(`loadModels(renderer, [...GEAR_MODELS])`), else the procedural parts stay; `sculpted(type, { gear: false })` keeps them
too. Clones share geometry and materials, so `RigRenderer` batches them: one draw per part for every soldier. Before
and after in the zoo: `zoo.html?stage=3&view=gear` (`&turn=` for the heading). The rifle is darkened (colour 0.4): in
the lab's light its baked metal read silver.

- Hood v2 (`img_61_0`): "covers only the head ... ending in a short gathered ruff at the neck, no shoulders". v1 had
  shoulders, which would clip when the head turns. 2,000 tris. Two colour zones (yellow fabric first, so a missed
  face falls back to it, then the black mask) and no raw texture colour.
- Air tank (`img_61_0`): a cylinder on a back frame with straps. 1,500 tris (at 800 the straps shattered into shards).
- Rifle: the pilot's (`img_21_0`) was already closed on all sides and at 1,497 tris.
- **Bake big, cut later.** Finishing straight to 2k/800 faces left black patches and shattered thin parts: the
  low-poly drifts further from the raw mesh than the bake rays reach. Finish at `"faces": 8000`, then
  `blender -b -P tools/decimate.py -- assets/pilot/<asset> <tris>` writes `<asset>_clean.glb`, which `props.mjs` packs.
- **Thin shells** (hood, straps): `"thicken_m"` and a short `"shrinkwrap_reach"` (0.002 for the hood, 0.006 for the
  tank). With the default reach the shrinkwrap folds low-poly faces inside out, and they render as black specks.
- gltfpack can't simplify across the finish's UV seams (it stops near 6k), and `-sa` drags colour across them (the
  yellow hood came out camo). Blender's collapse decimate keeps the seams.

## The face mask

The face (`maskFromHead` in `src/spider.js`, cut from the head scan) was a one-sided surface. The gameplay camera looks
down past it from behind, so its back faces were culled and the floor showed through between the chelicerae. It's
now closed into a solid: a flat back behind the face and a rim stitched round its cut edge. The back and rim get
projected UVs, because the scan's UVs stretch into streaks down the rim.
