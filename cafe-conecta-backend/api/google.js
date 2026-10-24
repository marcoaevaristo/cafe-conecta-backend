// api/google.js — entrar com Google. O app manda o "credential" (ID token) do Google
// Identity Services; o servidor confere no Google e devolve o token do Café Conecta.
// Precisa da variável GOOGLE_CLIENT_ID (o mesmo Client ID web criado no Google Cloud).
const crypto = require('crypto');
const express = require('express');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../lib/supabase');
const { JWT_SECRET } = require('../middleware/auth');
const { chaveIp, respeitarLimites } = require('../lib/limite');

const router = express.Router();
const clientId = () => (process.env.GOOGLE_CLIENT_ID || '').trim();

// GET /auth/google/config — o app só mostra o botão quando há Client ID configurado
router.get('/config', (req, res) => res.json({ client_id: clientId() || null }));

/** Confere o ID token no Google. Devolve { sub, email, nome } ou null. */
async function conferirToken(credential) {
  const { data } = await axios.get('https://oauth2.googleapis.com/tokeninfo', {
    params: { id_token: credential }, timeout: 8000, validateStatus: () => true,
  });
  const ok = data && data.aud === clientId()
    && ['accounts.google.com', 'https://accounts.google.com'].includes(data.iss)
    && (data.email_verified === true || data.email_verified === 'true')
    && Number(data.exp) * 1000 > Date.now();
  return ok ? { sub: data.sub, email: String(data.email).toLowerCase(), nome: data.name || data.email } : null;
}

function responder(res, usuario, status = 200) {
  const token = jwt.sign({ id: usuario.id, email: usuario.email, tipo: usuario.tipo, plano: usuario.plano }, JWT_SECRET, { expiresIn: '30d' });
  const { senha_hash, ...publico } = usuario;
  res.status(status).json({ token, usuario: publico });
}

// POST /auth/google { credential, tipo?, aceite_termos?, versao_termos? }
router.post('/', async (req, res) => {
  if (!clientId()) return res.status(503).json({ error: 'Entrar com Google ainda não está configurado' });
  if (!(await respeitarLimites(res, [{ chave: `google-ip:${chaveIp(req)}`, max: 30, minutos: 15 }], { registrarAgora: true }))) return;
  const credential = String(req.body?.credential || '');
  if (!credential) return res.status(400).json({ error: 'Credencial do Google ausente' });
  try {
    const g = await conferirToken(credential);
    if (!g) return res.status(401).json({ error: 'Não foi possível confirmar sua conta Google. Tente de novo.' });

    // 1) já entrou com Google antes  2) mesmo e-mail (confirmado pelo Google): liga as contas
    let { data: usuario } = await supabase.from('usuarios').select('*').eq('google_id', g.sub).maybeSingle();
    if (!usuario) {
      const r = await supabase.from('usuarios').select('*').ilike('email', g.email.replace(/[%_\\]/g, '\\$&')).maybeSingle();
      usuario = r.data;
      if (usuario) await supabase.from('usuarios').update({ google_id: g.sub }).eq('id', usuario.id);
    }
    if (usuario) return responder(res, usuario);

    // 3) conta nova: o app precisa perguntar o perfil e colher o aceite dos termos
    const { tipo } = req.body;
    if (!['produtor', 'comprador', 'corretor'].includes(tipo) || req.body.aceite_termos !== true) {
      return res.status(428).json({ error: 'Complete o cadastro', precisa_cadastro: true, nome: g.nome, email: g.email });
    }
    const senhaHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10); // senha aleatória: login só pelo Google ou "esqueci a senha"
    const { data: novo, error } = await supabase.from('usuarios').insert({
      nome: g.nome, email: g.email, senha_hash: senhaHash, tipo, google_id: g.sub,
      termos_aceitos_em: new Date().toISOString(), termos_versao: String(req.body.versao_termos || '').slice(0, 20) || null,
    }).select('*').single();
    if (error) throw error;
    responder(res, novo, 201);
  } catch (err) {
    if (['42703', 'PGRST204'].includes(err?.code)) return res.status(503).json({ error: 'Entrar com Google ainda não foi ativado no servidor.' });
    console.error('Erro no login com Google:', err);
    res.status(500).json({ error: 'Erro ao entrar com Google' });
  }
});

module.exports = router;
