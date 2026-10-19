const express = require('express');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');
const {
  propostaParaApp, statusPropostaParaDb, autorDaProposta, destinatarioDaProposta,
} = require('../lib/mapper');
const { exigirLimite } = require('../lib/planos');

const router = express.Router();

const SELECT_COMPLETO = `*, cafe:cafes(id, tipo, classificacao, cidade, estado, preco_saca), comprador:usuarios!propostas_comprador_id_fkey(id, nome, cidade), produtor:usuarios!propostas_produtor_id_fkey(id, nome, cidade)`;

// Erros do Postgres/PostgREST quando a migração de contraproposta ainda não foi aplicada
function faltaMigracao(error) {
  return error && (error.code === 'PGRST204' || error.code === '42703' || error.code === '23514');
}
const MSG_MIGRACAO = 'Contraproposta indisponível: falta aplicar a atualização do banco (migration_contraproposta.sql).';

// Junta as condições enviadas pelo app no único campo de texto livre do banco
function montarMensagem(b) {
  const partes = [
    b.condicao_pagamento && `Pagamento: ${b.condicao_pagamento}`,
    b.prazo_entrega && `Prazo de entrega: ${b.prazo_entrega}`,
    b.local_entrega && `Local de entrega: ${b.local_entrega}`,
    b.observacoes || b.mensagem,
  ].filter(Boolean);
  return partes.length ? partes.join('\n') : null;
}

// GET /propostas — propostas do usuário logado
router.get('/', authMiddleware, async (req, res) => {
  const { tipo } = req.query; // 'recebidas' | 'enviadas'
  try {
    let query = supabase
      .from('propostas')
      .select(SELECT_COMPLETO)
      .or(`comprador_id.eq.${req.usuario.id},produtor_id.eq.${req.usuario.id}`)
      .order('criado_em', { ascending: false });

    const { data, error } = await query;
    if (error) throw error;

    let lista = (data || []).map(propostaParaApp);
    if (tipo === 'recebidas') lista = lista.filter((p) => p.para_usuario_id === req.usuario.id);
    else if (tipo === 'enviadas') lista = lista.filter((p) => p.de_usuario_id === req.usuario.id);
    res.json(lista);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar propostas' });
  }
});

// POST /propostas — nova proposta ou contraproposta (com contraproposta_de)
router.post('/', authMiddleware, async (req, res) => {
  const b = req.body;
  const eu = req.usuario.id;
  const valor_proposto = b.valor_proposto ?? b.preco_ofertado;
  const mensagem = montarMensagem(b);

  try {
    // ── Contraproposta ──────────────────────────────────────
    if (b.contraproposta_de) {
      const { data: original } = await supabase
        .from('propostas').select('*').eq('id', b.contraproposta_de).single();

      if (!original) return res.status(404).json({ error: 'Proposta original não encontrada' });
      if (original.status !== 'pendente') {
        return res.status(400).json({ error: 'Só é possível contrapropor uma proposta aguardando resposta' });
      }
      if (destinatarioDaProposta(original) !== eu) {
        return res.status(403).json({ error: 'Só quem recebeu a proposta pode contrapropor' });
      }
      if (!valor_proposto) return res.status(400).json({ error: 'Informe o valor da contraproposta' });

      const { data, error } = await supabase
        .from('propostas')
        .insert({
          cafe_id: original.cafe_id,
          comprador_id: original.comprador_id,
          produtor_id: original.produtor_id,
          autor_id: eu,
          contraproposta_de: original.id,
          valor_proposto,
          quantidade_sacas: b.quantidade_sacas ?? original.quantidade_sacas,
          mensagem,
        })
        .select()
        .single();

      if (faltaMigracao(error)) return res.status(503).json({ error: MSG_MIGRACAO });
      if (error) throw error;

      // A original fica encerrada como "contraproposta"
      const { error: errStatus } = await supabase
        .from('propostas')
        .update({ status: 'contraproposta', atualizado_em: new Date().toISOString() })
        .eq('id', original.id);
      if (errStatus) throw errStatus;

      return res.status(201).json(propostaParaApp(data));
    }

    // ── Proposta nova (comprador → dono do lote) ─────────────
    const { cafe_id, quantidade_sacas } = b;
    if (!cafe_id || !valor_proposto || !quantidade_sacas) {
      return res.status(400).json({ error: 'Lote, valor e quantidade de sacas são obrigatórios' });
    }

    const { data: cafe } = await supabase
      .from('cafes').select('usuario_id, status').eq('id', cafe_id).single();

    if (!cafe) return res.status(404).json({ error: 'Lote não encontrado' });
    if (cafe.status !== 'ativo') return res.status(400).json({ error: 'Lote não está ativo' });
    if (cafe.usuario_id === eu) return res.status(400).json({ error: 'Não pode fazer proposta no próprio lote' });

    if (!(await exigirLimite(req, res, 'propostas_mes'))) return;

    const { data, error } = await supabase
      .from('propostas')
      .insert({
        cafe_id, comprador_id: eu,
        produtor_id: cafe.usuario_id,
        valor_proposto, quantidade_sacas, mensagem,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(propostaParaApp(data));
  } catch (err) {
    console.error('Erro ao criar proposta:', err);
    res.status(500).json({ error: 'Erro ao enviar proposta' });
  }
});

// PUT/PATCH /propostas/:id/status — aceitar / recusar / contraproposta / cancelar
async function atualizarStatus(req, res) {
  const status = statusPropostaParaDb(req.body.status);
  if (!['aceita', 'recusada', 'cancelada', 'contraproposta'].includes(status)) {
    return res.status(400).json({ error: 'Status inválido' });
  }

  try {
    const { data: proposta } = await supabase
      .from('propostas').select('*').eq('id', req.params.id).single();

    if (!proposta) return res.status(404).json({ error: 'Proposta não encontrada' });

    // Quem recebeu decide; quem fez pode cancelar
    if (status === 'cancelada' && autorDaProposta(proposta) !== req.usuario.id) {
      return res.status(403).json({ error: 'Sem permissão' });
    }
    if (status !== 'cancelada' && destinatarioDaProposta(proposta) !== req.usuario.id) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    // O POST de contraproposta já marca a original; repetir é inofensivo
    if (proposta.status === status) return res.json(propostaParaApp(proposta));
    if (proposta.status !== 'pendente') {
      return res.status(400).json({ error: 'Esta proposta já foi respondida' });
    }

    const { data, error } = await supabase
      .from('propostas')
      .update({ status, atualizado_em: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (status === 'contraproposta' && faltaMigracao(error)) {
      return res.status(503).json({ error: MSG_MIGRACAO });
    }
    if (error) throw error;
    res.json(propostaParaApp(data));
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar proposta' });
  }
}

router.put('/:id/status', authMiddleware, atualizarStatus);
router.patch('/:id/status', authMiddleware, atualizarStatus);

module.exports = router;
