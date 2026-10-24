const express = require('express');
const cors = require('cors');

const authRoutes = require('./api/auth');
const cafesRoutes = require('./api/cafes');
const propostasRoutes = require('./api/propostas');
const alertasRoutes = require('./api/alertas');
const favoritosRoutes = require('./api/favoritos');
const mensagensRoutes = require('./api/mensagens');
const planosRoutes = require('./api/planos');
const webhookRoutes = require('./api/webhook');
const dashboardRoutes = require('./api/dashboard');
const cotacoesRoutes = require('./api/cotacoes');
const pagbankRoutes = require('./api/pagbank');

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '4mb' })); // fotos e imagens da IA chegam em base64

// Health check
app.get('/', (req, res) => {
  res.json({ app: 'Café Conecta API', status: 'online', versao: '2.0.0' });
});

// GET /saude — monitoramento: confere banco, e-mail, push e login com Google.
// Responde 503 se o banco não responder (serviços de monitoramento tratam como fora do ar).
app.get('/saude', async (req, res) => {
  const inicio = Date.now();
  const supabase = require('./lib/supabase');
  let banco = false;
  try {
    const { error } = await supabase.from('cafes').select('id', { head: true, count: 'exact' }).limit(1);
    banco = !error;
  } catch (_) { /* fica false */ }
  const verificacoes = {
    banco,
    email: require('./lib/email').emailConfigurado(),
    push: Boolean(require('./lib/push').chavesVapid()),
    login_google: Boolean((process.env.GOOGLE_CLIENT_ID || '').trim()),
  };
  res.status(banco ? 200 : 503).json({ status: banco ? 'ok' : 'falha', verificacoes, ms: Date.now() - inicio, em: new Date().toISOString() });
});

// Rotas
app.use('/auth/google', require('./api/google'));
app.use('/auth', authRoutes);
app.use('/cafes', cafesRoutes);
app.use('/propostas', propostasRoutes);
app.use('/alertas', alertasRoutes);
app.use('/pedidos', require('./api/pedidos'));
app.use('/amostras', require('./api/amostras'));
app.use('/safra', require('./api/safra'));
app.use('/credito', require('./api/credito'));
app.use('/relatorios', require('./api/relatorios'));
app.use('/empresas', require('./api/empresas'));
app.use('/push', require('./api/push'));
app.use('/favoritos', favoritosRoutes);
app.use('/mensagens', mensagensRoutes);
app.use('/planos', planosRoutes);
app.use('/avaliacoes', require('./api/avaliacoes'));
app.use('/metricas', require('./api/metricas').router);
app.use('/admin', require('./api/admin').router);
app.use('/ia', require('./api/ia').iaRouter);
app.use('/laudos', require('./api/ia').laudosRouter);
app.use('/webhook', webhookRoutes);
app.use('/', require('./api/compartilhar')); // /l/:id — link público do lote
app.use('/dashboard', dashboardRoutes);
app.use('/', dashboardRoutes); // expõe /historico-precos na raiz
app.use('/api/cotacoes', cotacoesRoutes);
app.use('/pagbank', pagbankRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Café Conecta API rodando na porta ${PORT}`);
});

module.exports = app;
