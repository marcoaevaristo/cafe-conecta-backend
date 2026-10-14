const express = require('express');
const axios = require('axios');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const PLANOS = {
  basico: { nome: 'Básico', preco: 4900, descricao: 'Até 10 lotes, sem destaque' },
  profissional: { nome: 'Profissional', preco: 9900, descricao: 'Lotes ilimitados, destaque no feed' },
  premium: { nome: 'Premium', preco: 19900, descricao: 'Tudo + laudo IA + suporte prioritário' },
};

// GET /planos — listar planos disponíveis
router.get('/', (req, res) => {
  res.json(PLANOS);
});

// POST /planos/assinar — iniciar pagamento PagBank
router.post('/assinar', authMiddleware, async (req, res) => {
  const { plano } = req.body;

  if (!PLANOS[plano]) {
    return res.status(400).json({ error: 'Plano inválido' });
  }

  const PAGBANK_TOKEN = process.env.PAGBANK_TOKEN;
  const PAGBANK_URL = process.env.PAGBANK_ENV === 'production'
    ? 'https://api.pagseguro.com'
    : 'https://sandbox.api.pagseguro.com';

  try {
    // Cria o pedido no PagBank
    const pedido = {
      reference_id: `cafe-conecta-${req.usuario.id}-${Date.now()}`,
      customer: {
        name: req.usuario.nome || 'Cliente',
        email: req.usuario.email,
        tax_id: '00000000000', // Será preenchido pelo cliente no checkout
      },
      items: [{
        name: `Plano ${PLANOS[plano].nome} - Café Conecta`,
        quantity: 1,
        unit_amount: PLANOS[plano].preco,
      }],
      qr_codes: [{
        amount: { value: PLANOS[plano].preco },
        expiration_date: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min
      }],
      notification_urls: [`${process.env.API_URL}/webhook/pagbank`],
    };

    const response = await axios.post(`${PAGBANK_URL}/orders`, pedido, {
      headers: {
        'Authorization': `Bearer ${PAGBANK_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    // Salva a assinatura como pendente
    await supabase.from('assinaturas').insert({
      usuario_id: req.usuario.id,
      plano,
      status: 'pendente',
      valor: PLANOS[plano].preco / 100,
      pagbank_order_id: response.data.id,
    });

    // Retorna o QR code PIX para o app
    const qrCode = response.data.qr_codes?.[0];
    res.json({
      order_id: response.data.id,
      qr_code: qrCode?.text,
      qr_code_image: qrCode?.links?.find(l => l.rel === 'QRCODE.PNG')?.href,
      expira_em: qrCode?.expiration_date,
      valor: PLANOS[plano].preco / 100,
      plano: PLANOS[plano],
    });
  } catch (err) {
    console.error('Erro PagBank:', err.response?.data || err.message);
    res.status(500).json({ error: 'Erro ao criar pagamento', detalhe: err.response?.data });
  }
});

// GET /planos/minha-assinatura
router.get('/minha-assinatura', authMiddleware, async (req, res) => {
  try {
    const { data } = await supabase
      .from('assinaturas')
      .select('*')
      .eq('usuario_id', req.usuario.id)
      .eq('status', 'ativo')
      .order('criado_em', { ascending: false })
      .limit(1)
      .single();

    res.json(data || null);
  } catch (err) {
    res.json(null);
  }
});

module.exports = router;
