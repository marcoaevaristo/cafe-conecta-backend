// lib/empresa.js — código de convite da conta empresarial.
const crypto = require('crypto');

/** Código de convite estável da empresa: 10 caracteres derivados do id e do segredo do servidor. */
function codigoConvite(empresaId, segredo = process.env.JWT_SECRET || '') {
  const h = crypto.createHmac('sha256', segredo).update(`empresa:${empresaId}`).digest('hex');
  return `${h.slice(0, 5)}-${h.slice(5, 10)}`.toUpperCase();
}

module.exports = { codigoConvite };
