// api/pedidos.js — Pedidos de compra: o comprador anuncia o que procura e os vendedores ofertam.
const express = require('express');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');
const avisos = require('../lib/notificacoes');

const router = express.Router();
router.use(authMiddleware);

const MSG_SEM_TABELA = 'Pedidos de compra ainda não foram ativados no servidor. Tente mais tarde.';
const semTabela = (e) => e && ['42P01', 'PGRST205', 'PGRST200'].includes(e.code);
const USUARIO_PUBLICO = 'id, nome, cidade, estado, verificado';

function falha(res, err, msg) {
  if (semTabela(err)) return res.status(503).json({ error: MSG_SEM_TABELA });
  console.error(msg, err);
  return res.status(500).json({ error: msg });
}

const texto = (v, max = 300) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
const numero = (v) => (v == null || v === '' ? null : Number(v));

// GET /pedidos — pedidos abertos de outras pessoas (filtros: tipo, regiao)
router.get('/', async (req, res) => {
  try {
    let q = supabase
      .from('pedidos_compra')
      .select(`*, usuario:usuarios(${USUARIO_PUBLICO}), ofertas:ofertas_pedido(count)`)
      .eq('status', 'aberto')
      .order('criado_em', { ascending: false })
      .limit(100);
    if (req.query.tipo) q = q.eq('tipo', req.query.tipo);
    if (req.query.regiao) q = q.eq('regiao', req.query.regiao);
    const { data, error } = await q;
    if (error) throw error;
    const hoje = new Date().toISOString().slice(0, 10);
    res.json((data || [])
      .filter((p) => !p.prazo || p.prazo >= hoje)
      .map((p) => ({ ...p, total_ofertas: p.ofertas?.[0]?.count ?? 0, ofertas: undefined, meu: p.usuario_id === req.usuario.id })));
  } catch (err) {
    falha(res, err, 'Erro ao buscar pedidos de compra');
  }
});

// GET /pedidos/meus — meus pedidos com as ofertas recebidas
router.get('/meus', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('pedidos_compra')
      .select(`*, ofertas:ofertas_pedido(*, vendedor:usuarios(${USUARIO_PUBLICO}, telefone), cafe:cafes(id, tipo, classificacao, bebida, peneira, fazenda, cidade))`)
      .eq('usuario_id', req.usuario.id)
      .order('criado_em', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    falha(res, err, 'Erro ao buscar seus pedidos');
  }
});

// GET /pedidos/minhas-ofertas — ofertas que eu fiz
router.get('/minhas-ofertas', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('ofertas_pedido')
      .select(`*, pedido:pedidos_compra(*, usuario:usuarios(${USUARIO_PUBLICO}))`)
      .eq('usuario_id', req.usuario.id)
      .order('criado_em', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    falha(res, err, 'Erro ao buscar suas ofertas');
  }
});

// POST /pedidos — publicar um pedido de compra
router.post('/', async (req, res) => {
  if (req.usuario.tipo === 'produtor') {
    return res.status(403).json({ error: 'Contas de produtor vendem; pedidos de compra são para compradores e corretores.' });
  }
  const b = req.body;
  const quantidade = parseInt(b.quantidade_sacas, 10);
  const preco = numero(b.preco_maximo);
  if (!texto(b.tipo, 40) || !Number.isFinite(quantidade) || quantidade <= 0) {
    return res.status(400).json({ error: 'Informe o tipo de café e a quantidade de sacas' });
  }
  if (preco != null && (!Number.isFinite(preco) || preco <= 0)) {
    return res.status(400).json({ error: 'Preço máximo inválido' });
  }
  const prazo = texto(b.prazo, 10);
  if (prazo && !/^\d{4}-\d{2}-\d{2}$/.test(prazo)) return res.status(400).json({ error: 'Prazo inválido' });
  try {
    const { data, error } = await supabase
      .from('pedidos_compra')
      .insert({
        usuario_id: req.usuario.id,
        tipo: texto(b.tipo, 40),
        classificacao: texto(b.classificacao, 40),
        bebida: texto(b.bebida, 40),
        regiao: texto(b.regiao, 60),
        quantidade_sacas: quantidade,
        preco_maximo: preco,
        prazo,
        observacoes: texto(b.observacoes, 500),
      })
      .select()
      .single();
    if (error) throw error;
    await avisos.pedidoParaVendedores(data);
    res.status(201).json(data);
  } catch (err) {
    falha(res, err, 'Erro ao publicar o pedido de compra');
  }
});

