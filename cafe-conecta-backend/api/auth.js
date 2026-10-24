const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const supabase = require('../lib/supabase');
const { authMiddleware, JWT_SECRET } = require('../middleware/auth');

const { planoEfetivo } = require('../lib/planos');
const { ehAdmin } = require('./admin');
const { emailConfigurado, enviarCodigoRecuperacao } = require('../lib/email');
const { chaveIp, chaveEmail, respeitarLimites, registrar } = require('../lib/limite');

const router = express.Router();

// POST /auth/cadastro
router.post('/cadastro', async (req, res) => {
  const { nome, email, senha, telefone, cidade, estado, tipo } = req.body;

  if (!(await respeitarLimites(res, [{ chave: `cadastro-ip:${chaveIp(req)}`, max: 10, minutos: 60 }],
    { registrarAgora: true }))) return;

  if (!nome || !email || !senha || !tipo) {
    return res.status(400).json({ error: 'Campos obrigatórios: nome, email, senha, tipo' });
  }

  if (!['produtor', 'comprador', 'corretor'].includes(tipo)) {
    return res.status(400).json({ error: 'Tipo deve ser produtor, comprador ou corretor' });
  }

  try {
    const { data: existe } = await supabase
      .from('usuarios')
      .select('id')
      .eq('email', email)
      .single();

    if (existe) return res.status(409).json({ error: 'E-mail já cadastrado' });

    const senhaHash = await bcrypt.hash(senha, 10);

    const { data: usuario, error } = await supabase
      .from('usuarios')
      .insert({ nome, email, senha_hash: senhaHash, telefone, cidade, estado, tipo })
      .select('id, nome, email, tipo, plano, cidade, estado, telefone, criado_em')
      .single();

    if (error) throw error;

    const token = jwt.sign(
      { id: usuario.id, email: usuario.email, tipo: usuario.tipo, plano: usuario.plano },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(201).json({ token, usuario });
  } catch (err) {
    console.error('Erro no cadastro DETALHADO:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
    res.status(500).json({ error: 'Erro ao criar conta' });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
  }

  // Erros de senha: até 8 por conta e 30 por rede a cada 15 minutos
  const kEmail = `login:${chaveEmail(email)}`;
  const kIp = `login-ip:${chaveIp(req)}`;
  if (!(await respeitarLimites(res, [
    { chave: kEmail, max: 8, minutos: 15 },
    { chave: kIp, max: 30, minutos: 15 },
  ]))) return;
  const falhou = async () => {
    await registrar(kEmail, kIp);
    return res.status(401).json({ error: 'E-mail ou senha inválidos' });
  };

  try {
    const { data: usuario, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !usuario) return falhou();

    const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);
    if (!senhaValida) return falhou();

    const token = jwt.sign(
      { id: usuario.id, email: usuario.email, tipo: usuario.tipo, plano: usuario.plano },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    const { senha_hash, ...usuarioSemSenha } = usuario;
    res.json({ token, usuario: usuarioSemSenha });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ error: 'Erro ao fazer login' });
  }
});

// GET /auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { data: usuario, error } = await supabase
      .from('usuarios')
      .select('id, nome, email, tipo, plano, plano_valido_ate, cidade, estado, telefone, verificado, avatar_url, criado_em')
      .eq('id', req.usuario.id)
      .single();

    if (error || !usuario) return res.status(404).json({ error: 'Usuário não encontrado' });

    // Plano pago vencido volta a valer como gratuito; o plano contratado segue em plano_contratado
    res.json({
      ...usuario,
      plano: planoEfetivo(usuario),
      plano_contratado: usuario.plano,
      is_admin: ehAdmin(usuario.email), // mostra o Painel do desenvolvedor no app
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar perfil' });
  }
});

