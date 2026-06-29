import { assertEquals } from "@std/assert/equals";

import { type Timer, UnixTime } from "./time.ts";
import { Clip, type ClipRepository, ClipValue } from "./clip.ts";

// maccy stores timestamps as seconds since 2001-01-01 utc, not the unix epoch
const CORE_DATA_EPOCH = 978307200;

declare const cocoaTimeBrand: unique symbol;
type CocoaTime = number & { [cocoaTimeBrand]: never };
const CocoaTime = {
  from(value: number): CocoaTime {
    return value as CocoaTime;
  },
  toUnix(t: CocoaTime): UnixTime {
    return UnixTime.from(Math.floor((t as number) + CORE_DATA_EPOCH));
  },
  fromUnix(t: UnixTime): CocoaTime {
    return CocoaTime.from((t as number) - CORE_DATA_EPOCH);
  },
};

function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// cutoff is in core-data-epoch seconds, to match ZLASTCOPIEDAT
export function buildSql(
  types: string[],
  maxByteLength: number,
  cutoff: number,
): string {
  const typeList = types.map(sqlQuote).join(", ");
  return `SELECT item.ZLASTCOPIEDAT AS last_copied_at,
       CAST(c.ZVALUE AS TEXT) AS value
FROM ZHISTORYITEMCONTENT c
JOIN ZHISTORYITEM item ON item.Z_PK = c.ZITEM
WHERE c.ZTYPE IN (${typeList})
  AND LENGTH(c.ZVALUE) <= ${maxByteLength}
  AND item.ZLASTCOPIEDAT >= ${cutoff}
ORDER BY item.ZLASTCOPIEDAT DESC;`;
}

type Row = {
  last_copied_at: number;
  value: string;
};

// blank `sqlite3 -json` output means zero rows
export function parseClips(stdout: string): Clip[] {
  if (!/\S/.test(stdout)) {
    return [];
  }
  const rows = JSON.parse(stdout) as Row[];
  return rows.map((row) =>
    Clip.from({
      // normalize crlf/cr to lf so the domain only ever sees lf line breaks
      value: ClipValue.from(row.value.replace(/\r\n?/g, "\n")),
      copiedAt: CocoaTime.toUnix(CocoaTime.from(row.last_copied_at)),
    })
  );
}

export function expandPath(
  path: string,
  home = Deno.env.get("HOME") ?? "",
): string {
  return path.replace(/^~(?=$|\/)/, home);
}

export type MaccyRepositoryConfig = {
  dbPath: string;
  types: string[];
  maxByteLength: number;
  recentMs: number;
  timer?: Timer;
};

export function createMaccyClipRepository(
  config: MaccyRepositoryConfig,
): ClipRepository {
  const { dbPath, types, maxByteLength, recentMs } = config;
  const timer = config.timer ?? Date.now;

  return {
    async getAll(): Promise<Clip[]> {
      // unconfigured defaults yield nothing without launching sqlite3
      if (dbPath === "" || types.length === 0 || maxByteLength <= 0) {
        return [];
      }

      const now = UnixTime.now(timer);
      const since = UnixTime.from(
        (now as number) - Math.floor(recentMs / 1000),
      );
      const cutoff = CocoaTime.fromUnix(since);
      const sql = buildSql(types, maxByteLength, cutoff as number);

      // mode=ro (not immutable=1) so the live wal is read, not a stale snapshot
      const uri = `file:${expandPath(dbPath)}?mode=ro`;
      const { code, stdout, stderr } = await new Deno.Command("sqlite3", {
        args: ["-json", uri, sql],
      }).output();

      if (code !== 0) {
        const message = new TextDecoder().decode(stderr).trim();
        throw new Error(
          message !== "" ? message : `sqlite3 exited with code ${code}`,
        );
      }

      return parseClips(new TextDecoder().decode(stdout));
    },
  };
}

Deno.test("expandPath expands a leading tilde", () => {
  assertEquals(expandPath("~/x", "/home/test"), "/home/test/x");
  assertEquals(expandPath("~", "/home/test"), "/home/test");
  assertEquals(expandPath("/abs/~/x", "/home/test"), "/abs/~/x");
});

Deno.test("buildSql quotes types and inlines bounds", () => {
  const sql = buildSql(["public.utf8-plain-text"], 10000, 42);
  assertEquals(sql.includes("IN ('public.utf8-plain-text')"), true);
  assertEquals(sql.includes("LENGTH(c.ZVALUE) <= 10000"), true);
  assertEquals(sql.includes("ZLASTCOPIEDAT >= 42"), true);

  // multiple types and embedded quotes
  const sql2 = buildSql(["a", "b'c"], 1, 0);
  assertEquals(sql2.includes("IN ('a', 'b''c')"), true);
});

Deno.test("parseClips maps rows to clips, converting cocoa to unix seconds", () => {
  assertEquals(parseClips("   \n"), []);
  assertEquals(
    parseClips('[{"last_copied_at":100.9,"value":"hi"}]'),
    [
      Clip.from({
        value: ClipValue.from("hi"),
        copiedAt: UnixTime.from(100 + CORE_DATA_EPOCH),
      }),
    ],
  );

  // crlf and lone cr are normalized to lf
  assertEquals(
    parseClips('[{"last_copied_at":0,"value":"a\\r\\nb\\rc"}]')[0].value,
    ClipValue.from("a\nb\nc"),
  );
});
