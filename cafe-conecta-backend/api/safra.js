// api/safra.js — previsão de safra: o produtor informa quanto espera colher e quando;
// compradores veem a oferta futura somada por tipo, região e mês (sem identificar ninguém).
const express = require('express');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');
const { texto, falhaCom } = require('../lib/rotas');

const router = express.Router();
router.use(authMiddleware);
const falha = falhaCom('Previsão de safra ainda não foi ativada no servidor. Tente mais tarde.');
const { agregarPrevisoes } = require('../lib/safra');


router.get('/minhas', async (req, res) => {
  try {
    const { data, error } = await supabase.from('previsoes_safra').select('*')
      .eq('usuario_id', req.usuario.id).order('criado_em', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    falha(res, err, 'Erro ao buscar suas previsões');
  }
});

router.get('/agregado', async (req, res) => {
  try {
    const { data, error } = await supabase.from('previsoes_safra')
      .select('usuario_id, tipo, regiao, safra, sacas_previstas, mes_colheita').range(0, 9999);
    if (error) throw error;
    res.json(agregarPrevisoes(data || []));
  } catch (err) {
    falha(res, err, 'Erro ao buscar a previsão de oferta');
  }
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  const sacas = parseInt(b.sacas_previstas, 10);
  const mes = b.mes_colheita == null || b.mes_colheita === '' ? null : parseInt(b.mes_colheita, 10);
  const safra = texto(b.safra, 9);
  if (!texto(b.tipo, 40) || !safra || !/^\d{4}\/\d{4}$/.test(safra) || !Number.isFinite(sacas) || sacas <= 0) {
    return res.status(400).json({ error: 'Informe tipo, safra (ex.: 2027/2028) e sacas previstas' });
  }
  if (mes != null && (!Number.isFinite(mes) || mes < 1 || mes > 12)) return res.status(400).json({ error: 'Mês inválido' });
  try {
    const { data, error } = await supabase.from('previsoes_safra').insert({
      usuario_id: req.usuario.id, tipo: texto(b.tipo, 40), regiao: texto(b.regiao, 60), safra,
      sacas_previstas: sacas, mes_colheita: mes, observacoes: texto(b.observacoes, 400),
    }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    falha(res, err, 'Erro ao salvar a previsão');
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('previsoes_safra').delete()
      .eq('id', req.params.id).eq('usuario_id', req.usuario.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    falha(res, err, 'Erro ao apagar a previsão');
  }
});

module.exports = router;
