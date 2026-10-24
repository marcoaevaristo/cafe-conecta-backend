// lib/validacao.js — leitura e validação de campos (funções puras, testadas em test/).

/** Campos da ficha de café especial; só devolve os que vieram no corpo. */
function lerFicha(b) {
  const f = {};
  const texto = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, 60));
  if ('variedade' in b) f.variedade = texto(b.variedade);
  if ('processamento' in b) f.processamento = texto(b.processamento);
  if ('altitude' in b) {
    const a = parseInt(b.altitude, 10);
    f.altitude = Number.isFinite(a) && a > 0 && a < 3000 ? a : null;
  }
  if ('pontuacao_sca' in b) {
    const p = Number(b.pontuacao_sca);
    f.pontuacao_sca = Number.isFinite(p) && p >= 60 && p <= 100 ? Math.round(p * 10) / 10 : null;
  }
  if ('certificacoes' in b) {
    f.certificacoes = Array.isArray(b.certificacoes)
      ? [...new Set(b.certificacoes.map((c) => String(c).trim().slice(0, 40)).filter(Boolean))].slice(0, 10)
      : [];
  }
  return f;
}

/** Separa as condições que o app junta no texto da proposta. */
function lerCondicoes(mensagem) {
  const c = { pagamento: null, prazo_entrega: null, local_entrega: null, observacoes: [] };
  for (const linha of String(mensagem || '').split('\n').map((l) => l.trim()).filter(Boolean)) {
    if (/^Pagamento:/i.test(linha)) c.pagamento = linha.replace(/^Pagamento:\s*/i, '');
    else if (/^Prazo de entrega:/i.test(linha)) c.prazo_entrega = linha.replace(/^Prazo de entrega:\s*/i, '');
    else if (/^Local de entrega:/i.test(linha)) c.local_entrega = linha.replace(/^Local de entrega:\s*/i, '');
    else c.observacoes.push(linha);
  }
  return { ...c, observacoes: c.observacoes.join('\n') || null };
}

module.exports = { lerFicha, lerCondicoes };
