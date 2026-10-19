// api/admin.js — Painel do desenvolvedor (só para e-mails em ADMIN_EMAILS)
const express = require('express');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');
const { planoEfetivo } = require('../lib/planos');

const router = express.Router();

// Preço mensal de cada plano em reais (mesmos valores do checkout)
const PRECO = { basico: 29, profissional: 79, premium: 149 };
const FUSO = 'America/Sao_Paulo';

function emailsAdmin() {
  return (process.env.ADMIN_EMAILS || 'cafeconecta5@gmail.com')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}
function ehAdmin(email) {
  return emailsAdmin().includes(String(email || '').toLowerCase());
}

function exigirAdmin(req, res, next) {
  if (!ehAdmin(req.usuario?.email)) return res.status(403).json({ error: 'Acesso restrito' });
  next();
}

const dia = (data) => new Date(data).toLocaleDateString('sv-SE', { timeZone: FUSO });

// Últimos n dias (do mais antigo para hoje), no fuso de Brasília
function ultimosDias(n) {
  const dias = [];
  for (let i = n - 1; i >= 0; i--) dias.push(dia(Date.now() - i * 86400000));
  return dias;
}

async function todos(tabela, colunas) {
  const { data, error } = await supabase.from(tabela).select(colunas).range(0, 9999);
  if (error) throw new Error(`${tabela}: ${error.message}`);
  return data || [];
}

// GET /admin/resumo
router.get('/resumo', authMiddleware, exigirAdmin, async (req, res) => {
  try {
    const agora = Date.now();
    const desde = (dias) => agora - dias * 86400000;
    const dias30 = ultimosDias(30);

    const [usuarios, assinaturas, cafes, propostas, alertas, laudos] = await Promise.all([
      todos('usuarios', 'id, nome, email, tipo, plano, plano_valido_ate, criado_em'),
      todos('assinaturas', 'id, usuario_id, plano, status, valor, metodo_pagamento, pagbank_charge_id, criado_em'),
      todos('cafes', 'id, status, criado_em'),
      todos('propostas', 'id, status, valor_proposto, quantidade_sacas, criado_em'),
      todos('alertas', 'id, ativo'),
      todos('laudos', 'id, criado_em').catch(() => []),
    ]);
    const { count: mensagens30d } = await supabase.from('mensagens')
      .select('id', { count: 'exact', head: true }).gte('criado_em', new Date(desde(30)).toISOString());

    let acessos = [];
    let acessosDisponivel = true;
    try {
      const { data, error } = await supabase.from('acessos')
        .select('usuario_id, dia').gte('dia', dias30[0]).range(0, 49999);
      if (error) throw error;
      acessos = data || [];
    } catch { acessosDisponivel = false; }

    // ── Usuários ─────────────────────────────────────────────
    const contar = (lista, chave) => lista.reduce((m, x) => ({ ...m, [chave(x)]: (m[chave(x)] || 0) + 1 }), {});
    const planos = usuarios.map((u) => ({ ...u, efetivo: planoEfetivo(u) }));
    const pagantes = planos.filter((u) => u.efetivo !== 'gratuito');
    const cadastrosPorDia = contar(usuarios.filter((u) => u.criado_em), (u) => dia(u.criado_em));

    // ── Acessos ──────────────────────────────────────────────
    const hoje = dias30[dias30.length - 1];
    const serieAcessos = dias30.map((d) => {
      const doDia = acessos.filter((a) => a.dia === d);
      return {
        dia: d,
        usuarios: new Set(doDia.filter((a) => a.usuario_id).map((a) => a.usuario_id)).size,
        anonimos: doDia.filter((a) => !a.usuario_id).length,
      };
    });
    const ultimos7 = serieAcessos.slice(-7);
    const ativos = (n) => new Set(acessos.filter((a) => a.usuario_id && a.dia >= dias30[30 - n]).map((a) => a.usuario_id)).size;

    // ── Assinaturas e receita ───────────────────────────────
    // Pagamento confirmado = tem cobrança do PagBank (continua contando mesmo se depois cancelar a renovação)
    const pagas = assinaturas.filter((a) => a.pagbank_charge_id || a.status === 'ativo');
    const quemPagou = new Set(pagas.map((a) => a.usuario_id));
    // Plano pago sem nenhum pagamento (liberado à mão, ex.: master) não entra na receita
    const pagantesReais = pagantes.filter((u) => quemPagou.has(u.id));
    const cortesias = pagantes.filter((u) => !quemPagou.has(u.id));
    const receitaPeriodo = (dias) => pagas
      .filter((a) => new Date(a.criado_em).getTime() >= desde(dias))
      .reduce((s, a) => s + Number(a.valor || 0), 0);
    const nomeDe = Object.fromEntries(usuarios.map((u) => [u.id, u.nome]));

    // ── Marketplace ─────────────────────────────────────────
    const aceitas = propostas.filter((p) => p.status === 'aceita');
    const respondidas = propostas.filter((p) => ['aceita', 'recusada', 'contraproposta'].includes(p.status));

    res.json({
      gerado_em: new Date().toISOString(),
      usuarios: {
        total: usuarios.length,
        novos_7d: usuarios.filter((u) => new Date(u.criado_em).getTime() >= desde(7)).length,
        novos_30d: usuarios.filter((u) => new Date(u.criado_em).getTime() >= desde(30)).length,
        por_tipo: contar(usuarios, (u) => u.tipo),
        por_plano: contar(planos, (u) => u.efetivo),
        serie_cadastros_30d: dias30.map((d) => ({ dia: d, total: cadastrosPorDia[d] || 0 })),
        ultimos: [...usuarios]
          .sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)))
          .slice(0, 10)
          .map((u) => ({ nome: u.nome, email: u.email, tipo: u.tipo, plano: planoEfetivo(u), criado_em: u.criado_em })),
      },
      acessos: {
        disponivel: acessosDisponivel,
        hoje_usuarios: serieAcessos[serieAcessos.length - 1].usuarios,
        hoje_anonimos: serieAcessos[serieAcessos.length - 1].anonimos,
        ativos_7d: ativos(7),
        ativos_30d: ativos(30),
        media_diaria_7d: Number((ultimos7.reduce((s, d) => s + d.usuarios, 0) / 7).toFixed(1)),
        serie_30d: serieAcessos,
        hoje,
      },
      receita: {
        mrr: pagantesReais.reduce((s, u) => s + (PRECO[u.efetivo] || 0), 0),
        pagantes: pagantesReais.length,
        cortesias: cortesias.length,
        lista_cortesias: cortesias
          .map((u) => ({ id: u.id, nome: u.nome, email: u.email, plano: u.efetivo, valido_ate: u.plano_valido_ate }))
          .sort((a, b) => String(a.valido_ate || '9999').localeCompare(String(b.valido_ate || '9999'))),
        recebido_30d: receitaPeriodo(30),
        recebido_total: pagas.reduce((s, a) => s + Number(a.valor || 0), 0),
        assinaturas_por_status: contar(assinaturas, (a) => a.status),
        vencem_7d: pagantesReais.filter((u) => u.plano_valido_ate
          && new Date(u.plano_valido_ate).getTime() < agora + 7 * 86400000).length,
        ultimos_pagamentos: [...pagas]
          .sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)))
          .slice(0, 10)
          .map((a) => ({ usuario: nomeDe[a.usuario_id] || '—', plano: a.plano, valor: Number(a.valor), metodo: a.metodo_pagamento, criado_em: a.criado_em })),
      },
      marketplace: {
        lotes_ativos: cafes.filter((c) => c.status === 'ativo').length,
        lotes_total: cafes.length,
        lotes_novos_30d: cafes.filter((c) => new Date(c.criado_em).getTime() >= desde(30)).length,
        propostas_total: propostas.length,
        propostas_30d: propostas.filter((p) => new Date(p.criado_em).getTime() >= desde(30)).length,
        propostas_por_status: contar(propostas, (p) => p.status),
        taxa_aceite: respondidas.length ? Number((aceitas.length / respondidas.length * 100).toFixed(1)) : null,
        volume_negociado: aceitas.reduce((s, p) => s + Number(p.valor_proposto || 0) * Number(p.quantidade_sacas || 0), 0),
        mensagens_30d: mensagens30d || 0,
        alertas_ativos: alertas.filter((a) => a.ativo).length,
        laudos_ia_30d: laudos.filter((l) => new Date(l.criado_em).getTime() >= desde(30)).length,
        laudos_ia_total: laudos.length,
      },
    });
  } catch (err) {
    console.error('[admin/resumo]', err.message);
    res.status(500).json({ error: 'Erro ao montar o painel' });
  }
});

