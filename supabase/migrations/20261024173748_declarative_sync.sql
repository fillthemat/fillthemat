CREATE TABLE "public"."school_settings" (
  "school_id"          uuid                     NOT NULL,
  "name"               text                     NOT NULL DEFAULT ''::text,
  "notification_email" text                     NOT NULL DEFAULT ''::text,
  "phone"              text,
  "website"            text,
  "address"            text,
  "country"            text                     NOT NULL DEFAULT 'US'::text,
  "city"               text,
  "parking_notes"      text,
  "access_notes"       text,
  "trial_guidance"     text,
  "pricing"            text,
  "welcome_message"    text,
  "agent_instructions" text,
  "logo_url"           text,
  "primary_color"      text,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "school_settings_logo_url" CHECK (((logo_url IS NULL) OR (logo_url ~ '^https://'::text))),
  CONSTRAINT "school_settings_pkey" PRIMARY KEY (school_id),
  CONSTRAINT "school_settings_primary_color" CHECK (((primary_color IS NULL) OR (primary_color ~ '^#[0-9A-Fa-f]{6}$'::text)))
);

ALTER TABLE "public"."school_settings"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."school_settings" FROM "anon";

ALTER TABLE "public"."school_settings"
  ADD CONSTRAINT "school_settings_school_id_fkey" FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

CREATE POLICY "school_settings_owner_access" ON "public"."school_settings"
  FOR ALL
  TO "authenticated"
  USING ((school_id = ( SELECT schools.id
   FROM public.schools
  WHERE (schools.owner_user_id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((school_id = ( SELECT schools.id
   FROM public.schools
  WHERE (schools.owner_user_id = ( SELECT auth.uid() AS uid)))));

REVOKE ALL ON TABLE "public"."school_settings" FROM "authenticated";

GRANT INSERT, SELECT, UPDATE ON TABLE "public"."school_settings" TO "authenticated";

REVOKE ALL ON TABLE "public"."school_settings" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."school_settings" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."school_settings" TO "service_role";

-- Copy owner-editable values before the next migration removes the old columns.
INSERT INTO public.school_settings (
  school_id, name, notification_email, phone, website, address, country, city,
  parking_notes, access_notes, trial_guidance, pricing, welcome_message,
  agent_instructions, logo_url, primary_color, created_at, updated_at
)
SELECT id, name, notification_email, phone, website, address, country, city,
  parking_notes, access_notes, trial_guidance, pricing, welcome_message,
  agent_instructions, logo_url, primary_color, created_at, updated_at
FROM public.schools;
