import { assertEquals } from "@std/assert/equals";

import { Clip, ClipValue } from "./clip.ts";
import { UnixTime } from "./time.ts";

export type UseCountTracker = {
  // drops clips already used maxUseCount times or more, and forgets counts
  // for any (value, copiedAt) no longer present in clips
  filter(clips: Clip[], maxUseCount: number): Clip[];
  record(value: ClipValue, copiedAt: UnixTime): void;
};

// a re-copy carries a new copiedAt, so it naturally starts out unused
function keyOf(value: ClipValue, copiedAt: UnixTime): string {
  return JSON.stringify([copiedAt, value]);
}

export function createUseCountTracker(): UseCountTracker {
  const counts = new Map<string, number>();

  return {
    filter(clips, maxUseCount) {
      const keyed = clips.map((clip) => ({
        clip,
        key: keyOf(clip.value, clip.copiedAt),
      }));
      const liveKeys = new Set(keyed.map(({ key }) => key));
      for (const key of counts.keys()) {
        if (!liveKeys.has(key)) counts.delete(key);
      }
      return keyed
        .filter(({ key }) => (counts.get(key) ?? 0) < maxUseCount)
        .map(({ clip }) => clip);
    },

    record(value, copiedAt) {
      const key = keyOf(value, copiedAt);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    },
  };
}

function clipAt(value: string, copiedAt: number): Clip {
  return Clip.from({
    value: ClipValue.from(value),
    copiedAt: UnixTime.from(copiedAt),
  });
}

Deno.test("createUseCountTracker excludes a clip once its use count reaches maxUseCount", () => {
  const tracker = createUseCountTracker();
  const clip = clipAt("foo", 100);

  assertEquals(tracker.filter([clip], 1), [clip]);
  tracker.record(clip.value, clip.copiedAt);
  assertEquals(tracker.filter([clip], 1), []);
});

Deno.test("createUseCountTracker with maxUseCount 0 excludes immediately, even unused", () => {
  const tracker = createUseCountTracker();
  const clip = clipAt("foo", 100);

  assertEquals(tracker.filter([clip], 0), []);
});

Deno.test("createUseCountTracker treats a re-copy (new copiedAt) as unused", () => {
  const tracker = createUseCountTracker();
  const first = clipAt("foo", 100);
  const recopied = clipAt("foo", 200);

  tracker.record(first.value, first.copiedAt);
  assertEquals(tracker.filter([first], 1), []);
  assertEquals(tracker.filter([recopied], 1), [recopied]);
});

Deno.test("createUseCountTracker forgets counts once a key drops out of clips (gc)", () => {
  const tracker = createUseCountTracker();
  const clip = clipAt("foo", 100);

  tracker.record(clip.value, clip.copiedAt);
  assertEquals(tracker.filter([clip], 1), []);

  // clip ages out of view, e.g. beyond the recentMs cutoff
  tracker.filter([], 1);

  // the same (value, copiedAt) reappears; its count was gc'd, so it's unused again
  assertEquals(tracker.filter([clip], 1), [clip]);
});
