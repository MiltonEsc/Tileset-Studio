-- Track the real last-save time for level safety/status UI.
alter table public.levels
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_level_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists levels_touch_updated_at on public.levels;
create trigger levels_touch_updated_at
before update on public.levels
for each row execute function public.touch_level_updated_at();
