-- Per-user settings (GitHub token, Odoo instances and API keys).
-- The whole settings document is encrypted with AES-256-GCM by the Edge
-- Functions before it reaches this table; the database only ever stores
-- ciphertext.
create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload text not null,
  updated_at timestamptz not null default now()
);

-- RLS enabled without any policy: browsers (anon and authenticated roles)
-- can neither read nor write this table. Only the Edge Functions, through
-- the service role, access it.
alter table public.user_settings enable row level security;
revoke all on table public.user_settings from anon, authenticated;
