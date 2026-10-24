-- LOCAL DEVELOPMENT ONLY. Runs after public-schema migrations and 00-auth.sql.
INSERT INTO public.users (id, email, name)
SELECT id, 'owner@local.test', 'Local Owner'
FROM auth.users WHERE lower(email) = 'owner@local.test'
ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email, name = EXCLUDED.name, updated_at = now();

-- Reuse only this owner's school. A slug collision belongs to somebody else
-- and must fail instead of letting the seed claim their school.
WITH seeded_school AS (
    INSERT INTO public.schools (id, slug, timezone, approved_at)
    SELECT coalesce((SELECT school_id FROM public.school_settings WHERE owner_user_id = u.id), gen_random_uuid()),
        'demo', 'America/New_York', now()
    FROM auth.users u WHERE lower(u.email) = 'owner@local.test'
    ON CONFLICT (id) DO UPDATE SET approved_at = coalesce(public.schools.approved_at, now())
    RETURNING id
)
INSERT INTO public.school_settings (school_id, owner_user_id, notification_email, whatsapp_phone_number_id)
SELECT s.id, u.id, 'owner@local.test', '106500000000000'
FROM seeded_school s CROSS JOIN auth.users u
WHERE lower(u.email) = 'owner@local.test'
ON CONFLICT (school_id) DO UPDATE SET whatsapp_phone_number_id = EXCLUDED.whatsapp_phone_number_id;

INSERT INTO public.school_profiles (
    school_id, name, city, address, phone, country, welcome_message
)
SELECT s.id, 'Demo Dojo', 'Brooklyn', '123 Demo Street', '555-0100',
    'US', 'Welcome to the local demo school.'
FROM public.schools s JOIN public.school_settings a ON a.school_id = s.id JOIN auth.users u ON u.id = a.owner_user_id
WHERE lower(u.email) = 'owner@local.test'
ON CONFLICT (school_id) DO UPDATE SET
    city = coalesce(public.school_profiles.city, EXCLUDED.city);

INSERT INTO public.trial_offerings (school_id, name, description, minimum_age, maximum_age, active)
SELECT s.id, 'Kids beginner trial', 'A 45-minute intro class for new students.', 5, 12, true
FROM public.schools s JOIN public.school_settings a ON a.school_id = s.id JOIN auth.users u ON u.id = a.owner_user_id
WHERE lower(u.email) = 'owner@local.test'
    AND NOT EXISTS (SELECT FROM public.trial_offerings o WHERE o.school_id = s.id);

INSERT INTO public.trial_windows (
    school_id, trial_offering_id, day_of_week, start_minute, duration_minutes, capacity, label, active
)
SELECT s.id, o.id, 1, 1080, 60, 8, 'Monday 6pm', true
FROM public.schools s JOIN public.school_settings a ON a.school_id = s.id JOIN auth.users u ON u.id = a.owner_user_id
CROSS JOIN LATERAL (
    SELECT id FROM public.trial_offerings WHERE school_id = s.id ORDER BY created_at, id LIMIT 1
) o
WHERE lower(u.email) = 'owner@local.test'
    AND NOT EXISTS (SELECT FROM public.trial_windows w WHERE w.school_id = s.id AND w.trial_offering_id = o.id);

