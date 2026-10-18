/** Shared platter motion. DeckView integrates `angle` every frame; transitions read it
    (so a flying record and the real one turn in lockstep) and nudge the speed terms.
    speed (× 33⅓ rpm) = (drive ?? audio.speed) * boost + idle */
export const deckMotion = {
  angle: 0,                    // radians
  /** the deck's own rotation on screen (radians): the record's visual angle is angle + offset */
  offset: 0,
  boost: 1,
  idle: 0,
  drive: null as number | null,
  reset(): void { this.boost = 1; this.idle = 0; this.drive = null; }
};
