import { assertEquals } from "@std/assert/equals";

import { type Timer, UnixTime } from "./time.ts";
import { Clip, type ClipRepository, ClipValue } from "./clip.ts";

export function createCachedClipRepository(
  inner: ClipRepository,
  ttlMs: number,
  timer: Timer = Date.now,
): ClipRepository {
  let cache: { clips: Clip[]; at: number } | null = null;
  let pending: Promise<Clip[]> | null = null;

  return {
    getAll(): Promise<Clip[]> {
      const now = timer();
      // ttlMs <= 0 disables caching, since now - at is never < 0
      if (cache !== null && now - cache.at < ttlMs) {
        return Promise.resolve(cache.clips);
      }
      // share one in-flight query among concurrent callers
      if (pending !== null) {
        return pending;
      }
      pending = (async () => {
        try {
          const clips = await inner.getAll();
          cache = { clips, at: now };
          return clips;
        } finally {
          pending = null;
        }
      })();
      return pending;
    },
  };
}

function fakeRepository(): { repo: ClipRepository; calls: () => number } {
  let calls = 0;
  return {
    repo: {
      getAll(): Promise<Clip[]> {
        calls += 1;
        return Promise.resolve([
          Clip.from({
            value: ClipValue.from(`call ${calls}`),
            copiedAt: UnixTime.from(0),
          }),
        ]);
      },
    },
    calls: () => calls,
  };
}

Deno.test("createCachedClipRepository serves from cache within the ttl", async () => {
  let clock = 1000;
  const { repo, calls } = fakeRepository();
  const cached = createCachedClipRepository(repo, 500, () => clock);

  const first = await cached.getAll();
  assertEquals(calls(), 1);

  clock = 1499;
  assertEquals(await cached.getAll(), first);
  assertEquals(calls(), 1);

  clock = 1500;
  await cached.getAll();
  assertEquals(calls(), 2);
});

Deno.test("createCachedClipRepository shares one in-flight query", async () => {
  let calls = 0;
  let release!: (clips: Clip[]) => void;
  const gate = new Promise<Clip[]>((resolve) => {
    release = resolve;
  });
  const inner: ClipRepository = {
    getAll() {
      calls += 1;
      return gate;
    },
  };
  const cached = createCachedClipRepository(inner, 1000, () => 0);

  const a = cached.getAll();
  const b = cached.getAll();
  release([]);
  await Promise.all([a, b]);
  assertEquals(calls, 1);
});

Deno.test("createCachedClipRepository with ttl <= 0 never caches", async () => {
  let clock = 1000;
  const { repo, calls } = fakeRepository();
  const cached = createCachedClipRepository(repo, 0, () => clock);

  await cached.getAll();
  await cached.getAll();
  clock = 1000;
  await cached.getAll();
  assertEquals(calls(), 3);
});
