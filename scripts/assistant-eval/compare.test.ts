import { expect, it } from "vitest";
import {
  compareRuns,
  type RunReport,
  requireCompleteBaseline,
} from "./compare";

const baseline: RunReport = {
  model: "same-model",
  judgeModel: "judge",
  judgeHash: "rubric",
  datasetHash: "cases",
  runName: "old",
  experimentId: "old-id",
  cases: [
    {
      caseId: "faq",
      scores: [
        { name: "reply-rules", value: 1 },
        { name: "bookingIntent", value: 1 },
      ],
    },
    { caseId: "booking", scores: [{ name: "bookingIntent", value: 1 }] },
  ],
};
it("reports per-case lower or missing scores, including missing cases, without averaging them away", () => {
  const candidate: RunReport = {
    ...baseline,
    runName: "new",
    cases: [{ caseId: "faq", scores: [{ name: "reply-rules", value: 0 }] }],
  };
  expect(compareRuns(baseline, candidate)).toEqual([
    { caseId: "faq", metric: "reply-rules", baseline: 1, candidate: 0 },
    { caseId: "faq", metric: "bookingIntent", baseline: 1, candidate: null },
    {
      caseId: "booking",
      metric: "bookingIntent",
      baseline: 1,
      candidate: null,
    },
  ]);
});
it("rejects runs with different models, cases or judge configurations", () => {
  for (const field of [
    "model",
    "judgeModel",
    "judgeHash",
    "datasetHash",
  ] as const) {
    expect(() =>
      compareRuns(baseline, { ...baseline, [field]: "different" }),
    ).toThrow(field);
  }
});
it("cannot use a baseline with missing metrics, wrong or repeated case IDs as a release gate", () => {
  const required = [
    { caseId: "faq", scores: ["reply-rules", "bookingIntent", "leadRequest"] },
    { caseId: "booking", scores: ["bookingIntent"] },
  ];
  expect(() => requireCompleteBaseline(baseline, required)).toThrow("faq");
  expect(() =>
    requireCompleteBaseline(
      { ...baseline, cases: [baseline.cases[0], baseline.cases[0]] },
      [{ caseId: "faq", scores: ["reply-rules"] }],
    ),
  ).toThrow();
  expect(() =>
    requireCompleteBaseline(
      { ...baseline, cases: [{ caseId: "other", scores: [] }] },
      [{ caseId: "faq", scores: ["reply-rules"] }],
    ),
  ).toThrow();
});
