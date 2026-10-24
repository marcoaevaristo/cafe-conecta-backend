-- Café Conecta — novas funções (pode rodar mais de uma vez sem problema)
-- Ficha do lote, custo de produção, pedidos de compra, amostras, previsão de safra,
-- interesse em CPR, conta empresarial, notificações push e login com Google.

-- 1) Ficha completa do lote (cafés especiais)
alter table cafes add column if not exists variedade text;
alter table cafes add column if not exists processamento text;
alter table cafes add column if not exists altitude integer;
alter table cafes add column if not exists pontuacao_sca numeric(4,1);
alter table cafes add column if not exists certificacoes text[] not null default '{}';

-- 2) Custo de produção por saca (privado, só o próprio usuário vê) e login com Google
alter table usuarios add column if not exists custo_saca numeric(10,2);
alter table usuarios add column if not exists google_id text unique;

-- 3) Pedidos de compra (o comprador anuncia o que procura) e ofertas dos vendedores
create table if not exists pedidos_compra (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios(id) on delete cascade,
  tipo text not null,
  classificacao text,
  bebida text,
  regiao text,
  quantidade_sacas integer not null check (quantidade_sacas > 0),
  preco_maximo numeric(10,2),
  prazo date,
  observacoes text,
  status text not null default 'aberto' check (status in ('aberto', 'atendido', 'encerrado')),
  criado_em timestamptz not null default now()
);
create index if not exists pedidos_compra_status_idx on pedidos_compra (status, criado_em desc);

create table if not exists ofertas_pedido (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos_compra(id) on delete cascade,
  usuario_id uuid not null references usuarios(id) on delete cascade,
  cafe_id uuid references cafes(id) on delete set null,
  preco_saca numeric(10,2) not null check (preco_saca > 0),
  quantidade_sacas integer not null check (quantidade_sacas > 0),
  mensagem text,
  status text not null default 'enviada' check (status in ('enviada', 'aceita', 'recusada')),
  criado_em timestamptz not null default now()
);
create index if not exists ofertas_pedido_pedido_idx on ofertas_pedido (pedido_id);

-- 4) Amostras: pedido, envio, recebimento e resultado da prova
create table if not exists amostras (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references cafes(id) on delete cascade,
  solicitante_id uuid not null references usuarios(id) on delete cascade,
  vendedor_id uuid not null references usuarios(id) on delete cascade,
  endereco text not null,
  observacoes text,
  status text not null default 'solicitada'
    check (status in ('solicitada', 'enviada', 'recebida', 'avaliada', 'recusada', 'cancelada')),
  codigo_rastreio text,
  nota numeric(4,1),
  bebida_resultado text,
  defeitos integer,
  comentario text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists amostras_cafe_idx on amostras (cafe_id);

-- 5) Previsão de safra
create table if not exists previsoes_safra (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios(id) on delete cascade,
  tipo text not null,
  regiao text,
  safra text not null,
  sacas_previstas integer not null check (sacas_previstas > 0),
  mes_colheita integer check (mes_colheita between 1 and 12),
  observacoes text,
  criado_em timestamptz not null default now()
);

-- 6) Interesse em crédito / CPR (oportunidades para parceiros financeiros)
create table if not exists interesses_credito (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios(id) on delete cascade,
  cafe_id uuid references cafes(id) on delete set null,
  modalidade text not null default 'CPR',
  valor_desejado numeric(12,2),
  observacoes text,
  autoriza_contato boolean not null default false,
  criado_em timestamptz not null default now()
);

-- 7) Conta empresarial (cooperativas, tradings, bancos)
create table if not exists empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo text not null default 'cooperativa' check (tipo in ('cooperativa', 'trading', 'banco', 'torrefacao', 'outro')),
  cnpj text,
  dono_id uuid not null references usuarios(id) on delete cascade,
  criado_em timestamptz not null default now()
);
create table if not exists empresa_membros (
  empresa_id uuid not null references empresas(id) on delete cascade,
  usuario_id uuid not null references usuarios(id) on delete cascade,
  papel text not null default 'membro' check (papel in ('admin', 'membro')),
  criado_em timestamptz not null default now(),
  primary key (empresa_id, usuario_id)
);

-- 8) Notificações push (navegador/celular)
create table if not exists push_inscricoes (
  id bigserial primary key,
  usuario_id uuid not null references usuarios(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  criado_em timestamptz not null default now()
);

-- Só o backend (chave de serviço) acessa as tabelas novas
alter table pedidos_compra enable row level security;
alter table ofertas_pedido enable row level security;
alter table amostras enable row level security;
alter table previsoes_safra enable row level security;
alter table interesses_credito enable row level security;
alter table empresas enable row level security;
alter table empresa_membros enable row level security;
alter table push_inscricoes enable row level security;
