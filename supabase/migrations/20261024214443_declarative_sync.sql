CREATE INDEX conversations_resume_token_history ON public.conversations USING btree (resume_token_hash, school_id);

CREATE INDEX messages_transcript_order ON public.messages USING btree (conversation_id, created_at, id);
