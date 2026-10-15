const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../lib/supabase');
const { authMiddleware, JWT_SECRET } = require('../middleware/auth');

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

    res.json(usuario);
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

module.exports = router;
