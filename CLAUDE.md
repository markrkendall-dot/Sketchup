# Working on HomePlan

## Branches

- `main` is the one line of history. Pull it before you start (`git pull origin main`), work on
  it or on a short branch made from it, and bring the work back to `main` by fast-forward as soon
  as it is green. Do not leave finished work on a side branch.
- If someone else pushed to `main` meanwhile, rebase or merge onto it, then push. Never force-push
  `main`.

## Generated files

`docs/examples/146-mick-road.json` and `docs/viewer/146-mick-road-viewer.html` are generated from
`scripts/example-plan.ts` and the app. After a merge or rebase, do not hand-merge their conflicts:
take either side, then regenerate them.

```
npm run build:example
npm run build:viewer
cp dist-viewer/146-mick-road-viewer.html docs/viewer/146-mick-road-viewer.html
```

## Before pushing

```
npm test
npm run build
```

Both must pass. `npm test` also checks the example JSON against the script, so a stale JSON fails.

## Where things are

- `README.md`: how to use the app and how the 146 Mick Road starter was built, with what still
  needs measuring.
- `docs/DESIGN.md`: how the model, derivation and 3D are put together.
- `docs/history/`: past plans and reviews (records; branch names in them are historical).
- `docs/TODO.md`: changes MK has asked for that are not yet made.
- `docs/photos/`: the reference photos the starter is built from, numbered as the script cites them.
