import { DECK, deckSupportedEdges, deckTopWords } from '../../derive/decks';
import { boundsOf } from '../../model/geometry';
import { formatLengthCompact } from '../../model/units';
import { makeOutlineTool } from './outlineTool';

/**
 * Deck tool (J): click the corners of the deck (they snap to the walls' outside faces), close it by
 * clicking the first corner, double-clicking or pressing Enter (makeOutlineTool). The deck's top is
 * one step (6") below the floor; every edge gets a railing except those against a wall (on any
 * level), where a ledger carries it.
 */
export const deckTool = makeOutlineTool({
  noun: 'deck',
  selectionKey: 'decks',
  create: (ctx, outline) => {
    const ui = ctx.ui();
    const supported = deckSupportedEdges(ctx.plan(), ctx.levelId, outline, DECK.defaultElevation, ui.viewMode, ui.drawPhase);
    return ctx.actions.addDeck(ctx.levelId, { outline, elevation: DECK.defaultElevation, railings: supported.map((s) => !s), phase: ui.drawPhase });
  },
  added: (ctx, outline) => {
    const b = boundsOf(outline)!;
    const denom = ctx.plan().settings.precisionDenominator;
    return `Deck added, ${formatLengthCompact(b.maxX - b.minX, denom)} x ${formatLengthCompact(b.maxY - b.minY, denom)}, its top ${deckTopWords(DECK.defaultElevation, denom)}. Set its height and railings in the properties panel.`;
  },
  remove: (ctx, ids) => ctx.actions.deleteDecks(ctx.levelId, ids),
});
