require('./_mocks');
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { criptografar, chavesVapid, jwtVapid, deB64url } = require('../lib/push');

test('RFC 8291, apêndice A: mesma saída do exemplo oficial', () => {
  const efemera = crypto.createECDH('prime256v1');
  efemera.setPrivateKey(deB64url('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'));
  const saida = criptografar('When I grow up, I want to be a watermelon',
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    'BTBZMqHH6r4Tts7J_aSIgg', { sal: deB64url('DGv6ra1nlYgDCS1FRnbzlw'), efemera });
  assert.strictEqual(saida.toString('base64url'),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

test('chaves VAPID são estáveis e o JWT confere com a chave pública', () => {
  const k = chavesVapid('segredo-de-teste');
  assert.strictEqual(k.pub.length, 65);
  assert.strictEqual(chavesVapid('segredo-de-teste').publica, k.publica);
  const jwt = jwtVapid('https://fcm.googleapis.com/fcm/send/abc', k, 1000);
  const [cab, corpo, sig] = jwt.split('.');
  assert.deepStrictEqual(JSON.parse(Buffer.from(corpo, 'base64url')), { aud: 'https://fcm.googleapis.com', exp: 1000 + 43200, sub: 'mailto:cafeconecta5@gmail.com' });
  const pub = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256',
    x: k.pub.subarray(1, 33).toString('base64url'), y: k.pub.subarray(33).toString('base64url') } });
  assert.ok(crypto.verify('sha256', Buffer.from(`${cab}.${corpo}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
});
