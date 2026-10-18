const express = require('express');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');
const { avaliacaoParaApp } = require('../lib/mapper');

const router = express.Router();

// GET /avaliacoes/ja-avaliou/:propostaId — o usuário logado já avaliou esta proposta?
// (declarada antes de /:usuarioId para não ser capturada por ela)
router.get('/ja-avaliou/:propostaId', authMiddleware, async (req, res) => {
  try {
    const { count, error } = await supabase
      .from('avaliacoes')
      .select('id', { count: 'exact', head: true })
      .eq('avaliador_id', req.usuario.id)
      .eq('proposta_id', req.params.propostaId);

    if (error) throw error;
    res.json({ jaAvaliou: (count || 0) > 0 });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao verificar avaliação' });
  }
});

// GET /avaliacoes/:usuarioId/resumo — média e distribuição das notas
router.get('/:usuarioId/resumo', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('avaliacoes')
      .select('nota')
      .eq('avaliado_id', req.params.usuarioId);

    if (error) throw error;
    const notas = (data || []).map(a => a.nota);
    const total = notas.length;
    const media = total ? Number((notas.reduce((s, n) => s + n, 0) / total).toFixed(1)) : 0.0;
    const conta = n => notas.filter(x => x === n).length;

    res.json({ media, total, n5: conta(5), n4: conta(4), n3: conta(3), n2: conta(2), n1: conta(1) });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar resumo de avaliações' });
  }
});

// GET /avaliacoes/:usuarioId — avaliações recebidas por um usuário
router.get('/:usuarioId', authMiddleware, async (req, res) => {
  try {
    const consulta = (select) => supabase
      .from('avaliacoes')
      .select(select)
      .eq('avaliado_id', req.params.usuarioId)
      .order('criado_em', { ascending: false });

    let { data, error } = await consulta('*, avaliador:usuarios!avaliacoes_avaliador_id_fkey(id, nome)');
    if (error) ({ data, error } = await consulta('*')); // sem o nome do avaliador, se a FK tiver outro nome
    if (error) throw error;
    res.json((data || []).map(avaliacaoParaApp));
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar avaliações' });
  }
});

// POST /avaliacoes — aceita o formato do banco e o do app
router.post('/', authMiddleware, async (req, res) => {
  const avaliado_id = req.body.avaliado_id ?? req.body.para_usuario_id;
  const { proposta_id, comentario } = req.body;
  const nota = Number(req.body.nota);

  if (!avaliado_id || !proposta_id || !(nota >= 1 && nota <= 5)) {
    return res.status(400).json({ error: 'Avaliado, proposta e nota (1 a 5) são obrigatórios' });
  }
  if (avaliado_id === req.usuario.id) {
    return res.status(400).json({ error: 'Não é possível avaliar a si mesmo' });
  }

  try {
    // Só quem participou de uma proposta aceita pode avaliar a outra parte
    const { data: proposta } = await supabase
      .from('propostas').select('comprador_id, produtor_id, status').eq('id', proposta_id).single();

    const participantes = proposta ? [proposta.comprador_id, proposta.produtor_id] : [];
    if (!proposta || proposta.status !== 'aceita'
        || !participantes.includes(req.usuario.id) || !participantes.includes(avaliado_id)) {
      return res.status(403).json({ error: 'Só é possível avaliar após uma negociação aceita' });
    }

    const { data, error } = await supabase
      .from('avaliacoes')
      .insert({ avaliador_id: req.usuario.id, avaliado_id, proposta_id, nota, comentario })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Você já avaliou esta negociação' });
      throw error;
    }
    res.status(201).json(avaliacaoParaApp(data));
  } catch (err) {
    res.status(500).json({ error: 'Erro ao salvar avaliação' });
  }
});

module.exports = router;
