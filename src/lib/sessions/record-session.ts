import "server-only";
import { hashToken } from "@/lib/crypto";
import { isKnownBot } from "@/lib/request";
import { getSchoolForLandingAccess } from "@/lib/schools/public";
import { createAdminClient } from "@/lib/supabase/admin";

type LandingSessionInput = {
  slug: string;
  token: string;
  preview?: boolean;
  utm?: Record<string, string | undefined>;
  userAgent: string | null;
};

type LandingSessionResult = { status: "not_found" } | { status: "recorded"; qualified: boolean };

/** Records a landing visit; a reused key is never requalified. */
export async function recordLandingSession(
  input: LandingSessionInput,
): Promise<LandingSessionResult> {
  // Cookie-client RLS allows published schools or the owner's preview, never
  // an anonymous preview of a draft. Check before using the privileged client.
  const school = await getSchoolForLandingAccess(input.slug, { preview: input.preview });
  if (!school) return { status: "not_found" };

  const { data, error } = await createAdminClient().rpc("record_landing_session", {
    p_school_id: school.id,
    p_session_key_hash: hashToken(input.token),
    p_is_preview: Boolean(input.preview),
    p_bot_exclusion_reason: isKnownBot(input.userAgent) ?? undefined,
    p_utm: Object.fromEntries(
      ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].map((key) => [
        key,
        input.utm?.[key]?.slice(0, 200) ?? null,
      ]),
    ),
  });
  if (error) throw error;
  if (data === null) throw new Error("Landing session response is missing");
  return { status: "recorded", qualified: data };
}
