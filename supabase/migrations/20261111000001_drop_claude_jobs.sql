-- "Do with Claude" from a phone is gone (the Claude agent too): the button
-- only opens Claude Desktop on a computer. Drop its tables.
drop table if exists public.claude_jobs;
drop table if exists public.claude_agents;
