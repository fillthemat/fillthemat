import { describe, expect, it } from "vitest";
import { bookingIcsUid, buildTrialIcs, escapeIcsText, foldIcsLine } from "./ics";

describe("ICS helpers", () => {
  it("escapes backslash, comma, semicolon, and newlines", () => {
    expect(escapeIcsText("Dojo; A, B\\C\nNext")).toBe("Dojo\\; A\\, B\\\\C\\nNext");
  });

  it("folds lines at RFC octet limits", () => {
    const folded = foldIcsLine(`SUMMARY:${"A".repeat(80)}`);
    const lines = folded.split("\r\n");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]?.startsWith("SUMMARY:")).toBe(true);
    expect(lines[1]?.startsWith(" ")).toBe(true);
    for (const line of lines) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
  });

  it("emits publish output with stable UID and UTC stamps", () => {
    const ics = buildTrialIcs({
      uid: bookingIcsUid("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"),
      sequence: 0,
      method: "PUBLISH",
      dtstamp: new Date("2026-03-01T12:00:00.000Z"),
      start: new Date("2026-03-09T22:00:00.000Z"),
      end: new Date("2026-03-09T23:00:00.000Z"),
      summary: "Kids Trial",
      description: "Arrive early. Wear gi.",
      location: "12 Main St, Austin",
    });

    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics).toContain("METHOD:PUBLISH");
    expect(ics).toContain("UID:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee@fillthemat.com");
    expect(ics).toContain("DTSTART:20260309T220000Z");
    expect(ics).toContain("DTEND:20260309T230000Z");
    expect(ics).toContain("DTSTAMP:20260301T120000Z");
    expect(ics).not.toContain("STATUS:CANCELLED");
  });

  it("emits cancellation with incremented sequence", () => {
    const ics = buildTrialIcs({
      uid: "same-uid@fillthemat.com",
      sequence: 1,
      method: "CANCEL",
      dtstamp: new Date("2026-03-02T12:00:00.000Z"),
      start: new Date("2026-03-09T22:00:00.000Z"),
      end: new Date("2026-03-09T23:00:00.000Z"),
      summary: "Kids Trial",
      description: "Cancelled",
      location: "12 Main St",
    });
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("SEQUENCE:1");
    expect(ics).toContain("UID:same-uid@fillthemat.com");
  });
});
