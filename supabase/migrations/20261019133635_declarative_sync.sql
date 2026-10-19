SET local check_function_bodies = off;

CREATE POLICY "schools_select_own" ON "public"."schools"
  FOR SELECT
  TO "authenticated"
  USING ((owner_user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "users_select_own" ON "public"."users"
  FOR SELECT
  TO "authenticated"
  USING ((id = ( SELECT auth.uid() AS uid)));

REVOKE ALL ON FUNCTION "public"."prevent_published_school_identity_change"() FROM "service_role";

GRANT EXECUTE ON FUNCTION "public"."prevent_published_school_identity_change"() TO "service_role";

REVOKE ALL ON TABLE "public"."schools" FROM "authenticated";

GRANT SELECT ON TABLE "public"."schools" TO "authenticated";

REVOKE ALL ON TABLE "public"."schools" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."schools" TO "service_role";

REVOKE ALL ON TABLE "public"."users" FROM "authenticated";

GRANT SELECT ON TABLE "public"."users" TO "authenticated";

REVOKE ALL ON TABLE "public"."users" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."users" TO "service_role";
