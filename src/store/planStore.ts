import { create, useStore } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { current } from 'immer';
import { temporal } from 'zundo';
import { addLevelTo, deleteLevelFrom, moveLevelIn, type LevelEdit, type LevelPosition } from '../model/levelOps';
import { addStructureTo, clearOrigin, deleteStructureFrom, newStructureCentre, STRUCTURE_PRESETS, structurePatchProblem, type NewStructure, type StructurePatch } from '../model/structureOps';
import { allLevelIds, firstStructure, isIdentity, isLowestLevel, normalizeDegrees as normalizeAngle, structureOf } from '../model/structures';
import { dist } from '../model/geometry';
import { coreInterval, draftFootprints } from '../derive/openings';
import { clampOpeningHeight, clampOpeningOffset, openingFitsHeight, wallHeightOf } from '../model/openings';
import {
  clampOpenings,
  columnProblem,
  createEmptyPlan,
  deckProblem,
  fenceProblem,
  stairsRailingsOf,
  floorOpeningProblem,
  fixtureProblem,
  glassSidesOf,
  roofOptionProblem,
  roofProblem,
  surfaceProblem,
  findNodeNear,
  MERGE_EPS,
  movesCreateOverlap,
  newId,
  normalizeLevel,
  normalizeRailings,
  WALL_OVERLAP_MESSAGE,
  wallLength,
  wallOverlapping,
  knownOptionIds,
  nodeMeets,
  roomOptionFinishesOf,
  foundationProblem,
  templateLevels,
  mergeLeftoverJoints,
} from '../model/plan';
import { planWallOffset, wallShift, type WallSide } from '../model/offset';
import { planRenovation } from '../model/renovate';
import { framingProblem, joistZoneProblem, memberProblem, normalizeJoists } from '../model/structure';
import type { OptionLook, Beam, Column, RoomOptionFinishes, Deck, Fence, Fixture, FloorOpening, GradePoint, Id, JoistZone, Level, LevelFinishes, LevelFraming, Member, Post, Opening, Phase, Plan, PlanSettings, ProposedLook, Roof, Room, Site, SiteSurface, Staircase, Stairs, Underlay, Vec2, Wall, WallKind } from '../model/types';
import { STAIRCASE_STYLE_KEYS, staircaseFieldProblem, staircaseProblem } from '../model/stairStyle';
import { floorToFloor, normalizeDegrees, stairsHeightProblem, stairsRunOk, stairsWidthOk } from '../derive/stairs';
import { useUiStore } from './uiStore';
import { resolveOptionId } from '../derive/optionView';
import { optionsMeet } from '../derive/phase';
import { fallbackElevation, terrainHeightAt } from '../derive/site';
import { addOptionTo, applyPhaseIn, deleteOptionFrom, duplicateOptionIn, renameOptionIn, setEntityOptionsIn } from '../model/optionOps';
import { isValidUnderlay, normalizeRotation } from '../model/underlay';
import { isWoodId } from '../model/furniture';
import { isVariantOf } from '../model/bath';
import { KITCHEN_FIELD_KEYS, KITCHEN_FIELDS, KITCHEN_FINISH_FIELDS, KITCHEN_FINISH_KEYS, type KitchenFinishField } from '../model/casework';

export interface AddWallOptions {
  kind: WallKind;
  thickness: number;
  phase: Phase;
  /**
   * A new wall rebuilt where a demolished one stood (an old doorway closed up in a wall that is
   * otherwise kept): it may lie along that demolished wall. Never along a wall that stays.
   */
  replacesDemolished?: boolean;
  /** Design options of a new wall (absent: the work option's, store workOptionOf; see tagWork). */
  optionIds?: Id[];
}

export interface AddWallResult {
  /** Final node ids of the wall's ends after normalization (may be existing nodes). */
  a: Id;
  b: Id;
  /** Ids of the walls now covering the new segment (more than one if it was split). */
  wallIds: Id[];
  /** True when `b` was an existing node rather than a newly created one. */
  bWasExisting: boolean;
}

export type WallPatch = Partial<Omit<Wall, 'id'>>;
export type OpeningPatch = Partial<Omit<Opening, 'id'>>;
export type NewOpening = Omit<Opening, 'id'> & { id?: Id };
/** The fields of an opening that updateOpening removes when the patch sets them to undefined. */
const OPTIONAL_OPENING_KEYS: ReadonlySet<keyof Opening> = new Set<keyof Opening>([
  'swing',
  'lites',
  'shutters',
  'trim',
  'sashes',
  'fixedCenter',
  'glazing',
  'halfLite',
  'sliding',
  'overhead',
  'leafColor',
]);
export type RoomPatch = Partial<Omit<Room, 'id'>>;
/** Room fields that a patch clears with undefined. */
const OPTIONAL_ROOM_KEYS = ['ceilingOverride', 'phase', 'wallFinish', 'wallColor', 'wainscot', 'floorFinish', 'floorColor', 'proposedFloor', 'proposedWall', 'ceilingFinish', 'ceilingColor', 'ceilingShape', 'ceilingFlatTop'] as const;
export type NewRoom = Omit<Room, 'id'> & { id?: Id };
/** A flight's fields; its staircase is set by groupStairs and ungroupStaircase, not here. */
export type StairsPatch = Partial<Omit<Stairs, 'id' | 'staircaseId'>>;
export type NewStairs = Omit<Stairs, 'id'> & { id?: Id };
export type NewStaircase = Omit<Staircase, 'id'> & { id?: Id };
type StaircaseStyleKey = (typeof STAIRCASE_STYLE_KEYS)[number];
/** A staircase's style; undefined clears a field (back to its default). */
export type StaircasePatch = { [K in StaircaseStyleKey]?: Staircase[K] | undefined };
export type RoofPatch = Partial<Omit<Roof, 'id'>>;
export type NewRoof = Omit<Roof, 'id'> & { id?: Id };
export type GradePointPatch = Partial<Omit<GradePoint, 'id'>>;
export type NewGradePoint = Omit<GradePoint, 'id'> & { id?: Id };
export type ColumnPatch = Partial<Omit<Column, 'id'>>;
export type NewColumn = Omit<Column, 'id'> & { id?: Id };
export type SurfacePatch = Partial<Omit<SiteSurface, 'id'>>;
export type NewSurface = Omit<SiteSurface, 'id'> & { id?: Id };
export type FencePatch = Partial<Omit<Fence, 'id'>>;
export type NewFence = Omit<Fence, 'id'> & { id?: Id };
/** Ground surfaces' and fences' new outlines and points (a drag of the site selection). */
export interface SiteShapeMoves {
  surfaces?: Record<Id, Vec2[]>;
  fences?: Record<Id, Vec2[]>;
}
/** A new deck; its railings default to one per edge, all on (normalizeRailings). */
export type NewDeck = Omit<Deck, 'id' | 'railings'> & { id?: Id; railings?: boolean[] };
export type DeckPatch = Partial<Omit<Deck, 'id'>>;
/** A new floor opening; its railings default to one per edge, all on (normalizeRailings). */
export type NewFloorOpening = Omit<FloorOpening, 'id' | 'railings'> & { id?: Id; railings?: boolean[] };
export type FloorOpeningPatch = Partial<Omit<FloorOpening, 'id'>>;
export type NewMember = (Omit<Beam, 'id'> | Omit<Post, 'id'>) & { id?: Id };
/** A beam's or post's fields (its kind stays); undefined clears `label` or `footing`. */
export type MemberPatch = Partial<Omit<Beam, 'id' | 'kind'>> | Partial<Omit<Post, 'id' | 'kind'>>;
export type NewJoistZone = Omit<JoistZone, 'id'> & { id?: Id };
export type JoistZonePatch = Partial<Omit<JoistZone, 'id'>>;
export type FixturePatch = Partial<Omit<Fixture, 'id'>>;
export type NewFixture = Omit<Fixture, 'id'> & { id?: Id };
/** The fields of a fixture that updateFixture removes when the patch sets them to undefined. */
const OPTIONAL_FIXTURE_KEYS: ReadonlySet<keyof Fixture> = new Set<keyof Fixture>(['label', 'frontStyle', 'frontColor', 'counterOverhang', 'wood', 'fabric', 'builtIn', 'variant', 'glass', ...KITCHEN_FIELD_KEYS]);
export type UnderlayPatch = Partial<Underlay>;
export type LevelPatch = Partial<Pick<Level, 'name' | 'wallHeight' | 'floorThickness' | 'foundation'>>;
/** A level's casework defaults; undefined clears a field. */
export type FinishesPatch = Partial<Record<keyof LevelFinishes, LevelFinishes[keyof LevelFinishes] | undefined>>;
/** Which end of a wall stays put when its length is edited. */
export type LengthAnchor = 'start' | 'end';

export interface EntitySelection {
  nodes: Id[];
  walls: Id[];
  openings?: Id[];
  rooms?: Id[];
  stairs?: Id[];
  roofs?: Id[];
  fixtures?: Id[];
  decks?: Id[];
  floorOpenings?: Id[];
  /** Staircases: deleting one deletes its pieces; a phase goes to its pieces. */
  staircases?: Id[];
  members?: Id[];
  joistZones?: Id[];
  /** Site elements (plan.site); the level id the action is given only scopes the other kinds. */
  gradePoints?: Id[];
  columns?: Id[];
  surfaces?: Id[];
  fences?: Id[];
}

