// ============================================================
// Café Conecta — Integração PagBank
// api/pagbank.js
// ============================================================

const express = require('express');
const router  = express.Router();
const { createClient } = require('@supabase/supabase-js');

const PAGBANK_TOKEN = process.env.PAGBANK_TOKEN;
const PAGBANK_ENV   = process.env.PAGBANK_ENV || 'sandbox';
const PAGBANK_URL   = PAGBANK_ENV === 'sandbox'
  ? 'https://sandbox.api.pagseguro.com'
  : 'https://api.pagseguro.com';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Planos disponíveis
const PLANOS = {
  basico:        { nome: 'Básico',        valor: 2900  }, // centavos
  profissional:  { nome: 'Profissional',  valor: 7900  },
  premium:       { nome: 'Premium',       valor: 14900 },
};

// ── Helper: chama a API do PagBank ──────────────────────────
async function pagbankRequest(method, path, body = null) {
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${PAGBANK_TOKEN}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    },
  };
  if (body) options.body = JSON.stringify(body);

  const res  = await fetch(`${PAGBANK_URL}${path}`, options);
  const data = await res.json();

  if (!res.ok) {
    console.error('[PagBank] Erro:', data);
    throw new Error(data?.error_messages?.[0]?.description || 'Erro no PagBank');
  }
  return data;
}

// ── POST /pagbank/criar-assinatura ──────────────────────────
// Body: { user_id, plano, metodo: 'pix' | 'cartao', cartao? }
router.post('/criar-assinatura', async (req, res) => {
  try {
    const { user_id, plano, metodo, cartao } = req.body;

    if (!user_id || !plano || !metodo) {
      return res.status(400).json({ error: 'user_id, plano e metodo são obrigatórios' });
    }

    const planoInfo = PLANOS[plano];
    if (!planoInfo) {
      return res.status(400).json({ error: 'Plano inválido' });
    }

    // Monta o payload base da ordem
    const payload = {
      reference_id: `cafe-conecta-${user_id}-${Date.now()}`,
      customer: {
        name:  req.body.nome  || 'Usuário Café Conecta',
        email: req.body.email || 'usuario@cafeconecta.com.br',
        tax_id: req.body.cpf  || '00000000000', // CPF sem pontuação
      },
      items: [
        {
          reference_id: plano,
          name:         `Plano ${planoInfo.nome} — Café Conecta`,
          quantity:     1,
          unit_amount:  planoInfo.valor,
        },
      ],
      notification_urls: [
        `${process.env.BACKEND_URL || 'https://cafe-conecta-backend.vercel.app'}/pagbank/webhook`,
      ],
    };

    // ── PIX ──────────────────────────────────────────────────
    if (metodo === 'pix') {
      payload.qr_codes = [
        {
          amount:          { value: planoInfo.valor },
          expiration_date: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min
        },
      ];
    }

    // ── Cartão de crédito ────────────────────────────────────
    if (metodo === 'cartao') {
      if (!cartao?.encrypted) {
        return res.status(400).json({ error: 'Dados do cartão são obrigatórios' });
      }
      payload.charges = [
        {
          reference_id:    `charge-${user_id}-${Date.now()}`,
          description:     `Plano ${planoInfo.nome} Café Conecta`,
          amount:          { value: planoInfo.valor, currency: 'BRL' },
          payment_method: {
            type:           'CREDIT_CARD',
            installments:   1,
            capture:        true,
            card:           { encrypted: cartao.encrypted },
            holder:         { name: cartao.nome_titular },
          },
        },
      ];
    }

    // Cria a ordem no PagBank
    const ordem = await pagbankRequest('POST', '/orders', payload);

    // Extrai dados do PIX se for o método escolhido
    let pixCode    = null;
    let pixQrUrl   = null;
    let pixExpira  = null;
    if (metodo === 'pix' && ordem.qr_codes?.length > 0) {
      const qr  = ordem.qr_codes[0];
      pixCode   = qr.text;
      pixQrUrl  = qr.links?.find(l => l.rel === 'QRCODE.PNG')?.href || null;
      pixExpira = qr.expiration_date;
    }

    // Salva no Supabase — usando os nomes de coluna corretos da tabela assinaturas
    const { data: assinatura, error: dbError } = await supabase
      .from('assinaturas')
      .insert({
        usuario_id:       user_id,          // ← era user_id, correto: usuario_id
        plano,
        valor:            planoInfo.valor / 100, // ← era valor_mensal, correto: valor
        status:           'pendente',
        pagbank_order_id: ordem.id,
        metodo_pagamento: metodo,
        // pix_code, pix_qrcode_url, pix_expira_em não existem na tabela — omitidos
      })
      .select()
      .single();

    if (dbError) throw dbError;

    return res.json({
      sucesso:       true,
      assinatura_id: assinatura.id,
      order_id:      ordem.id,
      status:        'pendente',
      metodo,
      // Para PIX (retornamos os dados mesmo sem persistir na tabela):
      pix_code:    pixCode,
      pix_qrcode:  pixQrUrl,
      pix_expira:  pixExpira,
      // Para cartão: status já vem no charge
      charge_status: ordem.charges?.[0]?.status || null,
    });

  } catch (err) {
    console.error('[criar-assinatura]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /pagbank/webhook ───────────────────────────────────
// PagBank notifica aqui quando o pagamento é confirmado
router.post('/webhook', async (req, res) => {
  try {
    const { id: orderId, charges, qr_codes } = req.body;

    if (!orderId) return res.sendStatus(200);

    // Verifica se algum pagamento foi aprovado
    const aprovado =
      charges?.some(c => c.status === 'PAID') ||
      qr_codes?.some(q => q.status === 'PAID');

    if (aprovado) {
      const agora = new Date();
      const proximo = new Date(agora);
      proximo.setMonth(proximo.getMonth() + 1);

      await supabase
        .from('assinaturas')
        .update({
          status:            'ativa',
          valido_ate:        proximo.toISOString(), // ← era proximo_vencimento, correto: valido_ate
          pagbank_charge_id: charges?.[0]?.id || null,
          // ativado_em, cartao_ultimos4, cartao_bandeira não existem na tabela — omitidos
        })
        .eq('pagbank_order_id', orderId);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error('[webhook]', err.message);
    return res.sendStatus(500);
  }
});

// ── GET /pagbank/status/:user_id ────────────────────────────
// Flutter consulta para saber o plano ativo do usuário
router.get('/status/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params;

    const { data, error } = await supabase
      .from('assinaturas')
      .select('plano, status, valor, metodo_pagamento, valido_ate') // ← valor e valido_ate corretos
      .eq('usuario_id', user_id)                                    // ← era user_id, correto: usuario_id
      .in('status', ['ativa', 'pendente', 'trial'])
      .order('criado_em', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    return res.json({
      plano:              data?.plano     || 'gratuito',
      status:             data?.status    || 'gratuito',
      proximo_vencimento: data?.valido_ate || null,  // ← lê valido_ate, retorna como proximo_vencimento (compatível com Flutter)
    });
  } catch (err) {
    console.error('[status]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /pagbank/cancelar ──────────────────────────────────
router.post('/cancelar', async (req, res) => {
  try {
    const { user_id } = req.body;

    await supabase
      .from('assinaturas')
      .update({ status: 'cancelada' })  // ← cancelado_em não existe na tabela — removido
      .eq('usuario_id', user_id)        // ← era user_id, correto: usuario_id
      .eq('status', 'ativa');

    return res.json({ sucesso: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
