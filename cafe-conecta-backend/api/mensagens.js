const express = require('express');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');
const { mensagemParaApp } = require('../lib/mapper');

const avisos = require('../lib/notificacoes');
const router = express.Router();

const SELECT_COM_USUARIOS = `*, remetente:usuarios!mensagens_remetente_id_fkey(id, nome, avatar_url, verificado), destinatario:usuarios!mensagens_destinatario_id_fkey(id, nome, avatar_url, verificado)`;

// GET /mensagens — todas as mensagens do usuário
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('mensagens')
      .select(SELECT_COM_USUARIOS)
      .or(`remetente_id.eq.${req.usuario.id},destinatario_id.eq.${req.usuario.id}`)
      .order('criado_em', { ascending: false });

    if (error) throw error;
    res.json((data || []).map(mensagemParaApp));
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar mensagens' });
  }
});

// GET /mensagens/conversas — uma linha por contato, com a última mensagem
router.get('/conversas', authMiddleware, async (req, res) => {
  const eu = req.usuario.id;
  try {
    const { data, error } = await supabase
      .from('mensagens')
      .select(SELECT_COM_USUARIOS)
      .or(`remetente_id.eq.${eu},destinatario_id.eq.${eu}`)
      .order('criado_em', { ascending: false });

    if (error) throw error;

    const conversas = new Map();
    for (const m of data || []) {
      const souRemetente = m.remetente_id === eu;
      const contatoId = souRemetente ? m.destinatario_id : m.remetente_id;
      const contato = souRemetente ? m.destinatario : m.remetente;
      const recebidaNaoLida = !souRemetente && !m.lida;

      if (!conversas.has(contatoId)) {
        // Primeira ocorrência = mensagem mais recente (ordem decrescente)
        conversas.set(contatoId, {
          contato_id: contatoId,
          contato_nome: contato?.nome ?? 'Usuário',
          contato_empresa: null,
          contato_verificado: contato?.verificado ? 1 : 0,
          ultima_mensagem: m.conteudo,
          ultima_data: m.criado_em,
          de_usuario_id: m.remetente_id,
          lida: m.lida ? 1 : 0,
          nao_lidas: 0,
        });
      }
      if (recebidaNaoLida) conversas.get(contatoId).nao_lidas += 1;
    }

    res.json([...conversas.values()]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar conversas' });
  }
});

// GET /mensagens/nao-lidas — contagem
router.get('/nao-lidas', authMiddleware, async (req, res) => {
  try {
    const { count } = await supabase
      .from('mensagens')
      .select('id', { count: 'exact', head: true })
      .eq('destinatario_id', req.usuario.id)
      .eq('lida', false);

    const total = count || 0;
    res.json({ total, count: total });
  } catch (err) {
    res.json({ total: 0, count: 0 });
  }
});

// PUT /mensagens/lidas/:outro_usuario_id — marcar como lidas
router.put('/lidas/:outro_usuario_id', authMiddleware, async (req, res) => {
  try {
    await supabase
      .from('mensagens')
      .update({ lida: true })
      .eq('destinatario_id', req.usuario.id)
      .eq('remetente_id', req.params.outro_usuario_id);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao marcar mensagens' });
  }
});

// GET /mensagens/:contatoId — conversa com um contato (marca as recebidas como lidas)
router.get('/:contatoId', authMiddleware, async (req, res) => {
  const eu = req.usuario.id;
  const outro = req.params.contatoId;
  try {
    const { data, error } = await supabase
      .from('mensagens')
      .select(SELECT_COM_USUARIOS)
      .or(`and(remetente_id.eq.${eu},destinatario_id.eq.${outro}),and(remetente_id.eq.${outro},destinatario_id.eq.${eu})`)
      .order('criado_em', { ascending: true });

    if (error) throw error;

    await supabase
      .from('mensagens')
      .update({ lida: true })
      .eq('destinatario_id', eu)
      .eq('remetente_id', outro)
      .eq('lida', false);

    res.json((data || []).map(mensagemParaApp));
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar conversa' });
  }
});

// POST /mensagens — aceita o formato do banco e o do app
router.post('/', authMiddleware, async (req, res) => {
  const destinatario_id = req.body.destinatario_id ?? req.body.para_usuario_id;
  const conteudo = req.body.conteudo ?? req.body.texto;
  const { proposta_id } = req.body;

  if (!destinatario_id || !conteudo) {
    return res.status(400).json({ error: 'Destinatário e texto são obrigatórios' });
  }
  if (destinatario_id === req.usuario.id) {
    return res.status(400).json({ error: 'Não é possível enviar mensagem para si mesmo' });
  }

  try {
    const { data, error } = await supabase
      .from('mensagens')
      .insert({ remetente_id: req.usuario.id, destinatario_id, conteudo, proposta_id })
      .select()
      .single();

    if (error) throw error;
    await avisos.novaMensagem({ mensagem: data });
    res.status(201).json(mensagemParaApp(data));
  } catch (err) {
    res.status(500).json({ error: 'Erro ao enviar mensagem' });
  }
});

module.exports = router;
