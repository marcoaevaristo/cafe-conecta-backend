const express = require('express');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');
const { propostaParaApp, statusPropostaParaDb } = require('../lib/mapper');

const router = express.Router();

// GET /propostas — propostas do usuário logado
router.get('/', authMiddleware, async (req, res) => {
  const { tipo } = req.query; // 'recebidas' | 'enviadas'
  try {
    let query = supabase
      .from('propostas')
      .select(`*, cafe:cafes(id, tipo, classificacao, cidade, estado, preco_saca), comprador:usuarios!propostas_comprador_id_fkey(id, nome, cidade), produtor:usuarios!propostas_produtor_id_fkey(id, nome, cidade)`)
      .order('criado_em', { ascending: false });

    if (tipo === 'recebidas') query = query.eq('produtor_id', req.usuario.id);
    else if (tipo === 'enviadas') query = query.eq('comprador_id', req.usuario.id);
    else query = query.or(`comprador_id.eq.${req.usuario.id},produtor_id.eq.${req.usuario.id}`);

    const { data, error } = await query;
    if (error) throw error;
    res.json((data || []).map(propostaParaApp));
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar propostas' });
  }
});

// POST /propostas — aceita o formato do banco e o do app
router.post('/', authMiddleware, async (req, res) => {
  const b = req.body;
  const cafe_id = b.cafe_id;
  const valor_proposto = b.valor_proposto ?? b.preco_ofertado;
  const quantidade_sacas = b.quantidade_sacas;

  // O banco tem só um campo de texto livre: junta as condições enviadas pelo app nele
  const detalhes = [
    b.condicao_pagamento && `Pagamento: ${b.condicao_pagamento}`,
    b.prazo_entrega && `Prazo de entrega: ${b.prazo_entrega}`,
    b.local_entrega && `Local de entrega: ${b.local_entrega}`,
    b.observacoes || b.mensagem,
  ].filter(Boolean);
  const mensagem = detalhes.length ? detalhes.join('\n') : null;

  if (!cafe_id || !valor_proposto || !quantidade_sacas) {
    return res.status(400).json({ error: 'Lote, valor e quantidade de sacas são obrigatórios' });
  }

  try {
    const { data: cafe } = await supabase
      .from('cafes').select('usuario_id, status').eq('id', cafe_id).single();

    if (!cafe) return res.status(404).json({ error: 'Lote não encontrado' });
    if (cafe.status !== 'ativo') return res.status(400).json({ error: 'Lote não está ativo' });
    if (cafe.usuario_id === req.usuario.id) {
      return res.status(400).json({
        error: 'Contraproposta ainda não é suportada. Recuse a proposta e combine os novos termos por mensagem.',
      });
    }

    const { data, error } = await supabase
      .from('propostas')
      .insert({
        cafe_id, comprador_id: req.usuario.id,
        produtor_id: cafe.usuario_id,
        valor_proposto, quantidade_sacas, mensagem,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(propostaParaApp(data));
  } catch (err) {
    console.error('Erro ao criar proposta:', err);
    res.status(500).json({ error: 'Erro ao enviar proposta' });
  }
});

// PUT/PATCH /propostas/:id/status — aceitar/recusar/cancelar
async function atualizarStatus(req, res) {
  const status = statusPropostaParaDb(req.body.status);
  if (!['aceita', 'recusada', 'cancelada'].includes(status)) {
    return res.status(400).json({ error: 'Status inválido' });
  }

  try {
    const { data: proposta } = await supabase
      .from('propostas').select('*').eq('id', req.params.id).single();

    if (!proposta) return res.status(404).json({ error: 'Proposta não encontrada' });

    // Só o produtor pode aceitar/recusar; comprador pode cancelar
    if (status === 'cancelada' && proposta.comprador_id !== req.usuario.id) {
      return res.status(403).json({ error: 'Sem permissão' });
    }
    if (['aceita', 'recusada'].includes(status) && proposta.produtor_id !== req.usuario.id) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    const { data, error } = await supabase
      .from('propostas')
      .update({ status, atualizado_em: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(propostaParaApp(data));
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar proposta' });
  }
}

router.put('/:id/status', authMiddleware, atualizarStatus);
router.patch('/:id/status', authMiddleware, atualizarStatus);

module.exports = router;