export interface PlanState {
  plan: Plan;
  setPlan: (plan: Plan) => void;
  renamePlan: (name: string) => void;
  /**
   * Add a wall between two points or nodes and normalize the level. Null when it is degenerate or
   * would lie on top of a wall already there (then the draft message says so).
   */
  addWall: (levelId: Id, a: Vec2 | Id, b: Vec2 | Id, opts: AddWallOptions) => AddWallResult | null;
  /**
   * Add several walls in one undo step, all or nothing: null (and no change) when any of them is
   * degenerate or would lie on top of a wall already there (the draft message then says so).
   */
  addWalls: (levelId: Id, segments: readonly { a: Vec2 | Id; b: Vec2 | Id }[], opts: AddWallOptions) => AddWallResult[] | null;
  /**
   * Move walls sideways by `distance` to one side of each wall (relative to its a->b direction),
   * dragging their neighbours along (model/offset.ts), in one undo step. Returns null when done,
   * else why not (nothing changes).
   */
  offsetWalls: (levelId: Id, ids: readonly Id[], distance: number, side: WallSide) => string | null;
  /** Like offsetWalls with a shift vector per wall (perpendicular to it). Null when done, else why not. */
  shiftWalls: (levelId: Id, shifts: Record<Id, Vec2>) => string | null;
  /**
   * Move walls as a renovation (model/renovate.ts): existing ones demolished where they are and built
   * new where they go, the walls they meet extended or cut back; one undo step. The walls now where
   * the moved ones went, or why not (nothing changes).
   */
  renovateWalls: (levelId: Id, shifts: Record<Id, Vec2>) => { walls: Id[] } | { error: string };
  moveNode: (levelId: Id, nodeId: Id, pos: Vec2, opts?: { normalize?: boolean }) => void;
  /** Move nodes; a move that would lay a wall on top of another wall is refused (nothing changes). */
  moveNodes: (levelId: Id, positions: Record<Id, Vec2>, opts?: { normalize?: boolean }) => void;
  /** Run normalize() on a level; used at the end of an untracked drag. */
  normalize: (levelId: Id, moved?: Id[]) => void;
  deleteWalls: (levelId: Id, ids: Id[]) => void;
  deleteNodes: (levelId: Id, ids: Id[]) => void;
  /** Delete nodes (with their walls), walls (with their openings) and openings in one undo step. */
  deleteEntities: (levelId: Id, sel: EntitySelection) => void;
  updateWall: (levelId: Id, id: Id, patch: WallPatch) => void;
  /**
   * Patch several walls at once (phase, thickness, heightOverride, finish, band...). Not for a/b.
   * undefined clears an optional field; a band is copied per wall, its colour lower-cased, and one
   * with a height not above 0 is refused.
   */
  updateWalls: (levelId: Id, ids: Id[], patch: Omit<WallPatch, 'a' | 'b'>) => void;
  /**
   * Change wall kind. A wall whose thickness is still the default for its old kind gets the
   * default for the new kind; a customized thickness is kept.
   */
  setWallKind: (levelId: Id, ids: Id[], kind: WallKind) => void;
  /**
   * Set a wall's centerline length by moving one end along the wall direction: node b when
   * anchor is 'start' (default), node a when 'end'. Openings keep their distance from the fixed
   * end, then are clamped. Returns false when the length is not usable.
   */
  setWallLength: (levelId: Id, wallId: Id, length: number, anchor?: LengthAnchor) => boolean;
  /** Validate, clamp the offset, and add. Returns the new id, or null if it does not fit. */
  addOpening: (levelId: Id, opening: NewOpening) => Id | null;
  /** Patch an opening; the offset is re-clamped to its wall. */
  updateOpening: (levelId: Id, id: Id, patch: OpeningPatch) => void;
  deleteOpenings: (levelId: Id, ids: Id[]) => void;
  /** Add a room label; returns its id, or null when the name is blank or the anchor is not finite. */
  addRoom: (levelId: Id, room: NewRoom) => Id | null;
  /**
   * Rename or move a room, or change its phase or interior finishes. A blank name or non-finite
   * anchor is ignored; the optional fields (`ceilingOverride`, `phase` and the finishes) take
   * undefined to clear them. Colours are stored lower-case.
   */
  updateRoom: (levelId: Id, id: Id, patch: RoomPatch) => void;
  deleteRooms: (levelId: Id, ids: Id[]) => void;
  /**
   * Add stairs; returns the id, or null when the size or position is not usable, or the heights are
   * not (derive/stairs.ts stairsHeightProblem: base below the floor (allowed on the lowest level, for
   * outdoor steps down a slope), a climb not above 0, a top more than 1" above the floor above,
   * risers not a whole number from 1 to 100).
   */
  addStairs: (levelId: Id, stairs: NewStairs) => Id | null;
  /**
   * Patch stairs; invalid sizes are rejected, the direction is normalized to [0, 360). Heights are
   * checked like addStairs when the patch changes one. `headroom`, `holeStart`, `base`, `rise`,
   * `risers` and `open` take undefined to clear them.
   */
  updateStairs: (levelId: Id, id: Id, patch: StairsPatch) => void;
  deleteStairs: (levelId: Id, ids: Id[]) => void;
  /** Move pieces of stairs to new origins in one undo step (a staircase dragged as one). */
  moveStairs: (levelId: Id, positions: Record<Id, Vec2>) => void;
  /**
   * Make the pieces one staircase with `style` (taking them out of any other; one left with no
   * pieces goes). Null when no id names a piece of stairs or the style cannot be used.
   */
  groupStairs: (levelId: Id, ids: readonly Id[], style?: NewStaircase) => Id | null;
  /** Change a staircase's style; undefined clears a field (its default). */
  updateStaircase: (levelId: Id, id: Id, patch: StaircasePatch) => void;
  /** Its pieces go back to separate flights and the staircase goes. */
  ungroupStaircase: (levelId: Id, id: Id) => void;
  /** Add a roof; returns the id, or null when its outline, sizes or optional fields are not usable (roofOptionProblem). */
  addRoof: (levelId: Id, roof: NewRoof) => Id | null;
  /**
   * Patch a roof; an unusable outline, size or optional field is rejected, the ridge angle is
   * normalized to [0, 360). The optional fields (colour, eaves, rafter, board colour, weathering)
   * take undefined to clear them.
   */
  updateRoof: (levelId: Id, id: Id, patch: RoofPatch) => void;
  deleteRoofs: (levelId: Id, ids: Id[]) => void;
  /** Add a deck; returns the id, or null when its outline, top, railings or colour are not usable (deckProblem). */
  addDeck: (levelId: Id, deck: NewDeck) => Id | null;
  /**
   * Patch a deck; an unusable outline, top or colour is rejected. A new outline keeps the railings
   * of its first edges and gives any added edge one (normalizeRailings). `color` takes undefined to
   * clear it.
   */
  updateDeck: (levelId: Id, id: Id, patch: DeckPatch) => void;
  deleteDecks: (levelId: Id, ids: Id[]) => void;
  /** Add a floor opening; returns the id, or null when its outline or railings are not usable (floorOpeningProblem). */
  addFloorOpening: (levelId: Id, opening: NewFloorOpening) => Id | null;
  /** Patch a floor opening; an unusable outline is rejected. A new outline refits the railings (normalizeRailings). */
  updateFloorOpening: (levelId: Id, id: Id, patch: FloorOpeningPatch) => void;
  deleteFloorOpenings: (levelId: Id, ids: Id[]) => void;
  /** Add a beam or a post (DESIGN.md "Structure"); null when it cannot be used (memberProblem). */
  addMember: (levelId: Id, member: NewMember) => Id | null;
  updateMember: (levelId: Id, id: Id, patch: MemberPatch) => void;
  /** Put members at new places in one undo step (a drag): a beam's ends, a post's point. */
  placeMembers: (levelId: Id, places: Record<Id, { a?: Vec2; b?: Vec2; at?: Vec2 }>) => void;
  addJoistZone: (levelId: Id, zone: NewJoistZone) => Id | null;
  updateJoistZone: (levelId: Id, id: Id, patch: JoistZonePatch) => void;
  /** The joists over a level; undefined clears them (not set). */
  setLevelFraming: (levelId: Id, framing: LevelFraming | undefined) => void;
  /** Add a cabinet, appliance or sink (DESIGN.md "Casework"); returns the id, or null when it is not usable (fixtureProblem). */
  addFixture: (levelId: Id, fixture: NewFixture) => Id | null;
  /**
   * Patch a fixture; an unusable size, kind or optional field is rejected, the direction is
   * normalized to [0, 360). The optional fields (label, front style and colour, counter overhang)
   * take undefined to clear them.
   */
  updateFixture: (levelId: Id, id: Id, patch: FixturePatch) => void;
  /** The same patch on several fixtures (a counter run's top, its backsplash), as one undo step. */
  updateFixtures: (levelId: Id, ids: Id[], patch: FixturePatch) => void;
  deleteFixtures: (levelId: Id, ids: Id[]) => void;
  /** Move fixtures to new back-edge positions in one set (a drag of the selection). */
  moveFixtures: (levelId: Id, positions: Record<Id, Vec2>) => void;
  /** Copies of the fixtures, each moved by `offset`, in one undo step; returns the new ids. */
  duplicateFixtures: (levelId: Id, ids: Id[], offset: Vec2) => Id[];
  /** Set the level's casework defaults (cabinet colour, counter colour, front style); undefined clears a field. */
  updateFinishes: (levelId: Id, patch: FinishesPatch) => void;
  /**
   * Split a wall at `at` inches from its a end (a node is inserted there and the level normalized,
   * so the wall becomes two). Null when done, else why not: too near an end, or inside an opening.
   */
  splitWall: (levelId: Id, wallId: Id, at: number) => string | null;
  /** Add a grade point (a spot elevation of the ground); returns the id, or null for a non-finite value. */
  addGradePoint: (point: NewGradePoint) => Id | null;
  /** Move a grade point or change its elevation. */
  updateGradePoint: (id: Id, patch: GradePointPatch) => void;
  deleteGradePoints: (ids: Id[]) => void;
  /** Add a post or chimney; returns the id, or null when its size or heights are not usable. */
  addColumn: (column: NewColumn) => Id | null;
  /**
   * Patch a column; an unusable size, height (top not above base), colour or cap is rejected
   * (columnProblem), the rotation is normalized to [0, 360). `color` and `cap` take undefined to
   * clear them.
   */
  updateColumn: (id: Id, patch: ColumnPatch) => void;
  deleteColumns: (ids: Id[]) => void;
  /** Add a ground surface; returns the id, or null when its outline, material or colour is not usable (surfaceProblem). */
  addSurface: (surface: NewSurface) => Id | null;
  /** Patch a ground surface; an unusable outline, material or colour is rejected. `color` takes undefined to clear it. */
  updateSurface: (id: Id, patch: SurfacePatch) => void;
  deleteSurfaces: (ids: Id[]) => void;
  /** Add a fence; returns the id, or null when its points, height, rails, post spacing or colour are not usable (fenceProblem). */
  addFence: (fence: NewFence) => Id | null;
  /** Patch a fence; an unusable field is rejected. `color` takes undefined to clear it. */
  updateFence: (id: Id, patch: FencePatch) => void;
  deleteFences: (ids: Id[]) => void;
  /**
   * Move grade points and columns to new positions, and give surfaces new outlines and fences new
   * points, in one set (a drag of the site selection).
   */
  moveSiteItems: (points: Record<Id, Vec2>, columns: Record<Id, Vec2>, shapes?: SiteShapeMoves) => void;
  /** Turn the plan relative to true north (normalized to [0, 360)). */
  setNorthAngle: (degrees: number) => void;
  /** Delete every grade point (the terrain goes flat again) in one undo step. */
  clearGradePoints: () => void;
  /**
   * Set the phase of walls, openings, stairs, roofs, fixtures, decks, floor openings, columns,
   * ground surfaces, fences and room labels together (e.g. "Mark demolish"). A room set to existing
   * stores no phase.
   */
  setPhase: (
    levelId: Id,
    sel: { walls: Id[]; openings: Id[]; stairs?: Id[]; roofs?: Id[]; fixtures?: Id[]; decks?: Id[]; floorOpenings?: Id[]; staircases?: Id[]; members?: Id[]; joistZones?: Id[]; columns?: Id[]; surfaces?: Id[]; fences?: Id[]; rooms?: Id[] },
    phase: Phase,
  ) => void;
  /**
   * Copy the nodes and walls (not openings) of one level into another, merged with whatever is
   * there, in one undo step. Walls that would lie on top of a wall already on the target level
   * are skipped. Returns how many walls were copied and how many were skipped.
   */
  copyWallsFromLevel: (fromId: Id, toId: Id) => { copied: number; skipped: number };
  updateSettings: (patch: Partial<PlanSettings>) => void;
  /**
   * Set or clear fields of the plan's proposed look (types.ts ProposedLook): undefined clears a
   * field, colours are stored lower-case, an empty look is removed. One undo step.
   */
  updateProposedLook: (patch: Partial<ProposedLook>) => void;
  renameLevel: (levelId: Id, name: string) => void;
  updateLevel: (levelId: Id, patch: LevelPatch) => void;
  /**
   * Add an empty level to a structure (`structureId`, else the main one, or the structure of the
   * level the position names): above the top, below the bottom, or just above or below a level
   * (model/levelOps.ts addLevelTo: heights from the neighbour; one added at the bottom leaves the
   * other levels' elevations as they were). One undo step. Null when the position names no level.
   */
  addLevel: (position: LevelPosition, name?: string, structureId?: Id) => LevelEdit | null;
  /**
   * Delete a level and everything on it (model/levelOps.ts deleteLevelFrom). Refused (null) for the
   * last level. One undo step.
   */
  deleteLevel: (levelId: Id) => LevelEdit | null;
  /** Swap a level with the one above or below it (model/levelOps.ts moveLevelIn). One undo step. */
  moveLevel: (levelId: Id, direction: 'up' | 'down') => LevelEdit | null;
  /** The floor top of a structure's lowest level (the main structure when none is named). One undo step. */
  setBaseFloorElevation: (elevation: number, structureId?: Id) => void;
  /**
   * Add a structure (model/structureOps.ts addStructureTo): a garage or shed with its starter box,
   * placed clear of the others unless an origin is given. Returns its id. One undo step.
   */
  addStructure: (input: NewStructure) => Id;
  /** Delete a structure and its levels. Refused (false) for the last structure. One undo step. */
  deleteStructure: (id: Id) => boolean;
  renameStructure: (id: Id, name: string) => void;
  /**
   * Move, turn, re-kind or raise a structure (its origin, rotation, kind or lowest floor top).
   * Refused (false) for a value that is not a number or an empty name. One undo step.
   */
  updateStructure: (id: Id, patch: StructurePatch) => boolean;
  /** Put an image under a level, replacing any there, or remove it (undefined). One undo step. */
  setUnderlay: (levelId: Id, underlay: Underlay | undefined) => void;
  /**
   * Patch the level's underlay (placement, opacity, lock). Invalid values are rejected; the
   * rotation is normalized to [0, 360). No-op without an underlay. One undo step.
   */
  updateUnderlay: (levelId: Id, patch: UnderlayPatch) => void;
  /** Add a design option (blank name: the next "Option X"); returns its id. One undo step. */
  addOption: (name?: string) => Id;
  /** Add an option copied from another (model/optionOps.ts duplicateOptionIn); null when there is no such option. */
  duplicateOption: (id: Id, name?: string) => Id | null;
  renameOption: (id: Id, name: string) => void;
  /** Delete an option and its own changes (model/optionOps.ts deleteOptionFrom); false for the last one. */
  deleteOption: (id: Id) => boolean;
  /** Put the selected new and demolished entities in these options (undefined: every option). */
  setEntityOption: (levelId: Id, sel: EntitySelection, optionIds: Id[] | undefined) => void;
  /** Set or clear fields of an option's own proposed look (over the plan's); undefined clears a field. */
  /** Set an option's own look fields; 'today' keeps today's whatever the shared look says, undefined goes back to the shared one. */
  updateOptionLook: (optionId: Id, patch: Partial<OptionLook>) => void;
  /** Set or clear (undefined) a room's own proposed floor or walls in an option (Room.optionFinishes). */
  updateRoomOptionFinishes: (levelId: Id, roomId: Id, optionId: Id, patch: Partial<RoomOptionFinishes>) => void;
}

