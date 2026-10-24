// api/empresas.js — conta empresarial (cooperativa, trading, banco, torrefação).
// O dono cria a empresa e compartilha um código de convite; cada pessoa entra com o código
// (consentimento explícito) e os administradores veem o painel consolidado dos membros.
const express = require('express');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');
const { texto, falhaCom } = require('../lib/rotas');
const { lerPeriodo, relatorioDe } = require('../lib/relatorio');
const { codigoConvite } = require('../lib/empresa');

const router = express.Router();
router.use(authMiddleware);
const falha = falhaCom('Conta empresarial ainda não foi ativada no servidor. Tente mais tarde.');
const TIPOS = ['cooperativa', 'trading', 'banco', 'torrefacao', 'outro'];


async function papelDe(empresaId, usuarioId) {
  const { data } = await supabase.from('empresa_membros').select('papel')
    .eq('empresa_id', empresaId).eq('usuario_id', usuarioId).maybeSingle();
  return data?.papel || null;
}

router.get('/minhas', async (req, res) => {
  try {
    const { data, error } = await supabase.from('empresa_membros')
      .select('papel, empresa:empresas(*)').eq('usuario_id', req.usuario.id);
    if (error) throw error;
    res.json((data || []).filter((m) => m.empresa).map((m) => ({
      ...m.empresa, papel: m.papel,
      codigo_convite: m.papel === 'admin' ? codigoConvite(m.empresa.id) : undefined,
    })));
  } catch (err) {
    falha(res, err, 'Erro ao buscar suas empresas');
  }
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  const nome = texto(b.nome, 120);
  const cnpj = b.cnpj ? String(b.cnpj).replace(/\D/g, '') : null;
  if (!nome) return res.status(400).json({ error: 'Informe o nome da empresa' });
  if (cnpj && cnpj.length !== 14) return res.status(400).json({ error: 'CNPJ deve ter 14 dígitos' });
  try {
    const { data, error } = await supabase.from('empresas').insert({
      nome, tipo: TIPOS.includes(b.tipo) ? b.tipo : 'outro', cnpj, dono_id: req.usuario.id,
    }).select().single();
    if (error) throw error;
    const m = await supabase.from('empresa_membros').insert({ empresa_id: data.id, usuario_id: req.usuario.id, papel: 'admin' });
    if (m.error) throw m.error;
    res.status(201).json({ ...data, papel: 'admin', codigo_convite: codigoConvite(data.id) });
  } catch (err) {
    falha(res, err, 'Erro ao criar a empresa');
  }
});

// POST /empresas/entrar { codigo }
router.post('/entrar', async (req, res) => {
  const codigo = String(req.body?.codigo || '').trim().toUpperCase();
  if (!/^[0-9A-F]{5}-[0-9A-F]{5}$/.test(codigo)) return res.status(400).json({ error: 'Código inválido' });
  try {
    const { data, error } = await supabase.from('empresas').select('id, nome').range(0, 9999);
    if (error) throw error;
    const empresa = (data || []).find((e) => codigoConvite(e.id) === codigo);
    if (!empresa) return res.status(404).json({ error: 'Nenhuma empresa com esse código' });
    const { error: e2 } = await supabase.from('empresa_membros')
      .upsert({ empresa_id: empresa.id, usuario_id: req.usuario.id }, { onConflict: 'empresa_id,usuario_id', ignoreDuplicates: true });
    if (e2) throw e2;
    res.json({ ok: true, empresa });
  } catch (err) {
    falha(res, err, 'Erro ao entrar na empresa');
  }
});

// GET /empresas/:id/membros — qualquer membro vê quem faz parte
router.get('/:id/membros', async (req, res) => {
  try {
    if (!(await papelDe(req.params.id, req.usuario.id))) return res.status(403).json({ error: 'Sem permissão' });
    const { data, error } = await supabase.from('empresa_membros')
      .select('papel, criado_em, usuario:usuarios(id, nome, cidade, estado, tipo)').eq('empresa_id', req.params.id);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    falha(res, err, 'Erro ao buscar membros');
  }
});