-- Reuse any upcoming booked trial. After it expires/is cancelled, create a NEW
-- booking rather than clobbering history or conflicting with the old seed key.
WITH context AS MATERIALIZED (
    SELECT s.id AS school_id, s.timezone, o.id AS offering_id, o.name AS offering_name,
        w.id AS window_id, w.capacity, w.duration_minutes, now() + interval '168 hours' AS start_at,
        gen_random_uuid() AS booking_id
    FROM public.schools s JOIN public.school_settings a ON a.school_id = s.id JOIN auth.users u ON u.id = a.owner_user_id
    CROSS JOIN LATERAL (
        SELECT * FROM public.trial_offerings WHERE school_id = s.id ORDER BY created_at, id LIMIT 1
    ) o
    CROSS JOIN LATERAL (
        SELECT * FROM public.trial_windows
        WHERE school_id = s.id AND trial_offering_id = o.id ORDER BY created_at, id LIMIT 1
    ) w
    WHERE lower(u.email) = 'owner@local.test' AND NOT EXISTS (
        SELECT FROM public.bookings b WHERE b.school_id = s.id AND b.status = 'booked' AND b.start_at >= now()
    )
), contact AS (
    INSERT INTO public.contacts (school_id, email, name, phone)
    SELECT school_id, 'family@local.test', 'Alex Rivera', '555-0199' FROM context
    ON CONFLICT (school_id, email) DO UPDATE SET
        name = EXCLUDED.name, phone = EXCLUDED.phone, updated_at = now()
    RETURNING id, school_id
), participant AS (
    INSERT INTO public.participants (school_id, contact_id, name, normalized_name)
    SELECT school_id, id, 'Sam Rivera', 'sam rivera' FROM contact
    ON CONFLICT (contact_id, normalized_name) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
    RETURNING id, contact_id
), occurrence AS (
    INSERT INTO public.trial_occurrences (
        school_id, trial_window_id, trial_offering_id, start_at, end_at, capacity, booked_count
    )
    SELECT school_id, window_id, offering_id, start_at,
        start_at + duration_minutes * interval '1 minute', capacity, 1 FROM context
    ON CONFLICT (trial_window_id, start_at) DO UPDATE SET
        booked_count = public.trial_occurrences.booked_count + 1, updated_at = now()
    RETURNING id, school_id
)
INSERT INTO public.bookings (
    id, school_id, contact_id, participant_id, trial_offering_id, trial_window_id,
    trial_occurrence_id, idempotency_key, status, participant_name_snapshot,
    participant_age_snapshot, offering_name_snapshot, timezone_snapshot, start_at, end_at,
    contact_email_snapshot, contact_name_snapshot, contact_phone_snapshot, ics_uid
)
SELECT c.booking_id, c.school_id, p.contact_id, p.id, c.offering_id, c.window_id,
    occ.id, 'seed:demo-upcoming:' || c.booking_id, 'booked', 'Sam Rivera', 8,
    c.offering_name, c.timezone, c.start_at, c.start_at + c.duration_minutes * interval '1 minute',
    'family@local.test', 'Alex Rivera', '555-0199', c.booking_id || '@fillthemat.com'
FROM context c JOIN occurrence occ USING (school_id) CROSS JOIN participant p;

-- A separate, unbooked lead for the dashboard. Preserve edits on subsequent runs.
WITH context AS MATERIALIZED (
    SELECT s.id AS school_id, o.id AS offering_id
    FROM public.schools s JOIN public.school_settings a ON a.school_id = s.id JOIN auth.users u ON u.id = a.owner_user_id
    CROSS JOIN LATERAL (
        SELECT id FROM public.trial_offerings WHERE school_id = s.id ORDER BY created_at, id LIMIT 1
    ) o
    WHERE lower(u.email) = 'owner@local.test'
), contact AS (
    INSERT INTO public.contacts (school_id, email, name, phone)
    SELECT school_id, 'lead@local.test', 'Jordan Morgan', '555-0188' FROM context
    ON CONFLICT (school_id, email) DO UPDATE SET email = EXCLUDED.email
    RETURNING id, school_id
), landing_session AS (
    INSERT INTO public.landing_sessions (school_id, session_key_hash, qualified_at)
    SELECT school_id, 'seed:demo-lead', now() FROM context
    ON CONFLICT (school_id, session_key_hash) DO UPDATE SET session_key_hash = EXCLUDED.session_key_hash
    RETURNING id, school_id
)
INSERT INTO public.leads (
    school_id, landing_session_id, contact_id, participant_name, participant_age,
    trial_offering_id, stated_need, status
)
SELECT c.school_id, ls.id, ct.id, 'Taylor Morgan', 9, c.offering_id,
    'Looking for a beginner class to build confidence. Please contact me about trial availability.', 'open'
FROM context c JOIN contact ct USING (school_id) JOIN landing_session ls USING (school_id)
WHERE NOT EXISTS (
    SELECT FROM public.leads l WHERE l.school_id = c.school_id AND l.landing_session_id = ls.id
);
