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
