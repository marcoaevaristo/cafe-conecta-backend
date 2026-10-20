-- Status "vendido" nos lotes, com data e preço final da venda (opcional)
alter table cafes drop constraint if exists cafes_status_check;
alter table cafes add constraint cafes_status_check
  check (status in ('ativo', 'pausado', 'encerrado', 'vendido'));
alter table cafes add column if not exists vendido_em timestamptz;
alter table cafes add column if not exists preco_venda numeric(12,2);