// PATCH /pedidos/:id — o dono encerra ou marca como atendido
router.patch('/:id', async (req, res) => {
  const { status } = req.body;
  if (!['aberto', 'atendido', 'encerrado'].includes(status)) return res.status(400).json({ error: 'Status inválido' });
  try {
    const { data: p } = await supabase.from('pedidos_compra').select('usuario_id').eq('id', req.params.id).single();
    if (!p || p.usuario_id !== req.usuario.id) return res.status(403).json({ error: 'Sem permissão' });
    const { data, error } = await supabase
      .from('pedidos_compra').update({ status }).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    falha(res, err, 'Erro ao atualizar o pedido');
  }
});

// POST /pedidos/:id/ofertas — um vendedor oferta café para o pedido
router.post('/:id/ofertas', async (req, res) => {
  const b = req.body;
  const preco = numero(b.preco_saca);
  const quantidade = parseInt(b.quantidade_sacas, 10);
  if (!Number.isFinite(preco) || preco <= 0 || !Number.isFinite(quantidade) || quantidade <= 0) {
    return res.status(400).json({ error: 'Informe o preço por saca e a quantidade' });
  }
  try {
    const { data: pedido } = await supabase.from('pedidos_compra').select('*').eq('id', req.params.id).single();
    if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });
    if (pedido.status !== 'aberto') return res.status(400).json({ error: 'Este pedido não está mais aberto' });
    if (pedido.usuario_id === req.usuario.id) return res.status(400).json({ error: 'Você não pode ofertar no próprio pedido' });

    let cafeId = null;
    if (b.cafe_id) {
      const { data: cafe } = await supabase.from('cafes').select('id, usuario_id').eq('id', b.cafe_id).single();
      if (!cafe || cafe.usuario_id !== req.usuario.id) return res.status(400).json({ error: 'Escolha um lote seu' });
      cafeId = cafe.id;
    }
    const { data, error } = await supabase
      .from('ofertas_pedido')
      .insert({
        pedido_id: pedido.id, usuario_id: req.usuario.id, cafe_id: cafeId,
        preco_saca: preco, quantidade_sacas: quantidade, mensagem: texto(b.mensagem, 500),
      })
      .select()
      .single();
    if (error) throw error;
    await avisos.novaOfertaPedido({ oferta: data, pedido });
    res.status(201).json(data);
  } catch (err) {
    falha(res, err, 'Erro ao enviar a oferta');
  }
});

// PATCH /pedidos/ofertas/:id — o dono do pedido aceita ou recusa a oferta
router.patch('/ofertas/:id', async (req, res) => {
  const { status } = req.body;
  if (!['aceita', 'recusada'].includes(status)) return res.status(400).json({ error: 'Status inválido' });
  try {
    const { data: oferta } = await supabase
      .from('ofertas_pedido').select('*, pedido:pedidos_compra(*)').eq('id', req.params.id).single();
    if (!oferta) return res.status(404).json({ error: 'Oferta não encontrada' });
    if (oferta.pedido?.usuario_id !== req.usuario.id) return res.status(403).json({ error: 'Sem permissão' });
    if (oferta.status !== 'enviada') return res.status(400).json({ error: 'Esta oferta já foi respondida' });
    const { data, error } = await supabase
      .from('ofertas_pedido').update({ status }).eq('id', oferta.id).select().single();
    if (error) throw error;
    await avisos.respostaOfertaPedido({ oferta: data, pedido: oferta.pedido, status });
    res.json(data);
  } catch (err) {
    falha(res, err, 'Erro ao responder a oferta');
  }
});

module.exports = router;
