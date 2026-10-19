const express = require('express');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');
const { exigirLimite } = require('../lib/planos');

const router = express.Router();

// GET /alertas
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('alertas')
      .select('*')
      .eq('usuario_id', req.usuario.id)
      .order('criado_em', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar alertas' });
  }
});

// POST /alertas
router.post('/', authMiddleware, async (req, res) => {
  const { tipo_cafe, classificacao, regiao, preco_maximo, score_minimo } = req.body;
  try {
    if (!(await exigirLimite(req, res, 'alertas'))) return;
    const { data, error } = await supabase
      .from('alertas')
      .insert({ usuario_id: req.usuario.id, tipo_cafe, classificacao, regiao, preco_maximo, score_minimo })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar alerta' });
  }
});

// PUT /alertas/:id/toggle
router.put('/:id/toggle', authMiddleware, async (req, res) => {
  try {
    const { data: alerta } = await supabase
      .from('alertas').select('ativo, usuario_id').eq('id', req.params.id).single();

    if (!alerta || alerta.usuario_id !== req.usuario.id) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    const { data, error } = await supabase
      .from('alertas')
      .update({ ativo: !alerta.ativo })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar alerta' });
  }
});

// PATCH /alertas/:id — usado pelo app: { ativo: true|false }
router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    const { data: alerta } = await supabase
      .from('alertas').select('usuario_id').eq('id', req.params.id).single();

    if (!alerta || alerta.usuario_id !== req.usuario.id) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    const ativo = req.body.ativo === true || req.body.ativo === 1 || req.body.ativo === 'true';
    const { data, error } = await supabase
      .from('alertas')
      .update({ ativo })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar alerta' });
  }
});

// DELETE /alertas/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { data: alerta } = await supabase
      .from('alertas').select('usuario_id').eq('id', req.params.id).single();

    if (!alerta || alerta.usuario_id !== req.usuario.id) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    await supabase.from('alertas').delete().eq('id', req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir alerta' });
  }
});

module.exports = router;
