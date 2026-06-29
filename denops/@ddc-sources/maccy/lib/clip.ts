import { assertEquals } from "@std/assert/equals";

import { UnixTime } from "./time.ts";

declare const ClipValueBrand: unique symbol;
export type ClipValue = string & { [ClipValueBrand]: never };
export const ClipValue = {
  from(value: string): ClipValue {
    return value as ClipValue;
  },

  // collapse newlines into a single-line marker and trim the ends
  // inner whitespace (e.g. code indentation) is preserved on purpose
  fold(value: ClipValue): string {
    return value.trim().replace(/\r\n/g, "↵").replace(/[\r\n]/g, "↵");
  },

  // single-line form of the value: the value itself, or its first line
  // when it spans multiple lines
  toWord(value: ClipValue): string {
    return value.includes("\n") ? value.split("\n")[0] : value;
  },
};

declare const ClipBrand: unique symbol;
export type Clip = {
  value: ClipValue;
  copiedAt: UnixTime;
} & { [ClipBrand]: never };

export const Clip = {
  from(params: { value: ClipValue; copiedAt: UnixTime }): Clip {
    return params as Clip;
  },

  // a compact single-line label: the relative time joined with the folded body
  toAbbr(clip: Clip, now: UnixTime): string {
    return `${UnixTime.toRelativeTime(clip.copiedAt, now)}  ${
      ClipValue.fold(clip.value)
    }`;
  },
};

export interface ClipRepository {
  getAll(): Promise<Clip[]>;
}

Deno.test("ClipValue.fold collapses newlines, trims ends, keeps inner whitespace", () => {
  assertEquals(ClipValue.fold(ClipValue.from("a\nb")), "a↵b");
  assertEquals(ClipValue.fold(ClipValue.from("a\r\nb")), "a↵b");
  assertEquals(ClipValue.fold(ClipValue.from("a\rb")), "a↵b");
  assertEquals(ClipValue.fold(ClipValue.from("\n\nx\n\n")), "x");
  assertEquals(
    ClipValue.fold(ClipValue.from("  keep  inner  ")),
    "keep  inner",
  );
  assertEquals(ClipValue.fold(ClipValue.from("l1\n\nl3")), "l1↵↵l3");
});

Deno.test("ClipValue.toWord keeps single line, takes first line of multi-line", () => {
  assertEquals(ClipValue.toWord(ClipValue.from("hello")), "hello");
  assertEquals(ClipValue.toWord(ClipValue.from("first\nsecond")), "first");
});

Deno.test("Clip.toAbbr is relative time joined with the folded body", () => {
  const clip = Clip.from({
    value: ClipValue.from("a\nb"),
    copiedAt: UnixTime.from(100),
  });
  assertEquals(Clip.toAbbr(clip, UnixTime.from(160)), "1m  a↵b");
});
