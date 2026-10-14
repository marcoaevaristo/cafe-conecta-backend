const express = require('express');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

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

    res.json({
      lotes_ativos: cafesData.filter(c => c.status === 'ativo').length,
      lotes_total: cafesData.length,
      propostas_pendentes: propostasData.filter(p => p.status === 'pendente').length,
      propostas_aceitas: propostasData.filter(p => p.status === 'aceita').length,
      mensagens_nao_lidas: mensagens.count || 0,
      media_avaliacao: mediaAvaliacao,
      total_avaliacoes: avNotas.length,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar dashboard' });
  }
});

module.exports = router;
