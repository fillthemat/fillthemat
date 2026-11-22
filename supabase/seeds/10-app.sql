-- LOCAL DEVELOPMENT ONLY. Runs after public-schema migrations and 00-auth.sql.
-- OpenMat public configuration snapshot, 2026-11-21. No production IDs, users,
-- notification addresses, WhatsApp connections, bookings, leads, or messages.
-- Reruns preserve owner-edited profiles, FAQs, offerings, and weekly schedules.
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
        'openmat', 'America/Toronto', now()
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
    school_id, name, city, address, phone, country, website, logo_url,
    parking_notes, access_notes, trial_guidance, pricing, welcome_message
)
SELECT s.id, 'OpenMat MMA', 'Toronto', '295 College St, Level B', '(647) 269-8466',
    'CA', 'https://www.openmat.ca', 'https://www.openmat.ca/assets/images/logo-small.png',
    'There is no dedicated lot. Green P lots and street parking are within a block or two on College St and the side streets, and the 506 College streetcar stops outside.',
    'We are on Level B. Come down the stairs from the College St entrance, just east of Spadina, and ring the buzzer if the door is locked.',
    'Arrive 10-15 minutes early so we can get you signed in and show you around. Bring water and wear shorts and a t-shirt. No equipment needed for your first class - ask at the front desk and we will lend you what you need.',
    E'Your first class is free for first-time students.\n\nMonthly memberships\n- Ask at the front desk or email welcome@OpenMat.ca for current rates.\n- Students with valid ID get 15% off monthly memberships.\n- Family plans are available.\n\nPrivate lessons\n- One-on-one and small-group sessions with our coaches. Contact us to book.\n\nNo membership is required to try a class.',
    'Hey! You''ve reached OpenMat MMA at College and Spadina. We run BJJ, Muay Thai, Boxing and Wrestling for kids, youth and adults, and your first class is free. Tell me what you''d like to try and I''ll find a class that fits your week.'
FROM public.schools s JOIN public.school_settings a ON a.school_id = s.id JOIN auth.users u ON u.id = a.owner_user_id
WHERE lower(u.email) = 'owner@local.test'
ON CONFLICT (school_id) DO NOTHING;

INSERT INTO public.faqs (school_id, question, answer, sort_order)
SELECT s.id, f.question, f.answer, f.sort_order
FROM public.schools s JOIN public.school_settings a ON a.school_id = s.id JOIN auth.users u ON u.id = a.owner_user_id
CROSS JOIN (VALUES
    ('Do I need experience to start?', 'No. Every program has a beginner entry point. No Gi BJJ 101 runs on a 16-lesson rotation so you can start any week, and Muay Thai, Boxing and Wrestling Fundamentals assume no experience at all. Tell us it is your first class and a coach will pair you with someone who knows the way.', 0),
    ('What should I wear to my first class?', 'Shorts and a t-shirt. Bring water. If you own a gi, bring it; otherwise ask at the front desk and we will lend you what you need for the class.', 1),
    ('How much does a membership cost?', 'Your first class is free. Monthly memberships and family plans are available, and students with valid ID get 15% off. Email welcome@OpenMat.ca or call (647) 269-8466 for current rates.', 2),
    ('Where are you and how do I get there?', '295 College St, Level B - at College and Spadina in downtown Toronto. The 506 College streetcar stops outside and Spadina station is a short walk. Come down the stairs from the College St entrance and ring the buzzer if the door is locked.', 3),
    ('Is there parking?', 'There is no dedicated lot. Green P lots and street parking are within a block or two on College St and the side streets.', 4),
    ('Do parents stay during kids classes?', 'Yes. Parents watch from the benches. Kids BJJ is for ages 4-9 and Youth BJJ for ages 10-15, and both are coach-led with a high instructor-to-child ratio.', 5)
) AS f(question, answer, sort_order)
WHERE lower(u.email) = 'owner@local.test'
    AND NOT EXISTS (SELECT FROM public.faqs existing WHERE existing.school_id = s.id);

