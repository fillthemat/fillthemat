import { describe, expect, it } from "vitest";
import {
  formatAgeRange,
  formatCount,
  formatDuration,
  formatMinutes,
  formatTimeRange,
  formatTimezone,
  toTimeValue,
} from "./format";
import { DEFAULT_SECTION, resolveSection, sectionHref } from "./sections";

describe("formatMinutes", () => {
  it("renders wall-clock times without timezone math", () => {
    expect(formatMinutes(0)).toBe("12:00 AM");
    expect(formatMinutes(9 * 60 + 5)).toBe("9:05 AM");
    expect(formatMinutes(18 * 60)).toBe("6:00 PM");
  });

  it("wraps around midnight", () => {
    expect(formatMinutes(1440)).toBe("12:00 AM");
    expect(formatMinutes(1500)).toBe("1:00 AM");
  });
});

describe("toTimeValue", () => {
  it("produces a value for <input type=time>", () => {
    expect(toTimeValue(0)).toBe("00:00");
    expect(toTimeValue(18 * 60 + 30)).toBe("18:30");
  });
});

describe("formatTimeRange", () => {
  it("shows start and end", () => {
    expect(formatTimeRange(18 * 60, 60)).toBe("6:00 PM – 7:00 PM");
  });
});

describe("formatDuration", () => {
  it("uses owner-readable durations", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(60)).toBe("1 hr");
    expect(formatDuration(90)).toBe("1 hr 30 min");
  });
});

describe("formatAgeRange", () => {
  it("covers every combination", () => {
    expect(formatAgeRange(null, null)).toBe("All ages");
    expect(formatAgeRange(6, 12)).toBe("Ages 6–12");
    expect(formatAgeRange(6, 6)).toBe("Age 6");
    expect(formatAgeRange(16, null)).toBe("Ages 16 and up");
    expect(formatAgeRange(null, 12)).toBe("Ages 12 and under");
  });
});

describe("formatCount", () => {
  it("pluralizes", () => {
    expect(formatCount(1, "spot")).toBe("1 spot");
    expect(formatCount(0, "spot")).toBe("0 spots");
  });
});

describe("formatTimezone", () => {
  it("is readable", () => {
    expect(formatTimezone("America/New_York")).toBe("America / New York");
  });
});

describe("resolveSection", () => {
  it("keeps known sections and falls back otherwise", () => {
    expect(resolveSection("schedule")).toBe("schedule");
    expect(resolveSection("nope")).toBe(DEFAULT_SECTION);
    expect(resolveSection(undefined)).toBe(DEFAULT_SECTION);
  });
});

describe("sectionHref", () => {
  it("deep-links each category", () => {
    expect(sectionHref("profile")).toBe("/dashboard/settings");
    expect(sectionHref("branding")).toBe("/dashboard/settings?section=branding");
  });
});
