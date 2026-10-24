// lib/rotas.js — utilidades comuns às rotas novas.
const semTabela = (e) => Boolean(e) && ['42P01', 'PGRST205', 'PGRST200', '42703', 'PGRST204'].includes(e.code);
const texto = (v, max = 300) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
const numero = (v) => (v == null || v === '' ? null : Number(v));

/** Responde erro: 503 amigável se a tabela/coluna ainda não existe, 500 nos demais casos. */
function falhaCom(msgSemTabela) {
  return (res, err, msg) => {
    if (semTabela(err)) return res.status(503).json({ error: msgSemTabela });
    console.error(msg, err);
    return res.status(500).json({ error: msg });
  };
}

module.exports = { semTabela, texto, numero, falhaCom };
