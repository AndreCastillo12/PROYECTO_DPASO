# Carta DPASO

## Emisión electrónica SUNAT (Boleta/Factura)

Este repositorio incluye una arquitectura base para emitir comprobantes electrónicos con integración futura a un **PSE/OSEE** real.

## Entregables implementados

- Migración SQL: `supabase/sprint52_sunat_einvoice_foundation.sql`
  - Columnas en `orders` para documento electrónico (`document_type`, `series`, `correlativo`, `sunat_status`, `xml_*`, `cdr_*`, `hash`, `qr_*`, cliente, montos, etc.).
  - Tabla `sunat_document_series` para control de series/correlativos.
  - Tabla `invoice_issue_attempts` para logging, reintentos y auditoría.
  - RPC `rpc_next_sunat_correlative(p_document_type)` para asignación atómica de correlativo.
  - RPC `rpc_queue_invoice_issue(...)` para dejar orden en cola de emisión.

- Edge Function: `supabase/functions/issue-invoice/index.ts`
  - Valida caller (admin por JWT o sistema vía `x-internal-secret`).
  - Usa `service_role` para acceso seguro e interno.
  - Construye payload de comprobante con items, op. gravada, IGV y total.
  - Llama a provider abstracto (stub listo para conectar PSE real).
  - Guarda en `orders` la respuesta SUNAT/proveedor (serie, correlativo, hash, QR, XML/CDR, estado).
  - Log de intentos en `invoice_issue_attempts`.
  - Genera representación impresa:
    - HTML ticket 80mm (para correo).
    - PDF base64 (layout ticket con ancho térmico aproximado).

## Variables de entorno para `issue-invoice`

Obligatorias:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Seguridad:

- `INTERNAL_WEBHOOK_SECRET` (requerido para invocación sistema a sistema)

Provider (PSE/OSEE):

- `INVOICE_PROVIDER_NAME` (`stub` por defecto)
- `INVOICE_PROVIDER_MODE` (`sandbox` o `production`)
- `INVOICE_PROVIDER_API_URL` (URL del proveedor)
- `INVOICE_PROVIDER_TOKEN` (token/API key del proveedor)

## Flujo recomendado

1. Pedido confirmado/pagado en POS/admin.
2. Se marca cola de emisión:
   - `rpc_queue_invoice_issue(order_id, document_type, customer_doc_type, customer_doc_number, customer_name, idempotency_key)`.
3. Invocar Edge Function `issue-invoice` con `order_id`.
4. Function:
   - valida permisos,
   - toma correlativo atómico,
   - emite vía provider,
   - persiste resultado + ticket HTML/PDF,
   - registra intento para reintentos.
5. Si falla (`sunat_status = error/rejected`), se puede reintentar con `force_retry = true`.

## Integración con PSE/OSEE real

En `issue-invoice`, la función `callInvoiceProviderStub` ya define el contrato que debe cumplir el proveedor.

### Contrato esperado (salida provider)

- `status`: `issued | accepted | rejected | error`
- `series`, `correlativo`
- `hash`
- `qr_text` / `qr_url`
- `xml_base64` / `xml_url`
- `cdr_base64` / `cdr_url`
- `provider_raw` (payload crudo para auditoría)

### Checklist de conexión

- [ ] Registrar series en SUNAT (B/F) y alinearlas con `sunat_document_series`.
- [ ] Configurar credenciales sandbox y production del proveedor.
- [ ] Validar estructura UBL 2.1 y catálogos SUNAT (tipos de doc, moneda, IGV).
- [ ] Definir timeout/reintentos exponenciales para proveedor.
- [ ] Activar alertas por `sunat_status in ('error','rejected')`.
- [ ] Definir política de contingencia (emisión diferida / cola).
- [ ] Verificar render de ticket 80mm en impresora térmica real.
- [ ] Revisar cumplimiento legal de representación impresa y QR.

## Notas operativas

- El favicon circular de DPASO está en `public/images/Logos/favicon-circle.svg` y referenciado en `public/index.html` y `public/reset-password/index.html`.
- El estado idempotente se soporta con `invoice_idempotency_key` en `orders` y retorno temprano si ya existe documento emitido/aceptado.
