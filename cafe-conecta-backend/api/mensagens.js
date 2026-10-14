const express = require('express');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /mensagens — conversas do usuário
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('mensagens')
      .select(`*, remetente:usuarios!mensagens_remetente_id_fkey(id, nome, avatar_url), destinatario:usuarios!mensagens_destinatario_id_fkey(id, nome, avatar_url)`)
      .or(`remetente_id.eq.${req.usuario.id},destinatario_id.eq.${req.usuario.id}`)
      .order('criado_em', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar mensagens' });
  }
});

// POST /mensagens
router.post('/', authMiddleware, async (req, res) => {
  const { destinatario_id, conteudo, proposta_id } = req.body;

  if (!destinatario_id || !conteudo) {
    return res.status(400).json({ error: 'destinatario_id e conteudo são obrigatórios' });
  }

  try {
    const { data, error } = await supabase
      .from('mensagens')
      .insert({ remetente_id: req.usuario.id, destinatario_id, conteudo, proposta_id })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao enviar mensagem' });
  }
});

// PUT /mensagens/lidas/:outro_usuario_id — marcar como lidas
router.put('/lidas/:outro_usuario_id', authMiddleware, async (req, res) => {
  try {
    await supabase
      .from('mensagens')
      .update({ lida: true })
      .eq('destinatario_id', req.usuario.id)
      .eq('remetente_id', req.params.outro_usuario_id);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao marcar mensagens' });
  }
});

// GET /mensagens/nao-lidas — contagem
router.get('/nao-lidas', authMiddleware, async (req, res) => {
  try {
    const { count } = await supabase
      .from('mensagens')
      .select('id', { count: 'exact' })
      .eq('destinatario_id', req.usuario.id)
      .eq('lida', false);

    res.json({ total: count || 0 });
  } catch (err) {
    res.json({ total: 0 });
  }
});

module.exports = router;
