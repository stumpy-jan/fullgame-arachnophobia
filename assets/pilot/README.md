# Pilot: AI asset pipeline

Briefs for six pilot assets in the format of `Third-Moment-HQ/game-dev-infrastructure/common/ai_assets` (hero_asset.py).
Run each folder through the steps there (concept, pick, mesh, preview, finish, compress); the KTX2 `.glb` goes to
`public/models/props/`, and each becomes a kit piece in `src/world/kit.js` (props) or a part on the procedural skeleton in
`src/people/sculpted.js` (hood, rifle).

Budgets are in each `asset.json` (notes): the gameplay camera sees about 4 cm per pixel, so low triangle counts and 1K maps.
