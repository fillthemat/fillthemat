-- LOCAL DEVELOPMENT ONLY. Applied by db:seed/setup AFTER Drizzle migrations.
-- Do not include this file in native startup sql_paths: app does not exist yet.
-- Public declarative copies intentionally receive no data.
INSERT INTO app.users (id, email, name)
SELECT id, 'owner@local.test', 'Local Owner'
FROM auth.users WHERE lower(email) = 'owner@local.test'
ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email, name = EXCLUDED.name, updated_at = now();

-- A slug owned by somebody else is an error, never a reason to seed their school.
INSERT INTO app.schools (
    owner_user_id, name, slug, timezone, city, address, phone, notification_email,
    country, approved_at, whatsapp_phone_number_id, welcome_message
)
SELECT id, 'Demo Dojo', 'demo', 'America/New_York', 'Brooklyn', '123 Demo Street',
    '555-0100', 'owner@local.test', 'US', now(), '106500000000000',
    'Welcome to the local demo school.'
FROM auth.users WHERE lower(email) = 'owner@local.test'
ON CONFLICT (owner_user_id) DO UPDATE SET
    approved_at = coalesce(app.schools.approved_at, now()),
    city = coalesce(app.schools.city, 'Brooklyn'),
    -- Keep in sync with LOCAL_WHATSAPP_PHONE_NUMBER_ID (covered by seed tests).
    whatsapp_phone_number_id = EXCLUDED.whatsapp_phone_number_id, updated_at = now();

INSERT INTO app.trial_offerings (school_id, name, description, minimum_age, maximum_age, active)
SELECT s.id, 'Kids beginner trial', 'A 45-minute intro class for new students.', 5, 12, true
FROM app.schools s JOIN auth.users u ON u.id = s.owner_user_id
WHERE lower(u.email) = 'owner@local.test'
    AND NOT EXISTS (SELECT FROM app.trial_offerings o WHERE o.school_id = s.id);

INSERT INTO app.trial_windows (
    school_id, trial_offering_id, day_of_week, start_minute, duration_minutes, capacity, label, active
)
SELECT s.id, o.id, 1, 1080, 60, 8, 'Monday 6pm', true
FROM app.schools s JOIN auth.users u ON u.id = s.owner_user_id
CROSS JOIN LATERAL (
    SELECT id FROM app.trial_offerings WHERE school_id = s.id ORDER BY created_at, id LIMIT 1
) o
WHERE lower(u.email) = 'owner@local.test'
    AND NOT EXISTS (SELECT FROM app.trial_windows w WHERE w.school_id = s.id AND w.trial_offering_id = o.id);

-- Reuse any upcoming booked trial. After it expires/is cancelled, create a NEW
-- booking rather than clobbering history or conflicting with the old seed key.
WITH context AS MATERIALIZED (
    SELECT s.id AS school_id, s.timezone, o.id AS offering_id, o.name AS offering_name,
        w.id AS window_id, w.capacity, w.duration_minutes, now() + interval '168 hours' AS start_at,
        gen_random_uuid() AS booking_id
    FROM app.schools s JOIN auth.users u ON u.id = s.owner_user_id
    CROSS JOIN LATERAL (
        SELECT * FROM app.trial_offerings WHERE school_id = s.id ORDER BY created_at, id LIMIT 1
    ) o
    CROSS JOIN LATERAL (
        SELECT * FROM app.trial_windows
        WHERE school_id = s.id AND trial_offering_id = o.id ORDER BY created_at, id LIMIT 1
    ) w
    WHERE lower(u.email) = 'owner@local.test' AND NOT EXISTS (
        SELECT FROM app.bookings b WHERE b.school_id = s.id AND b.status = 'booked' AND b.start_at >= now()
    )
), contact AS (
    INSERT INTO app.contacts (school_id, email, name, phone)
    SELECT school_id, 'family@local.test', 'Alex Rivera', '555-0199' FROM context
    ON CONFLICT (school_id, email) DO UPDATE SET
        name = EXCLUDED.name, phone = EXCLUDED.phone, updated_at = now()
    RETURNING id, school_id
), participant AS (
    INSERT INTO app.participants (school_id, contact_id, name, normalized_name)
    SELECT school_id, id, 'Sam Rivera', 'sam rivera' FROM contact
    ON CONFLICT (contact_id, normalized_name) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
    RETURNING id, contact_id
), occurrence AS (
    INSERT INTO app.trial_occurrences (
        school_id, trial_window_id, trial_offering_id, start_at, end_at, capacity, booked_count
    )
    SELECT school_id, window_id, offering_id, start_at,
        start_at + duration_minutes * interval '1 minute', capacity, 1 FROM context
    ON CONFLICT (trial_window_id, start_at) DO UPDATE SET
        booked_count = app.trial_occurrences.booked_count + 1, updated_at = now()
    RETURNING id, school_id
)
INSERT INTO app.bookings (
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
