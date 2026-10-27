-- migration_seguranca_views.sql — corrige o alerta do Supabase "auth_users_exposed"
-- (uma view no schema public que lê auth.users e fica acessível pela API pública).
-- O app só acessa o banco pelo servidor (chave service_role), então tirar o acesso
-- de anon/authenticated a essas views não afeta nada no Café Conecta.

-- 1) Mostra quais views do public dependem de auth.users (só para conferência)
select distinct n.nspname as schema, c.relname as view
from pg_depend d
join pg_rewrite r on r.oid = d.objid
join pg_class c on c.oid = r.ev_class
join pg_namespace n on n.oid = c.relnamespace
where d.refobjid = 'auth.users'::regclass
  and n.nspname = 'public'
  and c.relkind in ('v', 'm');

-- 2) Fecha essas views para a API pública
do $$
declare v record;
begin
  for v in
    select distinct n.nspname as esquema, c.relname as nome, c.relkind as tipo
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid
    join pg_class c on c.oid = r.ev_class
    join pg_namespace n on n.oid = c.relnamespace
    where d.refobjid = 'auth.users'::regclass
      and n.nspname = 'public'
      and c.relkind in ('v', 'm')
  loop
    execute format('revoke all on %I.%I from anon, authenticated', v.esquema, v.nome);
    if v.tipo = 'v' then
      execute format('alter view %I.%I set (security_invoker = on)', v.esquema, v.nome);
    end if;
    raise notice 'Protegida: %.%', v.esquema, v.nome;
  end loop;
end $$;
