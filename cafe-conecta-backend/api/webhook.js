const express = require('express');
const supabase = require('../lib/supabase');

const router = express.Router();

// POST /webhook/pagbank — recebe notificações do PagBank
router.post('/pagbank', async (req, res) => {
  const evento = req.body;

  console.log('Webhook PagBank recebido:', JSON.stringify(evento, null, 2));

  try {
    const orderId = evento.id || evento.reference_id;
    const charges = evento.charges || [];

    for (const charge of charges) {
      const status = charge.status;

      if (status === 'PAID') {
        // Busca a assinatura pelo order_id
        const { data: assinatura } = await supabase
          .from('assinaturas')
          .select('*')
          .eq('pagbank_order_id', orderId)
          .single();

        if (assinatura) {
          const validoAte = new Date();
          validoAte.setMonth(validoAte.getMonth() + 1); // +1 mês

          // Atualiza assinatura
          await supabase.from('assinaturas').update({
            status: 'ativo',
            pagbank_charge_id: charge.id,
            metodo_pagamento: charge.payment_method?.type || 'PIX',
            valido_ate: validoAte.toISOString(),
          }).eq('id', assinatura.id);

          // Atualiza plano do usuário
          await supabase.from('usuarios').update({
            plano: assinatura.plano,
            plano_valido_ate: validoAte.toISOString(),
          }).eq('id', assinatura.usuario_id);

          console.log(`Plano ${assinatura.plano} ativado para usuário ${assinatura.usuario_id}`);
        }
      }

      if (status === 'CANCELED' || status === 'DECLINED') {
        await supabase.from('assinaturas').update({ status: 'cancelado' })
          .eq('pagbank_order_id', orderId);
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Erro no webhook:', err);
    res.status(500).json({ error: 'Erro ao processar webhook' });
  }
});

module.exports = router;
