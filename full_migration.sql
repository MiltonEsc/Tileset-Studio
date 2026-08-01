-- Tileset Studio storage: assets (props), tilesets, levels.
-- Shared collection, no login: anon role gets full access, gated only by RLS
-- policies that allow everything. Treat the data as public.

create table if not exists public.assets (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  cols       int  not null,
  rows       int  not null,
  tile_size  int  not null,
  pixels     text not null,                 -- base64 RGBA
  created_at timestamptz default now()
);

create table if not exists public.tilesets (
  id         uuid primary key default gen_random_uuid(),
  name       text  not null,
  tile_size  int   not null,
  definition jsonb not null,                -- { mode, biomeId?, colors?, basePixels? }
  created_at timestamptz default now()
);

create table if not exists public.levels (
  id            uuid primary key default gen_random_uuid(),
  name          text  not null,
  width         int   not null,
  height        int   not null,
  tile_size     int   not null,
  grid          text  not null,             -- base64 of Uint8Array(width*height)
  placed_props  jsonb not null default '[]'::jsonb,
  tileset       jsonb,                       -- embedded tileset definition
  seamless_edges boolean default false,
  created_at    timestamptz default now()
);

alter table public.assets   enable row level security;
alter table public.tilesets enable row level security;
alter table public.levels   enable row level security;

-- Open policies for the shared, no-login model
drop policy if exists "public_all_assets"   on public.assets;
drop policy if exists "public_all_tilesets" on public.tilesets;
drop policy if exists "public_all_levels"   on public.levels;

create policy "public_all_assets"   on public.assets   for all to anon, authenticated using (true) with check (true);
create policy "public_all_tilesets" on public.tilesets for all to anon, authenticated using (true) with check (true);
create policy "public_all_levels"   on public.levels   for all to anon, authenticated using (true) with check (true);

grant all on public.assets, public.tilesets, public.levels to anon, authenticated;
-- Levels moved to a multi-layer format: per-layer grids/manual tiles ride in a
-- `layers` jsonb array ({ id, name, kind, visible, tileset, gridB64,
-- manualTilesB64 }). The old single-grid columns stay readable for legacy rows
-- but are no longer written, so `grid` must not be NOT NULL.
alter table public.levels add column if not exists layers jsonb;
alter table public.levels add column if not exists manual_tiles text;  -- legacy single-layer manual tiles (base64)
alter table public.levels alter column grid drop not null;
-- SaaS user accounts: rows now belong to a Supabase Auth user.
-- Every table gets a user_id owned by auth.users; the open shared-collection
-- policies are replaced by per-user policies (only the owner can see/write
-- their rows) and the anon role loses access entirely — the app now requires
-- signing in (Supabase Auth, email + password) before touching the DB.
--
-- Legacy rows created before this migration have user_id NULL and become
-- invisible to everyone. To hand them to an account, run once:
--   update public.assets   set user_id = '<auth user uuid>' where user_id is null;
--   update public.tilesets set user_id = '<auth user uuid>' where user_id is null;
--   update public.levels   set user_id = '<auth user uuid>' where user_id is null;

alter table public.assets   add column if not exists user_id uuid default auth.uid() references auth.users(id) on delete cascade;
alter table public.tilesets add column if not exists user_id uuid default auth.uid() references auth.users(id) on delete cascade;
alter table public.levels   add column if not exists user_id uuid default auth.uid() references auth.users(id) on delete cascade;

create index if not exists assets_user_id_idx   on public.assets(user_id);
create index if not exists tilesets_user_id_idx on public.tilesets(user_id);
create index if not exists levels_user_id_idx   on public.levels(user_id);

-- Replace the open policies with owner-only ones.
drop policy if exists "public_all_assets"   on public.assets;
drop policy if exists "public_all_tilesets" on public.tilesets;
drop policy if exists "public_all_levels"   on public.levels;

create policy "own_assets" on public.assets
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own_tilesets" on public.tilesets
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own_levels" on public.levels
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The anon role can no longer touch the tables at all.
revoke all on public.assets, public.tilesets, public.levels from anon;

-- Last-save metadata used by the level safety UI.
alter table public.levels add column if not exists updated_at timestamptz not null default now();
create or replace function public.touch_level_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists levels_touch_updated_at on public.levels;
create trigger levels_touch_updated_at before update on public.levels
for each row execute function public.touch_level_updated_at();
