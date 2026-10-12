const digitWords: Record<string, string> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

/** Repeated copies are common in automated calls; never guess between codes. */
export function transcribedCode(text: string) {
  const normalized = text
    .toLowerCase()
    .replace(
      /\b(zero|one|two|three|four|five|six|seven|eight|nine)\b/g,
      (word) => digitWords[word],
    );
  const matches = [...normalized.matchAll(/(?<!\d)(\d(?:[\s,-]*\d)*)(?!\d)/g)];
  const codes = matches.map((match) => match[1].replace(/\D/g, ""));
  return codes.length &&
    codes.every((code) => code.length === 6) &&
    new Set(codes).size === 1
    ? codes[0]
    : null;
}
