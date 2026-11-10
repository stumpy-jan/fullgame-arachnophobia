# Arachnophobia: design

A top-down roguelike. You are a giant mutant spider escaping the secret facility that bred it. Each run starts
with you breaking out of a glass tank and ends when you break open the main security door and slip out into the
light. Decisions so far, with the open questions at the end.

## The run

- **About 15 minutes.** A seeded, procedurally generated facility of roughly 12–15 rooms (layout data, see
  `src/world/layout.js`), so 6–8 specimen vats and 6–8 mutations a run.
- **Pure roguelike.** Death ends the run; nothing carries over (for now).
- **Start:** a containment bay, your shattered tank. **Goal:** destroy the **2–3 lock machines** (randomly
  chosen kinds, in any order), which unseals the security door; break through it.
- **Generation:** rooms in a graph of typed rooms behind concrete dividing walls; the exit as far from the start
  as walking goes; lock machines in separate, well-defended rooms; vats spread, more of them off the main path.
  **Built** (`src/world/generate.js`, a new seed every run, `?seed=N` to replay): a 132 x 96 m site (about 4.5x
  the first lab) split into 20-26 rooms, 8 m doors on a spanning tree plus loops, start on the south wall, exit
  on the north wall 6-10 doors away. **The first rooms are empty**: the start bay and its neighbours have no
  furniture and nobody in them, the next ring is sparse with a few scientists, then rooms are furnished and
  soldiers appear, more of them deeper; lock rooms and the exit are guarded.

## Locks (2–3 per run)

Big machines you stand on or beside to tear apart (uses the climbing):
- **Hydraulic bolt pumps**: pistons and gauges; spill their fluid when destroyed.
- **Power generator**: electrifies the door; arcs make the floor around it dangerous.
- **Security core**: server towers with a shield that drops while its technicians are dead.

Built (first lab): the generator and the bolt pumps, both taken down by the slash (~6 s each, under fire).
When the last falls, the exit door sinks into the floor and daylight pours in; walking out wins the run.

## Controls and combat

- **Positioning first.** WASD moves; the body faces where it's going, and when slow or still, the mouse.
- **The autoattack is a slash** with the front legs in a front arc (~120°). Legs that walk can't slash:
  standing still, the front four slash; walking, the front pair; sprinting, none. Running repositions,
  standing your ground kills.
- **Triggered powers** come from mutations, on **fixed keys per slot** (Maw, Forelegs, Carapace ...),
  cooldowns 4–15 s.
- **Health:** slow regeneration while not taking damage, fast while eating.
- **Feeding:** stand over a corpse and hold a key to feed (fast heal, defenceless). Devour is the fast, safe
  version.

## Mutations: one per body slot

The body is built from **six swappable slots**, each a part made in code:

| Slot | Part | Arc |
|---|---|---|
| Maw | fangs / face mask | front, close |
| Forelegs | front two leg pairs | front |
| Carapace | back of the thorax | all round |
| Abdomen | abdomen | rear |
| Hind legs | back two leg pairs | movement |
| Glands | spinnerets / underside | trail |

- A vat offers **3 mutations for 3 different, still-empty slots**; pick one. A filled slot is never offered
  again.
- **Once all six are filled**, vats offer small improvements to mutations you have instead.
- Every mutation changes how the spider looks (its slot's part is swapped) and what it can do.

**First three to build:** **Devour** (Maw, triggered, 8 s: grab the nearest person, eat, fast heal),
**Rear quills** (Abdomen, auto: spines at anyone behind you), **Pounce** (Forelegs, triggered, 10 s: leap onto a
spot, stun everyone there). **Built since:** **Scythes** (Forelegs, triggered, 6 s: reap, a 220-degree sweep out to
6 m that cuts down everyone it reaches, walls permitting; passively the slash kills soldiers in one). The
mutation parts are AI-made (mandibles, quill ridge, scythes; the art session), procedural until they load.

**The wider list** (proposed): Maw: Screech, Acid spit. Forelegs: Scythes, Hooked claws. Carapace: Armour
plates (less damage from the front), Shock ridge, Quill volley. Abdomen: Brood sac, Gas bladder. Hind legs:
Sprinter, Leaper. Glands: Acid trail, Web trail.

## People and enemies

- **Scientists** (white coats): harmless; work, flee, and **alert units nearby**. There is no global alarm:
  part of the game is stealth, coming over a wall into a section that doesn't expect you. Panic shouldn't
  spread easily.
- **Soldiers** (yellow hazmat suits): close in, fire bursts with a clear line; **concrete walls stop
  bullets** (height-aware: on top of a wall you're exposed).
- **Later in a run** (proposed): riot shields (block frontal slashes, so flank them), flamethrowers (fire on
  the floor), turrets and flying drones (fly over walls), and **walker mechs** built on the spider's own leg
  system (minigun: hide behind walls; rockets: telegraphed).

## Look and feel

- Destructibility: glass (tanks, screens, windows) shatters as you push through; vats spill.
- Battle damage accumulates: bullet holes and scorch marks on walls, spent casings on the floor.
- Killing people dismembers them into bloody pieces; a floor-wide liquid spill system for blood, fluids and
  drag trails. **Built:** a heavy killing blow (the slash, a pounce) takes off a head, an arm or a leg (a wet
  stump left, the part flying, bouncing and bleeding where it lands). Liquids are simulated over the whole floor
  (`src/spill.js`): blood, the vats' pink specimen fluid (also the spider's own blood) and hydraulic oil spread
  round props and stop at walls; blood dries to a dark stain. Sources: spatter from every wound, corpses
  bleeding out into pools, drips from someone being carried, broken vats, wrecked locks (oil). The spider prints
  footprints after stepping in a pool. **Battle damage built** (`src/damage.js`): bullet holes chipped into whatever concrete stops a shot (misses fly on into the wall behind), brass casings piling up round the soldiers, glass bursting out of smashed vats (and lying round the start tank), soot burnt into the floor where a lock blows.
- The monster doesn't grow much: it changes through its mutations (modular, swappable parts).

## Feel (built)

- One slash kills a scientist, two a soldier; a killing blow tears the body apart (two to four parts fly, the rest
  is thrown along the blow and lands in its own blood). Blood is vivid red (exempt from the colour grade).
- Everything that happens shows from 34 m up: rounds are streaks with smoke trails, concrete throws dust and chips,
  hits spurt blood (the spider bleeds pink), the slash leaves a pale arc, quills leave a trail, the pounce a
  shockwave, a lock blows in fire and black smoke.
- A run is framed: a loading veil (nothing pops in), the title over the start bay, pause and settings, a summary
  at the end. The HUD is quiet: icons for the slots (tooltips), a prompt only when there's something to do.

## Open questions

- Facing: confirm "movement direction while moving, mouse when slow".
- Key layout for the six slots (only slots with triggered powers need one).
- Which lock kinds first (two of the three above).
- Late enemies: confirm mechs on the spider's leg system as the top tier.
