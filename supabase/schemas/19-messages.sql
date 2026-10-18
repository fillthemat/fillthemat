CREATE TABLE app.messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    message_id text NOT NULL,
    role text NOT NULL,
    parts jsonb NOT NULL,
    completion app.message_completion DEFAULT 'complete' NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT messages_conversation_message_id UNIQUE (conversation_id, message_id)
);

ALTER TABLE app.messages ADD CONSTRAINT messages_conversation_id_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES app.conversations(id) ON DELETE CASCADE;
