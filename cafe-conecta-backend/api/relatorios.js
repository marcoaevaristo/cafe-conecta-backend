// api/relatorios.js — relatório de negócios do usuário (o app gera PDF e planilha a partir dele).
const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { lerPeriodo, relatorioDe } = require('../lib/relatorio');

const router = express.Router();

// GET /relatorios/meu?de=AAAA-MM-DD&ate=AAAA-MM-DD
router.get('/meu', authMiddleware, async (req, res) => {
  try {
    res.json(await relatorioDe([req.usuario.id], lerPeriodo(req.query)));
  } catch (err) {
    console.error('Erro no relatório:', err);
    res.status(500).json({ error: 'Erro ao gerar o relatório' });
  }
});

module.exports = router;
