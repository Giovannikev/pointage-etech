-- "Do with Claude" from a phone: Pointage records a job, and the Claude agent
-- running on the user's computer (scripts/claudeAgent.ts) starts a Claude
-- Code session for it. The agent signs in as the user, so RLS limits both
-- the browser and the agent to the user's own rows. Nothing here is secret:
-- the local folders of the projects stay on the computer.

create table public.claude_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  instance_index smallint not null check (instance_index in (1, 2)),
  task_id integer not null check (task_id > 0),
  task_name text not null check (char_length(task_name) between 1 and 500),
  project_id integer check (project_id > 0),
  project_name text check (char_length(project_name) <= 500),
  -- Claude Desktop takes up to 14,336 characters: the same bound here.
  prompt text not null check (char_length(prompt) between 1 and 14336),
  -- pending: waiting for the agent; launching: the agent took it;
  -- started: the session runs; failed: see error.
  status text not null default 'pending'
    check (status in ('pending', 'launching', 'started', 'failed')),
  agent_host text check (char_length(agent_host) <= 255),
  session_name text check (char_length(session_name) <= 255),
  background_id text check (char_length(background_id) <= 64),
  error text check (char_length(error) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index claude_jobs_user_created_idx
  on public.claude_jobs (user_id, created_at desc);

alter table public.claude_jobs enable row level security;

create policy "Users read their Claude jobs"
  on public.claude_jobs for select to authenticated
  using ((select auth.uid()) = user_id);

-- A new job waits for the agent: only the agent fills in what follows.
create policy "Users create pending Claude jobs"
  on public.claude_jobs for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and status = 'pending'
    and agent_host is null
    and session_name is null
    and background_id is null
    and error is null
  );

create policy "Users update their Claude jobs"
  on public.claude_jobs for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users delete their Claude jobs"
  on public.claude_jobs for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.claude_jobs from anon;
grant select, insert, update, delete on table public.claude_jobs
  to authenticated;

-- The agent hears new jobs at once through Realtime (it also polls).
alter publication supabase_realtime add table public.claude_jobs;

-- The agent says it is alive every minute, so Pointage can tell whether the
-- computer will pick a job up. One agent per user.
create table public.claude_agents (
  user_id uuid primary key default auth.uid()
    references auth.users (id) on delete cascade,
  host text not null check (char_length(host) between 1 and 255),
  last_seen_at timestamptz not null default now()
);

alter table public.claude_agents enable row level security;

create policy "Users read their Claude agent"
  on public.claude_agents for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users create their Claude agent"
  on public.claude_agents for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users update their Claude agent"
  on public.claude_agents for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.claude_agents from anon;
grant select, insert, update on table public.claude_agents to authenticated;
