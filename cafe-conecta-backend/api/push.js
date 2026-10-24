// api/push.js — inscrição para notificações push no navegador/celular.
const express = require('express');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');
const { chavesVapid, enviarPush } = require('../lib/push');
const { falhaCom } = require('../lib/rotas');

const router = express.Router();
const falha = falhaCom('Notificações push ainda não foram ativadas no servidor.');

// GET /push/chave — chave pública VAPID (o navegador precisa dela para se inscrever)
router.get('/chave', (req, res) => {
  const k = chavesVapid();
  if (!k) return res.status(503).json({ error: 'Push indisponível' });
  res.json({ chave: k.publica });
});

// POST /push/inscrever — body: a PushSubscription do navegador ({ endpoint, keys: { p256dh, auth } })
router.post('/inscrever', authMiddleware, async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!/^https:\/\//.test(endpoint || '') || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Inscrição inválida' });
  }
  try {
    const { error } = await supabase.from('push_inscricoes').upsert(
      { usuario_id: req.usuario.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
      { onConflict: 'endpoint' },
    );
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    falha(res, err, 'Erro ao ligar notificações');
  }
});

// POST /push/cancelar — body: { endpoint }
router.post('/cancelar', authMiddleware, async (req, res) => {
  try {
    const { error } = await supabase.from('push_inscricoes').delete()
      .eq('usuario_id', req.usuario.id).eq('endpoint', String(req.body?.endpoint || ''));
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    falha(res, err, 'Erro ao desligar notificações');
  }
});

// POST /push/teste — manda uma notificação de teste para os aparelhos do próprio usuário
router.post('/teste', authMiddleware, async (req, res) => {
  await enviarPush(req.usuario.id, { titulo: 'Café Conecta', corpo: 'Notificações ligadas neste aparelho.', url: '/' });
  res.json({ ok: true });
});

module.exports = router;
