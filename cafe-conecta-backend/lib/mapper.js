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
// Status do app -> status do banco
const STATUS_PROPOSTA_DB = { aguardando: 'pendente' };

// Quem fez a proposta: autor_id (contrapropostas) ou, por padrão, o comprador.
function autorDaProposta(p) {
  return p.autor_id || p.comprador_id;
}
// Quem recebe e decide (aceitar/recusar/contrapropor): a outra parte.
function destinatarioDaProposta(p) {
  return autorDaProposta(p) === p.comprador_id ? p.produtor_id : p.comprador_id;
}

function propostaParaApp(p) {
  if (!p) return p;
  const autorEhComprador = autorDaProposta(p) === p.comprador_id;
  const autor = autorEhComprador ? p.comprador : p.produtor;
  return {
    ...p,
    de_usuario_id: autorDaProposta(p),
    para_usuario_id: destinatarioDaProposta(p),
    preco_ofertado: p.valor_proposto != null ? Number(p.valor_proposto) : null,
    observacoes: p.mensagem ?? null,
    status_app: STATUS_PROPOSTA_APP[p.status] ?? p.status,
    remetente_nome: autor?.nome ?? null,
    remetente_empresa: autor?.empresa ?? null,
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
  autorDaProposta,
  destinatarioDaProposta,
  statusPropostaParaDb,
  avaliacaoParaApp,
};
