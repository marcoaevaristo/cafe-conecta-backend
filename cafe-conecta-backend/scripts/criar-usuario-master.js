#!/usr/bin/env node
// scripts/criar-usuario-master.js
// Uso: node scripts/criar-usuario-master.js
//
// Passe as variáveis via linha de comando (Windows PowerShell):
//   $env:SUPABASE_URL="https://xxxx.supabase.co"; $env:SUPABASE_SERVICE_KEY="service_role_key"; node scripts/criar-usuario-master.js

const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('\n❌ Variáveis de ambiente ausentes!');
  console.error('   Configure antes de rodar (PowerShell):');
  console.error('');
  console.error('   $env:SUPABASE_URL="https://xxxx.supabase.co"');
  console.error('   $env:SUPABASE_SERVICE_KEY="sua_service_role_key"');
  console.error('   node scripts/criar-usuario-master.js');
  console.error('');
  console.error('   Chaves em: https://app.supabase.com → Project Settings → API');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function criarMaster() {
  const email = process.env.MASTER_EMAIL || 'cafeconecta5@gmail.com';
  const senha = process.env.MASTER_SENHA || 'Master@2024!';
  const nome  = process.env.MASTER_NOME  || 'Administrador Master';

  console.log('\n🚀 Criando usuário master: ' + email);

  const { data: existe } = await supabase
    .from('usuarios')
    .select('id, email, tipo, plano')
    .eq('email', email)
    .maybeSingle();

  if (existe) {
    console.log('⚠️  Usuário já existe! ID: ' + existe.id + ' | tipo: ' + existe.tipo + ' | plano: ' + existe.plano);
    if (process.env.MASTER_FORCE !== 'true') {
      console.log('   Para atualizar a senha, rode com: $env:MASTER_FORCE="true"');
      process.exit(0);
    }
    const senhaHash = await bcrypt.hash(senha, 10);
    await supabase
      .from('usuarios')
      .update({ senha_hash: senhaHash, tipo: 'produtor', plano: 'premium', verificado: true })
      .eq('id', existe.id);
    console.log('✅ Senha e plano atualizados!');
    console.log('   E-mail: ' + email);
    console.log('   Senha:  ' + senha);
    process.exit(0);
  }

  const senhaHash = await bcrypt.hash(senha, 10);

  const { data: usuario, error } = await supabase
    .from('usuarios')
    .insert({
      nome,
      email,
      senha_hash: senhaHash,
      tipo:       'produtor',
      plano:      'premium',
      verificado: true,
      cidade:     'Sao Paulo',
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
  console.log('----------------------------------------');
  console.log('ID:     ' + usuario.id);
  console.log('Nome:   ' + usuario.nome);
  console.log('E-mail: ' + usuario.email);
  console.log('Tipo:   ' + usuario.tipo);
  console.log('Plano:  ' + usuario.plano);
  console.log('----------------------------------------');
  console.log('\n🔑 Use para login:');
  console.log('   E-mail: ' + email);
  console.log('   Senha:  ' + senha);
  console.log('\n⚠️  Troque a senha após o primeiro login!\n');
}

criarMaster().catch(function(err) {
  console.error('Erro fatal:', err.message || err);
  process.exit(1);
});
