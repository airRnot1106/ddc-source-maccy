import { assertEquals } from "@std/assert/equals";

import { Clip, type ClipRepository, ClipValue } from "./clip.ts";
import { UnixTime } from "./time.ts";

export function createDedupedClipRepository(
  inner: ClipRepository,
): ClipRepository {
  return {
    async getAll(): Promise<Clip[]> {
      const clips = await inner.getAll();
      const seen = new Set<ClipValue>();
      const result: Clip[] = [];
      // clips arrive newest-first, so the first occurrence of a value is the newest
      for (const clip of clips) {
        if (seen.has(clip.value)) continue;
        seen.add(clip.value);
        result.push(clip);
      }
      return result;
    },
  };
}

Deno.test("createDedupedClipRepository keeps only the first occurrence of each value", async () => {
  const newer = Clip.from({
    value: ClipValue.from("foo"),
    copiedAt: UnixTime.from(200),
  });
  const other = Clip.from({
    value: ClipValue.from("bar"),
    copiedAt: UnixTime.from(150),
  });
  const older = Clip.from({
    value: ClipValue.from("foo"),
    copiedAt: UnixTime.from(100),
  });
  const inner: ClipRepository = {
    getAll: () => Promise.resolve([newer, other, older]),
  };

  const deduped = createDedupedClipRepository(inner);
  assertEquals(await deduped.getAll(), [newer, other]);
});

Deno.test("createDedupedClipRepository passes through clips with no duplicates", async () => {
  const a = Clip.from({
    value: ClipValue.from("a"),
    copiedAt: UnixTime.from(1),
  });
  const b = Clip.from({
    value: ClipValue.from("b"),
    copiedAt: UnixTime.from(2),
  });
  const inner: ClipRepository = { getAll: () => Promise.resolve([a, b]) };

  const deduped = createDedupedClipRepository(inner);
  assertEquals(await deduped.getAll(), [a, b]);
});
