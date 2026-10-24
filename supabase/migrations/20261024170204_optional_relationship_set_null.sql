ALTER TABLE "public"."bookings"
  DROP CONSTRAINT "bookings_conversation_fk";

ALTER TABLE "public"."bookings"
  DROP CONSTRAINT "bookings_landing_session_fk";

ALTER TABLE "public"."conversations"
  DROP CONSTRAINT "conversations_contact_fk";

ALTER TABLE "public"."conversations"
  DROP CONSTRAINT "conversations_landing_session_fk";

ALTER TABLE "public"."leads"
  DROP CONSTRAINT "leads_offering_fk";

ALTER TABLE "public"."bookings"
  ADD CONSTRAINT "bookings_conversation_fk" FOREIGN KEY (school_id, conversation_id) REFERENCES public.conversations(school_id, id) ON DELETE SET NULL (conversation_id);

ALTER TABLE "public"."bookings"
  ADD CONSTRAINT "bookings_landing_session_fk" FOREIGN KEY (school_id, landing_session_id) REFERENCES public.landing_sessions(school_id, id) ON DELETE SET NULL (landing_session_id);

ALTER TABLE "public"."conversations"
  ADD CONSTRAINT "conversations_contact_fk" FOREIGN KEY (school_id, contact_id) REFERENCES public.contacts(school_id, id) ON DELETE SET NULL (contact_id);

ALTER TABLE "public"."conversations"
  ADD CONSTRAINT "conversations_landing_session_fk" FOREIGN KEY (school_id, landing_session_id) REFERENCES public.landing_sessions(school_id, id) ON DELETE
    SET NULL (landing_session_id);

ALTER TABLE "public"."leads"
  ADD CONSTRAINT "leads_offering_fk" FOREIGN KEY (school_id, trial_offering_id) REFERENCES public.trial_offerings(school_id, id) ON DELETE SET NULL (trial_offering_id);
