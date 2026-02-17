# Carta DPASO React (Vite)

Migración de la carta pública desde `Carta-Dpaso-main` a React + Vite.

## Variables de entorno

Crear `.env` con:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## Desarrollo local

```bash
npm install
npm run dev
```

## Build / Deploy

```bash
npm run build
```

Salida: `dist/`

### Vercel
- Framework preset: **Vite**
- Build command: `npm run build`
- Output directory: `dist`
- Environment Variables:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

## QA checklist
- Buscar plato
- Agregar al carrito
- Checkout invitado
- Login por correo / Google
- Ver pedidos
- Editar perfil + avatar preview/upload
- Uso prolongado sin congelamiento