/**
 * The design option new work goes to (DESIGN.md "Design options"): the active one (uiStore) while
 * the plan has several, else none: with one option, new work is untagged and so in every option.
 */
export function workOptionOf(plan: Pick<Plan, 'options'>): Id | undefined {
  if (plan.options.length < 2) return undefined;
  return resolveOptionId(plan, useUiStore.getState().activeOptionId);
}

/**
 * Tag an entity being created as new work of the work option. Existing entities carry no tags; tags
 * the input already has are kept (those of options the plan has).
 */
function tagWork(e: { phase?: Phase; optionIds?: Id[] }, plan: Plan): void {
  if ((e.phase ?? 'existing') === 'existing') {
    delete e.optionIds;
    return;
  }
  if (e.optionIds !== undefined) {
    const ids = knownOptionIds(e.optionIds, new Set(plan.options.map((o) => o.id)));
    if (ids) e.optionIds = ids;
    else delete e.optionIds;
    return;
  }
  const work = workOptionOf(plan);
  if (work) e.optionIds = [work];
}

/**
 * After an edit that made walls and openings by its own rules (a renovation, a starter box): tag
 * what it made new or demolished as the work option's (tagWork), leaving what was already there.
 */
function tagWorkSince(before: Pick<Level, 'walls' | 'openings'>, level: Level, plan: Plan): void {
  const work = workOptionOf(plan);
  if (!work) return;
  for (const rec of [level.walls, level.openings] as Record<Id, Wall | Opening>[]) {
    const old = rec === level.walls ? before.walls : before.openings;
    for (const e of Object.values(rec)) {
      const prev = (old as Record<Id, Wall | Opening>)[e.id];
      if (e.phase === 'existing') continue;
      if (!prev) {
        if (e.optionIds === undefined) e.optionIds = [work];
      } else if (prev.phase === 'existing') e.optionIds = [work];
    }
  }
}

const touch = (plan: Plan) => {
  plan.modifiedAt = new Date().toISOString();
};

/**
 * Move nodes in place. For a wall whose a end moves while its b end stays, openings keep their
 * distance from b (offsets are measured from a), so a door does not slide when the far corner
 * is dragged or a length is edited from the other end. Offsets are clamped later by normalize.
 */
function moveNodesInPlace(level: Level, positions: Record<Id, Vec2>): void {
  const moved = new Set(Object.keys(positions).filter((id) => level.nodes[id]));
  const before = new Map<Id, number>();
  for (const w of Object.values(level.walls)) {
    if (moved.has(w.a) && !moved.has(w.b)) before.set(w.id, wallLength(level, w));
  }
  for (const id of moved) {
    const n = level.nodes[id];
    const p = positions[id];
    n.x = p.x;
    n.y = p.y;
  }
  if (before.size === 0) return;
  for (const o of Object.values(level.openings)) {
    const old = before.get(o.wallId);
    if (old === undefined) continue;
    const delta = wallLength(level, level.walls[o.wallId]) - old;
    if (delta !== 0) o.offset += delta;
  }
}

/** A member's stored form: points copied, a label trimmed (empty: none). */
function cleanMember(m: Member): Member {
  const out = { ...m } as Member;
  if (out.kind === 'beam') {
    out.a = { x: out.a.x, y: out.a.y };
    out.b = { x: out.b.x, y: out.b.y };
  } else {
    out.at = { x: out.at.x, y: out.at.y };
    if (out.footing) out.footing = { width: out.footing.width, thickness: out.footing.thickness };
    else delete out.footing;
  }
  if (typeof out.label === 'string') {
    const t = out.label.trim();
    if (t) out.label = t;
    else delete out.label;
  } else delete out.label;
  if (typeof out.color === 'string') out.color = out.color.toLowerCase();
  else delete out.color;
  // A log's depth is kept equal to its diameter.
  if (out.profile === 'log') out.depth = out.width;
  else delete out.profile;
  // A timber's heights: both or neither (memberProblem refuses one alone).
  for (const k of ['za', 'zb', 'base', 'top'] as const) if ((out as unknown as Record<string, unknown>)[k] === undefined) delete (out as unknown as Record<string, unknown>)[k];
  return out;
}

/** Drop the staircases no piece of stairs belongs to any more. */
function pruneStaircases(level: Level): void {
  const used = new Set<Id>();
  for (const st of Object.values(level.stairs)) if (st.staircaseId) used.add(st.staircaseId);
  for (const id of Object.keys(level.staircases)) if (!used.has(id)) delete level.staircases[id];
}

/** A staircase's stored form: no undefined fields, colours lower-cased. */
function cleanStaircase(sc: Staircase): Staircase {
  const out = { ...sc };
  for (const k of STAIRCASE_STYLE_KEYS) if (out[k] === undefined) delete out[k];
  if (out.treadColor) out.treadColor = out.treadColor.toLowerCase();
  if (out.riserColor) out.riserColor = out.riserColor.toLowerCase();
  return out;
}

function deleteInPlace(
  level: Level,
  nodeIds: Id[],
  wallIds: Id[],
  openingIds: Id[] = [],
  roomIds: Id[] = [],
  stairsIds: Id[] = [],
  roofIds: Id[] = [],
  fixtureIds: Id[] = [],
  deckIds: Id[] = [],
  floorOpeningIds: Id[] = [],
): void {
  for (const id of roofIds) delete level.roofs[id];
  for (const id of fixtureIds) delete level.fixtures[id];
  for (const id of deckIds) delete level.decks[id];
  for (const id of floorOpeningIds) delete level.floorOpenings[id];
  for (const id of openingIds) delete level.openings[id];
  for (const id of roomIds) delete level.rooms[id];
  for (const id of stairsIds) delete level.stairs[id];
  pruneStaircases(level);
  const walls = new Set(wallIds);
  const nodes = new Set(nodeIds);
  for (const w of Object.values(level.walls)) if (nodes.has(w.a) || nodes.has(w.b)) walls.add(w.id);
  for (const id of walls) delete level.walls[id];
  for (const o of Object.values(level.openings)) if (walls.has(o.wallId)) delete level.openings[o.id];
  for (const id of nodes) delete level.nodes[id];
  const used = new Set<Id>();
  for (const w of Object.values(level.walls)) {
    used.add(w.a);
    used.add(w.b);
  }
  for (const id of Object.keys(level.nodes)) if (!used.has(id)) delete level.nodes[id];
}

/** Pull the openings of the given walls (all walls when omitted) under their wall height. */
function clampOpeningHeights(level: Level, wallIds?: Set<Id>): void {
  for (const o of Object.values(level.openings)) {
    const w = level.walls[o.wallId];
    if (!w || (wallIds && !wallIds.has(w.id))) continue;
    const H = wallHeightOf(level, w);
    if (openingFitsHeight(o, H)) continue;
    clampOpeningHeight(o, H);
  }
}

/**
 * Stairs the editor can draw. On an edit only the sizes being changed are held to the size limits,
 * so an older file's odd flight can still change phase or move.
 */
const validStairs = (s: Omit<Stairs, 'id'>, limits: { width: boolean; run: boolean } = { width: true, run: true }): boolean =>
  (!limits.width || stairsWidthOk(s.width)) &&
  (!limits.run || stairsRunOk(s.run, s.risers)) &&
  s.width > 0 &&
  s.run > 0 &&
  Number.isFinite(s.width) &&
  Number.isFinite(s.run) &&
  Number.isFinite(s.direction) &&
  Number.isFinite(s.origin.x) &&
  Number.isFinite(s.origin.y) &&
  (s.headroom === undefined || (Number.isFinite(s.headroom) && s.headroom > 0)) &&
  (s.holeStart === undefined || (Number.isFinite(s.holeStart) && s.holeStart >= 0));

const STAIRS_HEIGHT_KEYS = ['base', 'rise', 'risers'] as const;

/** A roof's stored form: outline points and rafter sizes copied, ridge angle in [0, 360), colours lower-cased. */
function cleanRoof(r: Roof): Roof {
  const out: Roof = { ...r, outline: r.outline.map((p) => ({ x: p.x, y: p.y })), ridgeAngle: normalizeDegrees(r.ridgeAngle) };
  if (r.rafter) out.rafter = { depth: r.rafter.depth, spacing: r.rafter.spacing };
  if (typeof r.color === 'string') out.color = r.color.toLowerCase();
  if (typeof r.boardColor === 'string') out.boardColor = r.boardColor.toLowerCase();
  return out;
}

/** A floor opening's stored form: outline points copied, railings fitted to the outline. */
function cleanFloorOpening(o: Omit<FloorOpening, 'railings'> & { railings?: boolean[] }): FloorOpening {
  return { id: o.id, outline: o.outline.map((p) => ({ x: p.x, y: p.y })), railings: normalizeRailings(o.railings, o.outline.length), phase: o.phase, ...(o.optionIds ? { optionIds: [...o.optionIds] } : {}) };
}

/** A deck's stored form: outline points copied, railings fitted to the outline, colour lower-cased. */
function cleanDeck(d: Omit<Deck, 'railings'> & { railings?: boolean[] }): Deck {
  const out: Deck = { ...d, outline: d.outline.map((p) => ({ x: p.x, y: p.y })), railings: normalizeRailings(d.railings, d.outline.length) };
  if (typeof d.color === 'string') out.color = d.color.toLowerCase();
  else delete out.color;
  return out;
}

const isPoint = (p: Vec2 | undefined): p is Vec2 => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

/**
 * A fixture's stored form: position and overhang copied, direction in [0, 360), colour lower-cased,
 * empty label dropped; a piece and a fabric only on furniture (a fixture turned into a cabinet
 * loses them).
 */
function cleanFixture(f: Fixture): Fixture {
  const out: Fixture = { ...f, origin: { x: f.origin.x, y: f.origin.y }, direction: Number.isFinite(f.direction) ? normalizeDegrees(f.direction) : f.direction };
  if (typeof f.frontColor === 'string') out.frontColor = f.frontColor.toLowerCase();
  if (f.counterOverhang) out.counterOverhang = { ...f.counterOverhang };
  if (f.label !== undefined && (typeof f.label !== 'string' || !f.label.trim())) delete out.label;
  if (f.kind !== 'furniture') {
    delete out.piece;
    delete out.fabric;
    delete out.builtIn;
  }
  // A form only on a kind that has it, glass sides only on a shower (and only the true ones).
  if (out.variant !== undefined && !isVariantOf(f.kind, out.variant)) delete out.variant;
  if (f.kind !== 'shower' || !f.glass) delete out.glass;
  else out.glass = glassSidesOf(f.glass);
  // The kitchen's fields only on the kinds that take them (a base turned into a wall cabinet loses
  // its counter and its drawer bank); colours lower-cased, a glass front only when true.
  for (const k of KITCHEN_FIELD_KEYS) {
    const v = out[k];
    if (v === undefined) continue;
    if (!KITCHEN_FIELDS[k].kinds(f.kind) || (k === 'glassFront' && v !== true)) delete out[k];
    else if (typeof v === 'string' && v.startsWith('#')) (out as unknown as Record<string, unknown>)[k] = v.toLowerCase();
  }
  for (const k of ['label', 'frontStyle', 'frontColor', 'counterOverhang', 'piece', 'wood', 'fabric', 'builtIn', 'variant', 'glass', ...KITCHEN_FIELD_KEYS] as const) if (out[k] === undefined) delete out[k];
  return out;
}

const sameOverhang = (p: Fixture['counterOverhang'], q: Fixture['counterOverhang']): boolean =>
  p === q || (!!p && !!q && p.front === q.front && p.back === q.back && p.left === q.left && p.right === q.right);

/**
 * Apply a patch to one fixture of a level (a draft): refused (false) when the fixture is missing,
 * the result is not a usable fixture, or nothing changes. Undefined clears an optional field.
 */
