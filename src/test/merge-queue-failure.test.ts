import { expect, it } from "vitest";

// Deliberate throwaway for #157: PR checks pass; the merge queue must reject it.
it("deliberately rejects the merge-group build (DO NOT MERGE)", () => {
  expect(process.env.GITHUB_EVENT_NAME).not.toBe("merge_group");
});
