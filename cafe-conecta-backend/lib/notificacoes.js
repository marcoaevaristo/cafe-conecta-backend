// lib/notificacoes.js — avisos por e-mail (nova proposta, resposta, mensagem, alerta de preço).
// Nunca derruba a ação principal: qualquer falha de e-mail só vai para o log.
// O usuário pode desligar em Configurações (coluna usuarios.notificar_email).
const supabase = require('./supabase');
const { emailConfigurado, enviarEmail } = require('./email');
const { enviarPush } = require('./push');

const APP_URL = (process.env.APP_URL || 'https://cafe-conecta-flutter.vercel.app').replace(/\/+$/, '');
const TEMPO_MAX_MS = 8000;
const MAX_EMAILS_ALERTA = 30;

const brl = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const primeiroNome = (n) => String(n || '').trim().split(/\s+/)[0] || 'olá';
const resumoLote = (c) => [c?.tipo, c?.classificacao, c?.fazenda || c?.cidade].filter(Boolean).join(' · ');

function comTempoLimite(promessa) {
  return Promise.race([
    promessa,
    new Promise((_, rej) => setTimeout(() => rej(new Error('tempo esgotado')), TEMPO_MAX_MS)),
  ]);
}

async function nomeDe(id) {
  const { data } = await supabase.from('usuarios').select('nome').eq('id', id).single();
  return data?.nome || 'Um usuário';
}

/** Destinatários do aviso. querEmail=false para quem desligou o e-mail em Configurações
 *  (essas pessoas ainda recebem a notificação push, se tiverem ligado no aparelho). */
async function destinatarios(ids) {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length) return [];
  const { data, error } = await supabase.from('usuarios').select('id, nome, email').in('id', unicos);
  if (error || !data) return [];
  // preferência: se a coluna ainda não existe, todos recebem
  const pref = await supabase.from('usuarios').select('id, notificar_email').in('id', unicos);
  const desligados = new Set(pref.error ? [] : pref.data.filter((u) => u.notificar_email === false).map((u) => u.id));
  return data.map((u) => ({ ...u, querEmail: Boolean(u.email) && !desligados.has(u.id) }));
}

