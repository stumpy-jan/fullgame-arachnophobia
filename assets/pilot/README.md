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
- In use: the abdomen (`img_33_3`). The carapace (`img_45_3`, `?carapace`) still reads glassy next to the face mask.

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
