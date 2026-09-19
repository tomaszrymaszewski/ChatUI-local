-- AI Studio cloud sync schema.
--
-- Run once in the Supabase SQL editor (Dashboard → SQL → New query).
--
-- Design: the app stays local-first — every piece of user data lives in
-- localStorage under a `chatui:*` key and is mirrored to one row here per
-- (user, key). Sync is per-key last-write-wins with tombstones (`deleted`),
-- so devices merge instead of clobbering each other. Sessions and message
-- stores additionally union-merge by record id client-side.

create table if not exists public.user_data (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  -- The localStorage string for this key, stored as plaintext. (An earlier
  -- end-to-end encrypted variant stored AES-256-GCM JSON envelopes; the sync
  -- client ignores and overwrites any rows still in that shape.)
  value text not null default '',
  updated_at timestamptz not null default now(),
  -- Tombstone: true when the key was deleted on a device. Pulls delete the
  -- local key; pushes of a locally-deleted key set this flag.
  deleted boolean not null default false,
  primary key (user_id, key)
);

alter table public.user_data enable row level security;

-- Realtime: stream row changes to signed-in devices (Supabase Realtime
-- postgres_changes — the client subscribes filtered to its own user_id, which
-- RLS polices). Idempotent: adding an already-member table errors, so catch
-- and continue.
do $$
begin
  alter publication supabase_realtime publication add table public.user_data;
exception
  when duplicate_object then null;
end $$;

drop policy if exists "users manage own rows" on public.user_data;
create policy "users manage own rows"
  on public.user_data
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
