// ============================================================
// Café Conecta — Integração PagBank
// api/pagbank.js
// ============================================================

const express = require('express');
const router  = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { sincronizarPedido } = require('../lib/assinaturas');
const supabaseLib = require('../lib/supabase');

const PAGBANK_TOKEN = process.env.PAGBANK_TOKEN;
const PAGBANK_ENV   = process.env.PAGBANK_ENV || 'sandbox';
const PAGBANK_URL   = PAGBANK_ENV === 'sandbox'
  ? 'https://sandbox.api.pagseguro.com'
  : 'https://api.pagseguro.com';

const supabase = supabaseLib;

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
// Body: { plano, metodo: 'pix' | 'cartao', cpf, nome?, cartao? } — usuário vem do login
router.post('/criar-assinatura', authMiddleware, async (req, res) => {
  try {
    const user_id = req.usuario.id;
    const { plano, metodo, cartao } = req.body;

    if (!plano || !metodo) {
      return res.status(400).json({ error: 'plano e metodo são obrigatórios' });
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
        email: req.usuario.email || req.body.email || 'usuario@cafeconecta.com.br',
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

    let liberacao = null;
    if (ordem.charges?.some((c) => c.status === 'PAID')) {
      liberacao = await sincronizarPedido(ordem.id, ordem);
    }

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
      plano_liberado: liberacao?.situacao === 'pago',
      valido_ate: liberacao?.valido_ate || null,
    });

  } catch (err) {
    console.error('[criar-assinatura]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /pagbank/webhook ───────────────────────────────────
// PagBank avisa aqui quando o pedido muda. O corpo NÃO é confiável:
// o status é sempre confirmado consultando o pedido direto no PagBank.
router.post('/webhook', async (req, res) => {
  const orderId = req.body?.id;
  if (!orderId || !String(orderId).startsWith('ORDE_')) return res.sendStatus(200);
  try {
    const r = await sincronizarPedido(orderId);
    console.log('[webhook]', orderId, r.situacao);
    return res.sendStatus(200);
  } catch (err) {
    console.error('[webhook]', err.message);
    return res.sendStatus(500); // PagBank tenta de novo depois
  }
});

// ── GET /pagbank/verificar/:orderId ─────────────────────────
// App pergunta "já foi pago?" depois do PIX (não depende do webhook chegar)
router.get('/verificar/:orderId', authMiddleware, async (req, res) => {
  try {
    const { data: assinatura } = await supabase
      .from('assinaturas').select('usuario_id').eq('pagbank_order_id', req.params.orderId).maybeSingle();
    if (!assinatura || assinatura.usuario_id !== req.usuario.id) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }
    return res.json(await sincronizarPedido(req.params.orderId));
  } catch (err) {
    console.error('[verificar]', err.message);
    return res.status(502).json({ error: 'Não foi possível confirmar o pagamento agora. Tente de novo em instantes.' });
  }
});

// ── GET /pagbank/status ─────────────────────────────────────
// Assinatura mais recente do usuário logado
router.get(['/status', '/status/:user_id'], authMiddleware, async (req, res) => {
  try {
    const user_id = req.usuario.id;

    const { data, error } = await supabase
      .from('assinaturas')
      .select('plano, status, valor, metodo_pagamento, valido_ate') // ← valor e valido_ate corretos
      .eq('usuario_id', user_id)                                    // ← era user_id, correto: usuario_id
      .in('status', ['ativo', 'pendente'])
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
// Cancela a renovação: o plano continua valendo até plano_valido_ate (não há cobrança automática)
router.post('/cancelar', authMiddleware, async (req, res) => {
  try {
    const { error } = await supabase
      .from('assinaturas')
      .update({ status: 'cancelado' })
      .eq('usuario_id', req.usuario.id)
      .in('status', ['ativo', 'pendente']);
    if (error) throw error;

    return res.json({ sucesso: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
