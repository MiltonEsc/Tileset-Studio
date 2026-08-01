-- Reusable multi-layer rectangular stamps/prefabs.
create table if not exists public.stamps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  tile_size integer not null check (tile_size > 0),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stamps_user_id_idx on public.stamps(user_id);
alter table public.stamps enable row level security;

drop policy if exists "own_stamps" on public.stamps;
create policy "own_stamps" on public.stamps
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.stamps from anon;
grant select, insert, update, delete on public.stamps to authenticated;

create or replace function public.touch_stamp_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists stamps_touch_updated_at on public.stamps;
create trigger stamps_touch_updated_at
before update on public.stamps
for each row execute function public.touch_stamp_updated_at();
