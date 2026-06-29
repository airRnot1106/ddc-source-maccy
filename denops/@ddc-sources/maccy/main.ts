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

type Params = {
  recentMs: number;
  cacheTtlMs: number;
  types: string[];
  dbPath: string;
  maxByteLength: number;
};

// the full clip text, kept to expand multi-line clips on confirm
type UserData = {
  value: string;
};

export class Source extends BaseSource<Params, UserData> {
  #repository: ClipRepository | undefined;
  #configKey = "";

  // rebuild only when params change, so the cache survives across gathers
  // while still honoring runtime reconfiguration
  #getRepository(params: Params): ClipRepository {
    const key = JSON.stringify(params);
    if (this.#repository === undefined || key !== this.#configKey) {
      this.#repository = createCachedClipRepository(
        createMaccyClipRepository({
          dbPath: params.dbPath,
          types: params.types,
          maxByteLength: params.maxByteLength,
          recentMs: params.recentMs,
        }),
        params.cacheTtlMs,
      );
      this.#configKey = key;
    }
    return this.#repository;
  }

  override async gather(
    { sourceParams }: GatherArguments<Params>,
  ): Promise<Item<UserData>[]> {
    const clips = await this.#getRepository(sourceParams).getAll();
    const now = UnixTime.now();
    return clips.map((clip) => ({
      word: ClipValue.toWord(clip.value),
      abbr: Clip.toAbbr(clip, now),
      info: clip.value,
      user_data: { value: clip.value },
    }));
  }

  override async onCompleteDone(
    { denops, userData }: OnCompleteDoneArguments<Params, UserData>,
  ): Promise<void> {
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
    };
  }
}
