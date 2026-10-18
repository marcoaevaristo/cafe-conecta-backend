// lib/mapper.js
// Traduz entre os nomes de campos do banco e os nomes usados pelo app Flutter.
// O banco usa remetente/destinatario, comprador/produtor, avaliador/avaliado;
// o app usa de_usuario_id / para_usuario_id. As respostas levam os dois formatos.

function mensagemParaApp(m) {
  if (!m) return m;
  return {
    ...m,
    de_usuario_id: m.remetente_id,
    para_usuario_id: m.destinatario_id,
    texto: m.conteudo,
    remetente_nome: m.remetente?.nome ?? null,
    remetente_empresa: m.remetente?.empresa ?? null,
  };
}

// Status do banco -> status do app
const STATUS_PROPOSTA_APP = { pendente: 'aguardando' };
// Status do app -> status do banco (contraproposta encerra a original como recusada)
const STATUS_PROPOSTA_DB = { aguardando: 'pendente', contraproposta: 'recusada' };

function propostaParaApp(p) {
  if (!p) return p;
  return {
    ...p,
    de_usuario_id: p.comprador_id,
    para_usuario_id: p.produtor_id,
    preco_ofertado: p.valor_proposto != null ? Number(p.valor_proposto) : null,
    observacoes: p.mensagem ?? null,
    status_app: STATUS_PROPOSTA_APP[p.status] ?? p.status,
    remetente_nome: p.comprador?.nome ?? null,
    remetente_empresa: p.comprador?.empresa ?? null,
  };
}

function statusPropostaParaDb(status) {
  return STATUS_PROPOSTA_DB[status] ?? status;
}

function avaliacaoParaApp(a) {
  if (!a) return a;
  return {
    ...a,
    de_usuario_id: a.avaliador_id,
    para_usuario_id: a.avaliado_id,
    avaliador_nome: a.avaliador?.nome ?? null,
    avaliador_empresa: a.avaliador?.empresa ?? null,
  };
}

module.exports = {
  mensagemParaApp,
  propostaParaApp,
  statusPropostaParaDb,
  avaliacaoParaApp,
};
