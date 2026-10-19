// lib/assinaturas.js
// Confirma um pedido direto no PagBank e, se pago, libera o plano do usuário.
// Nunca confia no corpo do webhook: o status vem sempre de uma consulta ao PagBank.
const supabase = require('./supabase');

const PAGBANK_URL = (process.env.PAGBANK_ENV || 'sandbox') === 'sandbox'
  ? 'https://sandbox.api.pagseguro.com'
  : 'https://api.pagseguro.com';

async function consultarPedido(orderId) {
  const res = await fetch(`${PAGBANK_URL}/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${process.env.PAGBANK_TOKEN}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`PagBank respondeu ${res.status} ao consultar o pedido`);
  return res.json();
}

function situacaoDoPedido(pedido) {
  const cobrancas = pedido.charges || [];
  if (cobrancas.some((c) => c.status === 'PAID')) return 'pago';
  if (cobrancas.length && cobrancas.every((c) => ['CANCELED', 'DECLINED'].includes(c.status))) return 'recusado';
  return 'pendente';
}

// Soma 1 mês ao que ainda resta do plano, se for o mesmo plano e ainda estiver valendo
function novaValidade(usuario, plano, agora = new Date()) {
  const atual = usuario?.plano_valido_ate ? new Date(usuario.plano_valido_ate) : null;
  const base = atual && atual > agora && usuario.plano === plano ? atual : agora;
  const fim = new Date(base);
  fim.setUTCMonth(fim.getUTCMonth() + 1);
  return fim;
}

/**
 * Verifica o pedido no PagBank e atualiza assinatura + plano do usuário.
 * Retorna { situacao: 'pago' | 'pendente' | 'recusado' | 'desconhecido', plano, valido_ate }.
 * Pode ser chamada várias vezes para o mesmo pedido sem efeito duplicado.
 */
async function sincronizarPedido(orderId, pedidoJaConsultado = null) {
  const { data: assinatura } = await supabase
    .from('assinaturas').select('*').eq('pagbank_order_id', orderId).maybeSingle();
  if (!assinatura) return { situacao: 'desconhecido' };

  if (assinatura.status === 'ativo') {
    return { situacao: 'pago', plano: assinatura.plano, valido_ate: assinatura.valido_ate };
  }

  const pedido = pedidoJaConsultado || await consultarPedido(orderId);
  const situacao = situacaoDoPedido(pedido);

  if (situacao === 'recusado') {
    await supabase.from('assinaturas').update({ status: 'cancelado' }).eq('id', assinatura.id);
    return { situacao };
  }
  if (situacao !== 'pago') return { situacao };

  const { data: usuario } = await supabase
    .from('usuarios').select('plano, plano_valido_ate').eq('id', assinatura.usuario_id).single();
  const validoAte = novaValidade(usuario, assinatura.plano).toISOString();
  const cobranca = (pedido.charges || []).find((c) => c.status === 'PAID');

  // Só ativa se ainda estiver pendente (evita estender duas vezes em chamadas simultâneas)
  const { data: ativadas, error } = await supabase.from('assinaturas')
    .update({ status: 'ativo', valido_ate: validoAte, pagbank_charge_id: cobranca?.id || null })
    .eq('id', assinatura.id).eq('status', 'pendente')
    .select('id');
  if (error) throw error;

  if (ativadas && ativadas.length) {
    const { error: errUsuario } = await supabase.from('usuarios')
      .update({ plano: assinatura.plano, plano_valido_ate: validoAte })
      .eq('id', assinatura.usuario_id);
    if (errUsuario) throw errUsuario;
    console.log(`[assinatura] plano ${assinatura.plano} liberado até ${validoAte} (pedido ${orderId})`);
  }
  return { situacao: 'pago', plano: assinatura.plano, valido_ate: validoAte };
}

module.exports = { sincronizarPedido, situacaoDoPedido, novaValidade };
