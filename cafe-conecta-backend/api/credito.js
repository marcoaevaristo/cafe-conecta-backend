// api/credito.js — interesse em crédito rural / CPR. O produtor registra o interesse e
// autoriza (ou não) o contato; o painel do desenvolvedor lista para encaminhar a parceiros.
const express = require('express');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');
const { exigirAdmin } = require('./admin');
const { texto, numero, falhaCom } = require('../lib/rotas');

const router = express.Router();
router.use(authMiddleware);
const falha = falhaCom('Interesse em crédito ainda não foi ativado no servidor. Tente mais tarde.');
const MODALIDADES = ['CPR', 'CPR Financeira', 'Custeio', 'Investimento', 'Comercialização', 'Outro'];

router.get('/meus', async (req, res) => {
  try {
    const { data, error } = await supabase.from('interesses_credito')
      .select('*, cafe:cafes(id, tipo, classificacao, fazenda)')
      .eq('usuario_id', req.usuario.id).order('criado_em', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    falha(res, err, 'Erro ao buscar seus pedidos de crédito');
  }
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  const modalidade = MODALIDADES.includes(b.modalidade) ? b.modalidade : 'CPR';
  const valor = numero(b.valor_desejado);
  if (valor != null && (!Number.isFinite(valor) || valor <= 0)) return res.status(400).json({ error: 'Valor inválido' });
  if (b.autoriza_contato !== true) {
    return res.status(400).json({ error: 'Para registrar o interesse é preciso autorizar o contato de parceiros financeiros' });
  }
  try {
    let cafeId = null;
    if (b.cafe_id) {
      const { data: cafe } = await supabase.from('cafes').select('id, usuario_id').eq('id', b.cafe_id).single();
      if (!cafe || cafe.usuario_id !== req.usuario.id) return res.status(400).json({ error: 'Escolha um lote seu' });
      cafeId = cafe.id;
    }
    const { data, error } = await supabase.from('interesses_credito').insert({
      usuario_id: req.usuario.id, cafe_id: cafeId, modalidade, valor_desejado: valor,
      observacoes: texto(b.observacoes, 500), autoriza_contato: true,
    }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    falha(res, err, 'Erro ao registrar o interesse');
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('interesses_credito').delete()
      .eq('id', req.params.id).eq('usuario_id', req.usuario.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    falha(res, err, 'Erro ao retirar o interesse');
  }
});

// GET /credito/todos — só administrador: interesses com contato autorizado
router.get('/todos', exigirAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('interesses_credito')
      .select('*, usuario:usuarios(id, nome, email, telefone, cidade, estado), cafe:cafes(id, tipo, classificacao, quantidade_sacas, fazenda)')
      .eq('autoriza_contato', true).order('criado_em', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    falha(res, err, 'Erro ao buscar interesses de crédito');
  }
});

module.exports = router;
