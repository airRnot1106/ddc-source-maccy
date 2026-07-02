import { BaseSource } from "@shougo/ddc-vim/source";
import type {
  GatherArguments,
  OnCompleteDoneArguments,
} from "@shougo/ddc-vim/source";
import type { Item } from "@shougo/ddc-vim/types";

import { UnixTime } from "./lib/time.ts";
import { Clip, type ClipRepository, ClipValue } from "./lib/clip.ts";
import { createMaccyClipRepository } from "./lib/maccy_repository.ts";
import { createCachedClipRepository } from "./lib/cached_clip_repository.ts";
import { createDedupedClipRepository } from "./lib/deduped_clip_repository.ts";
import { createUseCountTracker } from "./lib/use_count_tracker.ts";

type Params = {
  recentMs: number;
  cacheTtlMs: number;
  types: string[];
  dbPath: string;
  maxByteLength: number;
  dedupe: boolean;
  excludeAfterUse: boolean;
  maxUseCount: number;
};

// the full clip text and its copiedAt, kept to expand multi-line clips on
// confirm and to key the use-count tracker
type UserData = {
  value: string;
  copiedAt: number;
};

export class Source extends BaseSource<Params, UserData> {
  #repository: ClipRepository | undefined;
  #configKey = "";
  // survives repository rebuilds, since use counts are unrelated to dbPath/types
  #tracker = createUseCountTracker();

  // rebuild only when params affecting the repository itself change, so the
  // cache survives across gathers even as unrelated params (e.g. maxUseCount)
  // are reconfigured at runtime
  #getRepository(params: Params): ClipRepository {
    const key = JSON.stringify({
      dbPath: params.dbPath,
      types: params.types,
      maxByteLength: params.maxByteLength,
      recentMs: params.recentMs,
      cacheTtlMs: params.cacheTtlMs,
      dedupe: params.dedupe,
    });
    if (this.#repository === undefined || key !== this.#configKey) {
      const cached = createCachedClipRepository(
        createMaccyClipRepository({
          dbPath: params.dbPath,
          types: params.types,
          maxByteLength: params.maxByteLength,
          recentMs: params.recentMs,
        }),
        params.cacheTtlMs,
      );
      this.#repository = params.dedupe
        ? createDedupedClipRepository(cached)
        : cached;
      this.#configKey = key;
    }
    return this.#repository;
  }

  override async gather(
    { sourceParams }: GatherArguments<Params>,
  ): Promise<Item<UserData>[]> {
    const clips = await this.#getRepository(sourceParams).getAll();
    const visible = sourceParams.excludeAfterUse
      ? this.#tracker.filter(clips, sourceParams.maxUseCount)
      : clips;
    const now = UnixTime.now();
    return visible.map((clip) => ({
      word: ClipValue.toWord(clip.value),
      abbr: Clip.toAbbr(clip, now),
      info: clip.value,
      user_data: { value: clip.value, copiedAt: clip.copiedAt },
    }));
  }

  override async onCompleteDone(
    { sourceParams, denops, userData }: OnCompleteDoneArguments<
      Params,
      UserData
    >,
  ): Promise<void> {
    if (sourceParams.excludeAfterUse) {
      this.#tracker.record(
        ClipValue.from(userData.value),
        // user_data round-trips through vim's msgpack-rpc, which can hand
        // back a bigint for what was a plain number
        UnixTime.from(Number(userData.copiedAt)),
      );
    }

    const lines = userData.value.split("\n");
    // the inserted word is the first line; nothing to expand for single-line clips
    if (lines.length <= 1) {
      return;
    }

    // nvim_win_get_cursor returns [row (1-based), col (0-based byte)]
    const [row, col] = await denops.call("nvim_win_get_cursor", 0) as [
      number,
      number,
    ];
    const tail = lines.slice(1);
    await denops.call("nvim_buf_set_text", 0, row - 1, col, row - 1, col, [
      "",
      ...tail,
    ]);
    // nvim_win_set_cursor col is a byte offset, not a code-unit count
    const lastLine = tail[tail.length - 1];
    await denops.call("nvim_win_set_cursor", 0, [
      row + tail.length,
      new TextEncoder().encode(lastLine).length,
    ]);
  }

  override params(): Params {
    // inconvenient by default: every param must be set explicitly to emit anything
    return {
      recentMs: 0,
      cacheTtlMs: 0,
      types: [],
      dbPath: "",
      maxByteLength: 0,
      dedupe: false,
      excludeAfterUse: false,
      maxUseCount: 1,
    };
  }
}
