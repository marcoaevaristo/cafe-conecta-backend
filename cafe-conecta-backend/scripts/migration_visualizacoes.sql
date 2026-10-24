-- Visualizações reais dos lotes: uma por visitante, por lote, por dia (horário de Brasília)
create table if not exists visualizacoes_lote (
  id bigserial primary key,
  cafe_id uuid not null references cafes(id) on delete cascade,
  visitante text not null,
  dia date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  criado_em timestamptz not null default now(),
  unique (cafe_id, visitante, dia)
);
create index if not exists visualizacoes_lote_cafe_idx on visualizacoes_lote (cafe_id);
-- só o backend (chave de serviço) acessa
alter table visualizacoes_lote enable row level security;
