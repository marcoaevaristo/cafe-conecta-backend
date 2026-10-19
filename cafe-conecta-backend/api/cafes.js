const express = require('express');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');
const { exigirLimite, planoDoUsuario, planoEfetivo, avaliarLimite } = require('../lib/planos');
const { lerImagemBase64 } = require('../lib/imagem');

const BUCKET_FOTOS = 'cafe-fotos';
const MSG_MIGRACAO_FOTOS = 'Fotos indisponíveis: falta aplicar a atualização do banco (migration_fotos_laudos.sql).';

// Lotes de quem tem plano Premium aparecem em destaque (benefício "Destaque na busca").
// Também respeita o campo destaque marcado manualmente no banco.
function marcarDestaque(cafe) {
  const dono = cafe.usuario || {};
  const destaque = cafe.destaque === true || planoEfetivo(dono) === 'premium';
  const { plano, plano_valido_ate, ...usuarioPublico } = dono;
  return { ...cafe, destaque, usuario: cafe.usuario ? usuarioPublico : cafe.usuario };
}

const router = express.Router();

// GET /cafes — listar lotes disponíveis
router.get('/', async (req, res) => {
  const { tipo, classificacao, score_minimo, regiao, usuario_id, status, busca } = req.query;

  try {
    let query = supabase
      .from('cafes')
      .select(`*, usuario:usuarios(id, nome, cidade, estado, verificado, avatar_url, plano, plano_valido_ate)`)
      .order('criado_em', { ascending: false });

    if (usuario_id) {
      query = query.eq('usuario_id', usuario_id);
      if (status) query = query.eq('status', status);
    } else {
      query = query.eq('status', 'ativo');
    }

    if (tipo) query = query.eq('tipo', tipo);
    if (classificacao) query = query.eq('classificacao', classificacao);
    if (regiao) query = query.ilike('regiao', `%${regiao}%`);
    if (score_minimo) query = query.gte('score', parseInt(score_minimo));
    if (busca) query = query.or(`tipo.ilike.%${busca}%,classificacao.ilike.%${busca}%,cidade.ilike.%${busca}%,fazenda.ilike.%${busca}%`);

    const { data, error } = await query;
    if (error) throw error;

    // Destaques primeiro; dentro de cada grupo, mantém a ordem (mais recentes antes)
    const lista = (data || []).map(marcarDestaque);
    lista.sort((a, b) => Number(b.destaque) - Number(a.destaque));
    res.json(lista);
  } catch (err) {
    console.error('Erro ao listar cafés:', err);
    res.status(500).json({ error: 'Erro ao buscar lotes' });
  }
});

// GET /cafes/:id
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('cafes')
      .select(`*, usuario:usuarios(id, nome, cidade, estado, verificado, avatar_url, telefone)`)
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Lote não encontrado' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar lote' });
  }
});

// POST /cafes — criar lote (requer auth)
router.post('/', authMiddleware, async (req, res) => {
  const {
    tipo, classificacao,
    quantidade_sacas, quantidade, // aceita ambos
    preco_saca,
    cidade, estado, regiao, fazenda, score, descricao,
    bebida, peneira, safra, status,
  } = req.body;

  const qtd = quantidade_sacas ?? quantidade;

  if (!tipo || !classificacao || !qtd || !cidade) {
    return res.status(400).json({ error: 'Campos obrigatórios: tipo, classificação, quantidade e cidade' });
  }

  try {
    if ((status ?? 'ativo') === 'ativo' && !(await exigirLimite(req, res, 'lotes_ativos'))) return;

    const { data, error } = await supabase
      .from('cafes')
      .insert({
        usuario_id: req.usuario.id,
        tipo, classificacao,
        quantidade_sacas: qtd,
        preco_saca: preco_saca ?? null,
        cidade,
        estado: estado ?? null,
        regiao: regiao ?? null,
        fazenda: fazenda ?? null,
        score: score ?? null,
        descricao: descricao ?? null,
        bebida: bebida ?? null,
        peneira: peneira ?? null,
        safra: safra ?? null,
        status: status ?? 'ativo',
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('Erro ao criar lote:', err);
    res.status(500).json({ error: 'Erro ao criar lote' });
  }
});

// PUT /cafes/:id
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { data: cafe } = await supabase
      .from('cafes').select('usuario_id, status').eq('id', req.params.id).single();

    if (!cafe || cafe.usuario_id !== req.usuario.id) {
      return res.status(403).json({ error: 'Sem permissão' });
    }
    if (req.body.status === 'ativo' && cafe.status !== 'ativo'
        && !(await exigirLimite(req, res, 'lotes_ativos'))) return;

    const { tipo, classificacao, quantidade_sacas, preco_saca, cidade, estado, regiao, fazenda, score, descricao, status, bebida, peneira, safra, lat, lng } = req.body;

    const { data, error } = await supabase
      .from('cafes')
      .update({ tipo, classificacao, quantidade_sacas, preco_saca, cidade, estado, regiao, fazenda, score, descricao, status, bebida, peneira, safra, lat, lng })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar lote' });
  }
});

