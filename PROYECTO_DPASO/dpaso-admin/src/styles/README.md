# Styles structure (`src/styles`)

## Responsabilidades

- `../index.css`
  - Reset base + design tokens globales (`:root`, tipografía, background, box-sizing).
- `global.css`
  - Estilos globales de elementos nativos y utilidades reutilizables.
- `layout.css`
  - Clases de layout genérico de páginas/containers.
- `admin-shell.css`
  - Layout principal del panel administrativo (sidebar/topbar/content).

## Estilos por página

- `dashboard.css`
- `pedidos.css`
- `clientes.css`
- `categorias.css`
- `platos.css`
- `order-detail.css`
- `login.css`

Convención:
- Un archivo CSS por página para evitar duplicidad.
- Nombres de archivo sin sufijos históricos (`-sedap`).
- Mantener componentes compartidos en `global.css` o `layout.css`, no en CSS de página.
