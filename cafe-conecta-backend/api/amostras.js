// api/amostras.js — pedido e acompanhamento de amostras de café.
// Fluxo: solicitada → enviada (vendedor) → recebida → avaliada (quem pediu).
// O vendedor pode recusar; quem pediu pode cancelar enquanto não foi enviada.
const express = require('express');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');
const avisos = require('../lib/notificacoes');

const router = express.Router();
router.use(authMiddleware);

const MSG_SEM_TABELA = 'Amostras ainda não foram ativadas no servidor. Tente mais tarde.';
const semTabela = (e) => e && ['42P01', 'PGRST205', 'PGRST200'].includes(e.code);
const texto = (v, max = 300) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));

function falha(res, err, msg) {
  if (semTabela(err)) return res.status(503).json({ error: MSG_SEM_TABELA });
  console.error(msg, err);
  return res.status(500).json({ error: msg });
}

const SELECT = `*, cafe:cafes(id, tipo, classificacao, bebida, peneira, fazenda, cidade, estado),
  solicitante:usuarios!amostras_solicitante_id_fkey(id, nome, cidade, estado, telefone),
  vendedor:usuarios!amostras_vendedor_id_fkey(id, nome, cidade, estado, telefone)`;

// GET /amostras — as que pedi e as que recebi pedido
router.get('/', async (req, res) => {
  try {
    const eu = req.usuario.id;
    const { data, error } = await supabase
      .from('amostras').select(SELECT)
      .or(`solicitante_id.eq.${eu},vendedor_id.eq.${eu}`)
      .order('criado_em', { ascending: false });
    if (error) throw error;
    res.json((data || []).map((a) => ({ ...a, souVendedor: a.vendedor_id === eu })));
  } catch (err) {
    falha(res, err, 'Erro ao buscar amostras');
  }
});

// GET /amostras/lote/:cafeId — resultados de prova já registrados para um lote (públicos)
router.get('/lote/:cafeId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('amostras').select('nota, bebida_resultado, defeitos, atualizado_em')
      .eq('cafe_id', req.params.cafeId).eq('status', 'avaliada')
      .order('atualizado_em', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    falha(res, err, 'Erro ao buscar provas do lote');
  }
});

// POST /amostras — pedir amostra de um lote. Body: { cafe_id, endereco, observacoes }
router.post('/', async (req, res) => {
  const endereco = texto(req.body.endereco, 400);
  if (!req.body.cafe_id || !endereco) return res.status(400).json({ error: 'Informe o lote e o endereço de entrega da amostra' });
  try {
    const { data: cafe } = await supabase.from('cafes').select('id, usuario_id, status').eq('id', req.body.cafe_id).single();
    if (!cafe) return res.status(404).json({ error: 'Lote não encontrado' });
    if (cafe.usuario_id === req.usuario.id) return res.status(400).json({ error: 'Não é possível pedir amostra do próprio lote' });
    if (cafe.status !== 'ativo') return res.status(400).json({ error: 'Este lote não está ativo' });

    const { data: aberta } = await supabase
      .from('amostras').select('id').eq('cafe_id', cafe.id).eq('solicitante_id', req.usuario.id)
      .in('status', ['solicitada', 'enviada']).limit(1);
    if (aberta?.length) return res.status(400).json({ error: 'Você já tem um pedido de amostra em andamento para este lote' });

    const { data, error } = await supabase
      .from('amostras')
      .insert({
        cafe_id: cafe.id, solicitante_id: req.usuario.id, vendedor_id: cafe.usuario_id,
        endereco, observacoes: texto(req.body.observacoes, 500),
      })
      .select().single();
    if (error) throw error;
    await avisos.eventoAmostra({ amostra: data, autorId: req.usuario.id, paraId: cafe.usuario_id });
    res.status(201).json(data);
  } catch (err) {
    falha(res, err, 'Erro ao pedir amostra');
  }
});

// PATCH /amostras/:id — avança o status
// vendedor: enviada (+codigo_rastreio) | recusada
// solicitante: recebida | avaliada (+nota, bebida_resultado, defeitos, comentario) | cancelada
router.patch('/:id', async (req, res) => {
  const { status } = req.body;
  try {
    const { data: a } = await supabase.from('amostras').select('*').eq('id', req.params.id).single();
    if (!a) return res.status(404).json({ error: 'Amostra não encontrada' });
    const eu = req.usuario.id;
    const souVendedor = a.vendedor_id === eu;
    const souSolicitante = a.solicitante_id === eu;
    if (!souVendedor && !souSolicitante) return res.status(403).json({ error: 'Sem permissão' });

    const permitido = {
      enviada: souVendedor && a.status === 'solicitada',
      recusada: souVendedor && a.status === 'solicitada',
      cancelada: souSolicitante && a.status === 'solicitada',
      recebida: souSolicitante && a.status === 'enviada',
      avaliada: souSolicitante && ['enviada', 'recebida'].includes(a.status),
    };
    if (!permitido[status]) return res.status(400).json({ error: 'Essa mudança não é possível agora' });

    const mudancas = { status, atualizado_em: new Date().toISOString() };
    if (status === 'enviada') mudancas.codigo_rastreio = texto(req.body.codigo_rastreio, 60);
    if (status === 'avaliada') {
      const nota = req.body.nota == null || req.body.nota === '' ? null : Number(req.body.nota);
      if (nota != null && (!Number.isFinite(nota) || nota < 0 || nota > 100)) {
        return res.status(400).json({ error: 'Nota deve ficar entre 0 e 100' });
      }
      const defeitos = req.body.defeitos == null || req.body.defeitos === '' ? null : parseInt(req.body.defeitos, 10);
      mudancas.nota = nota;
      mudancas.bebida_resultado = texto(req.body.bebida_resultado, 40);
      mudancas.defeitos = Number.isFinite(defeitos) && defeitos >= 0 ? defeitos : null;
      mudancas.comentario = texto(req.body.comentario, 600);
    }
    const { data, error } = await supabase.from('amostras').update(mudancas).eq('id', a.id).select().single();
    if (error) throw error;
    await avisos.eventoAmostra({ amostra: data, autorId: eu, paraId: souVendedor ? a.solicitante_id : a.vendedor_id });
    res.json(data);
  } catch (err) {
    falha(res, err, 'Erro ao atualizar a amostra');
  }
});

module.exports = router;
