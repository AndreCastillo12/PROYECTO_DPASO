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

type ResendResult = {
  ok: boolean;
  status: number;
  body: unknown;
};

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

function truncateForLog(value: unknown, max = 1200) {
  const asString = typeof value === 'string' ? value : JSON.stringify(value ?? {});
  if (!asString) return '';
  return asString.length > max ? `${asString.slice(0, max)}...[truncated]` : asString;
}

async function sendResendEmail(params: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<ResendResult> {
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
  const orderEmail = String(order?.email || '').trim().toLowerCase();
  const orderReceiptEmail = String(order?.receipt_email || '').trim().toLowerCase();
  return orderEmail || orderReceiptEmail;
}

async function updateOrderDeliveryStatus(
  supabase: ReturnType<typeof createClient>,
  orderId: string,
  payload: Record<string, unknown>
) {
  const { error } = await supabase.from('orders').update(payload).eq('id', orderId);
  if (!error) return;

  const isMissingColumn =
    error?.code === '42703' ||
    String(error?.message || '').toLowerCase().includes('column') ||
    String(error?.message || '').toLowerCase().includes('does not exist');

  if (!isMissingColumn) throw error;

  console.warn('[send-receipt] Fallback a update legacy por columnas ausentes', {
    order_id: orderId,
    original_error: truncateForLog({ code: error.code, message: error.message })
  });

  const legacyPayload: Record<string, unknown> = {
    receipt_email: payload.receipt_email ?? null,
    receipt_send_status: payload.receipt_send_status,
    receipt_last_attempt_at: payload.receipt_last_attempt_at,
    receipt_sent_at: payload.receipt_sent_at ?? null,
    receipt_send_error: payload.receipt_send_error ?? null
  };

  const { error: legacyError } = await supabase.from('orders').update(legacyPayload).eq('id', orderId);
  if (legacyError) throw legacyError;
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
    if (!Deno.env.get('DPASO_SERVICE_ROLE_KEY')) {
      throw new Error('Missing DPASO_SERVICE_ROLE_KEY secret');
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const DPASO_SERVICE_ROLE_KEY = Deno.env.get('DPASO_SERVICE_ROLE_KEY') ?? '';
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
    const ORDERS_NOTIFY_EMAIL = String(Deno.env.get('ORDERS_NOTIFY_EMAIL') ?? '').trim().toLowerCase();
    const INTERNAL_WEBHOOK_SECRET = String(Deno.env.get('INTERNAL_WEBHOOK_SECRET') ?? '').trim();
    const RESEND_FROM_EMAIL = String(Deno.env.get('RESEND_FROM_EMAIL') ?? '').trim() || 'DPASO <no-reply@dpasococinalibre.com>';

    const payload = (await req.json()) as ReceiptInput;
    const isWebhookInvocation = Boolean(payload?.record?.id);
    const orderId = String(payload?.order_id || payload?.record?.id || '').trim();
    const token = String(payload?.token || '').trim();

    console.log('[send-receipt] Inicio', {
      order_id: orderId || null,
      has_token: Boolean(token),
      is_webhook: isWebhookInvocation,
      has_record_id: Boolean(payload?.record?.id),
      secrets_present: {
        has_supabase_url: Boolean(SUPABASE_URL),
        has_service_role: Boolean(DPASO_SERVICE_ROLE_KEY),
        has_resend_key: Boolean(RESEND_API_KEY),
        has_notify_email: Boolean(ORDERS_NOTIFY_EMAIL),
        has_internal_secret: Boolean(INTERNAL_WEBHOOK_SECRET),
        has_from_email: Boolean(RESEND_FROM_EMAIL)
      }
    });

    if (!SUPABASE_URL || !DPASO_SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ENV_MISSING');
    }

    if (!RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY_MISSING');
    }

    if (!isValidEmail(ORDERS_NOTIFY_EMAIL)) {
      throw new Error('ORDERS_NOTIFY_EMAIL_MISSING_OR_INVALID');
    }

    if (!orderId) {
      return new Response(JSON.stringify({ error: 'ORDER_ID_REQUIRED' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(SUPABASE_URL, DPASO_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id,short_code,nombre_cliente,telefono,modalidad,direccion,referencia,total,subtotal,delivery_fee,provincia,distrito,created_at,receipt_token,email,receipt_email')
      .eq('id', orderId)
      .maybeSingle();

    console.log('[send-receipt] Resultado query order', {
      order_id: orderId,
      found: Boolean(order),
      has_order_error: Boolean(orderError),
      order_error: orderError ? truncateForLog({ code: orderError.code, message: orderError.message }) : null
    });

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
    } else if (!hasValidInternalSecret && (!token || token !== orderReceiptToken)) {
      return new Response(JSON.stringify({ error: 'INVALID_TOKEN' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select('nombre_snapshot,precio_snapshot,cantidad,subtotal')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });

    console.log('[send-receipt] Resultado query items', {
      order_id: orderId,
      count: Array.isArray(items) ? items.length : 0,
      has_items_error: Boolean(itemsError),
      items_error: itemsError ? truncateForLog({ code: itemsError.code, message: itemsError.message }) : null
    });

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

      console.log('[send-receipt] Resend cliente', {
        order_id: orderId,
        status: customerResult.status,
        ok: customerResult.ok,
        body: truncateForLog(customerResult.body)
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
        customerError = truncateForLog(customerResult.body, 1400);
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

    console.log('[send-receipt] Resend interno', {
      order_id: orderId,
      status: internalResult.status,
      ok: internalResult.ok,
      body: truncateForLog(internalResult.body)
    });

    const internalStatus: Exclude<DeliveryStatus, 'skipped'> = internalResult.ok ? 'sent' : 'failed';
    const internalError = internalResult.ok ? null : truncateForLog(internalResult.body, 1400);

    if (internalResult.ok) {
      console.log('[send-receipt] Correo interno enviado', {
        order_id: orderId,
        notify_email: ORDERS_NOTIFY_EMAIL,
        resend_status: internalResult.status
      });
    }

    const legacyStatus = internalResult.ok ? 'sent' : (customerStatus === 'sent' ? 'sent' : 'failed');
    const legacyError = [customerError, internalError].filter(Boolean).join(' | ') || null;

    await updateOrderDeliveryStatus(supabase, orderId, {
      receipt_email: isValidEmail(customerEmail) ? customerEmail : null,
      receipt_send_status: legacyStatus,
      receipt_last_attempt_at: new Date().toISOString(),
      receipt_sent_at: internalResult.ok || customerStatus === 'sent' ? new Date().toISOString() : null,
      receipt_send_error: legacyError,
      receipt_send_status_customer: customerStatus,
      receipt_send_status_internal: internalStatus,
      receipt_send_error_customer: customerError,
      receipt_send_error_internal: internalError
    });

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
    const err = error as Error & { stack?: string };
    const details = {
      message: String(err?.message || error),
      stack: String(err?.stack || '').slice(0, 3500)
    };

    console.error('[send-receipt] UNEXPECTED_ERROR', details);

    return new Response(JSON.stringify({ error: 'UNEXPECTED_ERROR', details }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
