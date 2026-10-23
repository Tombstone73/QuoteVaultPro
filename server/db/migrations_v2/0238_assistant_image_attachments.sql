-- Staged images stay private to one authenticated assistant conversation.
-- A saved message owns the reference; only unlinked rows are cleanup candidates.
CREATE TABLE public.ai_message_attachments (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id varchar NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id varchar NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  uploaded_by_user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  file_record_id varchar NOT NULL REFERENCES public.file_records(id) ON DELETE RESTRICT,
  message_id varchar REFERENCES public.ai_messages(id) ON DELETE CASCADE,
  original_filename text NOT NULL,
  mime_type varchar(32) NOT NULL,
  size_bytes integer NOT NULL,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_message_attachments_size_ck CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  CONSTRAINT ai_message_attachments_mime_ck CHECK (mime_type IN ('image/jpeg','image/png','image/gif','image/webp'))
);
CREATE INDEX ai_message_attachments_conversation_idx ON public.ai_message_attachments (org_id, conversation_id, message_id);
CREATE INDEX ai_message_attachments_retention_idx ON public.ai_message_attachments (message_id, removed_at, created_at);
