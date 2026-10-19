-- Café Conecta — permite contas do tipo corretor
-- Rodar uma vez no Supabase: SQL Editor → New query → colar → Run.
alter table usuarios drop constraint if exists usuarios_tipo_check;
alter table usuarios
  add constraint usuarios_tipo_check
  check (tipo in ('produtor', 'comprador', 'corretor', 'admin'));
