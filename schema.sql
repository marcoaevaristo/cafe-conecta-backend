-- ============================================
-- CAFÉ CONECTA — Schema Supabase
-- Cole no SQL Editor do Supabase e execute
-- ============================================

-- Extensões
create extension if not exists "uuid-ossp";

-- ============================================
-- USUÁRIOS
-- ============================================
create table if not exists usuarios (
  id uuid primary key default uuid_generate_v4(),
  nome text not null,
  email text unique not null,
  senha_hash text not null,
  telefone text,
  cidade text,
  estado text,
  tipo text not null check (tipo in ('produtor', 'comprador', 'admin')),
  plano text not null default 'gratuito' check (plano in ('gratuito', 'basico', 'profissional', 'premium')),
  plano_valido_ate timestamptz,
  verificado boolean default false,
  avatar_url text,
  criado_em timestamptz default now(),
  atualizado_em timestamptz default now()
);

-- ============================================
-- CAFÉS (LOTES)
-- ============================================
create table if not exists cafes (
  id uuid primary key default uuid_generate_v4(),
  usuario_id uuid references usuarios(id) on delete cascade,
  tipo text not null,
  classificacao text not null,
  quantidade_sacas integer not null,
  preco_saca numeric(10,2) not null,
  cidade text not null,
  estado text not null,
  regiao text,
  fazenda text,
  score integer check (score >= 0 and score <= 100),
  descricao text,
  status text not null default 'ativo' check (status in ('ativo', 'pausado', 'encerrado')),
  destaque boolean default false,
  imagem_url text,
  criado_em timestamptz default now(),
  atualizado_em timestamptz default now()
);

-- ============================================
-- PROPOSTAS
-- ============================================
create table if not exists propostas (
  id uuid primary key default uuid_generate_v4(),
  cafe_id uuid references cafes(id) on delete cascade,
  comprador_id uuid references usuarios(id) on delete cascade,
  produtor_id uuid references usuarios(id) on delete cascade,
  valor_proposto numeric(10,2) not null,
  quantidade_sacas integer not null,
  mensagem text,
  status text not null default 'pendente' check (status in ('pendente', 'aceita', 'recusada', 'cancelada')),
  criado_em timestamptz default now(),
  atualizado_em timestamptz default now()
);

-- ============================================
-- FAVORITOS
-- ============================================
create table if not exists favoritos (
  id uuid primary key default uuid_generate_v4(),
  usuario_id uuid references usuarios(id) on delete cascade,
  cafe_id uuid references cafes(id) on delete cascade,
  criado_em timestamptz default now(),
  unique(usuario_id, cafe_id)
);

-- ============================================
-- ALERTAS DE PREÇO
-- ============================================
create table if not exists alertas (
  id uuid primary key default uuid_generate_v4(),
  usuario_id uuid references usuarios(id) on delete cascade,
  tipo_cafe text,
  classificacao text,
  regiao text,
  preco_maximo numeric(10,2),
  score_minimo integer,
  ativo boolean default true,
  criado_em timestamptz default now()
);

-- ============================================
-- MENSAGENS
-- ============================================
create table if not exists mensagens (
  id uuid primary key default uuid_generate_v4(),
  remetente_id uuid references usuarios(id) on delete cascade,
  destinatario_id uuid references usuarios(id) on delete cascade,
  proposta_id uuid references propostas(id) on delete set null,
  conteudo text not null,
  lida boolean default false,
  criado_em timestamptz default now()
);

-- ============================================
-- AVALIAÇÕES
-- ============================================
create table if not exists avaliacoes (
  id uuid primary key default uuid_generate_v4(),
  avaliador_id uuid references usuarios(id) on delete cascade,
  avaliado_id uuid references usuarios(id) on delete cascade,
  proposta_id uuid references propostas(id) on delete set null,
  nota integer not null check (nota >= 1 and nota <= 5),
  comentario text,
  criado_em timestamptz default now(),
  unique(avaliador_id, proposta_id)
);

-- ============================================
-- HISTÓRICO DE PREÇOS
-- ============================================
create table if not exists historico_precos (
  id uuid primary key default uuid_generate_v4(),
  tipo_cafe text not null,
  classificacao text,
  regiao text,
  preco_medio numeric(10,2) not null,
  data_referencia date not null default current_date,
  criado_em timestamptz default now()
);

-- ============================================
-- ASSINATURAS / PAGAMENTOS
-- ============================================
create table if not exists assinaturas (
  id uuid primary key default uuid_generate_v4(),
  usuario_id uuid references usuarios(id) on delete cascade,
  plano text not null check (plano in ('basico', 'profissional', 'premium')),
  status text not null default 'pendente' check (status in ('pendente', 'ativo', 'cancelado', 'expirado')),
  valor numeric(10,2) not null,
  pagbank_order_id text,
  pagbank_charge_id text,
  metodo_pagamento text,
  valido_ate timestamptz,
  criado_em timestamptz default now(),
  atualizado_em timestamptz default now()
);

-- ============================================
-- ÍNDICES
-- ============================================
create index if not exists idx_cafes_usuario on cafes(usuario_id);
create index if not exists idx_cafes_status on cafes(status);
create index if not exists idx_cafes_tipo on cafes(tipo);
create index if not exists idx_propostas_cafe on propostas(cafe_id);
create index if not exists idx_propostas_comprador on propostas(comprador_id);
create index if not exists idx_propostas_produtor on propostas(produtor_id);
create index if not exists idx_mensagens_destinatario on mensagens(destinatario_id);
create index if not exists idx_alertas_usuario on alertas(usuario_id);
create index if not exists idx_assinaturas_usuario on assinaturas(usuario_id);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================
alter table usuarios enable row level security;
alter table cafes enable row level security;
alter table propostas enable row level security;
alter table favoritos enable row level security;
alter table alertas enable row level security;
alter table mensagens enable row level security;
alter table avaliacoes enable row level security;
alter table assinaturas enable row level security;

-- Políticas abertas para o backend (service_role ignora RLS)
-- O Flutter usará o backend como intermediário, não acesso direto ao Supabase

-- ============================================
-- FUNÇÃO: atualizar updated_at automaticamente
-- ============================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$ language plpgsql;

create trigger usuarios_updated_at before update on usuarios
  for each row execute function update_updated_at();

create trigger cafes_updated_at before update on cafes
  for each row execute function update_updated_at();

create trigger propostas_updated_at before update on propostas
  for each row execute function update_updated_at();

create trigger assinaturas_updated_at before update on assinaturas
  for each row execute function update_updated_at();

-- ============================================
-- DADOS DE TESTE (opcional)
-- ============================================
-- Descomente para inserir dados iniciais de histórico de preços
/*
insert into historico_precos (tipo_cafe, classificacao, regiao, preco_medio) values
  ('Arábica', 'Especial', 'Sul de Minas', 1200.00),
  ('Arábica', 'Superior', 'Cerrado', 980.00),
  ('Conilon', 'Fine Robusta', 'Espírito Santo', 750.00),
  ('Robusta', 'Padrão', 'Rondônia', 620.00);
*/
