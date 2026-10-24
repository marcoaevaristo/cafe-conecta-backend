// api/compartilhar.js — página pública de um lote para compartilhar (WhatsApp, LinkedIn…).
// O WhatsApp lê as tags og:* para montar a prévia; quem abre o link vai direto ao lote no app.
// Só mostra o que o catálogo já mostra a qualquer visitante (sem telefone nem e-mail).
const express = require('express');
const supabase = require('../lib/supabase');

const router = express.Router();
const APP_URL = (process.env.APP_URL || 'https://cafe-conecta-flutter.vercel.app').replace(/\/+$/, '');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (v) => (v == null ? null : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const num = (v) => Number(v || 0).toLocaleString('pt-BR');

function pagina({ titulo, descricao, imagem, destino, linhas }) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(descricao)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Café Conecta">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(descricao)}">
${imagem ? `<meta property="og:image" content="${esc(imagem)}">` : ''}
<meta property="og:url" content="${esc(destino)}">
<meta name="twitter:card" content="${imagem ? 'summary_large_image' : 'summary'}">
<meta http-equiv="refresh" content="0;url=${esc(destino)}">
<style>body{margin:0;font-family:system-ui,sans-serif;background:#2C1A0E;color:#F5EAD8;display:flex;min-height:100vh;align-items:center;justify-content:center}
main{max-width:440px;padding:28px;text-align:center}h1{color:#D4A843;font-size:22px}a{color:#1A0F08;background:#D4A843;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;margin-top:16px}
p{line-height:1.5;margin:6px 0}</style></head>
<body><main><div style="font-size:40px">☕</div><h1>${esc(titulo)}</h1>
${linhas.map((l) => `<p>${esc(l)}</p>`).join('')}
<a href="${esc(destino)}">Ver no Café Conecta</a></main>
<script>location.replace(${JSON.stringify(destino)});</script></body></html>`;
}

// GET /l/:id — link curto do lote
router.get('/l/:id', async (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=300');
  try {
    const { data: c } = await supabase
      .from('cafes')
      .select('id, tipo, classificacao, bebida, peneira, safra, quantidade_sacas, preco_saca, cidade, estado, regiao, fazenda, status, imagem_url, fotos')
      .eq('id', req.params.id)
      .single();
    if (!c) {
      return res.status(404).send(pagina({
        titulo: 'Lote não encontrado · Café Conecta', descricao: 'Veja outros lotes de café no Café Conecta.',
        destino: APP_URL, linhas: ['Este lote não está mais disponível.'],
      }));
    }
    const nome = [c.tipo, c.classificacao].filter(Boolean).join(' · ');
    const local = [c.cidade, c.estado].filter(Boolean).join('/');
    const preco = brl(c.preco_saca);
    const titulo = `${nome}${c.regiao ? ` — ${c.regiao}` : ''}`;
    const descricao = [
      `${num(c.quantidade_sacas)} sacas`,
      preco && `${preco}/saca`,
      c.bebida && `bebida ${c.bebida}`,
      c.peneira && `peneira ${c.peneira}`,
      local,
    ].filter(Boolean).join(' · ');
    const foto = (Array.isArray(c.fotos) && c.fotos[0]) || c.imagem_url || null;
    res.send(pagina({
      titulo: `${titulo} | Café Conecta`,
      descricao: c.status === 'ativo' ? descricao : `${descricao} (anúncio encerrado)`,
      imagem: foto,
      destino: `${APP_URL}/?lote=${encodeURIComponent(c.id)}`,
      linhas: [descricao, c.fazenda ? `Origem: ${c.fazenda}` : null].filter(Boolean),
    }));
  } catch (err) {
    console.error('Erro na página de compartilhamento:', err);
    res.status(500).send(pagina({ titulo: 'Café Conecta', descricao: 'Marketplace do café', destino: APP_URL, linhas: [] }));
  }
});

module.exports = router;
