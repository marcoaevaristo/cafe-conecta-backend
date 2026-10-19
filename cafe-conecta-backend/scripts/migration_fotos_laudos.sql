-- Café Conecta — fotos nos anúncios e laudos de IA
-- Rodar uma vez no Supabase: SQL Editor → New query → colar → Run.
-- É seguro rodar de novo.

-- Fotos de cada lote (URLs públicas do Storage)
alter table cafes add column if not exists fotos text[] not null default '{}';

-- Bucket público onde as fotos ficam guardadas (o backend envia com a service key)
insert into storage.buckets (id, name, public)
values ('cafe-fotos', 'cafe-fotos', true)
on conflict (id) do nothing;

-- Laudos gerados pela classificação por IA (também usados para contar o limite mensal)
create table if not exists laudos (
  id uuid primary key default uuid_generate_v4(),
  usuario_id uuid references usuarios(id) on delete cascade,
  cafe_id uuid references cafes(id) on delete set null,
  resultado jsonb not null,
  criado_em timestamptz default now()
);
create index if not exists idx_laudos_usuario_data on laudos(usuario_id, criado_em);

notify pgrst, 'reload schema';
