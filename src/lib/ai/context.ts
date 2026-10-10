import type { Faq, School, TrialOffering } from "@/db/schema";
import type { SlotOccurrence, SlotWindow } from "@/lib/schedule/occurrences";
import type { SchoolPromptInput } from "./instructions";

/** The school's id plus the details its instructions show the model. */
export type AssistantSchool = Pick<School, "id"> &
  Omit<SchoolPromptInput, "faqs">;

export type SchoolCatalog = {
  offerings: Array<
    Pick<
      TrialOffering,
      | "id"
      | "name"
      | "description"
      | "minimumAge"
      | "maximumAge"
      | "attire"
      | "expectations"
      | "active"
    >
  >;
  windows: SlotWindow[];
  occurrences: SlotOccurrence[];
  faqs: Array<Pick<Faq, "question" | "answer">>;
};

/** Data loaded once for a turn; tools do not fetch data themselves. */
export type AssistantContext = {
  school: AssistantSchool;
  catalog: SchoolCatalog;
  now: Date;
};
