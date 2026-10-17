#!/usr/bin/env node
// scripts/criar-usuario-master.js
// Uso: node scripts/criar-usuario-master.js
// Requer SUPABASE_URL e SUPABASE_SERVICE_KEY no ambiente (ou .env)

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function criarMaster() {
  const email    = process.env.MASTER_EMAIL  || 'master@cafeconecta.com.br';
  const senha    = process.env.MASTER_SENHA  || 'Master@2024!';
  const nome     = process.env.MASTER_NOME   || 'Administrador Master';

  console.log(`\n🚀 Criando usuário master: ${email}`);

  // Verifica se já existe
  const { data: existe } = await supabase
    .from('usuarios')
    .select('id, email, tipo, plano')
    .eq('email', email)
    .maybeSingle();

  if (existe) {
    console.log(`⚠️  Usuário já existe! ID: ${existe.id} | tipo: ${existe.tipo} | plano: ${existe.plano}`);
    console.log('   Para atualizar a senha, rode com MASTER_FORCE=true');

    if (process.env.MASTER_FORCE !== 'true') {
      process.exit(0);
    }
    // Atualiza senha
    const senhaHash = await bcrypt.hash(senha, 10);
    await supabase
      .from('usuarios')
      .update({ senha_hash: senhaHash, tipo: 'produtor', plano: 'premium', verificado: true })
      .eq('id', existe.id);
    console.log('✅ Senha e plano atualizados!');
    process.exit(0);
  }

  const senhaHash = await bcrypt.hash(senha, 10);

  const { data: usuario, error } = await supabase
    .from('usuarios')
    .insert({
      nome,
      email,
      senha_hash: senhaHash,
      tipo:       'produtor',   // produtor pode criar lotes E receber propostas
      plano:      'premium',    // acesso total
      verificado: true,
      cidade:     'São Paulo',
      estado:     'SP',
      telefone:   '(11) 99999-0000',
    })
    .select('id, nome, email, tipo, plano, verificado')
    .single();

  if (error) {
    console.error('❌ Erro ao criar usuário:', error.message);
    process.exit(1);
  }

  console.log('\n✅ Usuário master criado com sucesso!');
  console.log('─'.repeat(40));
  console.log(`ID:     ${usuario.id}`);
  console.log(`Nome:   ${usuario.nome}`);
  console.log(`E-mail: ${usuario.email}`);
  console.log(`Tipo:   ${usuario.tipo}`);
  console.log(`Plano:  ${usuario.plano}`);
  console.log('─'.repeat(40));
  console.log(`\n🔑 Login:`);
  console.log(`   E-mail: ${email}`);
  console.log(`   Senha:  ${senha}`);
  console.log('\n⚠️  Troque a senha após o primeiro login!\n');
}

criarMaster().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
