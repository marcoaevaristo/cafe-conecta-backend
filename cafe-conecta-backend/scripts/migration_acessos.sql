-- Café Conecta — registro de acessos (Painel do desenvolvedor)
-- Rodar uma vez no Supabase: SQL Editor → New query → colar → Run.
create table if not exists acessos (
  id bigserial primary key,
  usuario_id uuid references usuarios(id) on delete set null,
  dia date not null,
  plataforma text,
  criado_em timestamptz default now()
);
-- 1 linha por usuário por dia; visitas sem login (usuario_id vazio) não entram nessa regra
create unique index if not exists acessos_usuario_dia on acessos(usuario_id, dia);
create index if not exists acessos_dia on acessos(dia);
notify pgrst, 'reload schema';