// PUT /auth/perfil
router.put('/perfil', authMiddleware, async (req, res) => {
  const { nome, telefone, cidade, estado } = req.body;
  if (nome !== undefined && !String(nome).trim()) {
    return res.status(400).json({ error: 'O nome não pode ficar vazio' });
  }
  try {
    const { data, error } = await supabase
      .from('usuarios')
      .update({ nome, telefone, cidade, estado })
      .eq('id', req.usuario.id)
      .select('id, nome, email, tipo, plano, cidade, estado, telefone')
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar perfil' });
  }
});

// POST /auth/trocar-senha — Body: { senha_atual, nova_senha }
router.post('/trocar-senha', authMiddleware, async (req, res) => {
  const { senha_atual, nova_senha } = req.body;
  if (!senha_atual || !nova_senha) {
    return res.status(400).json({ error: 'Informe a senha atual e a nova senha' });
  }
  if (String(nova_senha).length < 6) {
    return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres' });
  }
  try {
    const { data: usuario } = await supabase
      .from('usuarios').select('id, senha_hash').eq('id', req.usuario.id).single();
    if (!usuario || !(await bcrypt.compare(senha_atual, usuario.senha_hash))) {
      return res.status(400).json({ error: 'Senha atual incorreta' });
    }
    const { error } = await supabase.from('usuarios')
      .update({ senha_hash: await bcrypt.hash(nova_senha, 10), reset_token: null, reset_token_expira: null })
      .eq('id', usuario.id);
    if (error) throw error;
    res.json({ mensagem: 'Senha alterada com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao trocar a senha' });
  }
});

