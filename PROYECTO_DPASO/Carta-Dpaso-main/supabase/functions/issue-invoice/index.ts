import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type IssueInvoiceInput = {
  order_id?: string;
  document_type?: "boleta" | "factura";
  customer_doc_type?: "DNI" | "RUC" | "CE" | "PASSPORT";
  customer_doc_number?: string;
  customer_name?: string;
  idempotency_key?: string;
  force_retry?: boolean;
};

type OrderRow = {
  id: string;
  short_code: string | null;
  nombre_cliente: string | null;
  customer_name: string | null;
  customer_doc_type: string | null;
  customer_doc_number: string | null;
  document_type: string | null;
  total: number | null;
  total_amount: number | null;
  subtotal: number | null;
  delivery_fee: number | null;
  igv_amount: number | null;
  taxable_amount: number | null;
  currency: string | null;
  payment_method: string | null;
  cash_received: number | null;
  cash_change: number | null;
  estado: string | null;
  paid: boolean | null;
  created_at: string;
  invoice_idempotency_key: string | null;
  sunat_status: string | null;
  series: string | null;
  correlativo: number | null;
  qr_text: string | null;
  invoice_retry_count: number | null;
};

type OrderItemRow = {
  nombre_snapshot: string;
  precio_snapshot: number;
  cantidad: number;
  subtotal: number;
};

type ProviderResult = {
  ok: boolean;
  status: "issued" | "accepted" | "rejected" | "error";
  series: string;
  correlativo: number;
  hash: string;
  qr_text: string;
  qr_url: string | null;
  xml_base64: string;
  cdr_base64: string;
  xml_url: string | null;
  cdr_url: string | null;
  provider_raw: Record<string, unknown>;
};

