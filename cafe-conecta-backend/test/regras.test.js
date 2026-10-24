require('./_mocks');
const test = require('node:test');
const assert = require('node:assert');
const { alertaCombina, loteAtendePedido } = require('../lib/notificacoes');
const { lerFicha, lerCondicoes } = require('../lib/validacao');
const { agregarPrevisoes } = require('../lib/safra');
const { lerPeriodo, montarRelatorio } = require('../lib/relatorio');
const { codigoConvite } = require('../lib/empresa');

const lote = { tipo: 'Arábica', classificacao: 'Tipo 6', regiao: 'Sul de Minas', preco_saca: 1500, score: 82 };

test('alerta de preço: combina por tipo, região, preço e pontuação', () => {
  assert.ok(alertaCombina({ tipo_cafe: 'arábica', preco_maximo: 1600 }, lote));
  assert.ok(!alertaCombina({ preco_maximo: 1400 }, lote));
  assert.ok(!alertaCombina({ regiao: 'Cerrado Mineiro' }, lote));
  assert.ok(!alertaCombina({ score_minimo: 85 }, lote));
  assert.ok(!alertaCombina({ preco_maximo: 2000 }, { ...lote, preco_saca: null }));
});

test('pedido de compra: aceita até 5% acima do preço máximo', () => {
  assert.ok(loteAtendePedido(lote, { tipo: 'Arábica', preco_maximo: 1450 }));
  assert.ok(!loteAtendePedido(lote, { tipo: 'Arábica', preco_maximo: 1400 }));
  assert.ok(!loteAtendePedido(lote, { tipo: 'Conilon' }));
  assert.ok(loteAtendePedido({ ...lote, preco_saca: null }, { tipo: 'Arábica', preco_maximo: 1000 }));
});

test('ficha especial: limita valores e ignora o que não veio', () => {
  assert.deepStrictEqual(lerFicha({}), {});
  const f = lerFicha({ altitude: '1200', pontuacao_sca: '86.27', certificacoes: ['UTZ', 'UTZ', ' Orgânico '] });
  assert.deepStrictEqual(f, { altitude: 1200, pontuacao_sca: 86.3, certificacoes: ['UTZ', 'Orgânico'] });
  assert.strictEqual(lerFicha({ altitude: 9000 }).altitude, null);
  assert.strictEqual(lerFicha({ pontuacao_sca: 40 }).pontuacao_sca, null);
});

test('condições da proposta saem do texto', () => {
  const c = lerCondicoes('Pagamento: 30 dias\nPrazo de entrega: novembro\nLocal de entrega: armazém\nCafé bem seco');
  assert.deepStrictEqual(c, { pagamento: '30 dias', prazo_entrega: 'novembro', local_entrega: 'armazém', observacoes: 'Café bem seco' });
  assert.strictEqual(lerCondicoes(null).observacoes, null);
});

test('previsão de safra: soma por grupo e esconde grupo com um só produtor', () => {
  const r = agregarPrevisoes([
    { usuario_id: 'a', tipo: 'Arábica', regiao: 'Sul de Minas', safra: '2027/2028', sacas_previstas: 300, mes_colheita: 6 },
    { usuario_id: 'b', tipo: 'Arábica', regiao: 'Sul de Minas', safra: '2027/2028', sacas_previstas: 200, mes_colheita: 6 },
    { usuario_id: 'c', tipo: 'Conilon', regiao: 'Rondônia', safra: '2027/2028', sacas_previstas: 999, mes_colheita: 5 },
  ]);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].sacas, 500);
  assert.strictEqual(r[0].produtores, 2);
});

test('relatório: período padrão de 12 meses e datas invertidas', () => {
  assert.deepStrictEqual(lerPeriodo({}, new Date('2026-10-24T12:00:00Z')), { de: '2025-10-24', ate: '2026-10-24' });
  assert.deepStrictEqual(lerPeriodo({ de: '2026-05-01', ate: '2026-01-01' }), { de: '2026-01-01', ate: '2026-05-01' });
});

test('relatório: venda por proposta não é contada duas vezes com o lote vendido', () => {
  const periodo = { de: '2026-01-01', ate: '2026-12-31' };
  const lotes = [
    { id: 'L1', usuario_id: 'eu', tipo: 'Arábica', status: 'vendido', preco_venda: 1500, quantidade_sacas: 100, vendido_em: '2026-03-01' },
    { id: 'L2', usuario_id: 'eu', tipo: 'Arábica', status: 'vendido', preco_venda: 1400, quantidade_sacas: 50, vendido_em: '2026-04-01' },
    { id: 'L3', usuario_id: 'eu', tipo: 'Arábica', status: 'ativo', quantidade_sacas: 80 },
  ];
  const propostas = [
    { cafe_id: 'L1', produtor_id: 'eu', comprador_id: 'x', status: 'aceita', valor_proposto: 1520, quantidade_sacas: 100, criado_em: '2026-02-20', atualizado_em: '2026-02-28' },
    { cafe_id: 'Z', produtor_id: 'y', comprador_id: 'eu', status: 'aceita', valor_proposto: 1000, quantidade_sacas: 10, criado_em: '2026-05-01' },
    { cafe_id: 'L3', produtor_id: 'eu', comprador_id: 'x', status: 'recusada', valor_proposto: 900, quantidade_sacas: 80, criado_em: '2026-06-01' },
  ];
  const r = montarRelatorio({ lotes, propostas, ids: ['eu'], periodo });
  assert.strictEqual(r.resumo.vendas.negocios, 2);
  assert.strictEqual(r.resumo.vendas.sacas, 150);
  assert.strictEqual(r.resumo.vendas.valor, 1520 * 100 + 1400 * 50);
  assert.strictEqual(r.resumo.compras.valor, 10000);
  assert.strictEqual(r.resumo.lotes_ativos, 1);
  assert.strictEqual(r.resumo.propostas_no_periodo, 3);
});

test('código de convite: estável, formato fixo e diferente por empresa', () => {
  const a = codigoConvite('empresa-1', 's');
  assert.match(a, /^[0-9A-F]{5}-[0-9A-F]{5}$/);
  assert.strictEqual(a, codigoConvite('empresa-1', 's'));
  assert.notStrictEqual(a, codigoConvite('empresa-2', 's'));
});
