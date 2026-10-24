// lib/push.js — notificações push na web (Web Push, RFC 8291 + VAPID RFC 8292),
// feito só com o módulo crypto do Node, sem dependências.
//
// As chaves VAPID são derivadas do JWT_SECRET, então não há nada a configurar.
// Se o JWT_SECRET for trocado, as inscrições antigas param de funcionar e cada
// usuário precisa ligar as notificações de novo em Configurações.
const crypto = require('crypto');
const supabase = require('./supabase');

const SUJEITO = process.env.VAPID_SUBJECT || 'mailto:cafeconecta5@gmail.com';
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const hmac = (chave, dados) => crypto.createHmac('sha256', chave).update(dados).digest();

let chaves = null;

/** Par de chaves VAPID (P-256) derivado do segredo do servidor. */
function chavesVapid(segredo = process.env.JWT_SECRET) {
  if (!segredo) return null;
  if (chaves && chaves.segredo === segredo) return chaves;
  for (let i = 0; i < 10; i++) {
    try {
      const d = hmac(segredo, `cafe-conecta-vapid-${i}`);
      const ecdh = crypto.createECDH('prime256v1');
      ecdh.setPrivateKey(d);
      const pub = ecdh.getPublicKey(); // 65 bytes, não comprimida
      chaves = { segredo, d, pub, publica: b64url(pub) };
      return chaves;
    } catch (_) { /* escalar fora da curva: tenta o próximo */ }
  }
  return null;
}

function jwtVapid(endpoint, k, agora = Math.floor(Date.now() / 1000)) {
  const aud = new URL(endpoint).origin;
  const cab = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const corpo = b64url(JSON.stringify({ aud, exp: agora + 12 * 3600, sub: SUJEITO }));
  const chave = crypto.createPrivateKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', d: b64url(k.d), x: b64url(k.pub.subarray(1, 33)), y: b64url(k.pub.subarray(33, 65)) },
  });
  const assinatura = crypto.sign('sha256', Buffer.from(`${cab}.${corpo}`), { key: chave, dsaEncoding: 'ieee-p1363' });
  return `${cab}.${corpo}.${b64url(assinatura)}`;
}

/** Criptografa a mensagem para uma inscrição (Content-Encoding: aes128gcm). */
function criptografar(texto, p256dh, auth, { sal = crypto.randomBytes(16), efemera = null } = {}) {
  const uaPub = deB64url(p256dh);
  const segredoAuth = deB64url(auth);
  const ecdh = efemera || crypto.createECDH('prime256v1');
  if (!efemera) ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const compartilhado = ecdh.computeSecret(uaPub);

  const prkChave = hmac(segredoAuth, compartilhado);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub, Buffer.from([1])]);
  const ikm = hmac(prkChave, info);
  const prk = hmac(sal, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);

  const cifra = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const cifrado = Buffer.concat([cifra.update(Buffer.concat([Buffer.from(texto), Buffer.from([2])])), cifra.final(), cifra.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([sal, rs, Buffer.from([asPub.length]), asPub, cifrado]);
}

async function enviarUma(insc, mensagem) {
  const k = chavesVapid();
  if (!k) return false;
  const corpo = criptografar(JSON.stringify(mensagem), insc.p256dh, insc.auth);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(insc.endpoint, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `vapid t=${jwtVapid(insc.endpoint, k)}, k=${k.publica}`,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'normal',
      },
      body: corpo,
    });
    if (res.status === 404 || res.status === 410) {
      await supabase.from('push_inscricoes').delete().eq('endpoint', insc.endpoint);
    } else if (res.status >= 400) {
      console.error('Push recusado:', res.status, (await res.text()).slice(0, 200));
    }
    return res.ok;
  } finally {
    clearTimeout(t);
  }
}

/** Envia para todos os aparelhos do usuário. Nunca lança erro. */
async function enviarPush(usuarioId, { titulo, corpo, url }) {
  try {
    if (!usuarioId || !chavesVapid()) return;
    const { data, error } = await supabase.from('push_inscricoes').select('endpoint, p256dh, auth').eq('usuario_id', usuarioId);
    if (error || !data?.length) return;
    await Promise.allSettled(data.map((i) => enviarUma(i, { titulo, corpo, url })));
  } catch (err) {
    console.error('Push falhou:', err.message);
  }
}

module.exports = { chavesVapid, jwtVapid, criptografar, enviarPush, b64url, deB64url };
