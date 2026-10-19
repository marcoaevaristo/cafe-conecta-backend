// lib/planos.js
// Limites de cada plano — os mesmos números mostrados na tela "Escolha seu Plano" do app.
// null = ilimitado.
const supabase = require('./supabase');

const ORDEM = ['gratuito', 'basico', 'profissional', 'premium'];
const NOMES = { gratuito: 'Gratuito', basico: 'Básico', profissional: 'Profissional', premium: 'Premium' };

const LIMITES = {
  gratuito:     { lotes_ativos: 2,    propostas_mes: 3,    alertas: 1,    fotos_por_lote: 0,    laudos_mes: 0 },
  basico:       { lotes_ativos: 5,    propostas_mes: 10,   alertas: null, fotos_por_lote: 3,    laudos_mes: 0 },
  profissional: { lotes_ativos: null, propostas_mes: null, alertas: null, fotos_por_lote: 10,   laudos_mes: 10 },
  premium:      { lotes_ativos: null, propostas_mes: null, alertas: null, fotos_por_lote: null, laudos_mes: null },
};

const DESCRICAO = {
  lotes_ativos: (n) => `${n} lote${n > 1 ? 's' : ''} ativo${n > 1 ? 's' : ''}`,
  propostas_mes: (n) => `${n} proposta${n > 1 ? 's' : ''} por mês`,
  alertas: (n) => `${n} alerta${n > 1 ? 's' : ''} de preço`,
  fotos_por_lote: (n) => `${n} foto${n > 1 ? 's' : ''} por lote`,
  laudos_mes: (n) => `${n} análise${n > 1 ? 's' : ''} de IA por mês`,
};

// Usado quando o plano não inclui o recurso (limite 0)
const NOME_RECURSO = {
  fotos_por_lote: 'fotos nos anúncios',
  laudos_mes: 'a classificação por IA e o laudo digital',
};

// Plano válido: um plano pago vencido (plano_valido_ate no passado) volta a ser gratuito.
function planoEfetivo(usuario, agora = new Date()) {
  const plano = ORDEM.includes(usuario?.plano) ? usuario.plano : 'gratuito';
  if (plano !== 'gratuito' && usuario?.plano_valido_ate && new Date(usuario.plano_valido_ate) < agora) {
    return 'gratuito';
  }
  return plano;
}

// Menor plano cujo limite comporta `usoAtual + 1`
function planoNecessario(recurso, usoAtual) {
  return ORDEM.find((p) => LIMITES[p][recurso] === null || LIMITES[p][recurso] > usoAtual) || 'premium';
}

// Decide se o uso atual permite mais um. Função pura, para testar sem banco.
function avaliarLimite(plano, recurso, usoAtual) {
  const limite = LIMITES[plano][recurso];
  if (limite === null || usoAtual < limite) return { permitido: true, limite };
  const necessario = planoNecessario(recurso, usoAtual);
  return {
    permitido: false,
    limite,
    resposta: {
      error: (limite === 0
        ? `Seu plano ${NOMES[plano]} não inclui ${NOME_RECURSO[recurso] || 'este recurso'}. `
        : `Seu plano ${NOMES[plano]} permite ${DESCRICAO[recurso](limite)}. `)
        + `Faça upgrade para o ${NOMES[necessario]} para continuar.`,
      codigo: 'LIMITE_PLANO',
      recurso,
      limite,
      plano_atual: plano,
      plano_necessario: necessario,
    },
  };
}

async function planoDoUsuario(usuarioId) {
  const { data } = await supabase
    .from('usuarios').select('plano, plano_valido_ate').eq('id', usuarioId).single();
  return planoEfetivo(data);
}

function inicioDoMes(agora = new Date()) {
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1)).toISOString();
}

async function contarUso(usuarioId, recurso) {
  let q;
  if (recurso === 'lotes_ativos') {
    q = supabase.from('cafes').select('id', { count: 'exact', head: true })
      .eq('usuario_id', usuarioId).eq('status', 'ativo');
  } else if (recurso === 'propostas_mes') {
    // Conta as propostas abertas pelo usuário como comprador; contrapropostas não contam.
    q = supabase.from('propostas').select('id', { count: 'exact', head: true })
      .eq('comprador_id', usuarioId).gte('criado_em', inicioDoMes());
  } else if (recurso === 'laudos_mes') {
    q = supabase.from('laudos').select('id', { count: 'exact', head: true })
      .eq('usuario_id', usuarioId).gte('criado_em', inicioDoMes());
  } else if (recurso === 'alertas') {
    q = supabase.from('alertas').select('id', { count: 'exact', head: true })
      .eq('usuario_id', usuarioId);
  }
  const { count, error } = await q;
  if (error) throw error;
  return count || 0;
}

// Verifica o limite e, se estourado, já responde 403. Retorna true se pode seguir.
async function exigirLimite(req, res, recurso) {
  const plano = await planoDoUsuario(req.usuario.id);
  if (LIMITES[plano][recurso] === null) return true; // ilimitado: nem consulta o uso
  const uso = await contarUso(req.usuario.id, recurso);
  const r = avaliarLimite(plano, recurso, uso);
  if (!r.permitido) {
    res.status(403).json(r.resposta);
    return false;
  }
  return true;
}

module.exports = { LIMITES, planoEfetivo, planoNecessario, avaliarLimite, planoDoUsuario, exigirLimite };
