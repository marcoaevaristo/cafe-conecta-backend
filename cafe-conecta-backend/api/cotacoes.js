// api/cotacoes.js
// Cotações do Café Conecta.
// Dólar: PTAX oficial do Banco Central (API pública, sem autenticação).
// Preços do café (bolsa e mercado físico) NÃO são servidos aqui: o app abre as
// fontes oficiais ao vivo (Investing.com, CEPEA, Notícias Agrícolas). Nenhum
// preço inventado é devolvido — se a fonte falhar, o campo vem null.

const express = require('express');
const https = require('https');
const { calcularIndice } = require('../lib/indice');
const router = express.Router();

const FONTES_CAFE = [
  { id: 'ice_arabica', nome: 'Café Arábica — Contrato C (ICE NY)', url: 'https://br.investing.com/commodities/us-coffee-c' },
  { id: 'ice_robusta', nome: 'Café Robusta (ICE Londres)', url: 'https://br.investing.com/commodities/london-coffee' },
  { id: 'cepea', nome: 'Indicador CEPEA/ESALQ', url: 'https://www.cepea.org.br/br/indicador/cafe.aspx' },
  { id: 'noticias_agricolas', nome: 'Notícias Agrícolas — cotações', url: 'https://www.noticiasagricolas.com.br/cotacoes/cafe' },
];

// "2026-10-16 13:09:28.123" (horário de Brasília) -> ISO com fuso
function isoBrasilia(s) {
  if (!s) return null;
  const [data, hora = '00:00:00'] = String(s).split(' ');
  return `${data}T${hora.slice(0, 8)}-03:00`;
}

// Último PTAX dos últimos 10 dias (cobre fins de semana e feriados)
function fetchDolarBCB() {
  return new Promise((resolve) => {
    const hoje = new Date();
    const inicio = new Date(hoje);
    inicio.setUTCDate(hoje.getUTCDate() - 10);
    const fmt = (d) =>
      `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}-${d.getUTCFullYear()}`;
    const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@dataInicial='${fmt(inicio)}'&@dataFinalCotacao='${fmt(hoje)}'&$top=1&$orderby=dataHoraCotacao%20desc&$format=json&$select=cotacaoCompra,cotacaoVenda,dataHoraCotacao`;

    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const item = JSON.parse(data)?.value?.[0];
          resolve(item ? {
            cotacao_compra: item.cotacaoCompra,
            cotacao_venda: item.cotacaoVenda,
            data_referencia: isoBrasilia(item.dataHoraCotacao),
            fonte: 'Banco Central do Brasil (PTAX)',
          } : null);
        } catch {
          resolve(null);
        }
      });
      res.on('error', () => resolve(null));
    });
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

// GET /api/cotacoes/atual
router.get('/atual', async (req, res) => {
  try {
    const dolar = await fetchDolarBCB();
    res.json({
      atualizado_em: new Date().toISOString(),
      dolar,            // null se o Banco Central não respondeu
      cepea: [],        // preços do café: abrir as fontes ao vivo
      b3: [],
      noticias: [],
      fontes_cafe: FONTES_CAFE,
    });
  } catch (err) {
    console.error('Erro cotacoes/atual:', err);
    res.status(500).json({ error: 'Erro ao buscar cotações' });
  }
});

// GET /api/cotacoes/indice — Índice Café Conecta (preços reais dos lotes do app)
router.get('/indice', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=30');
    res.json(await calcularIndice());
  } catch (err) {
    console.error('Erro cotacoes/indice:', err);
    res.status(500).json({ error: 'Erro ao calcular o índice' });
  }
});

// GET /api/cotacoes/historico — sem fonte licenciada, não devolve série inventada
router.get('/historico', (req, res) => {
  res.json({ pontos: [], tipo: req.query.tipo || 'arabica', fonte: req.query.fonte || 'cepea', fontes_cafe: FONTES_CAFE });
});

module.exports = router;
