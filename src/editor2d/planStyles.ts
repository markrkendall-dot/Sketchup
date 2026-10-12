// The plan layers' styles (PlanLayers.tsx): walls, openings, rooms, stairs, roofs and the site
// layer, with the colours they use. One string, injected into the page by main.tsx and inlined into
// the exported plan (io/exportPlan.ts) so the SVG stands alone. Overlay, grid and UI styles stay in
// index.css.

/** The plan's colours, as custom properties on :root (the page, or the exported <svg>). */
export const PLAN_VARS = `:root {
  --accent: #2563eb;
  --accent-soft: #dbeafe;
  --danger: #dc2626;
  --canvas: #fbfbfa;
  --wall-exterior: #5b6170;
  --wall-interior: #a1a6b0;
  --wall-edge: #1f2329;
  --wall-new-exterior: #3f8f5f;
  --wall-new-interior: #8cc5a2;
  --new-edge: #166534;
  --demo: #dc2626;
  --demo-fill: #fde2e2;
  --opening: #27272a;
}`;

/** The layers' rules. */
export const PLAN_RULES = `.wall-exterior {
  --wall-color: var(--wall-exterior);
}

.wall-interior {
  --wall-color: var(--wall-interior);
}

/* Fills of one style are a single path (no internal seams, see WallFillsLayer). The hairline
   stroke in the fill colour covers the anti-aliasing seam where two styles meet (an interior wall
   butting an exterior one); it stays inside the edge strokes. */
.wall-fill {
  fill: var(--wall-color);
  stroke: var(--wall-color);
  stroke-width: 0.75;
  stroke-linejoin: round;
}

/* Square caps: where two collinear outline segments meet (a wall split by a T, a corner) their
   ends overlap by half a pixel instead of leaving a lighter anti-aliased dot. */
.wall-edge {
  stroke: var(--wall-edge);
  stroke-width: 1;
  stroke-linecap: square;
  fill: none;
}

/* Phases: new walls green, demolished walls hatched red with a dashed outline. */
.wall-exterior.phase-new {
  --wall-color: var(--wall-new-exterior);
}

.wall-interior.phase-new {
  --wall-color: var(--wall-new-interior);
}

.wall.phase-new .wall-edge {
  stroke: var(--new-edge);
}

.wall.phase-demo .wall-fill {
  fill: url(#hp-hatch-demo);
  stroke: none;
}

.wall.phase-demo .wall-edge {
  stroke: var(--demo);
  stroke-dasharray: 5 3;
}

.hatch-bg {
  fill: var(--demo-fill);
}

.hatch-line {
  stroke: #f08080;
}

.wall.wall.is-hovered {
  --wall-color: #7c8aa5;
}

.wall.wall.is-selected {
  --wall-color: #3b82f6;
}

.wall.is-hovered .wall-fill,
.wall.is-selected .wall-fill {
  fill: var(--wall-color);
}

.wall.is-selected .wall-edge {
  stroke: #1d4ed8;
}

/* Openings ---------------------------------------------------------------------------------- */

.opening-gap {
  fill: var(--canvas);
  stroke: none;
}

.opening-line,
.opening-arc,
.opening-leaf,
.opening-dashed {
  fill: none;
  stroke: var(--opening);
  stroke-width: 1;
}

.opening-leaf {
  stroke-width: 2.25;
  stroke-linecap: round;
}

.opening-arc {
  stroke-width: 0.9;
  opacity: 0.85;
}

.opening-dashed {
  stroke-dasharray: 5 3;
}

.opening.phase-new .opening-line,
.opening.phase-new .opening-arc,
.opening.phase-new .opening-leaf,
.opening.phase-new .opening-dashed {
  stroke: #15803d;
}

.opening.phase-new .opening-gap {
  fill: #ecfdf3;
}

.opening.phase-demo .opening-line,
.opening.phase-demo .opening-arc,
.opening.phase-demo .opening-leaf,
.opening.phase-demo .opening-dashed {
  stroke: var(--demo);
  stroke-dasharray: 4 3;
}

.opening.phase-demo .opening-gap {
  fill: var(--demo-fill);
}

.opening.is-hovered .opening-gap {
  fill: #e0e7ff;
}

.opening.is-selected .opening-gap {
  fill: var(--accent-soft);
  stroke: var(--accent);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.opening.is-selected .opening-line,
.opening.is-selected .opening-arc,
.opening.is-selected .opening-leaf,
.opening.is-selected .opening-dashed {
  stroke: var(--accent);
}

.ghost-wall {
  fill: rgba(113, 113, 122, 0.12);
  stroke: rgba(113, 113, 122, 0.55);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}

.dim-label {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  fill: #27272a;
  stroke: var(--canvas);
  stroke-width: 3px;
  paint-order: stroke;
  stroke-linejoin: round;
}

.node {
  fill: #fff;
  stroke: var(--accent);
  stroke-width: 1.5;
}

.node.is-selected {
  fill: var(--accent);
}

/* Rooms ------------------------------------------------------------------------------------- */

.room-fill {
  stroke: none;
}

.room-fill.tint-0 {
  fill: #f3efe4;
}

.room-fill.tint-1 {
  fill: #e9f0ec;
}

.room-fill.tint-2 {
  fill: #ebeef5;
}

.room-fill.tint-3 {
  fill: #f4ecee;
}

.room-fill.is-selected {
  fill: #dbe7fb;
}

.room-label text {
  stroke: var(--canvas);
  stroke-width: 3px;
  paint-order: stroke;
  stroke-linejoin: round;
}

.room-name {
  font-size: 13px;
  font-weight: 650;
  letter-spacing: 0.01em;
  fill: #27272a;
}

.room-area {
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  fill: #52525b;
}

.room-label.unlabeled .room-area {
  fill: #a1a1aa;
}

.room-label.orphan .room-name,
.room-label.orphan .room-area {
  fill: #c2410c;
}

.room-label.orphan .room-area {
  font-style: italic;
}

.room-label.is-selected .room-name {
  fill: var(--accent);
}

.layer-room-labels.pickable .room-label:not(.unlabeled) {
  cursor: move;
}

.room-anchor {
  fill: var(--accent);
  stroke: #fff;
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.open-end {
  fill: #fff;
  stroke: var(--danger);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

/* Stairs ------------------------------------------------------------------------------------- */

.stairs .stairs-body {
  fill: #f2efe8;
  stroke: var(--wall-edge);
  stroke-width: 1.2;
}

.stairs .stairs-tread {
  fill: none;
  stroke: #6b6f78;
  stroke-width: 0.8;
}

.stairs .stairs-arrow,
.stairs .stairs-arrow-head {
  fill: none;
  stroke: var(--wall-edge);
  stroke-width: 1.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.stairs .stairs-label {
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.06em;
  fill: var(--wall-edge);
}

.stairs.phase-new .stairs-body {
  fill: #e3f3e9;
  stroke: var(--new-edge);
}

.stairs.phase-demo .stairs-body {
  fill: var(--demo-fill);
  stroke: var(--demo);
  stroke-dasharray: 5 3;
}

.stairs.is-selected .stairs-body {
  stroke: var(--accent);
  stroke-width: 2.2;
  fill: var(--accent-soft);
}

.stairs-ghost {
  opacity: 0.55;
}

/* The opening a stair below cuts in this floor: "open to below". */
.stair-hole .stair-hole-body {
  fill: rgba(31, 35, 41, 0.06);
  stroke: #52525b;
  stroke-width: 1.2;
  stroke-dasharray: 6 4;
}

.stair-hole .stair-hole-cross {
  fill: none;
  stroke: #71717a;
  stroke-width: 0.8;
  stroke-dasharray: 6 4;
}

.stair-hole .stair-hole-tread {
  fill: none;
  stroke: #a1a1aa;
  stroke-width: 0.7;
}

/* Casework ------------------------------------------------------------------------------------ */

/* Cabinets and appliances: a thin outline, the front edge heavier, ticks where doors meet. What
   hangs above the counter (wall cabinets, the hood, the microwave) is dashed. */
.fixture .fixture-body {
  fill: #f7f4ee;
  stroke: #3f3f46;
  stroke-width: 0.9;
}

.fixture .fixture-front {
  fill: none;
  stroke: #3f3f46;
  stroke-width: 1.6;
}

.fixture .fixture-tick {
  fill: none;
  stroke: #3f3f46;
  stroke-width: 0.8;
}

.fixture .fixture-basin {
  fill: #e6eaee;
  stroke: #52525b;
  stroke-width: 0.9;
}

.fixture .fixture-burner {
  fill: none;
  stroke: #52525b;
  stroke-width: 0.8;
}

.fixture .fixture-label {
  font-size: 9.5px;
  font-weight: 650;
  letter-spacing: 0.05em;
  fill: #3f3f46;
}

.fixture.fixture-overhead .fixture-body {
  fill: none;
  stroke-dasharray: 4 2.5;
}

.fixture.fixture-overhead .fixture-front {
  stroke-dasharray: 4 2.5;
  stroke-width: 1;
}

.fixture.phase-new .fixture-body {
  fill: #e3f3e9;
}

.fixture.phase-new .fixture-body,
.fixture.phase-new .fixture-front,
.fixture.phase-new .fixture-tick,
.fixture.phase-new .fixture-label {
  stroke: var(--new-edge);
}

.fixture.phase-new .fixture-label {
  fill: var(--new-edge);
  stroke: none;
}

.fixture.phase-demo .fixture-body {
  fill: var(--demo-fill);
  stroke: var(--demo);
  stroke-dasharray: 5 3;
}

.fixture.phase-demo .fixture-front,
.fixture.phase-demo .fixture-tick,
.fixture.phase-demo .fixture-basin,
.fixture.phase-demo .fixture-burner {
  stroke: var(--demo);
}

.fixture.phase-demo .fixture-label {
  fill: var(--demo);
}

.fixture.is-selected .fixture-body {
  fill: var(--accent-soft);
  stroke: var(--accent);
  stroke-width: 2;
}

.fixture.is-selected .fixture-front {
  stroke: var(--accent);
}

/* The counter top over a run of base cabinets: a light slab under the cabinet symbols. */
.counter {
  fill: rgba(107, 103, 96, 0.14);
  stroke: #6b6760;
  stroke-width: 0.8;
}

.counter.phase-new {
  fill: rgba(63, 143, 95, 0.12);
  stroke: var(--new-edge);
}

.counter.phase-demo {
  fill: var(--demo-fill);
  stroke: var(--demo);
  stroke-dasharray: 5 3;
}

/* Image underlay ----------------------------------------------------------------------------- */

.underlay-image {
  image-rendering: auto;
}

.underlay-outline {
  fill: none;
  stroke: var(--accent);
  stroke-width: 1.5;
  stroke-dasharray: 6 4;
}

/* Traced rooms over an image: keep the tints faint so the drawing shows through. */
.layer-room-fills.over-underlay .room-fill {
  fill-opacity: 0.35;
}

/* Roofs --------------------------------------------------------------------------------------- */

/* Over the room fills, under the walls: the overhang outline light, the bearing outline dashed,
   the ridge and hip lines solid and thin. */
.roof .roof-overhang {
  fill: rgba(120, 88, 66, 0.05);
  stroke: rgba(120, 88, 66, 0.5);
  stroke-width: 1;
  stroke-dasharray: 2 3;
}

.roof .roof-outline {
  fill: none;
  stroke: #7a5c48;
  stroke-width: 1.4;
  stroke-dasharray: 9 4;
}

.roof .roof-ridge {
  fill: none;
  stroke: #7a5c48;
  stroke-width: 1;
}

.roof.phase-new .roof-overhang {
  fill: rgba(63, 143, 95, 0.08);
  stroke: rgba(22, 101, 52, 0.55);
}

.roof.phase-new .roof-outline,
.roof.phase-new .roof-ridge {
  stroke: var(--new-edge);
}

.roof.phase-demo .roof-overhang {
  fill: url(#hp-hatch-demo);
  fill-opacity: 0.55;
  stroke: var(--demo);
}

.roof.phase-demo .roof-outline,
.roof.phase-demo .roof-ridge {
  stroke: var(--demo);
}

.roof.is-selected .roof-overhang {
  fill: rgba(37, 99, 235, 0.08);
  stroke: var(--accent);
}

.roof.is-selected .roof-outline,
.roof.is-selected .roof-ridge {
  stroke: var(--accent);
  stroke-width: 1.8;
}

.roof-handle {
  fill: #fff;
  stroke: var(--accent);
  stroke-width: 1.5;
}

/* The level below's roofs: faint, grey, for orientation only. */
.roof.roof-ghost {
  opacity: 0.5;
}

.roof.roof-ghost .roof-overhang {
  fill: none;
  stroke: rgba(113, 113, 122, 0.6);
}

.roof.roof-ghost .roof-outline,
.roof.roof-ghost .roof-ridge {
  stroke: rgba(113, 113, 122, 0.8);
}

/* Site (grade points, columns, north) --------------------------------------------------------- */

/* The first floor under the site layer: clearer than the level-below ghost. */
.site-ghost .ghost-wall {
  fill: rgba(91, 97, 112, 0.22);
  stroke: rgba(63, 70, 86, 0.8);
  stroke-width: 1.2;
  stroke-dasharray: none;
}

.hatch-chimney-bg {
  fill: #f3ddd5;
}

.hatch-chimney-line {
  stroke: #a85a4a;
}

.grade-point .grade-tri {
  fill: #fef3c7;
  stroke: #92400e;
  stroke-width: 1.5;
  stroke-linejoin: round;
}

.grade-point .grade-label {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  fill: #78350f;
  stroke: var(--canvas);
  stroke-width: 3px;
  paint-order: stroke;
  stroke-linejoin: round;
}

.grade-point.is-selected .grade-tri {
  fill: var(--accent-soft);
  stroke: var(--accent);
}

.grade-point.is-selected .grade-label {
  fill: var(--accent);
}

.column .column-body {
  stroke-width: 1.5;
}

.column-chimney .column-body {
  fill: url(#hp-hatch-chimney);
  stroke: #7a3b2c;
}

.column-post .column-body {
  fill: #c9b58c;
  stroke: #5c4a2a;
}

.column.phase-new .column-body {
  stroke: var(--new-edge);
}

.column-post.phase-new .column-body {
  fill: #86c79a;
}

.column.phase-demo .column-body {
  stroke: var(--demo);
  stroke-dasharray: 5 3;
}

.column-post.phase-demo .column-body,
.column-chimney.phase-demo .column-body {
  fill: url(#hp-hatch-demo);
}

.column.is-selected .column-body {
  stroke: var(--accent);
  stroke-width: 2.4;
}`;

export const PLAN_STYLES = `${PLAN_VARS}\n\n${PLAN_RULES}\n`;
