const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function encodeSlotId(windowId: string, startAt: Date): string {
  return Buffer.from(`${windowId}|${startAt.toISOString()}`, "utf8").toString("base64url");
}

export function parseSlotId(slotId: string): { windowId: string; startAt: Date } | null {
  try {
    const decoded = Buffer.from(slotId, "base64url").toString("utf8");
    const separator = decoded.indexOf("|");
    if (separator <= 0) return null;
    const windowId = decoded.slice(0, separator);
    const iso = decoded.slice(separator + 1);
    if (!UUID_RE.test(windowId)) return null;
    const startAt = new Date(iso);
    if (Number.isNaN(startAt.getTime()) || startAt.toISOString() !== iso) {
      return null;
    }
    return { windowId, startAt };
  } catch {
    return null;
  }
}
