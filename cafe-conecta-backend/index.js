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

// Rotas
app.use('/auth', authRoutes);
app.use('/cafes', cafesRoutes);
app.use('/propostas', propostasRoutes);
app.use('/alertas', alertasRoutes);
app.use('/favoritos', favoritosRoutes);
app.use('/mensagens', mensagensRoutes);
app.use('/planos', planosRoutes);
app.use('/avaliacoes', require('./api/avaliacoes'));
app.use('/ia', require('./api/ia').iaRouter);
app.use('/laudos', require('./api/ia').laudosRouter);
app.use('/debug', require('./api/debug'));
app.use('/webhook', webhookRoutes);
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