// PATCH /cafes/:id/status — usado pelo app (ativo | pausado | encerrado)
router.patch('/:id/status', authMiddleware, async (req, res) => {
  const { status } = req.body;
  if (!['ativo', 'pausado', 'encerrado'].includes(status)) {
    return res.status(400).json({ error: 'Status inválido' });
  }
  try {
    const { data: cafe } = await supabase
      .from('cafes').select('usuario_id, status').eq('id', req.params.id).single();

    if (!cafe || cafe.usuario_id !== req.usuario.id) {
      return res.status(403).json({ error: 'Sem permissão' });
    }
    if (status === 'ativo' && cafe.status !== 'ativo'
        && !(await exigirLimite(req, res, 'lotes_ativos'))) return;

    const { data, error } = await supabase
      .from('cafes')
      .update({ status })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar status do lote' });
  }
});

// POST /cafes/:id/fotos — adiciona uma foto ao lote. Body: { imagem: base64, content_type }
router.post('/:id/fotos', authMiddleware, async (req, res) => {
  try {
    const { data: cafe, error: errCafe } = await supabase
      .from('cafes').select('*').eq('id', req.params.id).single();
    if (errCafe || !cafe) return res.status(404).json({ error: 'Lote não encontrado' });
    if (cafe.usuario_id !== req.usuario.id) return res.status(403).json({ error: 'Sem permissão' });
    if (!('fotos' in cafe)) return res.status(503).json({ error: MSG_MIGRACAO_FOTOS });

    const fotos = cafe.fotos || [];
    const plano = await planoDoUsuario(req.usuario.id);
    const limite = avaliarLimite(plano, 'fotos_por_lote', fotos.length);
    if (!limite.permitido) return res.status(403).json(limite.resposta);

    const img = lerImagemBase64(req.body.imagem, req.body.content_type);
    if (img.erro) return res.status(400).json({ error: img.erro });

    const caminho = `${cafe.id}/${Date.now()}.${img.extensao}`;
    const { error: errUpload } = await supabase.storage
      .from(BUCKET_FOTOS).upload(caminho, img.buffer, { contentType: img.tipo, upsert: false });
    if (errUpload) {
      console.error('Erro no upload da foto:', errUpload);
      return res.status(503).json({ error: MSG_MIGRACAO_FOTOS });
    }
    const { data: pub } = supabase.storage.from(BUCKET_FOTOS).getPublicUrl(caminho);

    const novasFotos = [...fotos, pub.publicUrl];
    const { data, error } = await supabase
      .from('cafes')
      .update({ fotos: novasFotos, imagem_url: cafe.imagem_url || pub.publicUrl })
      .eq('id', cafe.id)
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('Erro ao adicionar foto:', err);
    res.status(500).json({ error: 'Erro ao adicionar foto' });
  }
});

// DELETE /cafes/:id/fotos — remove uma foto. Body: { url }
router.delete('/:id/fotos', authMiddleware, async (req, res) => {
  try {
    const { data: cafe } = await supabase
      .from('cafes').select('*').eq('id', req.params.id).single();
    if (!cafe) return res.status(404).json({ error: 'Lote não encontrado' });
    if (cafe.usuario_id !== req.usuario.id) return res.status(403).json({ error: 'Sem permissão' });

    const url = req.body.url;
    const fotos = (cafe.fotos || []).filter((f) => f !== url);
    const marcador = `/${BUCKET_FOTOS}/`;
    if (url && url.includes(marcador)) {
      await supabase.storage.from(BUCKET_FOTOS).remove([url.split(marcador)[1]]);
    }

    const { data, error } = await supabase
      .from('cafes')
      .update({ fotos, imagem_url: cafe.imagem_url === url ? (fotos[0] || null) : cafe.imagem_url })
      .eq('id', cafe.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover foto' });
  }
});

// DELETE /cafes/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { data: cafe } = await supabase
      .from('cafes').select('usuario_id').eq('id', req.params.id).single();

    if (!cafe || cafe.usuario_id !== req.usuario.id) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    await supabase.from('cafes').delete().eq('id', req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir lote' });
  }
});

module.exports = router;
