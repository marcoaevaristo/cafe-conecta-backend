// api/ia.js — Classificação de café por IA (Claude, com visão) e laudo digital.
// A chave fica só no servidor: defina ANTHROPIC_API_KEY nas variáveis do Vercel.
const express = require('express');
const axios = require('axios');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');
const { exigirLimite } = require('../lib/planos');
const { lerImagemBase64 } = require('../lib/imagem');

const iaRouter = express.Router();
const laudosRouter = express.Router();

const MODELO = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const MSG_MIGRACAO = 'Laudos indisponíveis: falta aplicar a atualização do banco (migration_fotos_laudos.sql).';

const PROMPT = `Você é um classificador de café certificado no Brasil (padrão COB / Instrução Normativa MAPA nº 8/2003).
Analise a foto de uma amostra de grãos de café e responda SOMENTE com um objeto JSON válido, sem texto antes ou depois, com estas chaves:
{
  "tipo": "Arábica" | "Conilon" | "Robusta",
  "classificacao": "Tipo 2" | "Tipo 3" | "Tipo 4" | "Tipo 5" | "Tipo 6" | "Tipo 7" | "Tipo 8",
  "peneira": string (ex.: "17/18"),
  "bebida": "Estritamente Mole" | "Mole" | "Apenas Mole" | "Dura" | "Riada" | "Rio",
  "score": número inteiro de 0 a 100 (escala SCA estimada),
  "defeitos_300g": número inteiro estimado de defeitos em 300 g,
  "observacoes": string curta com as características visuais relevantes,
  "confianca": "Alta" | "Média" | "Baixa"
}
Se a imagem não mostrar grãos de café, use "confianca": "Baixa" e explique em "observacoes".
A bebida não pode ser determinada só pela aparência: estime e deixe isso claro em "observacoes".`;

function extrairJson(texto) {
  const inicio = texto.indexOf('{');
  const fim = texto.lastIndexOf('}');
  if (inicio < 0 || fim < inicio) throw new Error('Resposta da IA sem JSON');
  return JSON.parse(texto.slice(inicio, fim + 1));
}

function textoDoLaudo(r) {
  return [
    `Tipo: ${r.tipo ?? '-'}`,
    `Classificação: ${r.classificacao ?? '-'}`,
    `Peneira: ${r.peneira ?? '-'}`,
    `Bebida (estimada): ${r.bebida ?? '-'}`,
    `Score de qualidade: ${r.score ?? '-'} pontos`,
    `Defeitos estimados: ${r.defeitos_300g ?? '-'} em 300 g`,
    `Confiança da análise: ${r.confianca ?? '-'}`,
    '',
    `Observações: ${r.observacoes ?? '-'}`,
  ].join('\n');
}

function urlPublica(req, id) {
  const base = process.env.API_URL || `https://${req.headers.host}`;
  return `${base}/laudos/${id}`;
}

// POST /ia/laudo — Body: { imagem: base64, content_type, cafe_id? }
iaRouter.post('/laudo', authMiddleware, async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({
        error: 'A classificação por IA ainda não foi configurada no servidor (falta a chave ANTHROPIC_API_KEY).',
      });
    }

    const img = lerImagemBase64(req.body.imagem, req.body.content_type);
    if (img.erro) return res.status(400).json({ error: img.erro });

    // Também confirma que a tabela de laudos existe (a contagem falha se não existir)
    try {
      if (!(await exigirLimite(req, res, 'laudos_mes'))) return;
    } catch (e) {
      return res.status(503).json({ error: MSG_MIGRACAO });
    }

    const resposta = await axios.post('https://api.anthropic.com/v1/messages', {
      model: MODELO,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: img.tipo, data: img.base64 } },
          { type: 'text', text: PROMPT },
        ],
      }],
    }, {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: 55000,
    });

    const texto = (resposta.data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    const resultado = extrairJson(texto);
    resultado.texto = textoDoLaudo(resultado);

    const { data: laudo, error } = await supabase
      .from('laudos')
      .insert({ usuario_id: req.usuario.id, cafe_id: req.body.cafe_id || null, resultado })
      .select()
      .single();
    if (error) {
      console.error('Erro ao salvar laudo:', error);
      return res.status(503).json({ error: MSG_MIGRACAO });
    }

    res.status(201).json({ id: laudo.id, criado_em: laudo.criado_em, url: urlPublica(req, laudo.id), ...resultado });
  } catch (err) {
    const detalhe = err.response?.data?.error?.message || err.message;
    console.error('Erro na classificação por IA:', detalhe);
    res.status(502).json({ error: 'Não foi possível analisar a imagem agora. Tente novamente em instantes.' });
  }
});

// GET /laudos/:id — página pública do laudo (destino do QR Code de rastreabilidade)
laudosRouter.get('/:id', async (req, res) => {
  const { data: laudo } = await supabase
    .from('laudos')
    .select('id, criado_em, resultado, usuario:usuarios(nome)')
    .eq('id', req.params.id)
    .single();

  if (!laudo) return res.status(404).send('Laudo não encontrado');
  if ((req.headers.accept || '').includes('application/json')) return res.json(laudo);

  const esc = (s) => String(s ?? '-').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r = laudo.resultado || {};
  const data = new Date(laudo.criado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const linha = (k, v) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`;
  res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Laudo ${esc(laudo.id.slice(0, 8))} · Café Conecta</title>
<style>
body{margin:0;font-family:system-ui,sans-serif;background:#f5f0e8;color:#2b1d14}
main{max-width:560px;margin:0 auto;padding:24px 16px}
h1{font-size:20px;margin:0 0 4px}.sub{color:#7a6552;font-size:13px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden}
th,td{padding:10px 12px;border-bottom:1px solid #eee;text-align:left;font-size:14px;vertical-align:top}
th{width:42%;color:#7a6552;font-weight:600}.obs{background:#fff;border-radius:12px;padding:12px;margin-top:12px;font-size:14px;line-height:1.5}
.nota{font-size:12px;color:#7a6552;margin-top:16px}
</style></head><body><main>
<h1>Laudo de classificação de café</h1>
<div class="sub">Laudo nº ${esc(laudo.id)}<br>Emitido em ${esc(data)} por ${esc(laudo.usuario?.nome)} via Café Conecta</div>
<table>
${linha('Tipo', r.tipo)}${linha('Classificação', r.classificacao)}${linha('Peneira', r.peneira)}
${linha('Bebida (estimada)', r.bebida)}${linha('Score', r.score != null ? r.score + ' pontos' : null)}
${linha('Defeitos (300 g)', r.defeitos_300g)}${linha('Confiança da análise', r.confianca)}
</table>
<div class="obs"><strong>Observações:</strong> ${esc(r.observacoes)}</div>
<p class="nota">Análise visual automatizada por IA a partir de foto. Não substitui a classificação oficial nem a prova de xícara.</p>
</main></body></html>`);
});

module.exports = { iaRouter, laudosRouter };
