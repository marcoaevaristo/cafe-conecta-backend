-- Preferência de avisos por e-mail (proposta, mensagem, alerta de preço)
alter table usuarios add column if not exists notificar_email boolean not null default true;
