// lib/limite.js — limite de tentativas (login, cadastro, recuperação de senha).
// Guarda cada tentativa na tabela limites_acesso (scripts/migration_limites.sql).
// Funciona em serverless porque o contador fica no banco, não na memória.
// Se a tabela ainda não existir, libera (não derruba o login) e avisa no log.
const crypto = require('crypto');
const supabase = require('./supabase');

// IP embaralhado: dá para contar tentativas sem guardar o endereço real
function chaveIp(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
    .split(',')[0].trim();
  return crypto.createHash('sha256').update(`ip|${ip}`).digest('hex').slice(0, 24);
}

const chaveEmail = (email) =>
  crypto.createHash('sha256').update(`email|${String(email || '').trim().toLowerCase()}`).digest('hex').slice(0, 24);

/** Quantas tentativas a chave teve nos últimos `minutos`. */
async function contar(chave, minutos) {
  const desde = new Date(Date.now() - minutos * 60000).toISOString();
  const { count, error } = await supabase
    .from('limites_acesso')
    .select('id', { count: 'exact', head: true })
    .eq('chave', chave)
    .gte('criado_em', desde);
  if (error) {
    console.warn('limites_acesso indisponível (rode scripts/migration_limites.sql):', error.message);
    return 0;
  }
  return count || 0;
}

async function registrar(...chaves) {
  const { error } = await supabase.from('limites_acesso').insert(chaves.map((chave) => ({ chave })));
  if (error) console.warn('Não registrou tentativa:', error.message);
  // limpeza ocasional do que tem mais de 1 dia
  if (Math.random() < 0.02) {
    await supabase.from('limites_acesso').delete()
      .lt('criado_em', new Date(Date.now() - 86400000).toISOString());
  }
}

/**
 * Verifica as regras [{ chave, max, minutos }]. Se alguma estourou, responde 429
 * e devolve false. Com `registrarAgora`, já conta esta tentativa.
 */
async function respeitarLimites(res, regras, { registrarAgora = false } = {}) {
  for (const r of regras) {
    if ((await contar(r.chave, r.minutos)) >= r.max) {
      res.status(429).json({
        error: `Muitas tentativas. Aguarde ${r.minutos >= 60 ? `${Math.round(r.minutos / 60)} hora(s)` : `${r.minutos} minutos`} e tente de novo.`,
        codigo: 'MUITAS_TENTATIVAS',
      });
      return false;
    }
  }
  if (registrarAgora) await registrar(...regras.map((r) => r.chave));
  return true;
}

module.exports = { chaveIp, chaveEmail, respeitarLimites, registrar };
