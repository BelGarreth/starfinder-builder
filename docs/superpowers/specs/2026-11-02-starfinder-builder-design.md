# Starfinder Builder: design

Date: 2026-11-02

## Intent

A Starfinder 1e character builder for players making a new PC. It's a static site in a new
`BelGarreth/starfinder-builder` repo on GitHub Pages, sitting next to `gestalt-calculator`,
`DDC-char-sheet` and `grimoire-ledger`. It's separate from `starfinder-dm` and shares no code
or data with it.

A player should come away with three things: a printable sheet, a saved file they can load
later to level up, and the final numbers.

## Goals

- Build a legal Starfinder 1e PC: race, theme, class levels (multiclass included), point-buy
  abilities, skills, feats, class feature choices, spells, and starting gear.
- Block illegal choices. Options that aren't allowed still show, greyed out, with the reason
  (for example "Requires Dex 15" or "Max 3 ranks at level 3"). A blocker bar lists everything
  still unspent or missing.
- Level up a saved character: add a class level, make that level's choices, and apply the
  ability increases at levels 5, 10, 15 and 20.
- Autosave to localStorage, JSON export/import, and a print view.
- Link every race, theme, class, feat, feature, spell and item to its AoN page.

## Non-goals

- AoN's "Other Species" (130 of them). Races are limited to the 13 Core and Core Legacy
  species: Android, Human, Kasatha, Lashunta, Shirren, Vesk, Ysoki, Dwarf, Elf, Gnome,
  Half-Elf, Halfling, Half-Orc.
- Starfinder 2e.
- Play-time tracking: current HP/SP/RP, conditions, buffs, ammo. grimoire-ledger tracks
  those; this tool builds and levels.
- Starships, vehicles, creature companions other than the mechanic's drone, and GM tools.
- A backend, accounts, or sync.

## Anti-goals

- Wrong numbers. A sheet that looks finished but has a bad KAC or save is worse than no tool,
  so every derived stat needs a test against a known-correct example.
- Letting an illegal build through. Blocking was an explicit choice.
- A look that drifts from grimoire-ledger.

## Constraints

- Static files only, served from the repo root via Pages (`main`, `/`). No runtime
  dependencies and no build step needed to serve it.
- It must work when opened from `file://`, like grimoire-ledger does.
- Nothing gets installed on the dev machine without asking. Build tooling uses only what's
  already there (Python 3 stdlib, git, gh).
- Rules content is OGL plus Paizo Community Use. A footer and the README carry the OGL
  Section 15 notice and the Community Use statement.

## Decided

**Look and structure (Gareth).** Copy grimoire-ledger "for the most part": same `:root`
palette and tokens, serif headings, top bar with name and actions, sticky tab strip, card
grid, `.btn`/`.fld`/`table.t` components, the same print-sheet approach, and the same
autosave/export/import pattern. Starting by copying its CSS wholesale is expected.

**Content scope (Gareth).** The 13 races above. Everything else (classes, themes, feats,
spells, gear) comes in full, with no book filter.

**Legality (Gareth).** Block, don't warn.

**Effects flow into the numbers (Gareth).** Every pick changes the sheet: feats (Toughness,
Improved Initiative, Skill Focus, Weapon Focus/Specialization), racial traits (human bonus
feat and rank, racial skill bonuses), theme benefits, class features (specialization skills,
armor training, expertise) and gear (armor, weapons, personal upgrades, augmentations). The
sheet shows SP/HP/RP, EAC/KAC, CMD-equivalent (KAC+8 vs combat maneuvers), saves, initiative,
speed, every skill total, and a per-weapon attack/damage line. Typed bonuses stack by the 1e
rules (same type doesn't stack, except circumstance/untyped). Use Foundry's `modifiers`
entries where its formula strings can be evaluated, and hand-code the rest in a
`tools/effect_overrides.json` table. Many picks don't change any sheet number (new actions, situational
abilities), so they show as text. The script keeps a list of entries whose text names a
bonus to a sheet stat. Any of those without an evaluated modifier or an override counts as a
build failure, just like prerequisites. Each derived number gets a test against a reference build.

**Tabs (my call).** Character (name, race and racial variant, theme, class levels) ·
Abilities (point buy) · Class features · Skills · Feats · Gear · Spells (only shown for
casters) · Print · Import/Export. The blocker bar sits under the tab strip, and the top bar
shows SP / HP / RP / EAC / KAC / saves live.

**Data source (my call, same decision as starfinder-dm).** No AoN scraping. A Python stdlib
script, `tools/build_data.py`, reads a pinned commit of
`foundryvtt-starfinder/foundryvtt-starfinder` (`src/items/*`: races, racial-features,
classes, class-features, themes, theme-features, feats, spells, equipment, archetypes,
archetype-features) and writes `data.js`, which assigns one global (`window.SFDATA`).
`data.js` is generated and committed, so Pages serves it with no build. The script also
records the Foundry commit SHA in `data.js`. Using a classic script, not `fetch`, keeps
`file://` working.

