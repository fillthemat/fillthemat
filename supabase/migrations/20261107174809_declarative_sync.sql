CREATE INDEX bookings_email_quota_idx ON public.bookings USING btree (school_id, contact_email_snapshot, created_at);

CREATE INDEX bookings_phone_quota_idx ON public.bookings USING btree (school_id, contact_phone_snapshot, created_at);

CREATE INDEX email_deliveries_recipient_quota_idx ON public.email_deliveries USING btree (school_id, recipient, created_at);

CREATE INDEX whatsapp_deliveries_recipient_quota_idx ON public.whatsapp_deliveries USING btree (school_id, recipient_wa_id, created_at);
