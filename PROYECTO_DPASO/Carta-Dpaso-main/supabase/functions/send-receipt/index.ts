import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

type ReceiptInput = {
  order_id?: string;
  token?: string;
  record?: {
    id?: string;
  };
};

type DeliveryStatus = 'sent' | 'failed' | 'skipped';

function isValidEmail(email = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(input = '') {
  return String(input)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function sendResendEmail(params: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: params.from,
      to: [params.to],
      subject: params.subject,
      html: params.html,
      text: params.text
    })
  });

  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

function resolveCustomerEmail(order: Record<string, unknown> | null) {
  const orderCustomerEmail = String(order?.customer_email || '').trim().toLowerCase();
  const orderEmail = String(order?.email || '').trim().toLowerCase();
  const orderReceiptEmail = String(order?.receipt_email || '').trim().toLowerCase();
  return orderCustomerEmail || orderEmail || orderReceiptEmail;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
    const ORDERS_NOTIFY_EMAIL = String(Deno.env.get('ORDERS_NOTIFY_EMAIL') ?? '').trim().toLowerCase();
    const INTERNAL_WEBHOOK_SECRET = String(Deno.env.get('INTERNAL_WEBHOOK_SECRET') ?? '').trim();
    const RESEND_FROM_EMAIL = String(Deno.env.get('RESEND_FROM_EMAIL') ?? '').trim() || 'DPASO <no-reply@dpasococinalibre.com>';

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ENV_MISSING');
    }

    if (!RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY_MISSING');
    }

    if (!isValidEmail(ORDERS_NOTIFY_EMAIL)) {
      throw new Error('ORDERS_NOTIFY_EMAIL_MISSING_OR_INVALID');
    }

    const payload = (await req.json()) as ReceiptInput;
    const isWebhookInvocation = Boolean(payload?.record?.id);
    const orderId = String(payload?.order_id || payload?.record?.id || '').trim();
    const token = String(payload?.token || '').trim();

    if (!orderId) {
      return new Response(JSON.stringify({ error: 'ORDER_ID_REQUIRED' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id,short_code,nombre_cliente,telefono,modalidad,direccion,referencia,total,subtotal,delivery_fee,provincia,distrito,created_at,receipt_token,customer_email,email,receipt_email')
      .eq('id', orderId)
      .maybeSingle();

    if (orderError) throw orderError;
    if (!order) {
      return new Response(JSON.stringify({ error: 'ORDER_NOT_FOUND' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const orderReceiptToken = String(order.receipt_token || '').trim();
    const internalHeaderSecret = String(req.headers.get('x-internal-secret') || '').trim();
    const hasValidInternalSecret = Boolean(
      isWebhookInvocation
      && INTERNAL_WEBHOOK_SECRET
      && internalHeaderSecret
      && internalHeaderSecret === INTERNAL_WEBHOOK_SECRET
    );

    if (!isWebhookInvocation) {
      if (!token || token !== orderReceiptToken) {
        return new Response(JSON.stringify({ error: 'INVALID_TOKEN' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    } else if (!hasValidInternalSecret) {
      if (!token || token !== orderReceiptToken) {
        return new Response(JSON.stringify({ error: 'INVALID_TOKEN' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select('nombre_snapshot,precio_snapshot,cantidad,subtotal')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });

    if (itemsError) throw itemsError;

    const customerEmail = resolveCustomerEmail(order as Record<string, unknown>);
    const safeItems = (items || []).map((item) => ({
      nombre: escapeHtml(item.nombre_snapshot || ''),
      cantidad: Number(item.cantidad || 0),
      precio: Number(item.precio_snapshot || 0),
      subtotal: Number(item.subtotal || 0)
    }));

    const subtotal = Number(order.subtotal ?? order.total ?? 0);
    const delivery = Number(order.delivery_fee ?? 0);
    const total = Number(order.total ?? 0);
    const shortCode = String(order.short_code || order.id || '').toUpperCase();

    const html = `
      <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.4;max-width:680px;margin:0 auto;">
        <h2 style="color:#0b2d4d;margin-bottom:6px;">DPASO · Comprobante de pedido</h2>
        <p style="margin:0 0 12px;">Pedido <strong>#${escapeHtml(shortCode)}</strong> generado correctamente.</p>
        <div style="border:1px dashed #88a9c7;border-radius:10px;padding:12px;background:#f8fbff;">
          <p><strong>Cliente:</strong> ${escapeHtml(order.nombre_cliente || '-')}</p>
          <p><strong>Teléfono:</strong> ${escapeHtml(order.telefono || '-')}</p>
          <p><strong>Modalidad:</strong> ${escapeHtml(order.modalidad || '-')}</p>
          <p><strong>Zona:</strong> ${escapeHtml(order.modalidad === 'Delivery' ? `${order.provincia || '-'} - ${order.distrito || '-'}` : 'No aplica')}</p>
          <p><strong>Dirección:</strong> ${escapeHtml(order.direccion || 'No aplica')}</p>
          <p><strong>Referencia:</strong> ${escapeHtml(order.referencia || '-')}</p>
          <p><strong>Subtotal:</strong> S/ ${subtotal.toFixed(2)}</p>
          <p><strong>Delivery:</strong> S/ ${delivery.toFixed(2)}</p>
          <p><strong>Total final:</strong> S/ ${total.toFixed(2)}</p>
          <hr style="border:none;border-top:1px solid #d6e4f2;margin:10px 0;" />
          <p><strong>Items</strong></p>
          <ul style="padding-left:18px;margin:6px 0;">
            ${safeItems.map((item) => `<li>${item.nombre} · Cantidad: ${item.cantidad} · Precio: S/ ${item.precio.toFixed(2)} · Subtotal: S/ ${item.subtotal.toFixed(2)}</li>`).join('')}
          </ul>
        </div>
      </div>
    `;

    const internalHtml = `
      <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.4;max-width:680px;margin:0 auto;">
        <h2 style="color:#0b2d4d;margin-bottom:6px;">DPASO · Nuevo pedido</h2>
        <p style="margin:0 0 12px;">Se registró el pedido <strong>#${escapeHtml(shortCode)}</strong>.</p>
        ${html}
      </div>
    `;

    let customerStatus: DeliveryStatus = 'skipped';
    let customerError: string | null = null;

    if (isValidEmail(customerEmail)) {
      const customerResult = await sendResendEmail({
        apiKey: RESEND_API_KEY,
        from: RESEND_FROM_EMAIL,
        to: customerEmail,
        subject: `Comprobante DPASO #${shortCode}`,
        html,
        text: `DPASO - Comprobante #${shortCode}\nTotal: S/ ${total.toFixed(2)}`
      });

      if (customerResult.ok) {
        customerStatus = 'sent';
        console.log('[send-receipt] Correo enviado al cliente', {
          order_id: orderId,
          customer_email: customerEmail,
          resend_status: customerResult.status
        });
      } else {
        customerStatus = 'failed';
        customerError = JSON.stringify(customerResult.body || {}).slice(0, 1400);
      }
    } else {
      customerStatus = 'skipped';
      customerError = 'CUSTOMER_EMAIL_MISSING_OR_INVALID';
      console.warn('[send-receipt] Email de cliente ausente o inválido; se omite envío al cliente', {
        order_id: orderId,
        raw_customer_email: customerEmail || null
      });
    }

    const internalResult = await sendResendEmail({
      apiKey: RESEND_API_KEY,
      from: RESEND_FROM_EMAIL,
      to: ORDERS_NOTIFY_EMAIL,
      subject: `Nuevo pedido DPASO #${shortCode}`,
      html: internalHtml,
      text: `Nuevo pedido #${shortCode}\nCliente: ${String(order.nombre_cliente || '-')}`
    });

    const internalStatus: Exclude<DeliveryStatus, 'skipped'> = internalResult.ok ? 'sent' : 'failed';
    const internalError = internalResult.ok ? null : JSON.stringify(internalResult.body || {}).slice(0, 1400);

    if (internalResult.ok) {
      console.log('[send-receipt] Correo interno enviado', {
        order_id: orderId,
        notify_email: ORDERS_NOTIFY_EMAIL,
        resend_status: internalResult.status
      });
    }

    const legacyStatus = internalResult.ok ? 'sent' : (customerStatus === 'sent' ? 'sent' : 'failed');
    const legacyError = [customerError, internalError].filter(Boolean).join(' | ') || null;

    await supabase
      .from('orders')
      .update({
        receipt_email: isValidEmail(customerEmail) ? customerEmail : null,
        receipt_send_status: legacyStatus,
        receipt_last_attempt_at: new Date().toISOString(),
        receipt_sent_at: internalResult.ok || customerStatus === 'sent' ? new Date().toISOString() : null,
        receipt_send_error: legacyError,
        receipt_send_status_customer: customerStatus,
        receipt_send_status_internal: internalStatus,
        receipt_send_error_customer: customerError,
        receipt_send_error_internal: internalError
      })
      .eq('id', orderId);

    if (!internalResult.ok) {
      return new Response(JSON.stringify({
        error: 'RESEND_ERROR_INTERNAL',
        details: internalResult.body,
        customer_status: customerStatus,
        customer_error: customerError
      }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      provider: 'resend',
      customer_status: customerStatus,
      customer_error: customerError,
      internal_status: internalStatus
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'UNEXPECTED_ERROR', details: String(error?.message || error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
