-- MCP helper: single secret token used by /api/mcp
--
-- Run this in Supabase Dashboard -> SQL Editor.
-- Signed-in editors can read and rotate the token from the app's MCP dialog.
-- The MCP server uses the service-role key, so it bypasses RLS.

create extension if not exists pgcrypto;

create table if not exists public.mcp_config (
  id smallint primary key default 1 check (id = 1),
  token uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now()
);

insert into public.mcp_config (id)
values (1)
on conflict (id) do nothing;

alter table public.mcp_config enable row level security;

revoke all on public.mcp_config from anon, authenticated;
grant select, update on public.mcp_config to authenticated;

drop policy if exists "Authenticated read MCP config" on public.mcp_config;
create policy "Authenticated read MCP config"
  on public.mcp_config
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated update MCP config" on public.mcp_config;
create policy "Authenticated update MCP config"
  on public.mcp_config
  for update
  to authenticated
  using (true)
  with check (true);
