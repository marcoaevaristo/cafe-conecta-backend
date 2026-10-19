const express = require('express');
const { sincronizarPedido } = require('../lib/assinaturas');

const router = express.Router();

// POST /webhook/pagbank — endereço antigo de notificação do PagBank.
// Mesmo tratamento de /pagbank/webhook: o status é confirmado direto no PagBank.
router.post('/pagbank', async (req, res) => {
  const orderId = req.body?.id;
  if (!orderId || !String(orderId).startsWith('ORDE_')) return res.status(200).json({ ok: true });
  try {
    const r = await sincronizarPedido(orderId);
    console.log('[webhook antigo]', orderId, r.situacao);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Erro no webhook:', err.message);
    res.status(500).json({ error: 'Erro ao processar webhook' });
  }
});

module.exports = router;
