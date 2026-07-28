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
