import { z } from "zod";

export const reportSchema = z.object({
  model: z.string(),
  judgeModel: z.string(),
  judgeHash: z.string(),
  datasetHash: z.string(),
  runName: z.string(),
  experimentId: z.string(),
  cases: z.array(
    z.object({
      caseId: z.string(),
      scores: z.array(
        z.object({
          name: z.string(),
          value: z.number().min(0).max(1),
          comment: z.string().optional(),
        }),
      ),
    }),
  ),
});
export type RunReport = z.infer<typeof reportSchema>;
export function requireCompleteBaseline(
  report: RunReport,
  required: { caseId: string; scores: string[] }[],
): void {
  if (
    report.cases.length !== required.length ||
    new Set(report.cases.map((row) => row.caseId)).size !== report.cases.length
  )
    throw new Error("Incomplete/duplicate baseline case set");
  for (const item of required) {
    const actual = report.cases.find((row) => row.caseId === item.caseId);
    if (
      !actual ||
      item.scores.some(
        (name) => !actual.scores.some((score) => score.name === name),
      )
    )
      throw new Error(`Incomplete baseline: ${item.caseId}`);
  }
}
export type Regression = {
  caseId: string;
  metric: string;
  baseline: number;
  candidate: number | null;
};

export function compareRuns(
  baseline: RunReport,
  candidate: RunReport,
): Regression[] {
  for (const field of [
    "model",
    "judgeModel",
    "judgeHash",
    "datasetHash",
  ] as const) {
    if (baseline[field] !== candidate[field])
      throw new Error(`Cannot compare different ${field}`);
  }
  return baseline.cases.flatMap((oldCase) =>
    oldCase.scores.flatMap((score) => {
      const value =
        candidate.cases
          .find((row) => row.caseId === oldCase.caseId)
          ?.scores.find((row) => row.name === score.name)?.value ?? null;
      return value === null || value < score.value
        ? [
            {
              caseId: oldCase.caseId,
              metric: score.name,
              baseline: score.value,
              candidate: value,
            },
          ]
        : [];
    }),
  );
}
