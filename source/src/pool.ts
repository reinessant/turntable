/* The worker pool behind a long download. SoundCloud answers 403/429 when it is asked for too much too fast, so the
   pool keeps a steady pace, and when a track is turned away it slows everyone down (one at a time, a longer gap, a
   pause that doubles with every refusal that no success came between), sends the track to the back of the line and
   goes on; a stretch of calm speeds it up again. A track that is refused again and again while others get through is
   that track's own problem (private, removed) and is given up; if nothing gets through at all, the pool gives up on
   the rest too — a long wait is no use then, and what was downloaded so far is kept. No I/O in here: the caller says
   what "fetch track i" means. */

export interface PoolOptions {
  count: number;
  parallel?: number;
  /** pause between starting two tracks, ms: grows after a refusal, shrinks back after a calm stretch */
  minGap?: number; maxGap?: number;
  /** the pause after a refusal, ms; it doubles with each refusal in a row (no success between) up to `longestPause` */
  firstPause?: number; longestPause?: number;
  /** refusals one track may get before it is given up */
  maxTries?: number;
  /** refusals in a row, with no success between, after which the pool gives up on everything still waiting */
  giveUpAfter?: number;
  /** after this many tracks in a row without a refusal the pool speeds up one step */
  calm?: number;
  isRate(message: string): boolean;
  cancelled(): boolean;
  start(index: number): void;
  /** fetch track `index`; throw to report a failure */
  work(index: number): Promise<void>;
  done(index: number): void;
  /** the track is given up (not a refusal, or refused too many times, or the pool gave up) */
  fail(index: number, message: string, refused: boolean): void;
  /** the track goes back to the line */
  retry(index: number): void;
  pause(until: number): void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runPool(o: PoolOptions): Promise<void> {
  const parallel = o.parallel ?? 4, minGap = o.minGap ?? 600, maxGap = o.maxGap ?? 8_000;
  const firstPause = o.firstPause ?? 20_000, longestPause = o.longestPause ?? 300_000, maxTries = o.maxTries ?? 4, calm = o.calm ?? 8;
  const giveUpAfter = o.giveUpAfter ?? 7;
  const tick = Math.max(5, Math.min(500, minGap));
  const queue = Array.from({ length: o.count }, (_, index) => index);
  const tries = new Array<number>(o.count).fill(0);
  let inflight = 0, limit = parallel, gap = minGap, pausedUntil = 0, lastStart = 0, streak = 0, refusedRun = 0, gaveUp = false;
  const worker = async (slot: number) => {
    for (;;) {
      if (o.cancelled()) return;
      if (gaveUp) {
        // nothing gets through: what is still in the line is given up (once, by whoever sees it first)
        while (queue.length) o.fail(queue.shift()!, "SoundCloud kept refusing", true);
        if (inflight === 0) return;
        await sleep(tick); continue;
      }
      if (!queue.length) { if (inflight === 0) return; await sleep(tick); continue; }          // others may still hand a track back
      if (slot >= limit || Date.now() < pausedUntil) { await sleep(tick); continue; }
      const wait = lastStart + gap - Date.now();
      if (wait > 0) { await sleep(Math.min(wait, tick)); continue; }                             // a steady pace, never a burst
      const index = queue.shift()!;
      lastStart = Date.now(); inflight++;
      o.start(index);
      try {
        await o.work(index);
        o.done(index);
        refusedRun = 0;
        // a stretch of calm: speed back up, one step at a time
        if (++streak >= calm) { streak = 0; gap = Math.max(minGap, gap / 2); if (limit < parallel) limit++; }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!o.isRate(message)) { o.fail(index, message, false); continue; }
        streak = 0; refusedRun++;
        limit = 1; gap = Math.min(maxGap, gap * 2);
        if (refusedRun >= giveUpAfter) { gaveUp = true; o.fail(index, message, true); continue; }
        pausedUntil = Math.max(pausedUntil, Date.now() + Math.min(longestPause, firstPause * 2 ** (refusedRun - 1)));
        o.pause(pausedUntil);
        if (++tries[index] >= maxTries) { o.fail(index, message, true); continue; }
        o.retry(index);
        queue.push(index);                                  // the others go first: one bad track must not hold the line
      } finally { inflight--; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, o.count) }, (_, slot) => worker(slot)));
}
