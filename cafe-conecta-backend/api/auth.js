const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const supabase = require('../lib/supabase');
const { authMiddleware, JWT_SECRET } = require('../middleware/auth');

const { planoEfetivo } = require('../lib/planos');

const router = express.Router();

// POST /auth/cadastro
router.post('/cadastro', async (req, res) => {
  const { nome, email, senha, telefone, cidade, estado, tipo } = req.body;

  if (!nome || !email || !senha || !tipo) {
    return res.status(400).json({ error: 'Campos obrigatórios: nome, email, senha, tipo' });
  }

  if (!['produtor', 'comprador'].includes(tipo)) {
    return res.status(400).json({ error: 'Tipo deve ser produtor ou comprador' });
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

  try {
    const { data: usuario, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !usuario) {
      return res.status(401).json({ error: 'E-mail ou senha inválidos' });
    }

    const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);
    if (!senhaValida) {
      return res.status(401).json({ error: 'E-mail ou senha inválidos' });
    }

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
    res.json({ ...usuario, plano: planoEfetivo(usuario), plano_contratado: usuario.plano });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar perfil' });
  }
});

// PUT /auth/perfil
router.put('/perfil', authMiddleware, async (req, res) => {
  const { nome, telefone, cidade, estado } = req.body;
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

// POST /auth/esqueci-senha
// Body: { email }
// Gera um token de 6 dígitos válido por 15 minutos e retorna no JSON
// (Em produção, enviar por e-mail. Aqui retornamos o token para facilitar os testes.)
router.post('/esqueci-senha', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'E-mail é obrigatório' });

  try {
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('id, nome, email')
      .eq('email', email)
      .maybeSingle();

    // Não revelar se o e-mail existe ou não (segurança)
    if (!usuario) {
      return res.json({ mensagem: 'Se o e-mail estiver cadastrado, você receberá o código em breve.' });
    }

    // Gera código numérico de 6 dígitos
    const codigo = Math.floor(100000 + Math.random() * 900000).toString();
    const expiracao = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min

    // Salva na tabela reset_senha (criamos via SQL abaixo ou usamos coluna temporária)
    // Usamos a tabela usuarios com colunas extras (adicione via migration):
    //   reset_token TEXT, reset_token_expira TIMESTAMPTZ
    const { error } = await supabase
      .from('usuarios')
      .update({ reset_token: codigo, reset_token_expira: expiracao })
      .eq('id', usuario.id);

    if (error) throw error;

    // Em produção: enviar por e-mail (SendGrid, Resend, etc.)
    // Por enquanto retornamos o código diretamente para testes
    console.log(`[RESET SENHA] ${email} → código: ${codigo}`);

    res.json({
      mensagem: 'Código de recuperação gerado com sucesso.',
      // REMOVA o campo "codigo" abaixo quando integrar com envio de e-mail real:
      codigo,
      email: usuario.email,
    });
  } catch (err) {
    console.error('Erro esqueci-senha:', err);
    res.status(500).json({ error: 'Erro ao gerar código de recuperação' });
  }
});

// POST /auth/resetar-senha
// Body: { email, codigo, nova_senha }
router.post('/resetar-senha', async (req, res) => {
  const { email, codigo, nova_senha } = req.body;

  if (!email || !codigo || !nova_senha) {
    return res.status(400).json({ error: 'Campos obrigatórios: email, codigo, nova_senha' });
  }

  if (nova_senha.length < 6) {
    return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres' });
  }

  try {
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('id, reset_token, reset_token_expira')
      .eq('email', email)
      .maybeSingle();

    if (!usuario) {
      return res.status(400).json({ error: 'Código inválido ou expirado' });
    }

    if (usuario.reset_token !== codigo) {
      return res.status(400).json({ error: 'Código inválido ou expirado' });
    }

    if (!usuario.reset_token_expira || new Date(usuario.reset_token_expira) < new Date()) {
      return res.status(400).json({ error: 'Código expirado. Solicite um novo.' });
    }

    const senhaHash = await bcrypt.hash(nova_senha, 10);

    await supabase
      .from('usuarios')
      .update({
        senha_hash: senhaHash,
        reset_token: null,
        reset_token_expira: null,
      })
      .eq('id', usuario.id);

    res.json({ mensagem: 'Senha alterada com sucesso! Faça login com sua nova senha.' });
  } catch (err) {
    console.error('Erro resetar-senha:', err);
    res.status(500).json({ error: 'Erro ao redefinir senha' });
  }
});

module.exports = router;
