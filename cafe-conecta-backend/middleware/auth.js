const jwt = require('jsonwebtoken');

// Sem senha padrão: o código é público, então uma senha escrita aqui permitiria
// a qualquer um forjar logins. Sem JWT_SECRET, as rotas com login recusam (503).
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) console.error('JWT_SECRET não configurado: logins desativados até definir na Vercel.');

function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'Token não fornecido' });

  if (!JWT_SECRET) return res.status(503).json({ error: 'Login temporariamente indisponível.' });

  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token inválido' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.usuario = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token expirado ou inválido' });
  }
}

module.exports = { authMiddleware, JWT_SECRET };
