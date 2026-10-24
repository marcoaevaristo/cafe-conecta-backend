// lib/safra.js — soma das previsões de safra (sem identificar produtores).
const MIN_PRODUTORES = 2; // grupos com menos produtores não aparecem (privacidade)

/** Soma as previsões por safra + tipo + região + mês, escondendo grupos pequenos. */
function agregarPrevisoes(linhas, minimo = MIN_PRODUTORES) {
  const grupos = new Map();
  for (const p of linhas) {
    const chave = [p.safra, p.tipo, p.regiao || 'Outras', p.mes_colheita || 0].join('|');
    const g = grupos.get(chave) || { safra: p.safra, tipo: p.tipo, regiao: p.regiao || 'Outras',
      mes_colheita: p.mes_colheita || null, sacas: 0, produtores: new Set() };
    g.sacas += Number(p.sacas_previstas) || 0;
    g.produtores.add(p.usuario_id);
    grupos.set(chave, g);
  }
  return [...grupos.values()]
    .filter((g) => g.produtores.size >= minimo)
    .map((g) => ({ ...g, produtores: g.produtores.size }))
    .sort((a, b) => a.safra.localeCompare(b.safra) || (a.mes_colheita || 13) - (b.mes_colheita || 13) || b.sacas - a.sacas);
}

module.exports = { agregarPrevisoes, MIN_PRODUTORES };
