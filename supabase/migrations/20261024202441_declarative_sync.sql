-- One statement keeps backfill + DDL atomic in both migration application and
-- pg-delta's statement-by-statement shadow replay, without committing a caller's
-- enclosing transaction (as explicit BEGIN/COMMIT would do).
DO $school_split$
BEGIN
SET local check_function_bodies = off;

-- Data-preservation additions to the generated structural diff. Snapshot the
-- moved columns before pg-delta drops them; restore before enforcing NOT NULL.
-- This entire migration runs in one transaction, including the temporary data.
-- Hold writers out before taking snapshots, not only when columns are dropped.
LOCK TABLE public.schools, public.school_settings IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE school_profile_backfill ON COMMIT DROP AS
SELECT school_id, name, phone, website, address, country, city, parking_notes,
       access_notes, trial_guidance, pricing, welcome_message, logo_url,
       primary_color, created_at, updated_at
FROM public.school_settings;

CREATE TEMP TABLE school_account_backfill ON COMMIT DROP AS
SELECT id AS school_id, owner_user_id, previewed_at, whatsapp_phone_number_id, whatsapp_waba_id
FROM public.schools;

REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;

DROP POLICY "bookings_select_own_school" ON "public"."bookings";

DROP POLICY "contacts_select_own_school" ON "public"."contacts";

DROP POLICY "conversations_select_own_school" ON "public"."conversations";

DROP POLICY "email_deliveries_select_own_school" ON "public"."email_deliveries";

DROP POLICY "faqs_owner_write" ON "public"."faqs";

DROP POLICY "faqs_public_read" ON "public"."faqs";

DROP POLICY "faqs_select_own_school" ON "public"."faqs";

DROP POLICY "funnel_events_select_own_school" ON "public"."funnel_events";

DROP POLICY "landing_sessions_select_own_school" ON "public"."landing_sessions";

DROP POLICY "leads_select_own_school" ON "public"."leads";

DROP POLICY "messages_select_own_school" ON "public"."messages";

DROP POLICY "participants_select_own_school" ON "public"."participants";

DROP POLICY "school_settings_owner_access" ON "public"."school_settings";

DROP POLICY "schools_select_own" ON "public"."schools";

DROP POLICY "schools_update_own" ON "public"."schools";

DROP POLICY "trial_occurrences_public_read" ON "public"."trial_occurrences";

DROP POLICY "trial_occurrences_select_own_school" ON "public"."trial_occurrences";

DROP POLICY "trial_offerings_owner_write" ON "public"."trial_offerings";

DROP POLICY "trial_offerings_public_read" ON "public"."trial_offerings";

DROP POLICY "trial_offerings_select_own_school" ON "public"."trial_offerings";

DROP POLICY "trial_windows_owner_write" ON "public"."trial_windows";

DROP POLICY "trial_windows_public_read" ON "public"."trial_windows";

DROP POLICY "trial_windows_select_own_school" ON "public"."trial_windows";

DROP POLICY "whatsapp_booking_intents_select_own_school" ON "public"."whatsapp_booking_intents";

DROP POLICY "whatsapp_deliveries_select_own_school" ON "public"."whatsapp_deliveries";

DROP POLICY "whatsapp_jobs_select_own_school" ON "public"."whatsapp_jobs";

DROP INDEX "public"."schools_whatsapp_phone_number_id_unique";

ALTER TABLE "public"."school_settings"
  DROP CONSTRAINT "school_settings_logo_url";

ALTER TABLE "public"."school_settings"
  DROP CONSTRAINT "school_settings_primary_color";

ALTER TABLE "public"."schools"
  DROP CONSTRAINT "schools_owner_user_id_unique";

ALTER TABLE "public"."schools"
  DROP CONSTRAINT "schools_owner_user_id_users_id_fk";

DROP FUNCTION "public"."can_read_school_catalog"(uuid);

DROP FUNCTION "public"."get_landing_school"(text, boolean);

ALTER TABLE "public"."school_settings"
  DROP COLUMN "access_notes";

ALTER TABLE "public"."school_settings"
  DROP COLUMN "address";

ALTER TABLE "public"."school_settings"
  DROP COLUMN "city";

ALTER TABLE "public"."school_settings"
  DROP COLUMN "country";