// GET /empresas/:id/painel?de&ate — só administradores
router.get('/:id/painel', async (req, res) => {
  try {
    if ((await papelDe(req.params.id, req.usuario.id)) !== 'admin') return res.status(403).json({ error: 'Só administradores veem o painel' });
    const { data: membros, error } = await supabase.from('empresa_membros')
      .select('usuario:usuarios(id, nome)').eq('empresa_id', req.params.id);
    if (error) throw error;
    const pessoas = (membros || []).map((m) => m.usuario).filter(Boolean);
    const rel = await relatorioDe(pessoas.map((p) => p.id), lerPeriodo(req.query));
    const porMembro = pessoas.map((p) => {
      const v = rel.vendas.filter((x) => x.usuario_id === p.id);
      const c = rel.compras.filter((x) => x.usuario_id === p.id);
      const ativos = rel.lotes.filter((l) => l.usuario_id === p.id && l.status === 'ativo');
      return {
        id: p.id, nome: p.nome,
        lotes_ativos: ativos.length,
        sacas_ofertadas: ativos.reduce((s, l) => s + (Number(l.sacas) || 0), 0),
        sacas_vendidas: v.reduce((s, x) => s + x.sacas, 0),
        valor_vendido: v.reduce((s, x) => s + (x.total || 0), 0),
        sacas_compradas: c.reduce((s, x) => s + x.sacas, 0),
      };
    }).sort((a, b) => b.valor_vendido - a.valor_vendido);
    const nomes = new Map(pessoas.map((p) => [p.id, p.nome]));
    const comNome = (x) => ({ ...x, membro: nomes.get(x.usuario_id) || '—' });
    res.json({ ...rel, vendas: rel.vendas.map(comNome), compras: rel.compras.map(comNome), lotes: rel.lotes.map(comNome), por_membro: porMembro });
  } catch (err) {
    falha(res, err, 'Erro ao montar o painel da empresa');
  }
});

// DELETE /empresas/:id/membros/:usuarioId — administrador remove, ou a pessoa sai
router.delete('/:id/membros/:usuarioId', async (req, res) => {
  try {
    const eu = req.usuario.id;
    const alvo = req.params.usuarioId;
    const { data: empresa } = await supabase.from('empresas').select('dono_id').eq('id', req.params.id).single();
    if (!empresa) return res.status(404).json({ error: 'Empresa não encontrada' });
    if (alvo === empresa.dono_id) return res.status(400).json({ error: 'O dono não pode sair da empresa' });
    if (alvo !== eu && (await papelDe(req.params.id, eu)) !== 'admin') return res.status(403).json({ error: 'Sem permissão' });
    const { error } = await supabase.from('empresa_membros').delete().eq('empresa_id', req.params.id).eq('usuario_id', alvo);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    falha(res, err, 'Erro ao remover membro');
  }
});

// PATCH /empresas/:id/membros/:usuarioId { papel } — administrador promove/rebaixa
router.patch('/:id/membros/:usuarioId', async (req, res) => {
  const papel = req.body?.papel;
  if (!['admin', 'membro'].includes(papel)) return res.status(400).json({ error: 'Papel inválido' });
  try {
    if ((await papelDe(req.params.id, req.usuario.id)) !== 'admin') return res.status(403).json({ error: 'Sem permissão' });
    const { data: empresa } = await supabase.from('empresas').select('dono_id').eq('id', req.params.id).single();
    if (empresa?.dono_id === req.params.usuarioId && papel !== 'admin') return res.status(400).json({ error: 'O dono é sempre administrador' });
    const { error } = await supabase.from('empresa_membros').update({ papel })
      .eq('empresa_id', req.params.id).eq('usuario_id', req.params.usuarioId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    falha(res, err, 'Erro ao mudar o papel');
  }
});

// DELETE /empresas/:id — só o dono exclui a empresa (os membros saem junto)
router.delete('/:id', async (req, res) => {
  try {
    const { data: empresa } = await supabase.from('empresas').select('dono_id').eq('id', req.params.id).single();
    if (!empresa) return res.status(404).json({ error: 'Empresa não encontrada' });
    if (empresa.dono_id !== req.usuario.id) return res.status(403).json({ error: 'Só o dono pode excluir a empresa' });
    const { error } = await supabase.from('empresas').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    falha(res, err, 'Erro ao excluir a empresa');
  }
});

module.exports = router;
