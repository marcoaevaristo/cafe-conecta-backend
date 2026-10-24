// lib/email.js — envio de e-mail pelo Gmail (SMTP com "senha de app").
// Variáveis no Vercel:
//   GMAIL_USER          conta que envia, ex.: suaconta@gmail.com
//   GMAIL_APP_PASSWORD  senha de app de 16 letras (Conta Google → Segurança → Senhas de app)
const nodemailer = require('nodemailer');

let transporte = null;

function emailConfigurado() {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

function obterTransporte() {
  if (!transporte) {
    transporte = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, ''), // aceita colado com espaços
      },
    });
  }
  return transporte;
}

async function enviarCodigoRecuperacao(destino, nome, codigo) {
  const primeiroNome = (nome || '').split(' ')[0] || 'olá';
  await obterTransporte().sendMail({
    from: `"Café Conecta" <${process.env.GMAIL_USER}>`,
    to: destino,
    subject: `Seu código de recuperação: ${codigo}`,
    text: `Olá, ${primeiroNome}.\n\nSeu código para redefinir a senha do Café Conecta é ${codigo}.\n`
      + 'Ele vale por 15 minutos.\n\nSe você não pediu a troca de senha, ignore este e-mail: sua senha continua a mesma.',
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;color:#2b1d14">
      <h2 style="margin:0 0 12px">Café Conecta</h2>
      <p>Olá, ${primeiroNome}.</p>
      <p>Seu código para redefinir a senha é:</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:16px 0">${codigo}</p>
      <p>Ele vale por <strong>15 minutos</strong>.</p>
      <p style="color:#7a6552;font-size:13px">Se você não pediu a troca de senha, ignore este e-mail: sua senha continua a mesma.</p>
    </div>`,
  });
}

/** Envio genérico (avisos do app). */
async function enviarEmail({ para, assunto, texto, html }) {
  await obterTransporte().sendMail({
    from: `"Café Conecta" <${process.env.GMAIL_USER}>`,
    to: para,
    subject: assunto,
    text: texto,
    html,
  });
}

module.exports = { emailConfigurado, enviarCodigoRecuperacao, enviarEmail };