function montarEmail({ nome, titulo, paragrafos, destaque, botao }) {
  const texto = [`Olá, ${primeiroNome(nome)}.`, '', titulo, '', ...paragrafos,
    destaque ? `\n${destaque}` : '', '', `Abrir o Café Conecta: ${APP_URL}`, '',
    'Para não receber estes avisos, desligue em Configurações → Avisos por e-mail.'].join('\n');
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:auto;color:#2b1d14">
  <div style="background:#2C1A0E;color:#D4A843;padding:16px 20px;border-radius:12px 12px 0 0;font-size:20px;font-weight:700">☕ Café Conecta</div>
  <div style="border:1px solid #eadfce;border-top:none;padding:20px;border-radius:0 0 12px 12px">
    <p style="margin:0 0 12px">Olá, ${esc(primeiroNome(nome))}.</p>
    <h2 style="font-size:18px;margin:0 0 12px">${esc(titulo)}</h2>
    ${paragrafos.map((p) => `<p style="margin:0 0 10px;line-height:1.5">${esc(p)}</p>`).join('')}
    ${destaque ? `<blockquote style="margin:12px 0;padding:10px 14px;background:#F5EAD8;border-left:4px solid #C4863A;border-radius:6px">${esc(destaque)}</blockquote>` : ''}
    <p style="margin:20px 0"><a href="${APP_URL}" style="background:#C4863A;color:#1A0F08;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">${esc(botao || 'Abrir o Café Conecta')}</a></p>
    <p style="color:#8B5E3C;font-size:12px;margin:16px 0 0">Para não receber estes avisos, desligue em Configurações → Avisos por e-mail.</p>
  </div></div>`;
  return { texto, html };
}

async function enviarPara(usuario, assunto, conteudo) {
  await enviarPush(usuario.id, { titulo: assunto, corpo: (conteudo.paragrafos || [])[0] || conteudo.titulo, url: APP_URL });
  if (!usuario.querEmail || !emailConfigurado()) return;
  try {
    const { texto, html } = montarEmail({ nome: usuario.nome, ...conteudo });
    await comTempoLimite(enviarEmail({ para: usuario.email, assunto, texto, html }));
  } catch (err) {
    console.error(`Aviso por e-mail falhou (${assunto}):`, err.message);
  }
}

/** Executa um aviso sem nunca lançar erro para quem chamou. */
async function seguro(fn) {
  try { await fn(); } catch (err) { console.error('Erro ao preparar aviso:', err.message); }
}

// ── Propostas ────────────────────────────────────────────────────────
async function novaProposta({ proposta, autorId, paraId, contraproposta = false }) {
  return seguro(async () => {
    const [para] = await destinatarios([paraId]);
    if (!para) return;
    const autorNome = await nomeDe(autorId);
    const { data: cafe } = await supabase.from('cafes').select('tipo, classificacao, fazenda, cidade').eq('id', proposta.cafe_id).single();
    const titulo = contraproposta ? `${autorNome} fez uma contraproposta` : `Nova proposta de ${autorNome}`;
    await enviarPara(para, `${titulo} · ${resumoLote(cafe)}`, {
      titulo,
      paragrafos: [
        `Lote: ${resumoLote(cafe)}`,
        `${proposta.quantidade_sacas} sacas a ${brl(proposta.valor_proposto)} por saca.`,
        'Abra o app para aceitar, recusar ou fazer uma contraproposta.',
      ],
      destaque: proposta.mensagem ? String(proposta.mensagem).slice(0, 300) : null,
      botao: 'Ver proposta',
    });
  });
}

async function respostaProposta({ proposta, status, quemRespondeuId, autorId }) {
  if (!['aceita', 'recusada'].includes(status)) return;
  return seguro(async () => {
    const [autor] = await destinatarios([autorId]);
    if (!autor) return;
    const quemRespondeuNome = await nomeDe(quemRespondeuId);
    const { data: cafe } = await supabase.from('cafes').select('tipo, classificacao, fazenda, cidade').eq('id', proposta.cafe_id).single();
    const aceita = status === 'aceita';
    const titulo = aceita ? `${quemRespondeuNome} aceitou sua proposta 🎉` : `${quemRespondeuNome} recusou sua proposta`;
    await enviarPara(autor, `${titulo} · ${resumoLote(cafe)}`, {
      titulo,
      paragrafos: [
        `Lote: ${resumoLote(cafe)}`,
        `${proposta.quantidade_sacas} sacas a ${brl(proposta.valor_proposto)} por saca.`,
        aceita ? 'Combine os detalhes da entrega e do pagamento pelo chat do app.'
          : 'Você pode fazer uma nova proposta ou procurar outros lotes no catálogo.',
      ],
      botao: aceita ? 'Abrir conversa' : 'Ver catálogo',
    });
  });
}

// ── Mensagens ────────────────────────────────────────────────────────
// Só avisa na primeira mensagem não lida daquela pessoa (evita um e-mail por mensagem)
async function novaMensagem({ mensagem }) {
  return seguro(async () => {
    const { count, error } = await supabase
      .from('mensagens')
      .select('id', { count: 'exact', head: true })
      .eq('remetente_id', mensagem.remetente_id)
      .eq('destinatario_id', mensagem.destinatario_id)
      .eq('lida', false)
      .neq('id', mensagem.id);
    if (error || count > 0) return;
    const [para] = await destinatarios([mensagem.destinatario_id]);
    if (!para) return;
    const remetenteNome = await nomeDe(mensagem.remetente_id);
    await enviarPara(para, `Nova mensagem de ${remetenteNome}`, {
      titulo: `${remetenteNome} enviou uma mensagem`,
      paragrafos: ['Responda pelo app para continuar a negociação.'],
      destaque: String(mensagem.conteudo || '').slice(0, 300),
      botao: 'Responder',
    });
  });
}

// ── Alertas de preço ─────────────────────────────────────────────────
const igual = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

function alertaCombina(alerta, cafe) {
  if (alerta.tipo_cafe && !igual(alerta.tipo_cafe, cafe.tipo)) return false;
  if (alerta.classificacao && !igual(alerta.classificacao, cafe.classificacao)) return false;
  if (alerta.regiao && !igual(alerta.regiao, cafe.regiao)) return false;
  if (alerta.preco_maximo != null) {
    if (cafe.preco_saca == null || Number(cafe.preco_saca) > Number(alerta.preco_maximo)) return false;
  }
  if (alerta.score_minimo != null) {
    if (cafe.score == null || Number(cafe.score) < Number(alerta.score_minimo)) return false;
  }
  return true;
}

async function alertasParaLote(cafe) {
  if (!cafe || cafe.status !== 'ativo') return;
  return seguro(async () => {
    const { data: alertas, error } = await supabase
      .from('alertas').select('*').eq('ativo', true).neq('usuario_id', cafe.usuario_id);
    if (error || !alertas?.length) return;
    const ids = [...new Set(alertas.filter((a) => alertaCombina(a, cafe)).map((a) => a.usuario_id))]
      .slice(0, MAX_EMAILS_ALERTA);
    const pessoas = await destinatarios(ids);
    const local = [cafe.cidade, cafe.regiao].filter(Boolean).join(' · ');
    await Promise.allSettled(pessoas.map((p) => enviarPara(p, `🔔 Lote que você procura: ${resumoLote(cafe)}`, {
      titulo: 'Apareceu um lote que bate com o seu alerta',
      paragrafos: [
        `${resumoLote(cafe)}${local ? ` — ${local}` : ''}`,
        `${cafe.quantidade_sacas} sacas${cafe.preco_saca != null ? ` a ${brl(cafe.preco_saca)} por saca` : ''}.`,
        'Entre no app para ver os detalhes, conversar com o vendedor ou fazer uma proposta.',
      ],
      botao: 'Ver lote',
    })));
  });
}

// ── Pedidos de compra ────────────────────────────────────────────────
// Vendedores com lote ativo compatível (tipo, região e preço) ficam sabendo do pedido
function loteAtendePedido(cafe, pedido) {
  if (!igual(cafe.tipo, pedido.tipo)) return false;
  if (pedido.classificacao && !igual(cafe.classificacao, pedido.classificacao)) return false;
  if (pedido.regiao && !igual(cafe.regiao, pedido.regiao)) return false;
  if (pedido.preco_maximo != null && cafe.preco_saca != null
      && Number(cafe.preco_saca) > Number(pedido.preco_maximo) * 1.05) return false; // tolera 5%
  return true;
}

async function pedidoParaVendedores(pedido) {
  return seguro(async () => {
    const { data: lotes, error } = await supabase
      .from('cafes').select('usuario_id, tipo, classificacao, regiao, preco_saca')
      .eq('status', 'ativo').neq('usuario_id', pedido.usuario_id);
    if (error || !lotes?.length) return;
    const ids = [...new Set(lotes.filter((l) => loteAtendePedido(l, pedido)).map((l) => l.usuario_id))]
      .slice(0, MAX_EMAILS_ALERTA);
    const pessoas = await destinatarios(ids);
    const oQue = [pedido.tipo, pedido.classificacao, pedido.bebida && `bebida ${pedido.bebida}`].filter(Boolean).join(' · ');
    await Promise.allSettled(pessoas.map((p) => enviarPara(p, `🛒 Comprador procurando ${pedido.quantidade_sacas} sacas de ${pedido.tipo}`, {
      titulo: 'Tem comprador procurando um café parecido com o seu',
      paragrafos: [
        `${oQue}${pedido.regiao ? ` — ${pedido.regiao}` : ''}`,
        `${pedido.quantidade_sacas} sacas${pedido.preco_maximo != null ? `, até ${brl(pedido.preco_maximo)} por saca` : ''}.`,
        'Abra Pedidos de compra no app para mandar sua oferta.',
      ],
      botao: 'Ver pedido',
    })));
  });
}

async function novaOfertaPedido({ oferta, pedido }) {
  return seguro(async () => {
    const [dono] = await destinatarios([pedido.usuario_id]);
    if (!dono) return;
    const vendedor = await nomeDe(oferta.usuario_id);
    await enviarPara(dono, `Nova oferta de ${vendedor} para o seu pedido`, {
      titulo: `${vendedor} ofertou café para o seu pedido`,
      paragrafos: [
        `Pedido: ${pedido.quantidade_sacas} sacas de ${pedido.tipo}.`,
        `Oferta: ${oferta.quantidade_sacas} sacas a ${brl(oferta.preco_saca)} por saca.`,
        'Abra Pedidos de compra → Meus pedidos para aceitar ou recusar.',
      ],
      destaque: oferta.mensagem ? String(oferta.mensagem).slice(0, 300) : null,
      botao: 'Ver oferta',
    });
  });
}

async function respostaOfertaPedido({ oferta, pedido, status }) {
  return seguro(async () => {
    const [vendedor] = await destinatarios([oferta.usuario_id]);
    if (!vendedor) return;
    const comprador = await nomeDe(pedido.usuario_id);
    const aceita = status === 'aceita';
    await enviarPara(vendedor, aceita ? `${comprador} aceitou sua oferta 🎉` : `${comprador} recusou sua oferta`, {
      titulo: aceita ? `${comprador} aceitou sua oferta` : `${comprador} recusou sua oferta`,
      paragrafos: [
        `${oferta.quantidade_sacas} sacas de ${pedido.tipo} a ${brl(oferta.preco_saca)} por saca.`,
        aceita ? 'Combine entrega e pagamento pelo chat do app.' : 'Outros pedidos de compra podem combinar com o seu café.',
      ],
      botao: aceita ? 'Abrir conversa' : 'Ver pedidos',
    });
  });
}

// ── Amostras ─────────────────────────────────────────────────────────
const ROTULO_AMOSTRA = {
  solicitada: 'pediu uma amostra do seu lote',
  enviada: 'enviou a amostra que você pediu',
  recebida: 'recebeu a amostra',
  avaliada: 'registrou o resultado da prova da sua amostra',
  recusada: 'não pôde enviar a amostra',
  cancelada: 'cancelou o pedido de amostra',
};

async function eventoAmostra({ amostra, autorId, paraId }) {
  return seguro(async () => {
    const [para] = await destinatarios([paraId]);
    if (!para) return;
    const autor = await nomeDe(autorId);
    const { data: cafe } = await supabase.from('cafes').select('tipo, classificacao, fazenda, cidade').eq('id', amostra.cafe_id).single();
    const acao = ROTULO_AMOSTRA[amostra.status] || 'atualizou a amostra';
    const linhas = [`Lote: ${resumoLote(cafe)}`];
    if (amostra.status === 'enviada' && amostra.codigo_rastreio) linhas.push(`Código de rastreio: ${amostra.codigo_rastreio}`);
    if (amostra.status === 'avaliada') {
      linhas.push([amostra.nota != null && `Nota: ${amostra.nota}`, amostra.bebida_resultado && `bebida ${amostra.bebida_resultado}`,
        amostra.defeitos != null && `${amostra.defeitos} defeitos`].filter(Boolean).join(' · '));
    }
    linhas.push('Acompanhe em Amostras, no app.');
    await enviarPara(para, `${autor} ${acao}`, {
      titulo: `${autor} ${acao}`,
      paragrafos: linhas,
      destaque: amostra.status === 'avaliada' ? amostra.comentario : amostra.status === 'solicitada' ? amostra.observacoes : null,
      botao: 'Ver amostra',
    });
  });
}

module.exports = {
  novaProposta, respostaProposta, novaMensagem, alertasParaLote, alertaCombina,
  pedidoParaVendedores, novaOfertaPedido, respostaOfertaPedido, loteAtendePedido, eventoAmostra,
};