function jsonResponse(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asMoney(value: number) {
  return Number(value || 0).toFixed(2);
}

function sanitizeText(input: string, max = 120): string {
  return String(input || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function formatDateTime(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function escapePdf(text: string) {
  return text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function toBase64(input: string) {
  return fromBytesToBase64(new TextEncoder().encode(input));
}

function fromBytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function buildTicketHtml(params: {
  order: OrderRow;
  items: OrderItemRow[];
  docTypeLabel: string;
  fullNumber: string;
  issueDate: Date;
  taxableAmount: number;
  igvAmount: number;
  totalAmount: number;
  paymentMethod: string;
  qrText: string;
}) {
  const { order, items, docTypeLabel, fullNumber, issueDate, taxableAmount, igvAmount, totalAmount, paymentMethod, qrText } = params;
  const customerName = sanitizeText(order.customer_name || order.nombre_cliente || "CLIENTE", 120);
  const customerDoc = `${order.customer_doc_type || "DNI"}: ${order.customer_doc_number || "-"}`;
  const issue = formatDateTime(issueDate);
  const paidValue = Number(order.cash_received ?? totalAmount);
  const changeValue = Number(order.cash_change ?? Math.max(paidValue - totalAmount, 0));

  const rows = items
    .map((item) => `
      <tr>
        <td>${item.cantidad}</td>
        <td>${sanitizeText(item.nombre_snapshot, 80)}</td>
        <td style="text-align:right;">${asMoney(Number(item.precio_snapshot || 0))}</td>
        <td style="text-align:right;">${asMoney(Number(item.subtotal || 0))}</td>
      </tr>`)
    .join("\n");

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=320" />
  <style>
    body { font-family: "Courier New", monospace; width: 300px; margin: 0 auto; color: #111; }
    .center { text-align: center; }
    .line { border-top: 1px dashed #444; margin: 8px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    td, th { padding: 2px 0; vertical-align: top; }
    th { border-bottom: 1px dashed #444; }
    .totals td { padding: 1px 0; }
    .muted { color: #444; font-size: 11px; }
    .qr { word-break: break-all; font-size: 10px; border: 1px dashed #555; padding: 6px; }
  </style>
</head>
<body>
  <div class="center">
    <strong>DPASO COCINA LIBRE</strong><br />
    RUC: 20609999991<br />
    Dirección: Mz WI Lt. 37, Calle 46<br />
    San Antonio de Carapongo - Lima
  </div>
  <div class="line"></div>
  <div class="center"><strong>${docTypeLabel}</strong></div>
  <div class="center"><strong>${fullNumber}</strong></div>
  <div class="muted">Fecha emisión: ${issue}</div>
  <div class="muted">Pedido: ${sanitizeText(order.short_code || order.id, 40)}</div>
  <div class="line"></div>
  <div>Cliente: ${customerName}</div>
  <div>${customerDoc}</div>
  <div class="line"></div>
  <table>
    <thead>
      <tr><th>CANT</th><th>DESCRIPCIÓN</th><th style="text-align:right;">P.UNIT</th><th style="text-align:right;">P.TOT</th></tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  <div class="line"></div>
  <table class="totals">
    <tr><td>Op. Gravada</td><td style="text-align:right;">S/ ${asMoney(taxableAmount)}</td></tr>
    <tr><td>IGV (18%)</td><td style="text-align:right;">S/ ${asMoney(igvAmount)}</td></tr>
    <tr><td><strong>Total</strong></td><td style="text-align:right;"><strong>S/ ${asMoney(totalAmount)}</strong></td></tr>
    <tr><td>Pago (${sanitizeText(paymentMethod || "N/A", 24)})</td><td style="text-align:right;">S/ ${asMoney(paidValue)}</td></tr>
    <tr><td>Vuelto</td><td style="text-align:right;">S/ ${asMoney(changeValue)}</td></tr>
  </table>
  <div class="line"></div>
  <div class="qr">QR/TEXT: ${sanitizeText(qrText, 800)}</div>
  <p class="center muted">Representación impresa de comprobante electrónico.</p>
</body>
</html>`;
}

function buildTicketPdfBase64(params: {
  title: string;
  fullNumber: string;
  issueDate: Date;
  customerName: string;
  customerDoc: string;
  items: OrderItemRow[];
  taxableAmount: number;
  igvAmount: number;
  totalAmount: number;
  paymentMethod: string;
  qrText: string;
}) {
  const lines: string[] = [];
  lines.push("DPASO COCINA LIBRE");
  lines.push("RUC 20609999991");
  lines.push(params.title);
  lines.push(params.fullNumber);
  lines.push(`FECHA: ${formatDateTime(params.issueDate)}`);
  lines.push(`CLIENTE: ${sanitizeText(params.customerName, 40)}`);
  lines.push(params.customerDoc);
  lines.push("----------------------------------------");
  lines.push("CNT DESC                 P.U.     P.TOT");
  for (const item of params.items) {
    const desc = sanitizeText(item.nombre_snapshot, 20).padEnd(20, " ");
    const qty = String(item.cantidad).padStart(3, " ");
    const pu = asMoney(Number(item.precio_snapshot || 0)).padStart(8, " ");
    const pt = asMoney(Number(item.subtotal || 0)).padStart(9, " ");
    lines.push(`${qty} ${desc} ${pu} ${pt}`);
  }
  lines.push("----------------------------------------");
  lines.push(`OP.GRAVADA: ${asMoney(params.taxableAmount)}`);
  lines.push(`IGV (18%):  ${asMoney(params.igvAmount)}`);
  lines.push(`TOTAL:      ${asMoney(params.totalAmount)}`);
  lines.push(`PAGO:       ${sanitizeText(params.paymentMethod, 20)}`);
  lines.push(`QR: ${sanitizeText(params.qrText, 120)}`);

  const contentLines = ["BT", "/F1 9 Tf", "1 0 0 1 20 790 Tm", "12 TL"];
  for (const line of lines) {
    contentLines.push(`(${escapePdf(line)}) Tj`);
    contentLines.push("T*");
  }
  contentLines.push("ET");

  const contentStream = contentLines.join("\n");
  const objects: string[] = [];
  objects.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj");
  objects.push("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj");
  objects.push("3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 226 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj");
  objects.push(`4 0 obj << /Length ${contentStream.length} >> stream\n${contentStream}\nendstream endobj`);
  objects.push("5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Courier >> endobj");

  let pdf = "%PDF-1.4\n";
  const xrefOffsets: number[] = [0];
  for (const obj of objects) {
    xrefOffsets.push(pdf.length);
    pdf += `${obj}\n`;
  }

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < xrefOffsets.length; i += 1) {
    pdf += `${String(xrefOffsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  const encoded = new TextEncoder().encode(pdf);
  return fromBytesToBase64(encoded);
}

async function callInvoiceProviderStub(params: {
  providerName: string;
  providerMode: string;
  providerUrl: string;
  providerToken: string;
  order: OrderRow;
  items: OrderItemRow[];
  payload: Record<string, unknown>;
  series: string;
  correlativo: number;
}): Promise<ProviderResult> {
  const { providerName, providerMode, providerUrl, providerToken, order, series, correlativo, payload } = params;
  const fullNumber = `${series}-${String(correlativo).padStart(8, "0")}`;

  if (providerName === "stub" || !providerUrl || !providerToken) {
    const qr = `${order.id}|${fullNumber}|${Number(order.total_amount || order.total || 0).toFixed(2)}|${order.customer_doc_number || "-"}`;
    return {
      ok: true,
      status: providerMode === "sandbox" ? "issued" : "accepted",
      series,
      correlativo,
      hash: crypto.randomUUID().replaceAll("-", "").slice(0, 32),
      qr_text: qr,
      qr_url: null,
      xml_base64: toBase64(`<Invoice><ID>${fullNumber}</ID><Order>${order.id}</Order></Invoice>`),
      cdr_base64: toBase64(`<CDR><ID>${fullNumber}</ID><Result>0</Result></CDR>`),
      xml_url: null,
      cdr_url: null,
      provider_raw: {
        provider: "stub",
        mode: providerMode,
        payload,
      },
    };
  }

  const response = await fetch(providerUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${providerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...payload, series, correlativo }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      status: "error",
      series,
      correlativo,
      hash: "",
      qr_text: "",
      qr_url: null,
      xml_base64: "",
      cdr_base64: "",
      xml_url: null,
      cdr_url: null,
      provider_raw: { status: response.status, body },
    };
  }

  return {
    ok: true,
    status: String(body?.status || "issued") as ProviderResult["status"],
    series: String(body?.series || series),
    correlativo: Number(body?.correlativo || correlativo),
    hash: String(body?.hash || ""),
    qr_text: String(body?.qr_text || ""),
    qr_url: body?.qr_url ? String(body.qr_url) : null,
    xml_base64: String(body?.xml_base64 || ""),
    cdr_base64: String(body?.cdr_base64 || ""),
    xml_url: body?.xml_url ? String(body.xml_url) : null,
    cdr_url: body?.cdr_url ? String(body.cdr_url) : null,
    provider_raw: typeof body === "object" && body ? body as Record<string, unknown> : { body },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse(405, { ok: false, error: "METHOD_NOT_ALLOWED" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const INTERNAL_WEBHOOK_SECRET = String(Deno.env.get("INTERNAL_WEBHOOK_SECRET") || "").trim();

  const INVOICE_PROVIDER_NAME = String(Deno.env.get("INVOICE_PROVIDER_NAME") || "stub").trim();
  const INVOICE_PROVIDER_MODE = String(Deno.env.get("INVOICE_PROVIDER_MODE") || "sandbox").trim();
  const INVOICE_PROVIDER_API_URL = String(Deno.env.get("INVOICE_PROVIDER_API_URL") || "").trim();
  const INVOICE_PROVIDER_TOKEN = String(Deno.env.get("INVOICE_PROVIDER_TOKEN") || "").trim();

  console.log("[issue-invoice] boot", {
    has_supabase_url: Boolean(SUPABASE_URL),
    has_service_role_key: Boolean(SUPABASE_SERVICE_ROLE_KEY),
    has_anon_key: Boolean(SUPABASE_ANON_KEY),
  });

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(500, { ok: false, error: "SUPABASE_ENV_MISSING" });
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let callerType: "system" | "admin" | null = null;
  let callerId: string | null = null;

  try {
    const internalSecret = String(req.headers.get("x-internal-secret") || "").trim();
    const authHeader = req.headers.get("Authorization") || "";
    const apikeyHeader = req.headers.get("apikey") || "";
    const internalSecretUsed = Boolean(INTERNAL_WEBHOOK_SECRET && internalSecret && internalSecret === INTERNAL_WEBHOOK_SECRET);

    if (internalSecretUsed) {
      callerType = "system";
    } else {
      if (!authHeader) {
        console.warn("[issue-invoice] unauthorized: missing auth header", {
          has_authorization_header: false,
          has_apikey_header: Boolean(apikeyHeader),
          used_internal_webhook_secret: internalSecretUsed,
        });
        return jsonResponse(401, { ok: false, error: "UNAUTHORIZED" });
      }

      const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        global: {
          headers: {
            Authorization: authHeader,
            ...(apikeyHeader ? { apikey: apikeyHeader } : {}),
          },
        },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: userData, error: userError } = await userClient.auth.getUser();
      if (userError || !userData?.user?.id) {
        console.warn("[issue-invoice] unauthorized: auth.getUser failed", {
          has_authorization_header: Boolean(authHeader),
          has_apikey_header: Boolean(apikeyHeader),
          used_internal_webhook_secret: internalSecretUsed,
          auth_error: userError?.message || null,
        });
        return jsonResponse(401, { ok: false, error: "UNAUTHORIZED" });
      }

      const { data: roleRow, error: roleError } = await adminClient
        .from("admin_panel_user_roles")
        .select("role")
        .eq("user_id", userData.user.id)
        .maybeSingle();
      if (roleError) return jsonResponse(500, { ok: false, error: "ROLE_LOOKUP_FAILED", detail: roleError.message });

      const role = String(roleRow?.role || "").toLowerCase();
      if (!role || (role !== "admin" && role !== "superadmin")) {
        return jsonResponse(403, { ok: false, error: "FORBIDDEN" });
      }

      callerType = "admin";
      callerId = userData.user.id;
    }

    const body = await req.json() as IssueInvoiceInput;
    const orderId = String(body?.order_id || "").trim();
    if (!orderId) return jsonResponse(400, { ok: false, error: "ORDER_ID_REQUIRED" });

    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .select("id,short_code,nombre_cliente,customer_name,customer_doc_type,customer_doc_number,document_type,total,total_amount,subtotal,delivery_fee,igv_amount,taxable_amount,currency,payment_method,cash_received,cash_change,estado,paid,created_at,invoice_idempotency_key,sunat_status,series,correlativo,qr_text,invoice_retry_count")
      .eq("id", orderId)
      .maybeSingle<OrderRow>();
    if (orderError) return jsonResponse(500, { ok: false, error: "ORDER_FETCH_FAILED", detail: orderError.message });
    if (!order) return jsonResponse(404, { ok: false, error: "ORDER_NOT_FOUND" });

    const requestedIdempotency = sanitizeText(body.idempotency_key || order.invoice_idempotency_key || crypto.randomUUID(), 120);
    const forceRetry = Boolean(body.force_retry);

    if (!forceRetry && ["issued", "accepted"].includes(String(order.sunat_status || ""))) {
      return jsonResponse(200, {
        ok: true,
        status: "already_issued",
        order_id: order.id,
        series: order.series,
        correlativo: order.correlativo,
        qr_text: order.qr_text,
      });
    }

    const documentType = String(body.document_type || order.document_type || "boleta").toLowerCase();
    if (!["boleta", "factura"].includes(documentType)) {
      return jsonResponse(400, { ok: false, error: "INVALID_DOCUMENT_TYPE" });
    }

    const customerDocType = String(body.customer_doc_type || order.customer_doc_type || (documentType === "factura" ? "RUC" : "DNI")).toUpperCase();
    const customerDocNumber = sanitizeText(body.customer_doc_number || order.customer_doc_number || "", 20);
    const customerName = sanitizeText(body.customer_name || order.customer_name || order.nombre_cliente || "CLIENTE", 140);

    if (documentType === "factura" && (customerDocType !== "RUC" || customerDocNumber.length !== 11)) {
      return jsonResponse(400, { ok: false, error: "FACTURA_REQUIRES_VALID_RUC" });
    }

    const { data: items, error: itemsError } = await adminClient
      .from("order_items")
      .select("nombre_snapshot,precio_snapshot,cantidad,subtotal")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true })
      .returns<OrderItemRow[]>();

    if (itemsError) return jsonResponse(500, { ok: false, error: "ORDER_ITEMS_FETCH_FAILED", detail: itemsError.message });
    if (!items || items.length === 0) return jsonResponse(400, { ok: false, error: "ORDER_ITEMS_EMPTY" });

    const totalAmount = Number(order.total_amount ?? order.total ?? 0);
    const taxableAmount = Number(order.taxable_amount ?? Number((totalAmount / 1.18).toFixed(2)));
    const igvAmount = Number(order.igv_amount ?? Number((totalAmount - taxableAmount).toFixed(2)));

    const { error: markProcessingError } = await adminClient
      .from("orders")
      .update({
        sunat_status: "processing",
        sunat_error: null,
        document_type: documentType,
        customer_doc_type: customerDocType,
        customer_doc_number: customerDocNumber || null,
        customer_name: customerName,
        invoice_last_attempt_at: new Date().toISOString(),
        invoice_retry_count: Number(order.invoice_retry_count || 0),
        invoice_idempotency_key: requestedIdempotency,
      })
      .eq("id", orderId);

    if (markProcessingError) {
      return jsonResponse(500, { ok: false, error: "ORDER_MARK_PROCESSING_FAILED", detail: markProcessingError.message });
    }

    const { data: corrData, error: corrError } = await adminClient.rpc("rpc_next_sunat_correlative", {
      p_document_type: documentType,
    });

    if (corrError || !Array.isArray(corrData) || !corrData[0]) {
      await adminClient.from("orders").update({ sunat_status: "error", sunat_error: "CORRELATIVE_ASSIGN_FAILED" }).eq("id", orderId);
      return jsonResponse(500, { ok: false, error: "CORRELATIVE_ASSIGN_FAILED", detail: corrError?.message || "NO_DATA" });
    }

    const row = corrData[0] as { series: string; correlativo: number; full_number: string };
    const issueDate = new Date();

    const payload = {
      order_id: orderId,
      document_type: documentType,
      issue_datetime: issueDate.toISOString(),
      series: row.series,
      correlativo: row.correlativo,
      customer: {
        doc_type: customerDocType,
        doc_number: customerDocNumber,
        name: customerName,
      },
      currency: order.currency || "PEN",
      totals: {
        op_gravada: taxableAmount,
        igv: igvAmount,
        total: totalAmount,
      },
      payment_method: order.payment_method || "no_especificado",
      items,
    };

    const providerResult = await callInvoiceProviderStub({
      providerName: INVOICE_PROVIDER_NAME,
      providerMode: INVOICE_PROVIDER_MODE,
      providerUrl: INVOICE_PROVIDER_API_URL,
      providerToken: INVOICE_PROVIDER_TOKEN,
      order,
      items,
      payload,
      series: row.series,
      correlativo: row.correlativo,
    });

    const docLabel = documentType === "factura" ? "FACTURA ELECTRÓNICA" : "BOLETA DE VENTA ELECTRÓNICA";
    const fullNumber = `${providerResult.series}-${String(providerResult.correlativo).padStart(8, "0")}`;
    const paymentMethod = sanitizeText(order.payment_method || "no_especificado", 20);

    const qrText = providerResult.qr_text || `${fullNumber}|${customerDocType}|${customerDocNumber}|${asMoney(totalAmount)}`;
    const ticketHtml = buildTicketHtml({
      order,
      items,
      docTypeLabel: docLabel,
      fullNumber,
      issueDate,
      taxableAmount,
      igvAmount,
      totalAmount,
      paymentMethod,
      qrText,
    });

    const ticketPdfBase64 = buildTicketPdfBase64({
      title: docLabel,
      fullNumber,
      issueDate,
      customerName,
      customerDoc: `${customerDocType}: ${customerDocNumber || "-"}`,
      items,
      taxableAmount,
      igvAmount,
      totalAmount,
      paymentMethod,
      qrText,
    });

    const status = providerResult.ok ? providerResult.status : "error";

    const { error: saveError } = await adminClient
      .from("orders")
      .update({
        document_type: documentType,
        series: providerResult.series,
        correlativo: providerResult.correlativo,
        sunat_status: status,
        sunat_error: providerResult.ok ? null : JSON.stringify(providerResult.provider_raw),
        sunat_provider: INVOICE_PROVIDER_NAME,
        xml_url: providerResult.xml_url,
        xml_base64: providerResult.xml_base64,
        cdr_url: providerResult.cdr_url,
        cdr_base64: providerResult.cdr_base64,
        hash: providerResult.hash || null,
        qr_text: qrText,
        qr_url: providerResult.qr_url,
        customer_doc_type: customerDocType,
        customer_doc_number: customerDocNumber || null,
        customer_name: customerName,
        taxable_amount: taxableAmount,
        igv_amount: igvAmount,
        total_amount: totalAmount,
        currency: order.currency || "PEN",
        issue_datetime: issueDate.toISOString(),
        invoice_last_attempt_at: issueDate.toISOString(),
        invoice_retry_count: Number(order.invoice_retry_count || 0) + 1,
        invoice_payload: payload,
        invoice_response: providerResult.provider_raw,
        ticket_html: ticketHtml,
        ticket_pdf_base64: ticketPdfBase64,
        invoice_issued_at: providerResult.ok ? issueDate.toISOString() : null,
      })
      .eq("id", orderId);

    if (saveError) return jsonResponse(500, { ok: false, error: "ORDER_INVOICE_SAVE_FAILED", detail: saveError.message });

    await adminClient.from("invoice_issue_attempts").insert({
      order_id: orderId,
      attempt_number: Number(order.invoice_retry_count || 0) + 1,
      status,
      caller_type: callerType,
      caller_id: callerId,
      request_payload: payload,
      provider_response: providerResult.provider_raw,
      error_message: providerResult.ok ? null : JSON.stringify(providerResult.provider_raw),
    });

    return jsonResponse(providerResult.ok ? 200 : 502, {
      ok: providerResult.ok,
      order_id: orderId,
      document_type: documentType,
      status,
      series: providerResult.series,
      correlativo: providerResult.correlativo,
      full_number: fullNumber,
      hash: providerResult.hash,
      qr_text: qrText,
      ticket_html: ticketHtml,
      ticket_pdf_base64: ticketPdfBase64,
    });
  } catch (error) {
    return jsonResponse(500, { ok: false, error: "UNEXPECTED_ERROR", detail: (error as Error)?.message || String(error) });
  }
});
