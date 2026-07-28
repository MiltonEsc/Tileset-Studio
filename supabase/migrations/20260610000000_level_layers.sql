-- Levels moved to a multi-layer format: per-layer grids/manual tiles ride in a
-- `layers` jsonb array ({ id, name, kind, visible, tileset, gridB64,
-- manualTilesB64 }). The old single-grid columns stay readable for legacy rows
-- but are no longer written, so `grid` must not be NOT NULL.
alter table public.levels add column if not exists layers jsonb;
alter table public.levels add column if not exists manual_tiles text;  -- legacy single-layer manual tiles (base64)
alter table public.levels alter column grid drop not null;
