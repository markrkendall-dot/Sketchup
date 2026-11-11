# Working on HomePlan

## Branches

- `main` is the one line of history. Pull it before you start (`git pull origin main`), work on
  it or on a short branch made from it, and bring the work back to `main` by fast-forward as soon
  as it is green. Do not leave finished work on a side branch.
- If someone else pushed to `main` meanwhile, rebase or merge onto it, then push. Never force-push
  `main`.

## Generated files

`docs/examples/146-mick-road.json`, `docs/examples/146-mick-road-rebuild.json`, the two viewers
`docs/viewer/146-mick-road-viewer.html` and `docs/viewer/146-mick-road-rebuild-viewer.html`, and the
cards in `docs/index.html` (between its `projects:start` and `projects:end` comments) are generated
from `scripts/example-plan.ts`, `scripts/rebuild-plan.ts` (both on `scripts/planLib.ts`), the list
of projects `scripts/projects.json` and the app. After a merge or rebase, do not hand-merge their
conflicts: take either side, then regenerate them.

```
npm run build:example
npm run build:viewer
npm run publish:viewer
```

## Before pushing

```
npm test
npm run build
```

Both must pass. `npm test` also checks the example JSON against the script, and the front page and
the published viewers against `scripts/projects.json`, so a stale one fails.

## Where things are

- `README.md`: how to use the app and how the 146 Mick Road starter was built, with what still
  needs measuring.
- `docs/DESIGN.md`: how the model, derivation and 3D are put together.
- `docs/history/`: past plans and reviews (records; branch names in them are historical).
- `docs/TODO.md`: changes MK has asked for that are not yet made.
- `docs/photos/`: the reference photos the starter is built from, numbered as the script cites them.
- `docs/index.html`, `docs/viewer/` and `.github/workflows/pages.yml`: the GitHub Pages site,
  https://markrkendall-dot.github.io/Sketchup/, published from `main` (README, "Share a viewer"),
  so the viewers must be rebuilt and copied over (above) for the site to show a change. The same
  pages open through githack: https://raw.githack.com/markrkendall-dot/Sketchup/main/docs/index.html
- `scripts/projects.json`: the list of projects behind the front page's cards and the switcher in
  each viewer's bar (README, "Projects: the front page and the switcher", says how to add one).
