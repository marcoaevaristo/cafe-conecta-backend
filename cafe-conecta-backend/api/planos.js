const express = require('express');
const axios = require('axios');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Mesmos valores cobrados em /pagbank/criar-assinatura (centavos)
const PLANOS = {
  basico: { nome: 'Básico', preco: 2900 },
  profissional: { nome: 'Profissional', preco: 7900 },
  premium: { nome: 'Premium', preco: 14900 },
};

// GET /planos — listar planos disponíveis
router.get('/', (req, res) => {
  res.json(PLANOS);
});

// POST /planos/assinar — fluxo antigo, substituído por /pagbank/criar-assinatura
router.post('/assinar', authMiddleware, (req, res) => {
  res.status(410).json({ error: 'Use /pagbank/criar-assinatura para assinar um plano.' });
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