ALTER TABLE "public"."school_settings"
  DROP COLUMN "logo_url";

ALTER TABLE "public"."school_settings"
  DROP COLUMN "name";

ALTER TABLE "public"."school_settings"
  DROP COLUMN "parking_notes";

ALTER TABLE "public"."school_settings"
  DROP COLUMN "phone";

ALTER TABLE "public"."school_settings"
  DROP COLUMN "pricing";

ALTER TABLE "public"."school_settings"
  DROP COLUMN "primary_color";

ALTER TABLE "public"."school_settings"
  DROP COLUMN "trial_guidance";

ALTER TABLE "public"."school_settings"
  DROP COLUMN "website";

ALTER TABLE "public"."school_settings"
  DROP COLUMN "welcome_message";

ALTER TABLE "public"."schools"
  DROP COLUMN "owner_user_id";

ALTER TABLE "public"."schools"
  DROP COLUMN "previewed_at";

ALTER TABLE "public"."schools"
  DROP COLUMN "whatsapp_phone_number_id";

ALTER TABLE "public"."schools"
  DROP COLUMN "whatsapp_waba_id";

CREATE TABLE "public"."school_profiles" (
  "school_id"       uuid                     NOT NULL,
  "name"            text                     NOT NULL DEFAULT ''::text,
  "phone"           text,
  "website"         text,
  "address"         text,
  "country"         text                     NOT NULL DEFAULT 'US'::text,
  "city"            text,
  "parking_notes"   text,
  "access_notes"    text,
  "trial_guidance"  text,
  "pricing"         text,
  "welcome_message" text,
  "logo_url"        text,
  "primary_color"   text,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "school_profiles_logo_url" CHECK (((logo_url IS NULL) OR (logo_url ~ '^https://'::text))),
  CONSTRAINT "school_profiles_pkey" PRIMARY KEY (school_id),
  CONSTRAINT "school_profiles_primary_color" CHECK (((primary_color IS NULL) OR (primary_color ~ '^#[0-9A-Fa-f]{6}$'::text)))
);

ALTER TABLE "public"."school_profiles"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."school_settings"
  ADD COLUMN "owner_user_id" uuid;

ALTER TABLE "public"."school_settings"
  ADD COLUMN "previewed_at" timestamp WITH time zone;

ALTER TABLE "public"."school_settings"
  ADD COLUMN "whatsapp_phone_number_id" text;

ALTER TABLE "public"."school_settings"
  ADD COLUMN "whatsapp_waba_id" text;

INSERT INTO public.school_profiles (
    school_id, name, phone, website, address, country, city, parking_notes,
    access_notes, trial_guidance, pricing, welcome_message, logo_url,
    primary_color, created_at, updated_at
)
SELECT * FROM school_profile_backfill;

ALTER TABLE public.school_settings DISABLE TRIGGER school_settings_set_updated_at;
UPDATE public.school_settings s
SET owner_user_id = b.owner_user_id, previewed_at = b.previewed_at,
    whatsapp_phone_number_id = b.whatsapp_phone_number_id, whatsapp_waba_id = b.whatsapp_waba_id
FROM school_account_backfill b WHERE b.school_id = s.school_id;
ALTER TABLE public.school_settings ENABLE TRIGGER school_settings_set_updated_at;

-- Also preserve ownership for an incomplete school without a settings row.
INSERT INTO public.school_settings (school_id, owner_user_id, previewed_at, whatsapp_phone_number_id, whatsapp_waba_id)
SELECT b.* FROM school_account_backfill b
WHERE NOT EXISTS (SELECT 1 FROM public.school_settings s WHERE s.school_id = b.school_id);

ALTER TABLE public.school_settings ALTER COLUMN owner_user_id SET NOT NULL;

