const express = require('express');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /cafes — listar lotes disponíveis
router.get('/', async (req, res) => {
  const { tipo, classificacao, score_minimo, regiao, usuario_id, status, busca } = req.query;

  try {
    let query = supabase
      .from('cafes')
      .select(`*, usuario:usuarios(id, nome, cidade, estado, verificado, avatar_url)`)
      .order('criado_em', { ascending: false });

    if (usuario_id) {
      query = query.eq('usuario_id', usuario_id);
      if (status) query = query.eq('status', status);
    } else {
      query = query.eq('status', 'ativo');
    }

    if (tipo) query = query.eq('tipo', tipo);
    if (classificacao) query = query.eq('classificacao', classificacao);
    if (regiao) query = query.ilike('regiao', `%${regiao}%`);
    if (score_minimo) query = query.gte('score', parseInt(score_minimo));
    if (busca) query = query.or(`tipo.ilike.%${busca}%,classificacao.ilike.%${busca}%,cidade.ilike.%${busca}%,fazenda.ilike.%${busca}%`);

    const { data, error } = await query;
    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('Erro ao listar cafés:', err);
    res.status(500).json({ error: 'Erro ao buscar lotes' });
  }
});

// GET /cafes/:id
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('cafes')
      .select(`*, usuario:usuarios(id, nome, cidade, estado, verificado, avatar_url, telefone)`)
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Lote não encontrado' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar lote' });
  }
});

// POST /cafes — criar lote (requer auth)
router.post('/', authMiddleware, async (req, res) => {
  const {
    tipo, classificacao,
    quantidade_sacas, quantidade, // aceita ambos
    preco_saca,
    cidade, estado, regiao, fazenda, score, descricao,
    bebida, peneira, safra, status,
  } = req.body;

  const qtd = quantidade_sacas ?? quantidade;

  if (!tipo || !classificacao || !qtd || !cidade) {
    return res.status(400).json({ error: 'Campos obrigatórios: tipo, classificação, quantidade e cidade' });
  }

  try {
    const { data, error } = await supabase
      .from('cafes')
      .insert({
        usuario_id: req.usuario.id,
        tipo, classificacao,
        quantidade_sacas: qtd,
        preco_saca: preco_saca ?? null,
        cidade,
        estado: estado ?? null,
        regiao: regiao ?? null,
        fazenda: fazenda ?? null,
        score: score ?? null,
        descricao: descricao ?? null,
        bebida: bebida ?? null,
        peneira: peneira ?? null,
        safra: safra ?? null,
        status: status ?? 'ativo',
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('Erro ao criar lote:', err);
    res.status(500).json({ error: 'Erro ao criar lote' });
  }
});

// PUT /cafes/:id
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { data: cafe } = await supabase
      .from('cafes').select('usuario_id').eq('id', req.params.id).single();

    if (!cafe || cafe.usuario_id !== req.usuario.id) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    const { tipo, classificacao, quantidade_sacas, preco_saca, cidade, estado, regiao, fazenda, score, descricao, status, bebida, peneira, safra, lat, lng } = req.body;

    const { data, error } = await supabase
      .from('cafes')
      .update({ tipo, classificacao, quantidade_sacas, preco_saca, cidade, estado, regiao, fazenda, score, descricao, status, bebida, peneira, safra, lat, lng })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar lote' });
  }
});

// DELETE /cafes/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { data: cafe } = await supabase
      .from('cafes').select('usuario_id').eq('id', req.params.id).single();

    if (!cafe || cafe.usuario_id !== req.usuario.id) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    await supabase.from('cafes').delete().eq('id', req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir lote' });
  }
});

module.exports = router;