// DELETE /auth/conta — Body: { senha }. Exclui a conta e os dados ligados a ela (LGPD).
router.delete('/conta', authMiddleware, async (req, res) => {
  const { senha } = req.body || {};
  if (!senha) return res.status(400).json({ error: 'Confirme com a sua senha' });
  try {
    const { data: usuario } = await supabase
      .from('usuarios').select('id, senha_hash').eq('id', req.usuario.id).single();
    if (!usuario || !(await bcrypt.compare(senha, usuario.senha_hash))) {
      return res.status(400).json({ error: 'Senha incorreta' });
    }

    // Apaga as fotos dos lotes no Storage (o banco não faz isso sozinho)
    const { data: cafes } = await supabase.from('cafes').select('id').eq('usuario_id', usuario.id);
    for (const cafe of cafes || []) {
      const { data: arquivos } = await supabase.storage.from('cafe-fotos').list(cafe.id);
      if (arquivos?.length) {
        await supabase.storage.from('cafe-fotos').remove(arquivos.map((a) => `${cafe.id}/${a.name}`));
      }
    }

    const { error } = await supabase.from('usuarios').delete().eq('id', usuario.id);
    if (error) {
      console.error('Erro ao excluir conta:', error);
      return res.status(409).json({ error: 'Não foi possível excluir a conta agora. Tente novamente mais tarde.' });
    }
    res.json({ mensagem: 'Conta excluída' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir a conta' });
  }
});

// ── Recuperação de senha ────────────────────────────────────────────
// O código de 6 dígitos vai SÓ por e-mail. No banco fica o hash do código
// e o número de tentativas, no formato "tentativas|hash" (coluna reset_token).
const MAX_TENTATIVAS = 5;
const VALIDADE_MIN = 15;
const INTERVALO_REENVIO_S = 60;
const MSG_NEUTRA = 'Se o e-mail estiver cadastrado, você receberá o código em alguns minutos.';

function lerToken(valor) {
  const [tentativas, hash] = String(valor || '').split('|');
  return { tentativas: parseInt(tentativas, 10) || 0, hash: hash || null };
}

// POST /auth/esqueci-senha — Body: { email }
router.post('/esqueci-senha', async (req, res) => {
  const email = String(req.body.email || '').trim();
  if (!email) return res.status(400).json({ error: 'E-mail é obrigatório' });

  // Sem e-mail configurado não há como entregar o código com segurança
  if (!emailConfigurado()) {
    return res.status(503).json({ error: 'A recuperação de senha está temporariamente indisponível. Tente mais tarde.' });
  }

  // Evita usar o app para disparar e-mails em massa: 10 pedidos por rede por hora
  if (!(await respeitarLimites(res, [{ chave: `reset-ip:${chaveIp(req)}`, max: 10, minutos: 60 }],
    { registrarAgora: true }))) return;

  try {
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('id, nome, email, reset_token_expira')
      .eq('email', email)
      .maybeSingle();

    // Mesma resposta exista ou não a conta (não revela quem está cadastrado)
    if (!usuario) return res.json({ mensagem: MSG_NEUTRA });

    // Evita disparar vários e-mails seguidos para a mesma conta
    if (usuario.reset_token_expira) {
      const geradoEm = new Date(usuario.reset_token_expira).getTime() - VALIDADE_MIN * 60 * 1000;
      if (Date.now() - geradoEm < INTERVALO_REENVIO_S * 1000) return res.json({ mensagem: MSG_NEUTRA });
    }

    const codigo = crypto.randomInt(100000, 1000000).toString();
    const hash = await bcrypt.hash(codigo, 10);
    const expiracao = new Date(Date.now() + VALIDADE_MIN * 60 * 1000).toISOString();

    const { error } = await supabase
      .from('usuarios')
      .update({ reset_token: `0|${hash}`, reset_token_expira: expiracao })
      .eq('id', usuario.id);
    if (error) throw error;

    await enviarCodigoRecuperacao(usuario.email, usuario.nome, codigo);
    res.json({ mensagem: MSG_NEUTRA });
  } catch (err) {
    console.error('Erro esqueci-senha:', err.message);
    res.status(500).json({ error: 'Não foi possível enviar o código agora. Tente novamente em instantes.' });
  }
});

// POST /auth/resetar-senha — Body: { email, codigo, nova_senha }
router.post('/resetar-senha', async (req, res) => {
  const email = String(req.body.email || '').trim();
  const codigo = String(req.body.codigo || '').trim();
  const { nova_senha } = req.body;

  if (!email || !codigo || !nova_senha) {
    return res.status(400).json({ error: 'Campos obrigatórios: email, codigo, nova_senha' });
  }
  if (nova_senha.length < 6) {
    return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres' });
  }

  const invalido = () => res.status(400).json({ error: 'Código inválido ou expirado. Solicite um novo.' });

  if (!(await respeitarLimites(res, [{ chave: `resetcod-ip:${chaveIp(req)}`, max: 20, minutos: 60 }],
    { registrarAgora: true }))) return;

  try {
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('id, reset_token, reset_token_expira')
      .eq('email', email)
      .maybeSingle();

    if (!usuario || !usuario.reset_token) return invalido();
    if (!usuario.reset_token_expira || new Date(usuario.reset_token_expira) < new Date()) return invalido();

    const { tentativas, hash } = lerToken(usuario.reset_token);
    if (!hash || tentativas >= MAX_TENTATIVAS) return invalido();

    if (!(await bcrypt.compare(codigo, hash))) {
      const restantes = MAX_TENTATIVAS - tentativas - 1;
      // Na última tentativa errada o código é apagado
      await supabase.from('usuarios')
        .update(restantes > 0
          ? { reset_token: `${tentativas + 1}|${hash}` }
          : { reset_token: null, reset_token_expira: null })
        .eq('id', usuario.id);
      return res.status(400).json({
        error: restantes > 0
          ? `Código incorreto. Você ainda tem ${restantes} tentativa${restantes > 1 ? 's' : ''}.`
          : 'Código incorreto várias vezes. Solicite um novo código.',
      });
    }

    const senhaHash = await bcrypt.hash(nova_senha, 10);
    const { error } = await supabase
      .from('usuarios')
      .update({ senha_hash: senhaHash, reset_token: null, reset_token_expira: null })
      .eq('id', usuario.id);
    if (error) throw error;

    res.json({ mensagem: 'Senha alterada com sucesso! Faça login com sua nova senha.' });
  } catch (err) {
    console.error('Erro resetar-senha:', err.message);
    res.status(500).json({ error: 'Erro ao redefinir senha' });
  }
});

module.exports = router;
