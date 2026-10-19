// lib/imagem.js
// Lê uma imagem enviada pelo app em base64 (com ou sem prefixo "data:...;base64,").
const TIPOS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 3 * 1024 * 1024; // 3 MB depois de decodificada

function lerImagemBase64(imagem, contentType) {
  if (!imagem || typeof imagem !== 'string') {
    return { erro: 'Envie a imagem em base64 no campo "imagem"' };
  }
  let tipo = contentType;
  let dados = imagem;
  const m = imagem.match(/^data:([^;]+);base64,(.*)$/s);
  if (m) { tipo = m[1]; dados = m[2]; }
  tipo = (tipo || 'image/jpeg').toLowerCase().replace('image/jpg', 'image/jpeg');

  if (!TIPOS[tipo]) return { erro: 'Formato não suportado. Use JPG, PNG ou WEBP.' };

  const buffer = Buffer.from(dados, 'base64');
  if (!buffer.length) return { erro: 'Imagem vazia ou inválida' };
  if (buffer.length > MAX_BYTES) return { erro: 'Imagem muito grande (máximo 3 MB)' };

  return { buffer, tipo, extensao: TIPOS[tipo], base64: buffer.toString('base64') };
}

module.exports = { lerImagemBase64 };