// ── Liberação de plano sem pagamento (cortesia) ─────────────────────

// GET /admin/usuarios?busca=texto — procura por nome ou e-mail (até 20)
router.get('/usuarios', authMiddleware, exigirAdmin, async (req, res) => {
  // remove caracteres que o filtro do Supabase usa como sintaxe
  const busca = String(req.query.busca || '').replace(/[,()%*\\]/g, ' ').trim();
  try {
    let q = supabase.from('usuarios')
      .select('id, nome, email, tipo, plano, plano_valido_ate, criado_em')
      .order('nome', { ascending: true })
      .limit(20);
    if (busca) q = q.or(`nome.ilike.*${busca}*,email.ilike.*${busca}*`);
    const { data, error } = await q;
    if (error) throw error;
    res.json((data || []).map((u) => ({ ...u, plano_efetivo: planoEfetivo(u) })));
  } catch (err) {
    console.error('[admin/usuarios]', err.message);
    res.status(500).json({ error: 'Erro ao buscar usuários' });
  }
});

// POST /admin/usuarios/:id/plano — Body: { plano, valido_ate: 'AAAA-MM-DD' }
// Libera o plano até o fim do dia informado (horário de Brasília). plano 'gratuito' remove a liberação.
router.post('/usuarios/:id/plano', authMiddleware, exigirAdmin, async (req, res) => {
  const { plano, valido_ate } = req.body || {};
  if (!['gratuito', 'basico', 'profissional', 'premium'].includes(plano)) {
    return res.status(400).json({ error: 'Plano inválido' });
  }

  let validade = null;
  if (plano !== 'gratuito') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(valido_ate || ''))) {
      return res.status(400).json({ error: 'Informe a data final no formato AAAA-MM-DD' });
    }
    validade = new Date(`${valido_ate}T23:59:59-03:00`); // fim do dia em Brasília
    if (Number.isNaN(validade.getTime())) return res.status(400).json({ error: 'Data inválida' });
    if (validade.getTime() <= Date.now()) return res.status(400).json({ error: 'A data final precisa ser no futuro' });
  }

  try {
    const { data, error } = await supabase.from('usuarios')
      .update({ plano, plano_valido_ate: validade ? validade.toISOString() : null })
      .eq('id', req.params.id)
      .select('id, nome, email, tipo, plano, plano_valido_ate')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Usuário não encontrado' });

    console.log(`[admin] ${req.usuario.email} definiu plano ${plano} até ${validade ? validade.toISOString() : '—'} para ${data.email}`);
    res.json({ ...data, plano_efetivo: planoEfetivo(data) });
  } catch (err) {
    console.error('[admin/plano]', err.message);
    res.status(500).json({ error: 'Erro ao alterar o plano' });
  }
});

module.exports = { router, ehAdmin };
