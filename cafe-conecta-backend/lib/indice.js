// lib/indice.js — Índice Café Conecta: preços reais do próprio marketplace.
// Médias ponderadas pelo número de sacas. Preços de negócios fechados só aparecem
// agregados com pelo menos MIN_NEGOCIOS por grupo, para não expor uma negociação
// individual.
const supabase = require('./supabase');

const MIN_NEGOCIOS = 3;
const DIAS_NEGOCIOS = 90;
const MESES_HISTORICO = 6;

const arred = (n) => Math.round(n * 100) / 100;

// "2026-10-19T..." -> mês de Brasília "2026-10"
function mesBrasilia(iso) {
  const d = new Date(new Date(iso).getTime() - 3 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function agrupar(itens, chave) {
  const grupos = new Map();
  for (const it of itens) {
    const k = chave(it);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(it);
  }
  return grupos;
}

// itens: [{ preco, sacas }]
function resumo(itens) {
  const validos = itens.filter((i) => i.preco > 0);
  if (!validos.length) return null;
  const pesoTotal = validos.reduce((s, i) => s + (i.sacas > 0 ? i.sacas : 1), 0);
  const soma = validos.reduce((s, i) => s + i.preco * (i.sacas > 0 ? i.sacas : 1), 0);
  return {
    preco_medio: arred(soma / pesoTotal),
    preco_min: arred(Math.min(...validos.map((i) => i.preco))),
    preco_max: arred(Math.max(...validos.map((i) => i.preco))),
    quantidade: validos.length,
    sacas: validos.reduce((s, i) => s + (i.sacas > 0 ? i.sacas : 0), 0),
  };
}

const normalizarTipo = (t) => (t || 'Não informado').trim();
const normalizarRegiao = (r) => (r || 'Não informada').trim();

async function calcularIndice() {
  const desde = new Date(Date.now() - DIAS_NEGOCIOS * 86400000).toISOString();

  const [cafesRes, propostasRes] = await Promise.all([
    supabase.from('cafes').select('tipo, regiao, preco_saca, quantidade_sacas').eq('status', 'ativo'),
    supabase
      .from('propostas')
      .select('valor_proposto, quantidade_sacas, status, criado_em, cafe:cafes(tipo, regiao)')
      .in('status', ['aceita', 'concluida'])
      .gte('criado_em', desde),
  ]);
  if (cafesRes.error) throw cafesRes.error;
  if (propostasRes.error) throw propostasRes.error;
  const propostas = propostasRes.data;

  const lotes = (cafesRes.data || []).map((c) => ({
    tipo: normalizarTipo(c.tipo),
    regiao: normalizarRegiao(c.regiao),
    preco: Number(c.preco_saca) || 0,
    sacas: Number(c.quantidade_sacas) || 0,
  }));

  const ofertas = [];
  for (const [k, itens] of agrupar(lotes, (l) => `${l.tipo}|${l.regiao}`)) {
    const r = resumo(itens);
    if (!r) continue;
    const [tipo, regiao] = k.split('|');
    ofertas.push({ tipo, regiao, ...r });
  }
  ofertas.sort((a, b) => b.sacas - a.sacas || a.tipo.localeCompare(b.tipo));

  const porTipo = [];
  for (const [tipo, itens] of agrupar(lotes, (l) => l.tipo)) {
    const r = resumo(itens);
    if (r) porTipo.push({ tipo, ...r });
  }
  porTipo.sort((a, b) => b.sacas - a.sacas);

  const fechados = (propostas || []).map((p) => ({
    tipo: normalizarTipo(p.cafe?.tipo),
    regiao: normalizarRegiao(p.cafe?.regiao),
    preco: Number(p.valor_proposto) || 0,
    sacas: Number(p.quantidade_sacas) || 0,
  }));
  const negocios = [];
  for (const [tipo, itens] of agrupar(fechados, (n) => n.tipo)) {
    const r = resumo(itens);
    if (r && r.quantidade >= MIN_NEGOCIOS) negocios.push({ tipo, ...r });
  }

  return {
    atualizado_em: new Date().toISOString(),
    fonte: 'Café Conecta — lotes anunciados e negócios fechados no app',
    total_lotes: lotes.length,
    total_sacas: lotes.reduce((s, l) => s + l.sacas, 0),
    por_tipo: porTipo,
    ofertas,
    negocios,
    total_negocios: fechados.length,
    dias_negocios: DIAS_NEGOCIOS,
    min_negocios: MIN_NEGOCIOS,
  };
}

// Média mensal do preço pedido nos lotes anunciados (últimos 6 meses),
// no formato que o gráfico do app já usa: { tipo_cafe, regiao, preco_medio, mes }
async function historicoMensal() {
  const inicio = new Date();
  inicio.setUTCMonth(inicio.getUTCMonth() - (MESES_HISTORICO - 1), 1);
  inicio.setUTCHours(3, 0, 0, 0);
  const { data, error } = await supabase
    .from('cafes')
    .select('tipo, regiao, preco_saca, quantidade_sacas, criado_em')
    .gte('criado_em', inicio.toISOString());
  if (error) throw error;

  const itens = (data || []).map((c) => ({
    tipo: normalizarTipo(c.tipo),
    regiao: normalizarRegiao(c.regiao),
    mes: mesBrasilia(c.criado_em),
    preco: Number(c.preco_saca) || 0,
    sacas: Number(c.quantidade_sacas) || 0,
  }));
  const saida = [];
  for (const [k, grupo] of agrupar(itens, (i) => `${i.tipo}|${i.regiao}|${i.mes}`)) {
    const r = resumo(grupo);
    if (!r) continue;
    const [tipo, regiao, mes] = k.split('|');
    saida.push({ id: null, tipo_cafe: tipo, regiao, preco_medio: r.preco_medio, mes, lotes: r.quantidade });
  }
  saida.sort((a, b) => a.mes.localeCompare(b.mes));
  return saida;
}

module.exports = { calcularIndice, historicoMensal };
