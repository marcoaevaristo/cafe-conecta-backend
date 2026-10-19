-- Café Conecta — suporte a contraproposta
-- Rodar uma vez no Supabase: SQL Editor → New query → colar → Run.
-- É seguro rodar de novo (usa IF NOT EXISTS / DROP IF EXISTS).

-- Quem fez a proposta. Vazio = o comprador (todas as propostas antigas).
alter table propostas
  add column if not exists autor_id uuid references usuarios(id) on delete set null;

-- Qual proposta esta contraproposta está respondendo.
alter table propostas
  add column if not exists contraproposta_de uuid references propostas(id) on delete set null;

-- Novo status: a proposta original fica como 'contraproposta' quando é respondida com outra.
alter table propostas drop constraint if exists propostas_status_check;
alter table propostas
  add constraint propostas_status_check
  check (status in ('pendente', 'aceita', 'recusada', 'cancelada', 'contraproposta'));

-- Faz a API do Supabase enxergar as colunas novas na hora.
notify pgrst, 'reload schema';