function patchFixture(level: Level, id: Id, patch: FixturePatch): boolean {
  const f = level.fixtures[id];
  if (!f) return false;
  // A form the (new) kind does not come in is refused; a kind change drops the old form (cleanFixture).
  if (patch.variant !== undefined && !isVariantOf(patch.kind ?? f.kind, patch.variant)) return false;
  const next = cleanFixture({ ...f, ...patch, id });
  if (fixtureProblem(next)) return false;
  const keys = Object.keys(patch) as (keyof FixturePatch)[];
  const same = (k: keyof FixturePatch) =>
    k === 'origin' ? next.origin.x === f.origin.x && next.origin.y === f.origin.y : k === 'counterOverhang' ? sameOverhang(next.counterOverhang, f.counterOverhang) : next[k] === f[k];
  // Fields the cleaning dropped (a piece and a fabric when the kind is no longer furniture, the
  // kitchen fields a new kind does not take).
  const dropped = (['piece', 'fabric', 'builtIn', 'variant', 'glass', ...KITCHEN_FIELD_KEYS] as const).filter((k) => next[k] === undefined && f[k] !== undefined);
  if (keys.every(same) && dropped.length === 0) return false;
  for (const k of keys) {
    if (same(k)) continue;
    if (next[k] === undefined) {
      if (OPTIONAL_FIXTURE_KEYS.has(k)) delete f[k];
    } else (f as unknown as Record<string, unknown>)[k] = next[k];
  }
  for (const k of dropped) delete f[k];
  return true;
}

/** A column's stored form: position copied, rotation in [0, 360), colour lower-cased, unset options left out. */
function cleanColumn(c: Column): Column {
  const out: Column = { ...c, at: { x: c.at.x, y: c.at.y }, rotation: Number.isFinite(c.rotation) ? normalizeDegrees(c.rotation) : c.rotation };
  if (typeof c.color === 'string') out.color = c.color.toLowerCase();
  if (c.color === undefined) delete out.color;
  if (c.cap === undefined) delete out.cap;
  return out;
}

/** A ground surface's stored form: outline copied, colour lower-cased, an unset colour left out. */
function cleanSurface(sf: SiteSurface): SiteSurface {
  const out: SiteSurface = { ...sf, outline: Array.isArray(sf.outline) ? sf.outline.map((p) => ({ x: p.x, y: p.y })) : sf.outline };
  if (typeof sf.color === 'string') out.color = sf.color.toLowerCase();
  else delete out.color;
  return out;
}

/** A fence's stored form: points copied, colour lower-cased, an unset colour left out. */
function cleanFence(f: Fence): Fence {
  const out: Fence = { ...f, points: Array.isArray(f.points) ? f.points.map((p) => ({ x: p.x, y: p.y })) : f.points };
  if (typeof f.color === 'string') out.color = f.color.toLowerCase();
  else delete out.color;
  return out;
}

const samePoints = (p: readonly Vec2[], q: readonly Vec2[]): boolean => p.length === q.length && p.every((v, i) => v.x === q[i].x && v.y === q[i].y);

/**
 * Write the patched fields of a site element that differ onto it (undefined deletes an optional
 * one); false when none differs, so the edit is a no-op. Point lists compare by value.
 */
function applySitePatch<T extends object>(target: T, next: T, keys: readonly (keyof T)[]): boolean {
  const same = (k: keyof T) => {
    const a = next[k];
    const b = target[k];
    return Array.isArray(a) && Array.isArray(b) ? samePoints(a as Vec2[], b as Vec2[]) : a === b;
  };
  if (keys.every(same)) return false;
  for (const k of keys) {
    if (same(k)) continue;
    if (next[k] === undefined) delete target[k];
    else target[k] = next[k];
  }
  return true;
}

/**
 * Add one wall to a (draft) level and normalize it: the body of `addWall`. Null when the segment
 * is degenerate, 'overlap' when it would lie on top of a wall already there (nothing changed).
 */
function addWallInPlace(level: Level, aRef: Vec2 | Id, bRef: Vec2 | Id, opts: AddWallOptions): AddWallResult | 'overlap' | null {
  // The wall as the option tests see it: walls and corners of other design options only are not in its way.
  const probe = { phase: opts.phase, optionIds: opts.optionIds };
  // Where each end lands: a node id, an existing node within MERGE_EPS, or a new point.
  const locate = (ref: Vec2 | Id): { id: Id | null; at: Vec2 } | null => {
    if (typeof ref === 'string') return level.nodes[ref] ? { id: ref, at: level.nodes[ref] } : null;
    const near = findNodeNear(level, ref, MERGE_EPS, undefined, (id) => nodeMeets(level, id, probe));
    return near ? { id: near, at: level.nodes[near] } : { id: null, at: ref };
  };
  const la = locate(aRef);
  const lb = locate(bRef);
  if (!la || !lb || (la.id !== null && la.id === lb.id) || dist(la.at, lb.at) <= MERGE_EPS) return null;
  // A wall on top of a wall already there (any phase) would replace a piece of it when the level
  // is normalized: refuse it instead (docs/history/REVIEW-2.md A1).
  const rebuilt = opts.replacesDemolished && opts.phase === 'new';
  if (wallOverlapping(level, la.at, lb.at, (w) => (rebuilt && w.phase === 'demo') || !optionsMeet(w, probe))) return 'overlap';
  const place = (l: { id: Id | null; at: Vec2 }): { id: Id; existing: boolean } => {
    if (l.id) return { id: l.id, existing: true };
    const id = newId();
    level.nodes[id] = { id, x: l.at.x, y: l.at.y };
    return { id, existing: false };
  };
  const a = place(la);
  const b = place(lb);
  const wall: Wall = { id: newId(), a: a.id, b: b.id, thickness: opts.thickness, kind: opts.kind, phase: opts.phase };
  if (opts.optionIds?.length && opts.phase !== 'existing') wall.optionIds = [...opts.optionIds];
  level.walls[wall.id] = wall;
  const remap = normalizeLevel(level);
  const finalA = remap.get(a.id) ?? a.id;
  const finalB = remap.get(b.id) ?? b.id;
  return { a: finalA, b: finalB, wallIds: wallsAlong(level, finalA, finalB).filter((id) => optionsMeet(level.walls[id], probe)), bWasExisting: b.existing };
}

/** A wall's options as tagWork would give them. */
function wallOpts(opts: AddWallOptions, plan: Plan): AddWallOptions {
  const probe: { phase: Phase; optionIds?: Id[] } = { phase: opts.phase, ...(opts.optionIds ? { optionIds: opts.optionIds } : {}) };
  tagWork(probe, plan);
  return { ...opts, optionIds: probe.optionIds };
}

/** Walls lying along the straight path a..b, following the graph after splits. */
function wallsAlong(level: Level, a: Id, b: Id): Id[] {
  const A = level.nodes[a];
  const B = level.nodes[b];
  if (!A || !B) return [];
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len2 = dx * dx + dy * dy;
  const onPath = (id: Id) => {
    const n = level.nodes[id];
    const t = ((n.x - A.x) * dx + (n.y - A.y) * dy) / len2;
    const px = A.x + dx * t - n.x;
    const py = A.y + dy * t - n.y;
    return t > -1e-6 && t < 1 + 1e-6 && px * px + py * py < 1;
  };
  return Object.values(level.walls)
    .filter((w) => onPath(w.a) && onPath(w.b))
    .map((w) => w.id);
}

