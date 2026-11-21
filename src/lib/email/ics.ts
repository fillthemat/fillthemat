export type IcsMethod = "PUBLISH" | "CANCEL";

export type TrialIcsInput = {
  uid: string;
  sequence: number;
  method: IcsMethod;
  dtstamp: Date;
  start: Date;
  end: Date;
  summary: string;
  description: string;
  location: string;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatIcsUtc(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

export function escapeIcsText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\n", "\\n");
}

function utf8Length(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function foldIcsLine(line: string): string {
  if (utf8Length(line) <= 75) return line;

  const bytes = Buffer.from(line, "utf8");
  const parts: string[] = [];
  let offset = 0;
  let limit = 75;

  while (offset < bytes.length) {
    let end = Math.min(offset + limit, bytes.length);
    while (
      end > offset &&
      end < bytes.length &&
      (bytes.readUInt8(end) & 0b1100_0000) === 0b1000_0000
    ) {
      end -= 1;
    }
    if (end === offset) {
      end = Math.min(offset + limit, bytes.length);
    }
    parts.push(bytes.subarray(offset, end).toString("utf8"));
    offset = end;
    limit = 74;
  }

  return parts.join("\r\n ");
}

export function buildTrialIcs(input: TrialIcsInput): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Fillthemat//Trial Booking//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${input.method}`,
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${formatIcsUtc(input.dtstamp)}`,
    `DTSTART:${formatIcsUtc(input.start)}`,
    `DTEND:${formatIcsUtc(input.end)}`,
    `SEQUENCE:${input.sequence}`,
    `SUMMARY:${escapeIcsText(input.summary)}`,
    `DESCRIPTION:${escapeIcsText(input.description)}`,
    `LOCATION:${escapeIcsText(input.location)}`,
  ];

  if (input.method === "CANCEL") {
    lines.push("STATUS:CANCELLED");
  }

  lines.push("END:VEVENT", "END:VCALENDAR");

  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

export function bookingIcsUid(bookingId: string): string {
  return `${bookingId}@fillthemat.com`;
}
