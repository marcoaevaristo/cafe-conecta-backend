-- Limite de tentativas de login, cadastro e recuperação de senha
create table if not exists limites_acesso (
  id bigserial primary key,
  chave text not null,
  criado_em timestamptz not null default now()
);
create index if not exists limites_acesso_chave_idx on limites_acesso (chave, criado_em);
-- só o backend (chave de serviço) acessa
alter table limites_acesso enable row level security;