export const usePlanStore = create<PlanState>()(
  temporal(
    immer((set, get) => {
      // `fn` returns false when it rejected the edit without changing anything, so the plan
      // keeps its identity and no empty undo step is recorded.
      const editLevel = (levelId: Id, fn: (level: Level, plan: Plan) => void | boolean) =>
        set((s) => {
          const level = s.plan.levels[levelId];
          if (!level) return;
          if (fn(level, s.plan) === false) return;
          touch(s.plan);
        });

      // Same for the site (plan.site: grade points, columns, north angle).
      const editSite = (fn: (site: Site, plan: Plan) => void | boolean) =>
        set((s) => {
          if (fn(s.plan.site, s.plan) === false) return;
          touch(s.plan);
        });

      return {
        plan: createEmptyPlan(),

        setPlan: (plan) => set({ plan }),

        renamePlan: (name) =>
          set((s) => {
            s.plan.name = name;
            touch(s.plan);
          }),

        addWall: (levelId, aRef, bRef, opts) => {
          let result: AddWallResult | null = null;
          let overlap = false;
          editLevel(levelId, (level, plan) => {
            const r = addWallInPlace(level, aRef, bRef, wallOpts(opts, plan));
            if (r === 'overlap') overlap = true;
            if (r === null || r === 'overlap') return false;
            result = r;
          });
          if (overlap) useUiStore.getState().patchDraft({ message: WALL_OVERLAP_MESSAGE, error: true });
          return result;
        },

        addWalls: (levelId, segments, given) => {
          const current = get().plan.levels[levelId];
          const opts = wallOpts(given, get().plan);
          if (!current || segments.length === 0) return null;
          // Dry run on a copy first: the walls go in together or not at all (one undo step).
          const trial = structuredClone(current) as Level;
          for (const s of segments) {
            const r = addWallInPlace(trial, s.a, s.b, opts);
            if (r === null || r === 'overlap') {
              if (r === 'overlap') useUiStore.getState().patchDraft({ message: WALL_OVERLAP_MESSAGE, error: true });
              return null;
            }
          }
          const results: AddWallResult[] = [];
          editLevel(levelId, (level) => {
            for (const s of segments) {
              const r = addWallInPlace(level, s.a, s.b, opts);
              if (r && r !== 'overlap') results.push(r);
            }
          });
          return results;
        },

        offsetWalls: (levelId, ids, distance, side) => {
          const level = get().plan.levels[levelId];
          if (!level) return 'No such level.';
          if (!Number.isFinite(distance) || !(distance > 0)) return 'Must be greater than 0.';
          const shifts = new Map<Id, Vec2>();
          for (const id of ids) if (level.walls[id]) shifts.set(id, wallShift(level, id, distance, side));
          return get().shiftWalls(levelId, Object.fromEntries(shifts));
        },

        shiftWalls: (levelId, shiftsIn) => {
          let problem: string | null = null;
          editLevel(levelId, (level) => {
            const shifts = new Map(Object.entries(shiftsIn).filter(([, s]) => isPoint(s) && Math.hypot(s.x, s.y) > 1e-9));
            if (shifts.size === 0) return false;
            const planned = planWallOffset(level, shifts);
            if ('error' in planned) {
              problem = planned.error;
              return false;
            }
            if (Object.keys(planned.positions).length === 0) return false;
            if (movesCreateOverlap(level, planned.positions)) {
              problem = WALL_OVERLAP_MESSAGE;
              return false;
            }
            // Openings on the moved walls keep their offset from the a end; on a neighbour whose a
            // end slides they keep their distance from its fixed b end (moveNodesInPlace). Clamped
            // by normalize.
            moveNodesInPlace(level, planned.positions);
            normalizeLevel(level, new Set(Object.keys(planned.positions)));
          });
          return problem;
        },

        renovateWalls: (levelId, shiftsIn) => {
          let out: { walls: Id[] } | { error: string } = { error: 'Nothing to move.' };
          editLevel(levelId, (level, plan) => {
            const shifts = new Map(Object.entries(shiftsIn).filter(([, s]) => isPoint(s) && Math.hypot(s.x, s.y) > 1e-9));
            if (shifts.size === 0) return false;
            const r = planRenovation(current(level), shifts);
            if ('error' in r) {
              out = r;
              return false;
            }
            const before = { walls: { ...current(level).walls }, openings: { ...current(level).openings } };
            level.nodes = r.level.nodes;
            level.walls = r.level.walls;
            level.openings = r.level.openings;
            tagWorkSince(before, level, plan);
            out = { walls: r.walls };
          });
          return out;
        },

        moveNode: (levelId, nodeId, pos, opts) =>
          editLevel(levelId, (level) => {
            if (!level.nodes[nodeId]) return false;
            if (movesCreateOverlap(level, { [nodeId]: pos })) return false;
            moveNodesInPlace(level, { [nodeId]: pos });
            if (opts?.normalize !== false) normalizeLevel(level, new Set([nodeId]));
          }),

        moveNodes: (levelId, positions, opts) =>
          editLevel(levelId, (level) => {
            // A step that would lay a wall on top of another is refused: the nodes stay put.
            if (movesCreateOverlap(level, positions)) return false;
            moveNodesInPlace(level, positions);
            if (opts?.normalize !== false) normalizeLevel(level, new Set(Object.keys(positions)));
          }),

        normalize: (levelId, moved) =>
          editLevel(levelId, (level) => {
            normalizeLevel(level, moved ? new Set(moved) : undefined);
          }),

        deleteWalls: (levelId, ids) =>
          editLevel(levelId, (level) => {
            deleteInPlace(level, [], ids);
            clampOpenings(level);
          }),

        deleteNodes: (levelId, ids) =>
          editLevel(levelId, (level) => {
            deleteInPlace(level, ids, []);
            clampOpenings(level);
          }),

        deleteEntities: (levelId, sel) =>
          editLevel(levelId, (level, plan) => {
            // A staircase goes with its pieces.
            const staircases = new Set(sel.staircases ?? []);
            const stairs = [...(sel.stairs ?? []), ...Object.values(level.stairs).flatMap((st) => (st.staircaseId && staircases.has(st.staircaseId) ? [st.id] : []))];
            // The corners the deleted walls ended at: a T left there may join its two walls again.
            const gone = new Set(sel.walls);
            const goneNodes = new Set(sel.nodes);
            const ends = Object.values(level.walls).flatMap((w) => (gone.has(w.id) || goneNodes.has(w.a) || goneNodes.has(w.b) ? [w.a, w.b] : []));
            deleteInPlace(level, sel.nodes, sel.walls, sel.openings, sel.rooms, stairs, sel.roofs, sel.fixtures, sel.decks, sel.floorOpenings);
            mergeLeftoverJoints(level, ends);
            for (const id of sel.members ?? []) delete level.members[id];
            for (const id of sel.joistZones ?? []) delete level.joistZones[id];
            for (const id of sel.gradePoints ?? []) delete plan.site.gradePoints[id];
            for (const id of sel.columns ?? []) delete plan.site.columns[id];
            for (const id of sel.surfaces ?? []) delete plan.site.surfaces[id];
            for (const id of sel.fences ?? []) delete plan.site.fences[id];
            // Removing walls changes the corner joins of their neighbours.
            if (sel.nodes.length || sel.walls.length) clampOpenings(level);
          }),

        updateWall: (levelId, id, patch) =>
          editLevel(levelId, (level) => {
            const w = level.walls[id];
            if (!w) return false;
            Object.assign(w, patch);
            if (patch.a !== undefined || patch.b !== undefined) normalizeLevel(level);
            if ('heightOverride' in patch) clampOpeningHeights(level, new Set([id]));
          }),

        updateWalls: (levelId, ids, patch) =>
          editLevel(levelId, (level) => {
            if (patch.thickness !== undefined && !(patch.thickness > 0)) return false;
            if (patch.band && !(patch.band.height > 0)) return false;
            for (const id of ids) {
              const w = level.walls[id];
              if (!w) continue;
              for (const [key, value] of Object.entries(patch) as [keyof Wall, unknown][]) {
                // undefined clears an optional field; required fields are never removed.
                if (value === undefined) {
                  if (key === 'heightOverride' || key === 'finish' || key === 'color' || key === 'bearing' || key === 'band') delete w[key];
                } else if (key === 'band') {
                  // A copy per wall, the colour lower-cased, in the loader's key order.
                  const b = value as NonNullable<Wall['band']>;
                  w.band = { finish: b.finish, ...(b.color ? { color: b.color.toLowerCase() } : {}), height: b.height };
                } else if (w[key] !== value) (w as unknown as Record<string, unknown>)[key] = value;
              }
            }
            // A wall that now stands with a wall it crosses is split there (normalizeLevel).
            if (patch.phase !== undefined) normalizeLevel(level);
            // Thickness and phase change the corner joins, so the core intervals of neighbours.
            if (patch.thickness !== undefined || patch.phase !== undefined) clampOpenings(level);
            // A lower wall takes its openings down with it.
            if ('heightOverride' in patch) clampOpeningHeights(level, new Set(ids));
          }),

        setWallKind: (levelId, ids, kind) =>
          set((s) => {
            const level = s.plan.levels[levelId];
            if (!level) return;
            const st = s.plan.settings;
            const def = (k: WallKind) =>
              k === 'exterior' ? st.defaultExteriorThickness : st.defaultInteriorThickness;
            for (const id of ids) {
              const w = level.walls[id];
              if (!w || w.kind === kind) continue;
              if (Math.abs(w.thickness - def(w.kind)) < 1e-9) w.thickness = def(kind);
              w.kind = kind;
            }
            clampOpenings(level);
            touch(s.plan);
          }),

        setWallLength: (levelId, wallId, length, anchor = 'start') => {
          let ok = false;
          editLevel(levelId, (level) => {
            const w = level.walls[wallId];
            if (!w || !(length > MERGE_EPS) || !Number.isFinite(length)) return false;
            const a = level.nodes[w.a];
            const b = level.nodes[w.b];
            const len = dist(a, b);
            if (len < 1e-9) return false;
            const ux = (b.x - a.x) / len;
            const uy = (b.y - a.y) / len;
            const [movedId, pos] =
              anchor === 'start'
                ? [w.b, { x: a.x + ux * length, y: a.y + uy * length }]
                : [w.a, { x: b.x - ux * length, y: b.y - uy * length }];
            if (movesCreateOverlap(level, { [movedId]: pos })) return false;
            moveNodesInPlace(level, { [movedId]: pos });
            normalizeLevel(level, new Set([movedId]));
            ok = true;
          });
          return ok;
        },

        addOpening: (levelId, input) => {
          let id: Id | null = null;
          editLevel(levelId, (level, plan) => {
            const wall = level.walls[input.wallId];
            if (!wall) return false;
            if (!(input.width > 0) || !(input.height > 0) || !(input.sill >= 0)) return false;
            if (!Number.isFinite(input.offset)) return false;
            if (!openingFitsHeight(input, wallHeightOf(level, wall))) return false;
            const [s0, s1] = coreInterval(level, wall.id, input.phase, draftFootprints(level))!;
            if (s1 - s0 < input.width) return false;
            const opening: Opening = {
              ...input,
              id: input.id ?? newId(),
              offset: clampOpeningOffset(input.offset, input.width, s0, s1),
            };
            if (opening.type !== 'door') delete opening.swing;
            tagWork(opening, plan);
            level.openings[opening.id] = opening;
            id = opening.id;
          });
          return id;
        },

        updateOpening: (levelId, id, patch) =>
          editLevel(levelId, (level) => {
            const o = level.openings[id];
            if (!o) return false;
            if (patch.width !== undefined && !(patch.width > 0)) return false;
            if (patch.height !== undefined && !(patch.height > 0)) return false;
            if (patch.sill !== undefined && !(patch.sill >= 0)) return false;
            if (patch.offset !== undefined && !Number.isFinite(patch.offset)) return false;
            if (patch.wallId !== undefined && !level.walls[patch.wallId]) return false;
            if (patch.height !== undefined || patch.sill !== undefined || patch.wallId !== undefined) {
              const target = level.walls[patch.wallId ?? o.wallId];
              const next = { height: patch.height ?? o.height, sill: patch.sill ?? o.sill };
              if (target && !openingFitsHeight(next, wallHeightOf(level, target))) return false;
            }
            for (const [key, value] of Object.entries(patch) as [keyof Opening, unknown][]) {
              // undefined clears an optional field; required fields are never removed.
              if (value === undefined) {
                if (OPTIONAL_OPENING_KEYS.has(key)) delete o[key];
              } else (o as unknown as Record<string, unknown>)[key] = value;
            }
            if (o.type !== 'door' && o.swing) delete o.swing;
            clampOpenings(level, o.wallId);
          }),

        deleteOpenings: (levelId, ids) =>
          editLevel(levelId, (level) => {
            for (const id of ids) delete level.openings[id];
          }),

        addRoom: (levelId, input) => {
          let id: Id | null = null;
          editLevel(levelId, (level, plan) => {
            const name = input.name.trim();
            if (!name || !Number.isFinite(input.anchor.x) || !Number.isFinite(input.anchor.y)) return false;
            const room: Room = { ...input, id: input.id ?? newId(), name, anchor: { x: input.anchor.x, y: input.anchor.y } };
            if (input.proposedFloor) room.proposedFloor = { finish: input.proposedFloor.finish, ...(input.proposedFloor.color ? { color: input.proposedFloor.color.toLowerCase() } : {}) };
            if (input.proposedWall) room.proposedWall = { finish: input.proposedWall.finish, ...(input.proposedWall.color ? { color: input.proposedWall.color.toLowerCase() } : {}) };
            tagWork(room, plan);
            level.rooms[room.id] = room;
            id = room.id;
          });
          return id;
        },

        updateRoom: (levelId, id, patch) =>
          editLevel(levelId, (level) => {
            const r = level.rooms[id];
            if (!r) return false;
            if (patch.name !== undefined) {
              const name = patch.name.trim();
              if (!name) return false;
              const others = Object.keys(patch).some((k) => k !== 'name' && (patch[k as keyof RoomPatch] !== undefined || (OPTIONAL_ROOM_KEYS as readonly string[]).includes(k)));
              if (name === r.name && !others) return false;
              r.name = name;
            }
            if (patch.anchor !== undefined) {
              if (!Number.isFinite(patch.anchor.x) || !Number.isFinite(patch.anchor.y)) return false;
              r.anchor = { x: patch.anchor.x, y: patch.anchor.y };
            }
            if ('ceilingOverride' in patch) {
              if (patch.ceilingOverride === undefined) delete r.ceilingOverride;
              else r.ceilingOverride = patch.ceilingOverride;
            }
            // Absent means existing; undefined clears it.
            if ('phase' in patch) {
              if (patch.phase === undefined) delete r.phase;
              else r.phase = patch.phase;
            }
            // Interior finishes: undefined clears a field; colours lower-case, the wainscot copied.
            for (const key of ['wallFinish', 'wallColor', 'wainscot', 'floorFinish', 'floorColor', 'ceilingFinish', 'ceilingColor'] as const) {
              if (!(key in patch)) continue;
              const v = patch[key];
              if (v === undefined) delete r[key];
              else if (key === 'wainscot') {
                const w = v as NonNullable<Room['wainscot']>;
                r.wainscot = { height: w.height, finish: w.finish, ...(w.color ? { color: w.color.toLowerCase() } : {}) };
              } else (r as unknown as Record<string, string>)[key] = key.endsWith('Color') ? (v as string).toLowerCase() : (v as string);
            }
            // The ceiling's shape (DESIGN.md "Ceilings"): a flat top only on one that follows the roof.
            if ('ceilingShape' in patch) {
              if (patch.ceilingShape === 'roof') r.ceilingShape = 'roof';
              else if (patch.ceilingShape === undefined) {
                delete r.ceilingShape;
                delete r.ceilingFlatTop;
              } else return false;
            }
            if ('ceilingFlatTop' in patch) {
              const h = patch.ceilingFlatTop;
              if (h === undefined) delete r.ceilingFlatTop;
              else if (!(Number.isFinite(h) && h > 0) || r.ceilingShape !== 'roof') return false;
              else r.ceilingFlatTop = h;
            }
            if ('proposedFloor' in patch) {
              const p = patch.proposedFloor;
              if (p === undefined) delete r.proposedFloor;
              else r.proposedFloor = { finish: p.finish, ...(p.color ? { color: p.color.toLowerCase() } : {}) };
            }
            if ('proposedWall' in patch) {
              const p = patch.proposedWall;
              if (p === undefined) delete r.proposedWall;
              else r.proposedWall = { finish: p.finish, ...(p.color ? { color: p.color.toLowerCase() } : {}) };
            }
          }),

        deleteRooms: (levelId, ids) =>
          editLevel(levelId, (level) => {
            if (!ids.some((id) => level.rooms[id])) return false;
            for (const id of ids) delete level.rooms[id];
          }),

        addStairs: (levelId, input) => {
          let id: Id | null = null;
          editLevel(levelId, (level, plan) => {
            if (!validStairs(input) || stairsHeightProblem(input, floorToFloor(plan, levelId), isLowestLevel(plan, levelId))) return false;
            const stairs: Stairs = {
              ...input,
              id: input.id ?? newId(),
              origin: { x: input.origin.x, y: input.origin.y },
              direction: normalizeDegrees(input.direction),
            };
            const railings = stairsRailingsOf(input.railings);
            if (railings) stairs.railings = railings;
            else delete stairs.railings;
            if (!stairs.staircaseId || !level.staircases[stairs.staircaseId]) delete stairs.staircaseId;
            for (const k of ['headroom', 'holeStart', 'open', ...STAIRS_HEIGHT_KEYS] as const) if (stairs[k] === undefined) delete stairs[k];
            tagWork(stairs, plan);
            level.stairs[stairs.id] = stairs;
            id = stairs.id;
          });
          return id;
        },

        updateStairs: (levelId, id, patch) =>
          editLevel(levelId, (level, plan) => {
            const st = level.stairs[id];
            if (!st) return false;
            const next = { ...st, ...patch };
            if (!validStairs(next, { width: patch.width !== undefined, run: patch.run !== undefined || 'risers' in patch })) return false;
            // Heights are checked when they change, so an older flight can still move or change phase
            // after the level's height changed under it.
            if (STAIRS_HEIGHT_KEYS.some((k) => k in patch) && stairsHeightProblem(next, floorToFloor(plan, levelId), isLowestLevel(plan, levelId))) return false;
            if (patch.origin) st.origin = { x: patch.origin.x, y: patch.origin.y };
            if (patch.direction !== undefined) st.direction = normalizeDegrees(patch.direction);
            if (patch.width !== undefined) st.width = patch.width;
            if (patch.run !== undefined) st.run = patch.run;
            if (patch.phase !== undefined) st.phase = patch.phase;
            if (patch.cutsFloorAbove !== undefined) st.cutsFloorAbove = patch.cutsFloorAbove;
            // Optional fields: undefined clears them (back to the headroom rule / 80", a flight from the
            // floor to the floor above, the 7.5" riser rule, a solid flight).
            for (const k of ['headroom', 'holeStart', ...STAIRS_HEIGHT_KEYS] as const) {
              if (!(k in patch)) continue;
              const v = patch[k];
              if (v === undefined) {
                if (k in st) delete st[k];
              } else if (st[k] !== v) st[k] = v;
            }
            if ('open' in patch) {
              if (patch.open === undefined) delete st.open;
              else if (st.open !== patch.open) st.open = patch.open;
            }
            // Railings: only the sides that have one are stored; none clears the field.
            if ('railings' in patch) {
              const r = stairsRailingsOf(patch.railings);
              if (!r) delete st.railings;
              else if (st.railings?.left !== r.left || st.railings?.right !== r.right || st.railings?.end !== r.end) st.railings = r;
            }
          }),

        deleteStairs: (levelId, ids) =>
          editLevel(levelId, (level) => {
            if (!ids.some((id) => level.stairs[id])) return false;
            for (const id of ids) delete level.stairs[id];
            pruneStaircases(level);
          }),

        moveStairs: (levelId, positions) =>
          editLevel(levelId, (level) => {
            let changed = false;
            for (const [id, p] of Object.entries(positions)) {
              const st = level.stairs[id];
              if (!st || !isPoint(p) || (st.origin.x === p.x && st.origin.y === p.y)) continue;
              st.origin = { x: p.x, y: p.y };
              changed = true;
            }
            if (!changed) return false;
          }),

        groupStairs: (levelId, ids, style) => {
          let made: Id | null = null;
          editLevel(levelId, (level) => {
            const pieces = ids.flatMap((id) => (level.stairs[id] ? [level.stairs[id]] : []));
            if (!pieces.length || (style && staircaseProblem(style))) return false;
            const sc = cleanStaircase({ ...style, id: style?.id ?? newId() });
            level.staircases[sc.id] = sc;
            for (const st of pieces) st.staircaseId = sc.id;
            pruneStaircases(level);
            made = sc.id;
          });
          return made;
        },

        updateStaircase: (levelId, id, patch) =>
          editLevel(levelId, (level) => {
            const sc = level.staircases[id];
            if (!sc) return false;
            const keys = (Object.keys(patch) as StaircaseStyleKey[]).filter((k) => (STAIRCASE_STYLE_KEYS as readonly string[]).includes(k));
            if (keys.some((k) => staircaseFieldProblem(k, patch[k]))) return false;
            let changed = false;
            for (const k of keys) {
              let v = patch[k];
              if (typeof v === 'string' && (k === 'treadColor' || k === 'riserColor')) v = v.toLowerCase();
              if (v === undefined) {
                if (!(k in sc)) continue;
                delete sc[k];
              } else if (sc[k] === v) continue;
              else (sc as unknown as Record<string, unknown>)[k] = v;
              changed = true;
            }
            if (!changed) return false;
          }),

        ungroupStaircase: (levelId, id) =>
          editLevel(levelId, (level) => {
            if (!level.staircases[id]) return false;
            for (const st of Object.values(level.stairs)) if (st.staircaseId === id) delete st.staircaseId;
            delete level.staircases[id];
          }),

        addRoof: (levelId, input) => {
          let id: Id | null = null;
          editLevel(levelId, (level, plan) => {
            const roof = cleanRoof({ ...input, id: input.id ?? newId() });
            if (roofProblem(roof) || roofOptionProblem(roof)) return false;
            tagWork(roof, plan);
            level.roofs[roof.id] = roof;
            id = roof.id;
          });
          return id;
        },

        updateRoof: (levelId, id, patch) =>
          editLevel(levelId, (level) => {
            const r = level.roofs[id];
            if (!r) return false;
            const next = cleanRoof({ ...r, ...patch, id });
            if (roofProblem(next) || roofOptionProblem(next)) return false;
            const keys = Object.keys(patch) as (keyof RoofPatch)[];
            const same = (k: keyof RoofPatch) =>
              k === 'outline'
                ? next.outline.length === r.outline.length && next.outline.every((p, i) => p.x === r.outline[i].x && p.y === r.outline[i].y)
                : k === 'rafter'
                  ? next.rafter?.depth === r.rafter?.depth && next.rafter?.spacing === r.rafter?.spacing
                  : next[k] === r[k];
            if (keys.every(same)) return false;
            for (const k of keys) {
              if (same(k)) continue;
              // An optional field (colour, eaves, rafter, board colour, weathering) cleared.
              if (next[k] === undefined) delete r[k];
              else (r as unknown as Record<string, unknown>)[k] = next[k];
            }
          }),

        deleteRoofs: (levelId, ids) =>
          editLevel(levelId, (level) => {
            if (!ids.some((id) => level.roofs[id])) return false;
            for (const id of ids) delete level.roofs[id];
          }),

        addDeck: (levelId, input) => {
          let id: Id | null = null;
          editLevel(levelId, (level, plan) => {
            const deck = cleanDeck({ ...input, id: input.id ?? newId() });
            if (deckProblem(deck)) return false;
            tagWork(deck, plan);
            level.decks[deck.id] = deck;
            id = deck.id;
          });
          return id;
        },

        updateDeck: (levelId, id, patch) =>
          editLevel(levelId, (level) => {
            const d = level.decks[id];
            if (!d) return false;
            const next = cleanDeck({ ...d, ...patch, railings: patch.railings ?? d.railings, id });
            if (deckProblem(next)) return false;
            // A new outline can change the edge count, and with it the railings.
            const keys = (['outline', 'elevation', 'railings', 'phase', 'color'] as const).filter((k) => k in patch || (k === 'railings' && 'outline' in patch));
            const same = (k: (typeof keys)[number]) =>
              k === 'outline'
                ? next.outline.length === d.outline.length && next.outline.every((p, i) => p.x === d.outline[i].x && p.y === d.outline[i].y)
                : k === 'railings'
                  ? next.railings.length === d.railings.length && next.railings.every((r, i) => r === d.railings[i])
                  : next[k] === d[k];
            if (keys.every(same)) return false;
            for (const k of keys) {
              if (same(k)) continue;
              if (next[k] === undefined) delete d[k];
              else (d as unknown as Record<string, unknown>)[k] = next[k];
            }
          }),

        deleteDecks: (levelId, ids) =>
          editLevel(levelId, (level) => {
            if (!ids.some((id) => level.decks[id])) return false;
            for (const id of ids) delete level.decks[id];
          }),

        addFloorOpening: (levelId, input) => {
          let id: Id | null = null;
          editLevel(levelId, (level, plan) => {
            const fo = cleanFloorOpening({ ...input, id: input.id ?? newId() });
            if (floorOpeningProblem(fo)) return false;
            tagWork(fo, plan);
            level.floorOpenings[fo.id] = fo;
            id = fo.id;
          });
          return id;
        },

        updateFloorOpening: (levelId, id, patch) =>
          editLevel(levelId, (level) => {
            const o = level.floorOpenings[id];
            if (!o) return false;
            const next = cleanFloorOpening({ ...o, ...patch, railings: patch.railings ?? o.railings, id });
            if (floorOpeningProblem(next)) return false;
            const samePoints = next.outline.length === o.outline.length && next.outline.every((p, i) => p.x === o.outline[i].x && p.y === o.outline[i].y);
            const sameRails = next.railings.length === o.railings.length && next.railings.every((r, i) => r === o.railings[i]);
            if (samePoints && sameRails && next.phase === o.phase) return false;
            level.floorOpenings[id] = next;
          }),

        deleteFloorOpenings: (levelId, ids) =>
          editLevel(levelId, (level) => {
            if (!ids.some((id) => level.floorOpenings[id])) return false;
            for (const id of ids) delete level.floorOpenings[id];
          }),

        addMember: (levelId, input) => {
          let id: Id | null = null;
          editLevel(levelId, (level, plan) => {
            const m = cleanMember({ ...input, id: input.id ?? newId() } as Member);
            if (memberProblem(m, isLowestLevel(plan, levelId))) return false;
            tagWork(m, plan);
            level.members[m.id] = m;
            id = m.id;
          });
          return id;
        },

        updateMember: (levelId, id, patch) =>
          editLevel(levelId, (level, plan) => {
            const m = level.members[id];
            if (!m) return false;
            const merged = { ...m, ...patch, id, kind: m.kind } as Member;
            for (const k of ['label', 'footing', 'za', 'zb', 'base', 'top', 'color', 'profile'] as const) if (k in patch && (patch as Record<string, unknown>)[k] === undefined) delete (merged as unknown as Record<string, unknown>)[k];
            const next = cleanMember(merged);
            if (memberProblem(next, isLowestLevel(plan, levelId))) return false;
            if (JSON.stringify(next) === JSON.stringify(m)) return false;
            level.members[id] = next;
          }),

        placeMembers: (levelId, places) =>
          editLevel(levelId, (level) => {
            let changed = false;
            for (const [id, p] of Object.entries(places)) {
              const m = level.members[id];
              if (!m) continue;
              if (m.kind === 'beam') {
                if (p.a && isPoint(p.a) && (p.a.x !== m.a.x || p.a.y !== m.a.y)) (m.a = { x: p.a.x, y: p.a.y }), (changed = true);
                if (p.b && isPoint(p.b) && (p.b.x !== m.b.x || p.b.y !== m.b.y)) (m.b = { x: p.b.x, y: p.b.y }), (changed = true);
              } else if (p.at && isPoint(p.at) && (p.at.x !== m.at.x || p.at.y !== m.at.y)) (m.at = { x: p.at.x, y: p.at.y }), (changed = true);
            }
            if (!changed) return false;
          }),

        addJoistZone: (levelId, input) => {
          let id: Id | null = null;
          editLevel(levelId, (level, plan) => {
            const z: JoistZone = { ...input, id: input.id ?? newId(), outline: input.outline.map((p) => ({ x: p.x, y: p.y })), joists: normalizeJoists(input.joists) };
            if (joistZoneProblem(z)) return false;
            tagWork(z, plan);
            level.joistZones[z.id] = z;
            id = z.id;
          });
          return id;
        },

        updateJoistZone: (levelId, id, patch) =>
          editLevel(levelId, (level) => {
            const z = level.joistZones[id];
            if (!z) return false;
            const next: JoistZone = { ...z, ...patch, id, outline: (patch.outline ?? z.outline).map((p) => ({ x: p.x, y: p.y })), joists: normalizeJoists(patch.joists ?? z.joists) };
            if (joistZoneProblem(next) || JSON.stringify(next) === JSON.stringify(z)) return false;
            level.joistZones[id] = next;
          }),

        setLevelFraming: (levelId, framing) =>
          editLevel(levelId, (level) => {
            if (framing === undefined) {
              if (!level.framing) return false;
              delete level.framing;
              return;
            }
            if (framingProblem(framing)) return false;
            const next: LevelFraming = { joists: normalizeJoists(framing.joists), ...(framing.depth !== undefined ? { depth: framing.depth } : {}) };
            if (JSON.stringify(next) === JSON.stringify(level.framing)) return false;
            level.framing = next;
          }),

        addFixture: (levelId, input) => {
          let id: Id | null = null;
          editLevel(levelId, (level, plan) => {
            const f = cleanFixture({ ...input, id: input.id ?? newId() });
            if (fixtureProblem(f)) return false;
            tagWork(f, plan);
            level.fixtures[f.id] = f;
            id = f.id;
          });
          return id;
        },

        updateFixture: (levelId, id, patch) => editLevel(levelId, (level) => (patchFixture(level, id, patch) ? undefined : false)),

        updateFixtures: (levelId, ids, patch) =>
          editLevel(levelId, (level) => {
            let changed = false;
            for (const id of ids) if (patchFixture(level, id, patch)) changed = true;
            if (!changed) return false;
          }),

        deleteFixtures: (levelId, ids) =>
          editLevel(levelId, (level) => {
            if (!ids.some((id) => level.fixtures[id])) return false;
            for (const id of ids) delete level.fixtures[id];
          }),

        moveFixtures: (levelId, positions) =>
          editLevel(levelId, (level) => {
            let changed = false;
            for (const [id, p] of Object.entries(positions)) {
              const f = level.fixtures[id];
              if (!f || !isPoint(p) || (f.origin.x === p.x && f.origin.y === p.y)) continue;
              f.origin = { x: p.x, y: p.y };
              changed = true;
            }
            if (!changed) return false;
          }),

        duplicateFixtures: (levelId, ids, offset) => {
          const made: Id[] = [];
          editLevel(levelId, (level, plan) => {
            if (!isPoint(offset)) return false;
            for (const id of ids) {
              const f = level.fixtures[id];
              if (!f) continue;
              const copy = cleanFixture({ ...f, id: newId(), origin: { x: f.origin.x + offset.x, y: f.origin.y + offset.y } });
              // A copy is new work of its own: it goes to the option being drawn in.
              delete copy.optionIds;
              tagWork(copy, plan);
              level.fixtures[copy.id] = copy;
              made.push(copy.id);
            }
            if (made.length === 0) return false;
          });
          return made;
        },

        updateFinishes: (levelId, patch) =>
          editLevel(levelId, (level) => {
            const cur: LevelFinishes = { ...(level.finishes ?? {}) };
            let changed = false;
            for (const [k, v] of Object.entries(patch) as [keyof LevelFinishes, LevelFinishes[keyof LevelFinishes] | undefined][]) {
              const value = typeof v === 'string' && (k === 'cabinetColor' || k === 'counterColor' || k === 'ceilingColor' || k === 'backsplashColor') ? v.toLowerCase() : v;
              if (k === 'cabinetWood' && value !== undefined && !isWoodId(value)) continue;
              if ((KITCHEN_FINISH_KEYS as readonly string[]).includes(k) && value !== undefined && !KITCHEN_FINISH_FIELDS[k as KitchenFinishField](value)) continue;
              if (cur[k] === value) continue;
              if (value === undefined) delete cur[k];
              else (cur as Record<string, unknown>)[k] = value;
              changed = true;
            }
            if (!changed) return false;
            if (Object.keys(cur).length) level.finishes = cur;
            else delete level.finishes;
          }),

        splitWall: (levelId, wallId, at) => {
          let problem: string | null = null;
          editLevel(levelId, (level) => {
            const w = level.walls[wallId];
            if (!w) {
              problem = 'No such wall.';
              return false;
            }
            const a = level.nodes[w.a];
            const b = level.nodes[w.b];
            const len = dist(a, b);
            if (!Number.isFinite(at) || at <= MERGE_EPS * 2 || at >= len - MERGE_EPS * 2) {
              problem = 'Split the wall somewhere along it, not at an end.';
              return false;
            }
            for (const o of Object.values(level.openings)) {
              if (o.wallId === wallId && Math.abs(o.offset - at) < o.width / 2 + MERGE_EPS) {
                problem = 'That point is inside an opening: move the opening or split beside it.';
                return false;
              }
            }
            const t = at / len;
            const id = newId();
            level.nodes[id] = { id, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
            normalizeLevel(level);
          });
          return problem;
        },

        addGradePoint: (input) => {
          let id: Id | null = null;
          editSite((site) => {
            if (!isPoint(input.at) || !Number.isFinite(input.elevation)) return false;
            const gp: GradePoint = { id: input.id ?? newId(), at: { x: input.at.x, y: input.at.y }, elevation: input.elevation };
            site.gradePoints[gp.id] = gp;
            id = gp.id;
          });
          return id;
        },

        updateGradePoint: (id, patch) =>
          editSite((site) => {
            const g = site.gradePoints[id];
            if (!g) return false;
            if (patch.at && !isPoint(patch.at)) return false;
            if (patch.elevation !== undefined && !Number.isFinite(patch.elevation)) return false;
            const moved = !!patch.at && (patch.at.x !== g.at.x || patch.at.y !== g.at.y);
            const raised = patch.elevation !== undefined && patch.elevation !== g.elevation;
            if (!moved && !raised) return false;
            if (moved) g.at = { x: patch.at!.x, y: patch.at!.y };
            if (raised) g.elevation = patch.elevation!;
          }),

        deleteGradePoints: (ids) =>
          editSite((site) => {
            if (!ids.some((id) => site.gradePoints[id])) return false;
            for (const id of ids) delete site.gradePoints[id];
          }),

        clearGradePoints: () =>
          editSite((site) => {
            if (Object.keys(site.gradePoints).length === 0) return false;
            site.gradePoints = {};
          }),

        addColumn: (input) => {
          let id: Id | null = null;
          editSite((site, plan) => {
            const col = cleanColumn({ ...input, id: input.id ?? newId() });
            if (columnProblem(col)) return false;
            tagWork(col, plan);
            site.columns[col.id] = col;
            id = col.id;
          });
          return id;
        },

        updateColumn: (id, patch) =>
          editSite((site) => {
            const c = site.columns[id];
            if (!c) return false;
            const next = cleanColumn({ ...c, ...patch, id });
            if (columnProblem(next)) return false;
            const keys = Object.keys(patch) as (keyof ColumnPatch)[];
            const same = (k: keyof ColumnPatch) => (k === 'at' ? next.at.x === c.at.x && next.at.y === c.at.y : next[k] === c[k]);
            if (keys.every(same)) return false;
            for (const k of keys) {
              if (same(k)) continue;
              // An optional field (colour, cap) cleared; the required ones never are (columnProblem).
              if (next[k] === undefined) delete c[k];
              else (c as unknown as Record<string, unknown>)[k] = next[k];
            }
          }),

        deleteColumns: (ids) =>
          editSite((site) => {
            if (!ids.some((id) => site.columns[id])) return false;
            for (const id of ids) delete site.columns[id];
          }),

        addSurface: (input) => {
          let id: Id | null = null;
          editSite((site, plan) => {
            const sf = cleanSurface({ ...input, id: input.id ?? newId() });
            if (surfaceProblem(sf)) return false;
            tagWork(sf, plan);
            site.surfaces[sf.id] = sf;
            id = sf.id;
          });
          return id;
        },

        updateSurface: (id, patch) =>
          editSite((site) => {
            const sf = site.surfaces[id];
            if (!sf) return false;
            const next = cleanSurface({ ...sf, ...patch, id });
            if (surfaceProblem(next)) return false;
            return applySitePatch(sf, next, Object.keys(patch) as (keyof SurfacePatch)[]);
          }),

        deleteSurfaces: (ids) =>
          editSite((site) => {
            if (!ids.some((id) => site.surfaces[id])) return false;
            for (const id of ids) delete site.surfaces[id];
          }),

        addFence: (input) => {
          let id: Id | null = null;
          editSite((site, plan) => {
            const f = cleanFence({ ...input, id: input.id ?? newId() });
            if (fenceProblem(f)) return false;
            tagWork(f, plan);
            site.fences[f.id] = f;
            id = f.id;
          });
          return id;
        },

        updateFence: (id, patch) =>
          editSite((site) => {
            const f = site.fences[id];
            if (!f) return false;
            const next = cleanFence({ ...f, ...patch, id });
            if (fenceProblem(next)) return false;
            return applySitePatch(f, next, Object.keys(patch) as (keyof FencePatch)[]);
          }),

        deleteFences: (ids) =>
          editSite((site) => {
            if (!ids.some((id) => site.fences[id])) return false;
            for (const id of ids) delete site.fences[id];
          }),

        moveSiteItems: (points, columns, shapes = {}) =>
          editSite((site) => {
            let changed = false;
            for (const [id, p] of Object.entries(points)) {
              const g = site.gradePoints[id];
              if (!g || !isPoint(p) || (g.at.x === p.x && g.at.y === p.y)) continue;
              g.at = { x: p.x, y: p.y };
              changed = true;
            }
            for (const [id, p] of Object.entries(columns)) {
              const c = site.columns[id];
              if (!c || !isPoint(p) || (c.at.x === p.x && c.at.y === p.y)) continue;
              c.at = { x: p.x, y: p.y };
              changed = true;
            }
            // A surface or fence takes its new shape only when it can still be used (the same count of points, moved).
            for (const [id, outline] of Object.entries(shapes.surfaces ?? {})) {
              const sf = site.surfaces[id];
              if (!sf || !Array.isArray(outline) || outline.length !== sf.outline.length || !outline.every(isPoint) || samePoints(sf.outline, outline)) continue;
              sf.outline = outline.map((p) => ({ x: p.x, y: p.y }));
              changed = true;
            }
            for (const [id, pts] of Object.entries(shapes.fences ?? {})) {
              const f = site.fences[id];
              if (!f || !Array.isArray(pts) || pts.length !== f.points.length || !pts.every(isPoint) || samePoints(f.points, pts)) continue;
              f.points = pts.map((p) => ({ x: p.x, y: p.y }));
              changed = true;
            }
            if (!changed) return false;
          }),

        setNorthAngle: (degrees) =>
          editSite((site) => {
            if (!Number.isFinite(degrees)) return false;
            const next = normalizeDegrees(degrees);
            if (next === site.northAngle) return false;
            site.northAngle = next;
          }),

        setPhase: (levelId, sel, phase) =>
          editLevel(levelId, (level, plan) => {
            // In a plan of several design options the change is the active option's (optionOps applyPhaseIn).
            const work = workOptionOf(plan);
            const all = plan.options.map((o) => o.id);
            let changed = false;
            const apply = (e: { id: Id; phase?: Phase; optionIds?: Id[] } | undefined): boolean => {
              if (!e || !applyPhaseIn(e, phase, work, all)) return false;
              changed = true;
              return true;
            };
            for (const id of sel.columns ?? []) apply(plan.site.columns[id]);
            for (const id of sel.surfaces ?? []) apply(plan.site.surfaces[id]);
            for (const id of sel.fences ?? []) apply(plan.site.fences[id]);
            for (const id of sel.roofs ?? []) apply(level.roofs[id]);
            const staircases = new Set(sel.staircases ?? []);
            for (const st of Object.values(level.stairs)) {
              if (sel.stairs?.includes(st.id) || (st.staircaseId && staircases.has(st.staircaseId))) apply(st);
            }
            for (const id of sel.fixtures ?? []) apply(level.fixtures[id]);
            for (const id of sel.decks ?? []) apply(level.decks[id]);
            for (const id of sel.members ?? []) apply(level.members[id]);
            for (const id of sel.joistZones ?? []) apply(level.joistZones[id]);
            for (const id of sel.floorOpenings ?? []) apply(level.floorOpenings[id]);
            // A room label's phase is optional: existing is stored as no phase at all.
            for (const id of sel.rooms ?? []) {
              const r = level.rooms[id];
              if (apply(r) && r.phase === 'existing') delete r.phase;
            }
            let wallPhase = false;
            for (const id of sel.walls) if (apply(level.walls[id])) wallPhase = true;
            for (const id of sel.openings) apply(level.openings[id]);
            if (!changed) return false;
            // A wall that now stands with a wall it crosses (a demolished one kept) is split there.
            if (wallPhase) normalizeLevel(level);
            clampOpenings(level);
          }),

        addOption: (name) => {
          let id = '';
          set((s) => {
            id = addOptionTo(s.plan, name).id;
            touch(s.plan);
          });
          return id;
        },

        duplicateOption: (srcId, name) => {
          let id: Id | null = null;
          set((s) => {
            const opt = duplicateOptionIn(s.plan, srcId, name);
            if (!opt) return;
            id = opt.id;
            touch(s.plan);
          });
          return id;
        },

        renameOption: (id, name) =>
          set((s) => {
            if (renameOptionIn(s.plan, id, name)) touch(s.plan);
          }),

        deleteOption: (id) => {
          let ok = false;
          set((s) => {
            ok = deleteOptionFrom(s.plan, id);
            if (ok) touch(s.plan);
          });
          return ok;
        },

        setEntityOption: (levelId, sel, optionIds) =>
          set((s) => {
            if (setEntityOptionsIn(s.plan, levelId, sel, optionIds)) {
              const level = s.plan.levels[levelId];
              if (level) clampOpenings(level);
              touch(s.plan);
            }
          }),

        updateOptionLook: (optionId, patch) =>
          set((s) => {
            const opt = s.plan.options.find((o) => o.id === optionId);
            if (!opt) return;
            const look: Record<string, unknown> = { ...(opt.proposedLook ?? {}) };
            for (const [k, v] of Object.entries(patch)) {
              if (v === undefined) delete look[k];
              else look[k] = typeof v === 'string' && k.endsWith('Color') ? v.toLowerCase() : v;
            }
            if (Object.keys(look).length) opt.proposedLook = look as OptionLook;
            else delete opt.proposedLook;
            touch(s.plan);
          }),

        updateRoomOptionFinishes: (levelId, roomId, optionId, patch) =>
          editLevel(levelId, (level, plan) => {
            const r = level.rooms[roomId];
            if (!r || !plan.options.some((o) => o.id === optionId)) return false;
            const cur: Record<string, unknown> = { ...(r.optionFinishes?.[optionId] ?? {}) };
            for (const [k, v] of Object.entries(patch)) {
              if (k !== 'proposedFloor' && k !== 'proposedWall') continue;
              if (v === undefined) delete cur[k];
              else cur[k] = v;
            }
            const next = roomOptionFinishesOf(cur);
            const all = { ...(r.optionFinishes ?? {}) };
            if (next) all[optionId] = next;
            else delete all[optionId];
            if (Object.keys(all).length) r.optionFinishes = all;
            else delete r.optionFinishes;
          }),

        copyWallsFromLevel: (fromId, toId) => {
          const out = { copied: 0, skipped: 0 };
          set((s) => {
            const from = s.plan.levels[fromId];
            const to = s.plan.levels[toId];
            if (!from || !to || from === to) return;
            // Walls that would lie on top of a wall already on the target level are skipped (the
            // duplicate drop would otherwise replace pieces of the target's walls).
            const targetWalls = new Set(Object.keys(to.walls));
            const nodeMap = new Map<Id, Id>();
            const nodeFor = (id: Id): Id | null => {
              const n = from.nodes[id];
              if (!n) return null;
              let mapped = nodeMap.get(id);
              if (!mapped) {
                mapped = newId();
                nodeMap.set(id, mapped);
                to.nodes[mapped] = { id: mapped, x: n.x, y: n.y };
              }
              return mapped;
            };
            for (const w of Object.values(from.walls)) {
              const pa = from.nodes[w.a];
              const pb = from.nodes[w.b];
              if (!pa || !pb) continue;
              if (wallOverlapping(to, pa, pb, (t) => !targetWalls.has(t.id))) {
                out.skipped++;
                continue;
              }
              const a = nodeFor(w.a);
              const b = nodeFor(w.b);
              if (!a || !b) continue;
              const copy: Wall = { ...w, id: newId(), a, b };
              // Whether a wall carries load is the source level's business.
              delete copy.bearing;
              // Height overrides belong to the source level's storey.
              delete copy.heightOverride;
              to.walls[copy.id] = copy;
              out.copied++;
            }
            if (out.copied === 0) return;
            normalizeLevel(to);
            touch(s.plan);
          });
          return out;
        },

        updateSettings: (patch) =>
          set((s) => {
            Object.assign(s.plan.settings, patch);
            touch(s.plan);
          }),

        updateProposedLook: (patch) =>
          set((s) => {
            const look: Record<string, unknown> = { ...(s.plan.proposedLook ?? {}) };
            for (const [k, v] of Object.entries(patch)) {
              if (v === undefined) delete look[k];
              else look[k] = typeof v === 'string' && k.endsWith('Color') ? v.toLowerCase() : v;
            }
            if (Object.keys(look).length) s.plan.proposedLook = look as ProposedLook;
            else delete s.plan.proposedLook;
            touch(s.plan);
          }),

        renameLevel: (levelId, name) =>
          editLevel(levelId, (level) => {
            level.name = name;
          }),

        updateLevel: (levelId, patch) =>
          editLevel(levelId, (level) => {
            if (patch.wallHeight !== undefined && !(patch.wallHeight > 0)) return false;
            if (patch.floorThickness !== undefined && !(patch.floorThickness >= 0)) return false;
            if (patch.name !== undefined && !patch.name.trim()) return false;
            if (patch.foundation !== undefined && foundationProblem(patch.foundation)) return false;
            const lowered = patch.wallHeight !== undefined && patch.wallHeight < level.wallHeight;
            const { foundation, ...rest } = patch;
            Object.assign(level, rest);
            // A foundation of none is no foundation: the field goes (the plan reads as before).
            if (foundation !== undefined) {
              if (foundation.kind === 'none') delete level.foundation;
              else level.foundation = { ...foundation };
            }
            if (lowered) clampOpeningHeights(level);
          }),

        addLevel: (position, name, structureId) => {
          let out: LevelEdit | null = null;
          set((s) => {
            out = addLevelTo(s.plan, position, name, structureId);
            if (out) touch(s.plan);
          });
          return out;
        },

        deleteLevel: (levelId) => {
          let out: LevelEdit | null = null;
          set((s) => {
            out = deleteLevelFrom(s.plan, levelId);
            if (out) touch(s.plan);
          });
          return out;
        },

        moveLevel: (levelId, direction) => {
          let out: LevelEdit | null = null;
          set((s) => {
            out = moveLevelIn(s.plan, levelId, direction);
            if (out) touch(s.plan);
          });
          return out;
        },

        setBaseFloorElevation: (elevation, structureId) =>
          set((s) => {
            const st = s.plan.structures[structureId ?? s.plan.structureOrder[0]];
            if (!st || !Number.isFinite(elevation) || st.baseFloorElevation === elevation) return;
            st.baseFloorElevation = elevation;
            touch(s.plan);
          }),

        addStructure: (input) => {
          let id = '';
          // With grade points, a new building's lowest floor sits on the ground where it goes (the
          // middle of its starter box), the template's levels kept relative to it; without, the
          // template's (0 on a slab). Read from the plan before the edit: a draft never keys a cache.
          const before = get().plan;
          let placed = input;
          if (input.baseFloorElevation === undefined && Object.keys(before.site.gradePoints).length > 0) {
            const origin = input.origin ?? clearOrigin(before);
            const ground = terrainHeightAt(before.site, newStructureCentre(input, origin), fallbackElevation(before));
            const template = templateLevels(STRUCTURE_PRESETS[input.kind].template).base;
            if (Number.isFinite(ground)) placed = { ...input, origin, baseFloorElevation: Math.round(ground) + template };
          }
          set((s) => {
            const st = addStructureTo(s.plan, placed);
            id = st.id;
            for (const lid of st.levelOrder) {
              const level = s.plan.levels[lid];
              if (!level) continue;
              tagWorkSince({ walls: {}, openings: {} }, level, s.plan);
              // The starter box's roof is its work too (it was left in every option before).
              const work = workOptionOf(s.plan);
              if (work) for (const r of Object.values(level.roofs)) if (r.phase !== 'existing' && r.optionIds === undefined) r.optionIds = [work];
            }
            touch(s.plan);
          });
          return id;
        },

        deleteStructure: (id) => {
          let ok = false;
          set((s) => {
            ok = deleteStructureFrom(s.plan, id);
            if (ok) touch(s.plan);
          });
          return ok;
        },

        renameStructure: (id, name) => void get().updateStructure(id, { name }),

        updateStructure: (id, patch) => {
          if (structurePatchProblem(patch)) return false;
          let ok = false;
          set((s) => {
            const st = s.plan.structures[id];
            if (!st) return;
            let changed = false;
            if (patch.name !== undefined && patch.name !== st.name) {
              st.name = patch.name;
              changed = true;
            }
            if (patch.kind !== undefined && patch.kind !== st.kind) {
              st.kind = patch.kind;
              changed = true;
            }
            if (patch.origin && (patch.origin.x !== st.origin.x || patch.origin.y !== st.origin.y)) {
              st.origin = { x: patch.origin.x, y: patch.origin.y };
              changed = true;
            }
            if (patch.rotation !== undefined && normalizeAngle(patch.rotation) !== st.rotation) {
              st.rotation = normalizeAngle(patch.rotation);
              changed = true;
            }
            if (patch.baseFloorElevation !== undefined && patch.baseFloorElevation !== st.baseFloorElevation) {
              st.baseFloorElevation = patch.baseFloorElevation;
              changed = true;
            }
            ok = true;
            if (changed) touch(s.plan);
          });
          return ok;
        },

        setUnderlay: (levelId, underlay) =>
          editLevel(levelId, (level) => {
            if (!underlay) {
              if (!level.underlay) return false;
              delete level.underlay;
              return;
            }
            const next: Underlay = {
              ...underlay,
              origin: { x: underlay.origin.x, y: underlay.origin.y },
              rotation: normalizeRotation(underlay.rotation),
            };
            if (!isValidUnderlay(next)) return false;
            level.underlay = next;
          }),

        updateUnderlay: (levelId, patch) =>
          editLevel(levelId, (level) => {
            const u = level.underlay;
            if (!u) return false;
            const next: Underlay = { ...u, ...patch };
            if (patch.origin) next.origin = { x: patch.origin.x, y: patch.origin.y };
            if (patch.rotation !== undefined) next.rotation = normalizeRotation(patch.rotation);
            if (!isValidUnderlay(next)) return false;
            const keys = Object.keys(patch) as (keyof Underlay)[];
            const changed = keys.some((k) =>
              k === 'origin' ? next.origin.x !== u.origin.x || next.origin.y !== u.origin.y : next[k] !== u[k],
            );
            if (!changed) return false;
            for (const k of keys) (u as unknown as Record<string, unknown>)[k] = next[k];
          }),
      };
    }),
    {
      partialize: (s) => ({ plan: s.plan }),
      limit: 200,
      equality: (past, current) => past.plan === current.plan,
    },
  ),
);

// ---------------------------------------------------------------------------------------------
// Undo / redo helpers

const temporalStore = () => usePlanStore.temporal.getState();

/** Fit the 2D view to the active level (registered by ui/fileActions.ts, which owns zoomToFit). */
let refitView: () => void = () => {};
export function setHistoryRefit(fn: () => void): void {
  refitView = fn;
}

type HistoryListener = (kind: 'undo' | 'redo') => void;
const historyListeners = new Set<HistoryListener>();

/** Be told after every undo or redo made through undo() / redo(). Returns an unsubscribe function. */
export function onHistoryStep(fn: HistoryListener): () => void {
  historyListeners.add(fn);
  return () => void historyListeners.delete(fn);
}

/**
 * Undo or redo, then make a change on another level visible: when the step changed a level that
 * is not the active one, switch to it and say so in the status bar.
 */
function stepHistory(kind: 'undo' | 'redo'): void {
  const before = getPlan();
  if (kind === 'undo') temporalStore().undo();
  else temporalStore().redo();
  const after = getPlan();
  if (after !== before) {
    const ui = useUiStore.getState();
    const changed = allLevelIds(after).filter((id) => before.levels[id] !== after.levels[id]);
    if (changed.length > 0 && !changed.includes(ui.activeLevelId)) {
      const id = changed[0];
      // Landing in another building refits the 2D view to it, as switching building by hand does
      // (editor2d/tools switchLevel): each building is drawn in its own coordinates.
      const from = ui.siteMode ? undefined : structureOf(before, ui.activeLevelId);
      const to = structureOf(after, id);
      const main = firstStructure(after);
      const refit = from?.id !== to?.id && !(!from && to && isIdentity(to) && to.id === main?.id);
      ui.setActiveLevel(id);
      if (refit) refitView();
      const text = `${kind === 'undo' ? 'Undid' : 'Redid'} a change on ${after.levels[id].name}`;
      // Clears itself after NOTICE_MS (uiStore.setNotice).
      useUiStore.getState().setNotice({ text, error: false });
    }
  }
  for (const fn of historyListeners) fn(kind);
}

export const undo = () => stepHistory('undo');
export const redo = () => stepHistory('redo');
export const clearHistory = () => temporalStore().clear();
/** Drag grouping: call after the first (tracked) set of a drag. */
export const pauseHistory = () => temporalStore().pause();
/** Drag grouping: call on pointerup so the next edit is tracked again. */
export const resumeHistory = () => temporalStore().resume();

/** Subscribe to undo/redo availability. */
export function useTemporal(): { canUndo: boolean; canRedo: boolean } {
  const canUndo = useStore(usePlanStore.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(usePlanStore.temporal, (s) => s.futureStates.length > 0);
  return { canUndo, canRedo };
}

/** Non-reactive accessors for tools and event handlers. */
export const getPlan = (): Plan => usePlanStore.getState().plan;
export const getLevel = (levelId: Id): Level | undefined => getPlan().levels[levelId];
