import { describe, expect, it } from "vitest";
import { parseDate, parseTime, toWallClock, wallClockToInstant } from "./timezone";

const at = (iso: string) => new Date(iso).getTime();
const wall = (year: number, month: number, day: number, hour: number, minute = 0, second = 0) => ({
  year,
  month,
  day,
  hour,
  minute,
  second,
});

describe("wallClockToInstant", () => {
  it("converts winter and summer times in Lisbon", () => {
    expect(wallClockToInstant(wall(2026, 1, 4, 18), "Europe/Lisbon")).toBe(at("2026-01-04T18:00:00Z"));
    expect(wallClockToInstant(wall(2026, 7, 12, 18), "Europe/Lisbon")).toBe(at("2026-07-12T17:00:00Z"));
  });

  it("moves a time skipped by spring forward ahead by the jump", () => {
    expect(wallClockToInstant(wall(2026, 3, 29, 1, 30), "Europe/Lisbon")).toBe(at("2026-03-29T01:30:00Z"));
    expect(wallClockToInstant(wall(2026, 3, 8, 2, 30), "America/New_York")).toBe(at("2026-03-08T07:30:00Z"));
  });

  it("picks the first occurrence of a time repeated by fall back", () => {
    expect(wallClockToInstant(wall(2026, 10, 25, 1, 30), "Europe/Lisbon")).toBe(at("2026-10-25T00:30:00Z"));
    expect(wallClockToInstant(wall(2026, 11, 1, 1, 30), "America/New_York")).toBe(at("2026-11-01T05:30:00Z"));
  });

  it("handles zones east of UTC and across the date line", () => {
    expect(wallClockToInstant(wall(2027, 1, 1, 0), "Asia/Tokyo")).toBe(at("2026-12-31T15:00:00Z"));
    expect(wallClockToInstant(wall(2026, 1, 1, 0), "Pacific/Kiritimati")).toBe(at("2025-12-31T10:00:00Z"));
  });

  it("round-trips with toWallClock", () => {
    for (const iso of ["2026-03-29T00:59:59Z", "2026-03-29T01:00:00Z", "2026-10-25T01:00:00Z", "2026-12-31T23:59:59Z"]) {
      expect(wallClockToInstant(toWallClock(at(iso), "Europe/Lisbon"), "Europe/Lisbon")).toBe(
        // 01:00Z on the fall-back day reads 01:00 WET, which first happened at 00:00Z (WEST).
        iso === "2026-10-25T01:00:00Z" ? at("2026-10-25T00:00:00Z") : at(iso),
      );
    }
  });
});

describe("parseDate / parseTime", () => {
  it("parses Postgres values", () => {
    expect(parseDate("1970-01-02")).toBe(1);
    expect(parseTime("18:00")).toEqual({ hour: 18, minute: 0, second: 0 });
    expect(parseTime("07:05:09")).toEqual({ hour: 7, minute: 5, second: 9 });
    expect(parseTime("07:05:09.5")).toEqual({ hour: 7, minute: 5, second: 9 });
  });

  it("rejects invalid values", () => {
    for (const d of ["2026-02-29", "2026-13-01", "26-01-01", ""]) expect(() => parseDate(d)).toThrow();
    for (const t of ["24:00", "18:60", "6pm", ""]) expect(() => parseTime(t)).toThrow();
  });
});