**Size budget (my call).** The script strips Foundry's HTML descriptions down to a one- or
two-sentence summary plus the AoN link, and drops Foundry-only fields (icons, flags,
`modifiers` it doesn't use). Target: `data.js` under 3 MB. If it comes out bigger, split it
into per-category `data/*.js` files loaded with script tags, not fetch.

**Racial variants (my call).** Foundry stores variants as separate entries (`vesk_(cave)`,
`lashunta_(damaya)`, and so on). They show as a "Variant" dropdown under each of the 13 races.
Lashunta and Gnome have no base entry, only variants, so the player has to pick one. Legacy
variants (like `gnome_(feychild)`) are in scope.

**Enhanced classes (my call).** Foundry has `envoy_enhanced`, `solarian_enhanced`,
`technomancer_enhanced` and `witchwarper_enhanced` (the Starfinder Enhanced revisions). Each
appears as a toggle on its base class, not as a separate class.

**Rules engine (my call).** Plain JS in `index.html`, organised as pure functions from
character state to derived stats (`compute()` in grimoire-ledger's style). Point buy
(base 10, racial mods, 10 points, max 18 at creation) · HP/SP/RP · BAB · saves · EAC/KAC
from armor, Dex cap and proficiencies · skills (ranks per level = class + Int; cap = character
level; class-skill +3; theme skill) · feats (one at 1st and every odd level, plus class bonus
feats, with prerequisites checked) · ability increases at 5/10/15/20 (+2 to four different
scores, +1 if the score is already 17+) · spells known and per day from class tables plus
bonus spells.

**Prerequisites (my call).** Foundry's feat prerequisites are mostly free text. The script
parses the common shapes (ability minimums, BAB, character or class level, other feats, skill
ranks) into structured checks. Anything it can't parse goes on a hand-maintained override
list in `tools/prereq_overrides.json`, so there are no silent passes. A feat with no
structured check and no override counts as a build failure.

**Starting gear (my call).** 1,000 credits at level 1. Higher-level builds use the CRB
wealth-by-level table. Over budget blocks. So does an item whose level is above the CRB
cap for starting gear. Check the exact cap, character level or character level + 1, against
AoN's equipment rules before coding it.

**Class rollout (my call).** Phase 1: Envoy, Mechanic (exocortex only), Mystic, Operative,
Solarian, Soldier, Technomancer. Phase 2: the mechanic's drone. Phase 3: Biohacker,
Vanguard, Witchwarper. Phase 4: Nanocyte, Evolutionist, Precog. Archetypes come in whichever
phase is convenient once the base classes work. Classes not yet supported don't appear in
the picker, rather than showing half-built.

**Class progressions (my call).** Foundry's class items carry the base math (BAB, saves,
HP, SP, ranks, class skills, proficiencies, spell tables) but don't say which features arrive
at which level. They also don't mark which features are choices: a fixed feature and a
pickable improvisation both just say "1st Level (Envoy)". So each class gets a hand-written
progression in `tools/class_progressions.json`, listing fixed features per level, choice
slots with their pools, bonus feat slots, and archetype swap points. `build_data.py` checks it
against Foundry's feature pool and fails if it references a feature Foundry doesn't have.
This is the biggest single chunk of work in each phase, and a class ships only once its
progression is complete.

**Save format (my call).** `{v, name, race, variant, theme, abilities, levels:[{class, increases, skills, feats, choices, spells}], gear, notes}`. Skill ranks, feats, ability
increases, feature choices and spells learned are all recorded per level. That way the checks
can confirm a feat's prerequisites held at the level it was taken, which slot it fills, which
increase a +2 came from, and that each level's rank budget used Int as it stood then. Earlier
levels stay editable, and any edit revalidates the whole build from level 1. The save stores
choices only, never derived numbers, so a data refresh fixes old saves. `v` allows
migrations.

**Gear legality (my call).** Credits and the item-level cap, plus the rules that limit kit:
armor upgrade slots, weapon fusion total level, one augmentation per body system, and
proficiency (non-proficient armor or weapons can be bought but show their penalties).
Ammo, batteries and consumables count toward credits and bulk, with no other checks. Bulk
shows encumbered/overburdened, which is a warning, not a block, because carrying too much is
legal.

**AoN links (my call).** Foundry has no AoN URLs or IDs. Links use AoN's name-addressable
pages where they exist (`Races.aspx?ItemName=`, `Themes.aspx?ItemName=`, `Feats.aspx?ItemName=`,
`SpellDisplay.aspx?ItemName=`, class pages). Equipment and anything else ID-only falls back to
an AoN search link for the name. `build_data.py` makes no requests to AoN.

## Left to the builder

- Internal code organisation inside `index.html`, and whether the JS moves to `app.js`
  (gestalt-calculator does that; either is fine).
- Exact print-sheet layout, as long as it fits the core numbers on page one and stays
  close to grimoire-ledger's print style.
- How the tests run (a Node-free option, such as a `tests.html` that runs assertions in
  the browser, avoids installs), and which reference characters to test against. Use
  published pregens (the CRB iconics) where possible.
- The repo name if `starfinder-builder` clashes with something.
