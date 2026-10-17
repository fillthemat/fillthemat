import { describe, expect, it } from "vitest";
import { applyCreateSuccessValues, applySavedValues, sameValues } from "./form-utils";

describe("applySavedValues", () => {
  it("writes server values except fields typed during save", () => {
    const previous = { name: "Kids", description: "typed after submit" };
    const saved = { name: "Kids beginner", description: "from server" };
    expect(applySavedValues(previous, saved, ["description"])).toEqual({
      name: "Kids beginner",
      description: "typed after submit",
    });
  });
});

describe("applyCreateSuccessValues", () => {
  const blank = { question: "", answer: "" };

  it("clears the form when nothing was typed after submit", () => {
    expect(
      applyCreateSuccessValues({ question: "Do we need a uniform?", answer: "No." }, blank, []),
    ).toEqual(blank);
  });

  it("keeps characters typed after submit (clearOnSuccess regression)", () => {
    expect(
      applyCreateSuccessValues(
        { question: "Do we need a uniform?", answer: "No. Extra note." },
        blank,
        ["answer"],
      ),
    ).toEqual({
      question: "",
      answer: "No. Extra note.",
    });
  });
});

describe("sameValues", () => {
  it("compares every key", () => {
    expect(sameValues({ a: "1" }, { a: "1" })).toBe(true);
    expect(sameValues({ a: "1" }, { a: "2" })).toBe(false);
    expect(sameValues({ a: "1" }, { a: "1", b: "" })).toBe(false);
  });
});
