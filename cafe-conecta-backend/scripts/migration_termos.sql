-- Registro do aceite dos Termos de uso e da Política de privacidade (LGPD)
alter table usuarios add column if not exists termos_aceitos_em timestamptz;
alter table usuarios add column if not exists termos_versao text;
