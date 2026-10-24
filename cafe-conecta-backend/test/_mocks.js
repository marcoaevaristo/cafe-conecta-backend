// Substitui módulos que precisam de rede/credenciais, para testar só a lógica.
const path = require('path');
function falso(rel, exports) {
  const p = path.join(__dirname, '..', rel);
  require.cache[require.resolve(p)] = { id: p, filename: p, loaded: true, exports };
}
falso('lib/supabase.js', { from: () => { throw new Error('supabase não disponível em teste'); } });
falso('lib/email.js', { emailConfigurado: () => false, enviarEmail: async () => {}, enviarCodigoRecuperacao: async () => {} });
