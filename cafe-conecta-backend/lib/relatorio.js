// lib/relatorio.js — números de negócio de um ou mais usuários num período.
// Usado no relatório pessoal (/relatorios) e no painel da conta empresarial (/empresas).
const supabase = require('./supabase');

const FECHADAS = ['aceita', 'concluida'];

/** Período padrão: últimos 12 meses. Datas no formato AAAA-MM-DD. */
function lerPeriodo(q = {}, hoje = new Date()) {
  const valida = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : null);
  const ate = valida(q.ate) || hoje.toISOString().slice(0, 10);
  const umAno = new Date(`${ate}T00:00:00Z`); umAno.setUTCFullYear(umAno.getUTCFullYear() - 1);
  const de = valida(q.de) || umAno.toISOString().slice(0, 10);
  return de <= ate ? { de, ate } : { de: ate, ate: de };
}
const noPeriodo = (data, { de, ate }) => Boolean(data) && data.slice(0, 10) >= de && data.slice(0, 10) <= ate;

/**
 * Junta lotes, vendas e compras. Vendas = propostas fechadas como produtor + lotes marcados
 * "vendido" com preço final que não vieram de proposta (o mesmo critério do Índice).
 */
function montarRelatorio({ lotes, propostas, ids, periodo }) {
  const meus = new Set(ids);
  const fechadas = propostas.filter((p) => FECHADAS.includes(p.status) && noPeriodo(p.atualizado_em || p.criado_em, periodo));
  const lotesComProposta = new Set(fechadas.map((p) => p.cafe_id));
  const loteDe = new Map(lotes.map((l) => [l.id, l]));
  const linha = (origem, p, l, qtd, preco, data, usuario) => ({
    origem, data: (data || '').slice(0, 10), usuario_id: usuario,
    lote: [l?.tipo, l?.classificacao, l?.fazenda || l?.cidade].filter(Boolean).join(' · ') || '—',
    sacas: Number(qtd) || 0, preco_saca: preco == null ? null : Number(preco),
    total: preco == null ? null : Number(preco) * (Number(qtd) || 0),
  });

  const vendas = [
    ...fechadas.filter((p) => meus.has(p.produtor_id)).map((p) =>
      linha('proposta', p, p.cafe || loteDe.get(p.cafe_id), p.quantidade_sacas, p.valor_proposto, p.atualizado_em || p.criado_em, p.produtor_id)),
    ...lotes.filter((l) => l.status === 'vendido' && l.preco_venda != null && !lotesComProposta.has(l.id) && noPeriodo(l.vendido_em, periodo))
      .map((l) => linha('lote vendido', null, l, l.quantidade_sacas, l.preco_venda, l.vendido_em, l.usuario_id)),
  ].sort((a, b) => a.data.localeCompare(b.data));
  const compras = fechadas.filter((p) => meus.has(p.comprador_id)).map((p) =>
    linha('proposta', p, p.cafe || loteDe.get(p.cafe_id), p.quantidade_sacas, p.valor_proposto, p.atualizado_em || p.criado_em, p.comprador_id))
    .sort((a, b) => a.data.localeCompare(b.data));

  const soma = (lista) => ({
    negocios: lista.length,
    sacas: lista.reduce((s, x) => s + x.sacas, 0),
    valor: lista.reduce((s, x) => s + (x.total || 0), 0),
  });
  const ativos = lotes.filter((l) => l.status === 'ativo');
  const propostasPeriodo = propostas.filter((p) => noPeriodo(p.criado_em, periodo));
  return {
    periodo,
    resumo: {
      lotes_ativos: ativos.length,
      sacas_ofertadas: ativos.reduce((s, l) => s + (Number(l.quantidade_sacas) || 0), 0),
      propostas_no_periodo: propostasPeriodo.length,
      vendas: soma(vendas),
      compras: soma(compras),
      preco_medio_venda: soma(vendas).sacas ? soma(vendas).valor / soma(vendas).sacas : null,
    },
    vendas,
    compras,
    lotes: lotes.map((l) => ({
      id: l.id, usuario_id: l.usuario_id, tipo: l.tipo, classificacao: l.classificacao, fazenda: l.fazenda,
      cidade: l.cidade, sacas: l.quantidade_sacas, preco_saca: l.preco_saca, status: l.status,
      criado_em: (l.criado_em || '').slice(0, 10),
    })),
  };
}

async function relatorioDe(ids, periodo) {
  const lista = ids.join(',');
  const [lotes, propostas] = await Promise.all([
    supabase.from('cafes').select('*').in('usuario_id', ids).range(0, 4999),
    supabase.from('propostas').select('*, cafe:cafes(tipo, classificacao, fazenda, cidade)')
      .or(`produtor_id.in.(${lista}),comprador_id.in.(${lista})`).range(0, 4999),
  ]);
  if (lotes.error) throw lotes.error;
  if (propostas.error) throw propostas.error;
  return montarRelatorio({ lotes: lotes.data || [], propostas: propostas.data || [], ids, periodo });
}

module.exports = { lerPeriodo, montarRelatorio, relatorioDe };
