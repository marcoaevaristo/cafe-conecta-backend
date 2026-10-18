const express = require('express');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /historico-precos — histórico mock de preços para o gráfico do dashboard
// Retorna dados dos últimos 6 meses para regiões cafeeiras brasileiras
router.get('/historico-precos', async (req, res) => {
  try {
    const regioes = [
      { regiao: 'Sul de Minas', base: 1420 },
      { regiao: 'Cerrado', base: 1380 },
      { regiao: 'Mogiana', base: 1395 },
    ];
    const tipos = [
      { tipo: 'arabica', label: 'Arábica' },
    ];
    const resultado = [];
    const hoje = new Date();

    for (const tipo of tipos) {
      for (const r of regioes) {
        for (let m = 5; m >= 0; m--) {
          const d = new Date(hoje.getFullYear(), hoje.getMonth() - m, 1);
          const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          // Variação determinística baseada no mês para consistência
          const seed = d.getMonth() + d.getFullYear() * 12;
          const variacao = ((seed % 9) - 4) * 15; // -60 a +60 por mês
          const tendencia = (5 - m) * 18; // tendência de alta nos últimos meses
          const preco = Math.round((r.base + variacao + tendencia) * 100) / 100;
          resultado.push({
            id: null,
            tipo_cafe: tipo.label,
            regiao: r.regiao,
            preco_medio: preco,
            mes,
          });
        }
      }
    }

    res.json(resultado);
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
