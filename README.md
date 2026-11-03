# Starfinder Builder

A static Starfinder 1e character builder. No server, no dependencies: open `index.html` in any modern
browser. Phase 1 covers the Core and Core Legacy races, themes, and the envoy, mechanic, mystic,
operative, solarian, soldier and technomancer classes, with illegal picks blocked and explained.

Live at https://belgarreth.github.io/starfinder-builder/

## Persistence

State autosaves to the browser's `localStorage`. It survives reloads but stays in that one
browser on that one device, so export a backup if you care about it. If storage is blocked the page
still works and says so in the top bar.

## Run your own copy

1. Fork this repo.
2. **Settings → Pages → Deploy from a branch → `main` / `/ (root)`**.
3. A minute later it's live at `https://<your-username>.github.io/starfinder-builder/`.

## Regenerating data

`data.js` is generated from the Foundry VTT Starfinder system data pinned in `tools/foundry.lock`.
The generator lives in `tools/` and is added in a later task; it needs only Python 3 and no packages.

## Tests

```
node --test
python3 -m unittest discover -s tools -p 'test_*.py'
```

## Licensing

Uses material from the Starfinder Core Rulebook under the Open Game License 1.0a. Starfinder Core
Rulebook © 2017, Paizo Inc. Foundry VTT Starfinder system data, MIT, © 2019-2025 The Foundry
Starfinder Development Team. See [LICENSE-OGL.md](LICENSE-OGL.md) for the license and Section 15.

This website uses trademarks and/or copyrights owned by Paizo Inc., used under Paizo's Community Use Policy (paizo.com/licenses/communityuse). We are expressly prohibited from charging you to use or access this content. This website is not published, endorsed, or specifically approved by Paizo. For more information about Paizo Inc. and Paizo products, visit paizo.com.
