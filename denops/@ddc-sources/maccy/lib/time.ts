import { assertEquals } from "@std/assert/equals";

declare const unixTimeBrand: unique symbol;
export type UnixTime = number & { [unixTimeBrand]: never };

// returns unix milliseconds, like Date.now; injectable for tests
export type Timer = () => number;

export const UnixTime = {
  from(value: number): UnixTime {
    return value as UnixTime;
  },
  now(timer: Timer = Date.now): UnixTime {
    return UnixTime.from(Math.floor(timer() / 1000));
  },
  toRelativeTime(target: UnixTime, now: UnixTime) {
    const diff = now - target;
    if (diff < 1) return "now" as const;
    if (diff < 60) return `${diff}s` as const;
    if (diff < 3600) return `${Math.floor(diff / 60)}m` as const;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h` as const;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d` as const;
    return `${Math.floor(diff / 604800)}w` as const;
  },
};

Deno.test("UnixTime.now", () => {
  assertEquals(UnixTime.now(() => 5_000_000), UnixTime.from(5000));
  assertEquals(
    UnixTime.now(() => 1_734_000_123_456),
    UnixTime.from(1_734_000_123),
  );
});

Deno.test("UnixTime.toRelativeTime", () => {
  const now = UnixTime.from(1_000_000);
  const ago = (diff: number) =>
    UnixTime.toRelativeTime(UnixTime.from(1_000_000 - diff), now);

  // same instant and clock skew into the future both read as "now"
  assertEquals(ago(0), "now");
  assertEquals(ago(-5), "now");

  // seconds up to the minute boundary
  assertEquals(ago(1), "1s");
  assertEquals(ago(59), "59s");

  // minutes
  assertEquals(ago(60), "1m");
  assertEquals(ago(5 * 60), "5m");
  assertEquals(ago(3599), "59m");

  // hours
  assertEquals(ago(3600), "1h");
  assertEquals(ago(86399), "23h");

  // days
  assertEquals(ago(86400), "1d");
  assertEquals(ago(604799), "6d");

  // weeks (no larger unit)
  assertEquals(ago(604800), "1w");
  assertEquals(ago(3 * 604800), "3w");
});
