// api/metricas.js — registro de acessos ao app (alimenta o Painel do desenvolvedor)
const express = require('express');
const jwt = require('jsonwebtoken');
const supabase = require('../lib/supabase');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// Dia no fuso de Brasília (YYYY-MM-DD)
function hojeBrasilia() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

// POST /metricas/visita — o app chama ao abrir. Com login, conta 1 acesso por usuário por dia;
// sem login, conta cada abertura como visita anônima.
router.post('/visita', async (req, res) => {
  let usuarioId = null;
  const token = (req.headers.authorization || '').split(' ')[1];
  if (token) {
    try { usuarioId = jwt.verify(token, JWT_SECRET).id; } catch { /* token inválido: visita anônima */ }
  }
  const plataforma = String(req.body?.plataforma || 'web').slice(0, 20);

  try {
    const linha = { usuario_id: usuarioId, dia: hojeBrasilia(), plataforma };
    const { error } = usuarioId
      ? await supabase.from('acessos').upsert(linha, { onConflict: 'usuario_id,dia', ignoreDuplicates: true })
      : await supabase.from('acessos').insert(linha);
    if (error) console.error('[metricas] acesso não registrado:', error.message);
  } catch (err) {
    console.error('[metricas]', err.message);
  }
  res.status(204).end(); // nunca atrapalha o app, mesmo se falhar
});

module.exports = { router, hojeBrasilia };
