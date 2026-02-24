import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

type ReceiptInput = {
  order_id?: string;
  email?: string;
  token?: string;
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
    const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') ?? 'DPASO <onboarding@resend.dev>';

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ENV_MISSING');
    }

    if (!RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY_MISSING');
    }

    const payload = (await req.json()) as ReceiptInput;
    const orderId = String(payload?.order_id || '').trim();
    const email = String(payload?.email || '').trim().toLowerCase();
    const token = String(payload?.token || '').trim();

    if (!orderId) {
      return new Response(JSON.stringify({ error: 'ORDER_ID_REQUIRED' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!isValidEmail(email)) {
      return new Response(JSON.stringify({ error: 'INVALID_EMAIL' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!token) {
      return new Response(JSON.stringify({ error: 'INVALID_TOKEN' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id,short_code,nombre_cliente,telefono,modalidad,direccion,referencia,total,subtotal,delivery_fee,provincia,distrito,created_at,receipt_token')
      .eq('id', orderId)
      .maybeSingle();

    if (orderError) throw orderError;
    if (!order) {
      return new Response(JSON.stringify({ error: 'ORDER_NOT_FOUND' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (String(order.receipt_token || '') !== token) {
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

    if (itemsError) throw itemsError;

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

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [email],
        subject: `Comprobante DPASO #${shortCode}`,
        html,
        text: `DPASO - Comprobante #${shortCode}\nTotal: S/ ${total.toFixed(2)}`
      })
    });

    const resendBody = await resendResponse.json().catch(() => ({}));

    if (!resendResponse.ok) {
      const resendError = JSON.stringify(resendBody || {}).slice(0, 1400);
      await supabase
        .from('orders')
        .update({
          receipt_email: email,
          receipt_send_status: 'failed',
          receipt_last_attempt_at: new Date().toISOString(),
          receipt_send_error: resendError
        })
        .eq('id', orderId);

      return new Response(JSON.stringify({ error: 'RESEND_ERROR', details: resendBody }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    await supabase
      .from('orders')
      .update({
        receipt_email: email,
        receipt_send_status: 'sent',
        receipt_last_attempt_at: new Date().toISOString(),
        receipt_sent_at: new Date().toISOString(),
        receipt_send_error: null
      })
      .eq('id', orderId);

    return new Response(JSON.stringify({ ok: true, provider: 'resend', result: resendBody }), {
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