CREATE OR REPLACE FUNCTION public.cancel_dashboard_booking (
  p_booking_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE v_booking public.bookings%ROWTYPE;
BEGIN
    SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN RETURN 'not_found'; END IF;
    IF v_booking.status = 'cancelled' THEN RETURN 'replay'; END IF;
    IF v_booking.status <> 'booked' OR v_booking.start_at <= now() THEN RETURN 'not_cancellable'; END IF;
    UPDATE public.bookings SET status = 'cancelled' WHERE id = p_booking_id;
    RETURN 'cancelled';
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_settings_faq (
  p_school_id uuid,
  p_question  text,
  p_answer    text
)
  RETURNS SETOF public.faqs
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    PERFORM 1 FROM public.school_settings
    WHERE school_id = p_school_id AND owner_user_id = (SELECT auth.uid()) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'school_not_found' USING ERRCODE = '42501'; END IF;
    RETURN QUERY INSERT INTO public.faqs (school_id, question, answer, sort_order)
    VALUES (p_school_id, p_question, p_answer, (SELECT count(*)::integer FROM public.faqs WHERE school_id = p_school_id))
    RETURNING *;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_school_after_account()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    DELETE FROM public.schools WHERE id = OLD.school_id;
    RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."delete_school_after_account"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.delete_settings_window (
  p_window_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE v_school_id uuid;
BEGIN
    SELECT w.school_id INTO v_school_id FROM public.trial_windows w
    WHERE w.id = p_window_id AND w.school_id = (
        SELECT school_id FROM public.school_settings WHERE owner_user_id = (SELECT auth.uid())
    ) FOR UPDATE;
    IF NOT FOUND THEN RETURN 'not_found'; END IF;
    IF EXISTS (SELECT 1 FROM public.trial_occurrences WHERE trial_window_id = p_window_id AND school_id = v_school_id) THEN
        RETURN 'on_calendar';
    END IF;
    DELETE FROM public.trial_windows WHERE id = p_window_id;
    RETURN 'deleted';
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_faq_limit()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    PERFORM 1 FROM public.school_settings WHERE school_id = NEW.school_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'school_not_found' USING ERRCODE = '42501'; END IF;
    IF (SELECT count(*) FROM public.faqs WHERE school_id = NEW.school_id) >= 20 THEN
        RAISE EXCEPTION 'faq_limit_reached' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."enforce_faq_limit"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.get_overview_metrics (
  p_school_id uuid,
  p_now       timestamp with time zone DEFAULT now()
)
  RETURNS TABLE (
    upcoming_bookings            integer,
    leads                        integer,
    eligible_bookings            integer,
    converted_sessions           integer,
    chat_assisted_booking_events integer,
    active_trial_classes         integer,
    active_class_times           integer,
    failed_emails                integer
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
    SELECT
        (
            SELECT count(*)::integer
            FROM public.bookings b
            WHERE b.school_id = s.id
              AND b.status = 'booked'
              AND b.start_at >= p_now
        ),
        (
            SELECT count(*)::integer
            FROM public.leads l
            WHERE l.school_id = s.id
        ),
        (
            SELECT count(*)::integer
            FROM public.landing_sessions ls
            WHERE ls.school_id = s.id
              AND ls.qualified_at IS NOT NULL
        ),
        (
            SELECT count(*)::integer
            FROM public.landing_sessions ls
            WHERE ls.school_id = s.id
              AND ls.qualified_at IS NOT NULL
              AND EXISTS (
                  SELECT 1
                  FROM public.bookings b
                  WHERE b.school_id = s.id
                    AND b.landing_session_id = ls.id
              )
        ),
        (
            SELECT count(*)::integer
            FROM public.funnel_events fe
            WHERE fe.school_id = s.id
              AND fe.event_type = 'booking_confirmed'
              AND fe.metadata ->> 'source' = 'chat'
        ),
        (
            SELECT count(*)::integer
            FROM public.trial_offerings o
            WHERE o.school_id = s.id
              AND o.active = true
        ),
        (
            SELECT count(*)::integer
            FROM public.trial_windows w
            WHERE w.school_id = s.id
              AND w.active = true
        ),
        (
            SELECT count(*)::integer
            FROM public.email_deliveries e
            WHERE e.school_id = s.id
              AND e.state = 'failed'
        )
    FROM public.schools s
    WHERE s.id = p_school_id
      AND s.id = (SELECT school_id FROM public.school_settings WHERE owner_user_id = (SELECT auth.uid()));
$function$;

CREATE OR REPLACE FUNCTION public.get_settings_windows (
  p_school_id uuid
)
  RETURNS TABLE (
    id                   uuid,
    trial_offering_id    uuid,
    offering_name        text,
    offering_active      boolean,
    day_of_week          integer,
    start_minute         integer,
    duration_minutes     integer,
    capacity             integer,
    label                text,
    active               boolean,
    on_calendar          boolean,
    has_upcoming_booking boolean,
    max_upcoming_booked  integer
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
    SELECT w.id, w.trial_offering_id, o.name, o.active, w.day_of_week, w.start_minute,
        w.duration_minutes, w.capacity, w.label, w.active,
        EXISTS (SELECT 1 FROM public.trial_occurrences t WHERE t.trial_window_id = w.id AND t.school_id = w.school_id),
        EXISTS (SELECT 1 FROM public.bookings b WHERE b.trial_window_id = w.id AND b.school_id = w.school_id AND b.status <> 'cancelled' AND b.start_at > now()),
        (SELECT coalesce(max(t.booked_count), 0) FROM public.trial_occurrences t WHERE t.trial_window_id = w.id AND t.school_id = w.school_id AND t.start_at > now())
    FROM public.trial_windows w
    JOIN public.trial_offerings o ON o.id = w.trial_offering_id AND o.school_id = w.school_id
    WHERE w.school_id = p_school_id
      AND w.school_id = (SELECT school_id FROM public.school_settings WHERE owner_user_id = (SELECT auth.uid()))
    ORDER BY w.day_of_week, w.start_minute;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_published_school_identity_change()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    IF OLD.published_at IS NOT NULL AND (
        NEW.slug IS DISTINCT FROM OLD.slug OR NEW.timezone IS DISTINCT FROM OLD.timezone
        OR NEW.published_at IS DISTINCT FROM OLD.published_at
    ) THEN
        RAISE EXCEPTION 'slug, timezone and publication timestamp are immutable after publish';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = NEW.timezone) THEN
        RAISE EXCEPTION 'invalid_timezone' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_owner_booking_transition()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE v_notification_email text;
BEGIN
    IF current_user <> 'authenticated' OR NEW.status = OLD.status THEN RETURN NULL; END IF;
    IF NEW.status IN ('showed', 'no_show') THEN
        INSERT INTO public.funnel_events (school_id, booking_id, event_type)
        VALUES (NEW.school_id, NEW.id, NEW.status::text);
        RETURN NULL;
    END IF;
    UPDATE public.trial_occurrences SET booked_count = booked_count - 1
    WHERE id = NEW.trial_occurrence_id AND school_id = NEW.school_id AND booked_count > 0;
    SELECT notification_email INTO v_notification_email
    FROM public.school_settings WHERE school_id = NEW.school_id;
    IF NEW.contact_email_snapshot IS NOT NULL THEN
        INSERT INTO public.email_deliveries (school_id, booking_id, kind, recipient, provider_idempotency_key)
        VALUES (NEW.school_id, NEW.id, 'booking_cancellation', NEW.contact_email_snapshot,
                'booking-cancellation/' || NEW.id || '/' || NEW.ics_sequence);
    END IF;
    IF v_notification_email IS NOT NULL AND v_notification_email <> '' THEN
        INSERT INTO public.email_deliveries (school_id, booking_id, kind, recipient, provider_idempotency_key)
        VALUES (NEW.school_id, NEW.id, 'owner_cancellation', v_notification_email,
                'owner-cancellation/' || NEW.id || '/' || NEW.ics_sequence);
    END IF;
    INSERT INTO public.funnel_events (school_id, booking_id, landing_session_id, conversation_id, event_type, metadata)
    VALUES (NEW.school_id, NEW.id, NEW.landing_session_id, NEW.conversation_id,
            'booking_cancelled', jsonb_build_object('sequence', NEW.ics_sequence));
    RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."record_owner_booking_transition"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.sync_window_capacity()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    PERFORM 1 FROM public.trial_occurrences
    WHERE trial_window_id = NEW.id AND school_id = NEW.school_id AND start_at > now()
    ORDER BY id FOR UPDATE;
    UPDATE public.trial_occurrences SET capacity = NEW.capacity
    WHERE trial_window_id = NEW.id AND school_id = NEW.school_id AND start_at > now();
    RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."sync_window_capacity"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.update_booking_attendance (
  p_booking_id uuid,
  p_status     text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    IF p_status NOT IN ('showed', 'no_show') OR p_status IS NULL THEN
        RAISE EXCEPTION 'invalid_attendance_status' USING ERRCODE = '22023';
    END IF;
    UPDATE public.bookings SET status = p_status::public.booking_status
    WHERE id = p_booking_id AND status IN ('booked', 'showed', 'no_show');
    RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_school_agent (
  p_school_id          uuid,
  p_welcome_message    text,
  p_agent_instructions text
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    UPDATE public.school_settings SET agent_instructions = p_agent_instructions
    WHERE school_id = p_school_id AND owner_user_id = (SELECT auth.uid());
    IF NOT FOUND THEN RAISE EXCEPTION 'school_not_found' USING ERRCODE = '42501'; END IF;
    UPDATE public.school_profiles SET welcome_message = p_welcome_message WHERE school_id = p_school_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'school_profile_missing'; END IF;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."update_school_agent"(uuid, text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.update_school_profile (
  p_school_id uuid,
  p_slug      text,
  p_timezone  text,
  p_profile   jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    PERFORM 1 FROM public.school_settings
    WHERE school_id = p_school_id AND owner_user_id = (SELECT auth.uid()) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'school_not_found' USING ERRCODE = '42501'; END IF;
    UPDATE public.schools SET slug = p_slug, timezone = p_timezone WHERE id = p_school_id;
    UPDATE public.school_settings SET notification_email = p_profile->>'notification_email'
    WHERE school_id = p_school_id;
    INSERT INTO public.school_profiles (
        school_id, name, phone, website, address, city, country,
        parking_notes, access_notes, trial_guidance
    ) VALUES (
        p_school_id, p_profile->>'name', p_profile->>'phone', p_profile->>'website',
        p_profile->>'address', p_profile->>'city', coalesce(p_profile->>'country', 'US'),
        p_profile->>'parking_notes', p_profile->>'access_notes', p_profile->>'trial_guidance'
    ) ON CONFLICT (school_id) DO UPDATE SET
        name = EXCLUDED.name, phone = EXCLUDED.phone, website = EXCLUDED.website,
        address = EXCLUDED.address, city = EXCLUDED.city, country = EXCLUDED.country,
        parking_notes = EXCLUDED.parking_notes, access_notes = EXCLUDED.access_notes,
        trial_guidance = EXCLUDED.trial_guidance;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_settings_window_capacity (
  p_window_id uuid,
  p_capacity  integer
)
  RETURNS TABLE (
    result     text,
    max_booked integer
  )
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE v_school_id uuid; v_booked integer;
BEGIN
    IF p_capacity IS NULL OR p_capacity NOT BETWEEN 1 AND 50 THEN
        RAISE EXCEPTION 'invalid_capacity' USING ERRCODE = '22023';
    END IF;
    SELECT w.school_id INTO v_school_id FROM public.trial_windows w
    WHERE w.id = p_window_id AND w.school_id = (
        SELECT school_id FROM public.school_settings WHERE owner_user_id = (SELECT auth.uid())
    ) FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'not_found'::text, 0; RETURN; END IF;
    SELECT coalesce(max(booked_count), 0) INTO v_booked FROM public.trial_occurrences
    WHERE trial_window_id = p_window_id AND school_id = v_school_id AND start_at > now();
    IF v_booked > p_capacity THEN
        RETURN QUERY SELECT 'below_booked'::text, v_booked; RETURN;
    END IF;
    UPDATE public.trial_windows SET capacity = p_capacity WHERE id = p_window_id;
    RETURN QUERY SELECT 'updated'::text, v_booked;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_owner_booking_transition()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    IF current_user <> 'authenticated' OR NEW.status = OLD.status THEN RETURN NEW; END IF;
    IF NEW.status IN ('showed', 'no_show') AND OLD.status IN ('booked', 'showed', 'no_show') THEN
        RETURN NEW;
    END IF;
    IF NEW.status = 'cancelled' AND OLD.status = 'booked' AND OLD.start_at > now() THEN
        NEW.cancelled_at := now();
        NEW.ics_sequence := OLD.ics_sequence + 1;
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'invalid_booking_status_change' USING ERRCODE = '22023';
END;
$function$;

REVOKE ALL ON FUNCTION "public"."validate_owner_booking_transition"() FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "public"."school_profiles"
  ADD CONSTRAINT "school_profiles_school_id_fkey" FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

ALTER TABLE "public"."school_settings"
  ADD CONSTRAINT "school_settings_owner_user_id_fkey" FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."school_settings"
  ADD CONSTRAINT "school_settings_owner_user_id_key" UNIQUE (owner_user_id);

CREATE UNIQUE INDEX school_settings_whatsapp_phone_number_id_unique ON public.school_settings USING btree (whatsapp_phone_number_id)
  WHERE (whatsapp_phone_number_id IS NOT NULL);

CREATE TRIGGER bookings_owner_side_effects
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.record_owner_booking_transition();

CREATE TRIGGER bookings_owner_transition
  BEFORE UPDATE OF status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_owner_booking_transition();

CREATE TRIGGER faqs_enforce_limit
  BEFORE INSERT ON public.faqs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_faq_limit();

CREATE TRIGGER school_profiles_set_updated_at
  BEFORE UPDATE ON public.school_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER school_settings_delete_school
  AFTER DELETE ON public.school_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_school_after_account();

CREATE TRIGGER trial_windows_sync_capacity
  AFTER UPDATE OF capacity ON public.trial_windows
  FOR EACH ROW
  WHEN ((old.capacity IS DISTINCT FROM new.capacity))
  EXECUTE FUNCTION public.sync_window_capacity();

CREATE POLICY "bookings_select_own_school" ON "public"."bookings"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "bookings_update_own_school" ON "public"."bookings"
  FOR UPDATE
  TO "authenticated"
  USING ((school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "contacts_select_own_school" ON "public"."contacts"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "conversations_select_own_school" ON "public"."conversations"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "email_deliveries_owner_trigger_insert" ON "public"."email_deliveries"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((pg_trigger_depth() > 0) AND (school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "email_deliveries_select_own_school" ON "public"."email_deliveries"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "faqs_owner_write" ON "public"."faqs"
  FOR ALL
  TO "authenticated"
  USING ((school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "faqs_public_read" ON "public"."faqs"
  FOR SELECT
  TO "anon", "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.schools s
  WHERE ((s.id = faqs.school_id) AND (s.approved_at IS NOT NULL) AND (s.published_at IS NOT NULL)))));

CREATE POLICY "faqs_select_own_school" ON "public"."faqs"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "funnel_events_owner_trigger_insert" ON "public"."funnel_events"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((pg_trigger_depth() > 0) AND (school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "funnel_events_select_own_school" ON "public"."funnel_events"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "landing_sessions_select_own_school" ON "public"."landing_sessions"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "leads_select_own_school" ON "public"."leads"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "messages_select_own_school" ON "public"."messages"
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM (public.conversations c
     JOIN public.school_settings s ON ((s.school_id = c.school_id)))
  WHERE ((c.id = messages.conversation_id) AND (s.owner_user_id = auth.uid())))));

CREATE POLICY "participants_select_own_school" ON "public"."participants"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "school_profiles_owner_access" ON "public"."school_profiles"
  FOR ALL
  TO "authenticated"
  USING ((school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "school_profiles_public_read" ON "public"."school_profiles"
  FOR SELECT
  TO "anon", "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.schools s
  WHERE ((s.id = school_profiles.school_id) AND (s.approved_at IS NOT NULL) AND (s.published_at IS NOT NULL)))));

CREATE POLICY "school_settings_owner_access" ON "public"."school_settings"
  FOR ALL
  TO "authenticated"
  USING ((owner_user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((owner_user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "schools_select_own" ON "public"."schools"
  FOR SELECT
  TO "authenticated"
  USING ((id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "schools_select_public" ON "public"."schools"
  FOR SELECT
  TO "anon", "authenticated"
  USING (((approved_at IS NOT NULL) AND (published_at IS NOT NULL)));

CREATE POLICY "schools_update_own" ON "public"."schools"
  FOR UPDATE
  TO "authenticated"
  USING ((id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "trial_occurrences_owner_trigger_update" ON "public"."trial_occurrences"
  FOR UPDATE
  TO "authenticated"
  USING (((pg_trigger_depth() > 0) AND (school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK (((pg_trigger_depth() > 0) AND (school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "trial_occurrences_public_read" ON "public"."trial_occurrences"
  FOR SELECT
  TO "anon", "authenticated"
  USING (((EXISTS ( SELECT 1
   FROM public.schools s
  WHERE ((s.id = trial_occurrences.school_id) AND (s.approved_at IS NOT NULL) AND (s.published_at IS NOT NULL)))) AND (EXISTS ( SELECT 1
   FROM public.trial_windows w
  WHERE ((w.id = trial_occurrences.trial_window_id) AND w.active)))));

CREATE POLICY "trial_occurrences_select_own_school" ON "public"."trial_occurrences"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "trial_offerings_owner_write" ON "public"."trial_offerings"
  FOR ALL
  TO "authenticated"
  USING ((school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "trial_offerings_public_read" ON "public"."trial_offerings"
  FOR SELECT
  TO "anon", "authenticated"
  USING ((active AND (EXISTS ( SELECT 1
   FROM public.schools s
  WHERE ((s.id = trial_offerings.school_id) AND (s.approved_at IS NOT NULL) AND (s.published_at IS NOT NULL))))));

CREATE POLICY "trial_offerings_select_own_school" ON "public"."trial_offerings"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "trial_windows_owner_write" ON "public"."trial_windows"
  FOR ALL
  TO "authenticated"
  USING ((school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "trial_windows_public_read" ON "public"."trial_windows"
  FOR SELECT
  TO "anon", "authenticated"
  USING ((active AND (EXISTS ( SELECT 1
   FROM public.schools s
  WHERE ((s.id = trial_windows.school_id) AND (s.approved_at IS NOT NULL) AND (s.published_at IS NOT NULL)))) AND (EXISTS ( SELECT 1
   FROM public.trial_offerings o
  WHERE ((o.id = trial_windows.trial_offering_id) AND o.active)))));

CREATE POLICY "trial_windows_select_own_school" ON "public"."trial_windows"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "whatsapp_booking_intents_select_own_school" ON "public"."whatsapp_booking_intents"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "whatsapp_deliveries_select_own_school" ON "public"."whatsapp_deliveries"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "whatsapp_jobs_select_own_school" ON "public"."whatsapp_jobs"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

REVOKE ALL ON FUNCTION "public"."delete_school_after_account"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."delete_school_after_account"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."delete_school_after_account"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."enforce_faq_limit"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."enforce_faq_limit"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."enforce_faq_limit"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."record_owner_booking_transition"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."record_owner_booking_transition"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."record_owner_booking_transition"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."sync_window_capacity"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."sync_window_capacity"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."sync_window_capacity"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."update_school_agent"(uuid, text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."update_school_agent"(uuid, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_school_agent"(uuid, text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_school_agent"(uuid, text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."validate_owner_booking_transition"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_owner_booking_transition"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_owner_booking_transition"() TO "service_role";

REVOKE ALL ("status") ON TABLE "public"."bookings" FROM "authenticated";

GRANT UPDATE ("status") ON TABLE "public"."bookings" TO "authenticated";

REVOKE ALL ("booking_id") ON TABLE "public"."email_deliveries" FROM "authenticated";

GRANT INSERT ("booking_id") ON TABLE "public"."email_deliveries" TO "authenticated";

REVOKE ALL ("kind") ON TABLE "public"."email_deliveries" FROM "authenticated";

GRANT INSERT ("kind") ON TABLE "public"."email_deliveries" TO "authenticated";

REVOKE ALL ("provider_idempotency_key") ON TABLE "public"."email_deliveries" FROM "authenticated";

GRANT INSERT ("provider_idempotency_key") ON TABLE "public"."email_deliveries" TO "authenticated";

REVOKE ALL ("recipient") ON TABLE "public"."email_deliveries" FROM "authenticated";

GRANT INSERT ("recipient") ON TABLE "public"."email_deliveries" TO "authenticated";

REVOKE ALL ("school_id") ON TABLE "public"."email_deliveries" FROM "authenticated";

GRANT INSERT ("school_id") ON TABLE "public"."email_deliveries" TO "authenticated";

REVOKE ALL ON TABLE "public"."faqs" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."faqs" TO "authenticated";

REVOKE ALL ("booking_id") ON TABLE "public"."funnel_events" FROM "authenticated";

GRANT INSERT ("booking_id") ON TABLE "public"."funnel_events" TO "authenticated";

REVOKE ALL ("conversation_id") ON TABLE "public"."funnel_events" FROM "authenticated";

GRANT INSERT ("conversation_id") ON TABLE "public"."funnel_events" TO "authenticated";

REVOKE ALL ("event_type") ON TABLE "public"."funnel_events" FROM "authenticated";

GRANT INSERT ("event_type") ON TABLE "public"."funnel_events" TO "authenticated";

REVOKE ALL ("landing_session_id") ON TABLE "public"."funnel_events" FROM "authenticated";

GRANT INSERT ("landing_session_id") ON TABLE "public"."funnel_events" TO "authenticated";

REVOKE ALL ("metadata") ON TABLE "public"."funnel_events" FROM "authenticated";

GRANT INSERT ("metadata") ON TABLE "public"."funnel_events" TO "authenticated";

REVOKE ALL ("school_id") ON TABLE "public"."funnel_events" FROM "authenticated";

GRANT INSERT ("school_id") ON TABLE "public"."funnel_events" TO "authenticated";

REVOKE ALL ON TABLE "public"."school_profiles" FROM "anon";

GRANT SELECT ON TABLE "public"."school_profiles" TO "anon";

REVOKE ALL ON TABLE "public"."school_profiles" FROM "authenticated";

GRANT INSERT, SELECT, UPDATE ON TABLE "public"."school_profiles" TO "authenticated";

REVOKE ALL ON TABLE "public"."school_profiles" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."school_profiles" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."school_profiles" TO "service_role";

REVOKE ALL ON TABLE "public"."school_settings" FROM "authenticated";

REVOKE ALL ("agent_instructions") ON TABLE "public"."school_settings" FROM "authenticated";

GRANT UPDATE ("agent_instructions") ON TABLE "public"."school_settings" TO "authenticated";

REVOKE ALL ("notification_email") ON TABLE "public"."school_settings" FROM "authenticated";

GRANT UPDATE ("notification_email") ON TABLE "public"."school_settings" TO "authenticated";

REVOKE ALL ("previewed_at") ON TABLE "public"."school_settings" FROM "authenticated";

GRANT UPDATE ("previewed_at") ON TABLE "public"."school_settings" TO "authenticated";

REVOKE ALL ("updated_at") ON TABLE "public"."school_settings" FROM "authenticated";

GRANT UPDATE ("updated_at") ON TABLE "public"."school_settings" TO "authenticated";

GRANT SELECT ON TABLE "public"."school_settings" TO "authenticated";

REVOKE ALL ON TABLE "public"."schools" FROM "anon";

GRANT SELECT ON TABLE "public"."schools" TO "anon";

REVOKE ALL ("slug") ON TABLE "public"."schools" FROM "authenticated";

GRANT UPDATE ("slug") ON TABLE "public"."schools" TO "authenticated";

REVOKE ALL ("timezone") ON TABLE "public"."schools" FROM "authenticated";

GRANT UPDATE ("timezone") ON TABLE "public"."schools" TO "authenticated";

REVOKE ALL ("booked_count") ON TABLE "public"."trial_occurrences" FROM "authenticated";

GRANT UPDATE ("booked_count") ON TABLE "public"."trial_occurrences" TO "authenticated";

REVOKE ALL ("capacity") ON TABLE "public"."trial_occurrences" FROM "authenticated";

GRANT UPDATE ("capacity") ON TABLE "public"."trial_occurrences" TO "authenticated";

REVOKE ALL ON TABLE "public"."trial_windows" FROM "authenticated";

REVOKE ALL ("active") ON TABLE "public"."trial_windows" FROM "authenticated";

GRANT UPDATE ("active") ON TABLE "public"."trial_windows" TO "authenticated";

REVOKE ALL ("capacity") ON TABLE "public"."trial_windows" FROM "authenticated";

GRANT UPDATE ("capacity") ON TABLE "public"."trial_windows" TO "authenticated";

REVOKE ALL ("updated_at") ON TABLE "public"."trial_windows" FROM "authenticated";

GRANT UPDATE ("updated_at") ON TABLE "public"."trial_windows" TO "authenticated";

GRANT DELETE, INSERT, SELECT ON TABLE "public"."trial_windows" TO "authenticated";

END;
$school_split$;
