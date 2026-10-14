const express = require('express');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /favoritos
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('favoritos')
      .select(`*, cafe:cafes(*, usuario:usuarios(id, nome, verificado))`)
      .eq('usuario_id', req.usuario.id)
      .order('criado_em', { ascending: false });

    if (error) throw error;
    res.json(data.map(f => f.cafe));
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar favoritos' });
  }
});

// POST /favoritos/:cafe_id — toggle
router.post('/:cafe_id', authMiddleware, async (req, res) => {
  const { cafe_id } = req.params;
  try {
    const { data: existe } = await supabase
      .from('favoritos')
      .select('id')
      .eq('usuario_id', req.usuario.id)
      .eq('cafe_id', cafe_id)
      .single();

    if (existe) {
      await supabase.from('favoritos').delete().eq('id', existe.id);
      return res.json({ favoritado: false });
    } else {
      await supabase.from('favoritos').insert({ usuario_id: req.usuario.id, cafe_id });
      return res.json({ favoritado: true });
    }
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar favorito' });
  }
});

// GET /favoritos/check/:cafe_id
router.get('/check/:cafe_id', authMiddleware, async (req, res) => {
  try {
    const { data } = await supabase
      .from('favoritos')
      .select('id')
      .eq('usuario_id', req.usuario.id)
      .eq('cafe_id', req.params.cafe_id)
      .single();

    res.json({ favoritado: !!data });
  } catch (err) {
    res.json({ favoritado: false });
  }
});

module.exports = router;
