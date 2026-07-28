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