-- Each window tuple is [day_of_week (Sunday=0), start_minute, duration_minutes].
-- Capacities vary by offering; all snapshot offerings/windows are active,
-- waiver_notes/labels are null, and adult offerings have no configured age bound.
WITH catalog(name, description, minimum_age, maximum_age, expectations, attire, capacity, windows) AS (
    VALUES
    ('BJJ Mobility', 'Mobility and movement for BJJ players: hip and shoulder range, plus the drills that keep you on the mats.', null::integer, null::integer, 'Low intensity, all floor work. Good on a rest day or after a hard week.', 'Comfortable athletic clothes.', 20, '[[5,1020,60]]'::jsonb),
    ('Boxing', 'Boxing technique and conditioning: stance, jab, footwork and combinations.', null, null, 'Skipping, shadow boxing, bag and pad work. Coach-led, no sparring required.', 'Shorts and a t-shirt. Loaner gloves and wraps available.', 20, '[[5,1020,60]]'::jsonb),
    ('Gi BJJ - All Levels', 'Brazilian Jiu-Jitsu in the gi for every level. Classes follow OpenMat''s structured curriculum, so beginners and experienced students drill the same techniques at different depths.', null, null, 'Warm-up, technique instruction with a partner, then drilling and positional sparring. Coach-led, no experience needed.', 'Gi and belt if you have one. Loaner gi available for your first class.', 20, '[[0,660,60],[1,720,60],[1,1080,60],[3,720,60],[3,1080,60],[5,720,60]]'::jsonb),
    ('Kids BJJ (4-9)', 'Playful BJJ fundamentals for ages 4-9, built around games, movement and simple self-defence.', 4, 9, 'Parents watch from the bench. Class ends with a game and a short talk about focus and respect.', 'Shorts and a t-shirt, bare feet.', 12, '[[1,1005,75],[3,1005,75],[6,600,60]]'::jsonb),
    ('MMA Fundamentals', 'The basics of mixing striking and grappling: distance, entries and working against the wall.', null, null, 'Technical drilling with a partner and moderate conditioning. No live MMA sparring.', 'Shorts and a t-shirt. Gloves if you have them.', 20, '[[5,1080,90]]'::jsonb),
    ('Muay Thai - All Levels', 'Thai boxing fundamentals: stance, footwork, kicks, knees and clinch work.', null, null, 'Shadow boxing, pad work with a partner and conditioning. No sparring until you are ready.', 'Shorts and a t-shirt. Loaner gloves and shin pads available.', 20, '[[1,1200,60],[3,1200,60],[6,540,60]]'::jsonb),
    ('No Gi BJJ - All Levels', 'Brazilian Jiu-Jitsu without the gi. Same curriculum at a faster pace, with more emphasis on wrestling ties and leg entanglements.', null, null, 'Warm-up, technique, then rounds. Bring water - this one is sweaty.', 'Rash guard and shorts. T-shirt and shorts are fine for your first class.', 20, '[[2,420,60],[2,720,60],[5,420,60],[6,660,60]]'::jsonb),
    ('No Gi BJJ 101', 'The beginner no-gi program: a 16-lesson rotation covering escapes, guard, mount, side control and takedowns.', null, null, 'Structured, step-by-step instruction in an eight-week rotation, so you can start any week.', 'Rash guard or t-shirt and shorts.', 20, '[[1,1260,60],[2,1185,60],[3,1260,60],[4,720,60],[4,1185,60]]'::jsonb),
    ('No Gi BJJ 201 - Advanced', 'The advanced no-gi curriculum: leg entanglements, back attacks and chain wrestling.', null, null, 'Fast-paced drilling and live rounds. Best for students who have finished the 101 rotation.', 'Rash guard and shorts.', 20, '[[2,1080,105],[4,1080,105]]'::jsonb),
    ('Sparring', 'Open rounds for students who already train. A coach is on the mat to pair partners and keep rounds safe.', null, null, 'Arrive warmed up. Rounds run five to six minutes, paired by size and level.', 'Gi or no gi depending on the round. Mouthguard recommended.', 24, '[[0,720,60],[1,780,30],[1,1140,60],[2,780,30],[2,1260,30],[3,780,30],[3,1140,60],[4,780,30],[4,1260,30],[5,780,30],[6,720,60]]'::jsonb),
    ('Womens No Gi BJJ 101', 'The beginner no-gi curriculum taught in a women-only class, led by OpenMat''s female coaches.', null, null, 'The same 101 rotation as the co-ed class, in a smaller group. No experience needed.', 'Rash guard or t-shirt and shorts.', 20, '[[0,780,60]]'::jsonb),
    ('Womens Sparring', 'Rounds for the women training at OpenMat, with a coach pairing partners.', null, null, 'Arrive warmed up. Rounds run five minutes with a coach on the mat.', 'Gi or no gi.', 24, '[[0,840,60]]'::jsonb),
    ('Wrestling', 'Stand-up wrestling for students who already know the basics.', null, null, 'Stance work, takedown drills and live goes from the feet.', 'Shorts and a t-shirt.', 20, '[[4,1020,60]]'::jsonb),
    ('Wrestling Fundamentals', 'Stance, movement and takedowns for students who are new to wrestling.', null, null, 'Lots of movement drills and partner work. No live sparring in your first class.', 'Shorts and a t-shirt. Wrestling shoes optional.', 20, '[[2,1020,60]]'::jsonb),
    ('Youth BJJ', 'BJJ for ages 10-15, with more technical drilling and an introduction to controlled live rounds.', 10, 15, 'Warm-up, technique with a partner, then controlled sparring with a coach watching.', 'Shorts and a t-shirt. A gi if you have one.', 16, '[[2,960,60],[5,960,60],[6,660,60]]'::jsonb)
), inserted_offerings AS (
    INSERT INTO public.trial_offerings (
        school_id, name, description, minimum_age, maximum_age, expectations, attire, active
    )
    SELECT s.id, c.name, c.description, c.minimum_age, c.maximum_age, c.expectations, c.attire, true
    FROM public.schools s JOIN public.school_settings a ON a.school_id = s.id JOIN auth.users u ON u.id = a.owner_user_id
    CROSS JOIN catalog c
    WHERE lower(u.email) = 'owner@local.test'
        AND NOT EXISTS (SELECT FROM public.trial_offerings o WHERE o.school_id = s.id)
    RETURNING id, school_id, name
)
INSERT INTO public.trial_windows (
    school_id, trial_offering_id, day_of_week, start_minute, duration_minutes, capacity, label, active
)
SELECT o.school_id, o.id, (w.value->>0)::integer, (w.value->>1)::integer,
    (w.value->>2)::integer, c.capacity, null, true
FROM inserted_offerings o JOIN catalog c USING (name)
CROSS JOIN LATERAL jsonb_array_elements(c.windows) AS w(value);

-- Reuse any upcoming booked trial. After it expires/is cancelled, create a NEW
-- booking rather than clobbering history or conflicting with the old seed key.
WITH context AS MATERIALIZED (
    SELECT s.id AS school_id, s.timezone, o.id AS offering_id, o.name AS offering_name,
        w.id AS window_id, w.capacity, w.duration_minutes, now() + interval '168 hours' AS start_at,
        gen_random_uuid() AS booking_id
    FROM public.schools s JOIN public.school_settings a ON a.school_id = s.id JOIN auth.users u ON u.id = a.owner_user_id
    CROSS JOIN LATERAL (
        SELECT * FROM public.trial_offerings WHERE school_id = s.id
        ORDER BY (name = 'Kids BJJ (4-9)') DESC, created_at, id LIMIT 1
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
        SELECT id FROM public.trial_offerings WHERE school_id = s.id
        ORDER BY (name = 'Kids BJJ (4-9)') DESC, created_at, id LIMIT 1
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
