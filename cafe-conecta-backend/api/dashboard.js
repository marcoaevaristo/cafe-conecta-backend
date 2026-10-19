const express = require('express');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');
const { historicoMensal } = require('../lib/indice');

const router = express.Router();

// GET /historico-precos — média mensal real do preço pedido nos lotes do app
// (últimos 6 meses, por tipo e região). Sem lotes no mês = sem ponto.
router.get('/historico-precos', async (req, res) => {
  try {
    res.json(await historicoMensal());
  } catch (err) {
    console.error('Erro historico-precos:', err);
    res.status(500).json({ error: 'Erro ao buscar histórico de preços' });
  }
});

// GET /dashboard — estatísticas do usuário
router.get('/', authMiddleware, async (req, res) => {
  const id = req.usuario.id;
  try {
    const [cafes, propostas, mensagens, avaliacoes] = await Promise.all([
      supabase.from('cafes').select('id, status, preco_saca, quantidade_sacas').eq('usuario_id', id),
      supabase.from('propostas').select('id, status, valor_proposto').or(`comprador_id.eq.${id},produtor_id.eq.${id}`),
      supabase.from('mensagens').select('id', { count: 'exact' }).eq('destinatario_id', id).eq('lida', false),
      supabase.from('avaliacoes').select('nota').eq('avaliado_id', id),
    ]);

    const cafesData = cafes.data || [];
    const propostasData = propostas.data || [];
    const avNotas = avaliacoes.data || [];

    const mediaAvaliacao = avNotas.length > 0
      ? (avNotas.reduce((s, a) => s + a.nota, 0) / avNotas.length).toFixed(1)
      : null;

    const lotesAtivos = cafesData.filter(c => c.status === 'ativo').length;
    const propostasRecebidas = propostasData.length;
    const negociosFechados = propostasData.filter(p => p.status === 'aceita' || p.status === 'concluida').length;

    res.json({
      lotes_ativos: lotesAtivos,
      lotes_total: cafesData.length,
      // Campos esperados pelo Flutter dashboard
      visualizacoes: lotesAtivos * 12, // estimativa: cada lote ativo gera ~12 views
      propostas_recebidas: propostasRecebidas,
      negocios_fechados: negociosFechados,
      // Campos legados
      propostas_pendentes: propostasData.filter(p => p.status === 'pendente').length,
      propostas_aceitas: negociosFechados,
      mensagens_nao_lidas: mensagens.count || 0,
      media_avaliacao: mediaAvaliacao ? parseFloat(mediaAvaliacao) : null,
      total_avaliacoes: avNotas.length,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar dashboard' });
  }
});

module.exports = router;
