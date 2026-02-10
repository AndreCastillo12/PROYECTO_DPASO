// ===============================
// SUPABASE CONFIG
// ===============================
const SUPABASE_URL = 'https://gtczpfxdkiajprnluokq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0Y3pwZnhka2lhanBybmx1b2txIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzOTc5MTAsImV4cCI6MjA4NTk3MzkxMH0.UrV46fOq-YFQWykvR-eqPmlr-33w1aC7ynmywu_nsQ8';
const FALLBACK_IMAGE = 'images/Logos/logo.jpg';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const animatedElements = new Set();
const fadeObserver = new IntersectionObserver((entries, observer) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;

    entry.target.classList.add('show');
    observer.unobserve(entry.target);
    animatedElements.delete(entry.target);
  });
}, { threshold: 0.15 });

function observeFadeElement(element) {
  if (!element || animatedElements.has(element)) return;
  animatedElements.add(element);
  fadeObserver.observe(element);
}

function buildImageUrl(imageName) {
  if (!imageName) return FALLBACK_IMAGE;
  return `${SUPABASE_URL}/storage/v1/object/public/platos/${imageName}`;
}

function buildPlatoCard(item) {
  const card = document.createElement('div');
  card.className = 'plato fade-up';

  const image = document.createElement('img');
  image.src = buildImageUrl(item.imagen);
  image.alt = item.nombre;

  const title = document.createElement('h3');
  title.textContent = item.nombre;

  const description = document.createElement('p');
  description.textContent = item.descripcion || '';

  const price = document.createElement('span');
  price.textContent = `S/ ${Number(item.precio).toFixed(2)}`;

  card.append(image, title, description, price);
  observeFadeElement(card);

  return card;
}

function buildEmptyCategoryMessage() {
  const emptyCard = document.createElement('div');
  emptyCard.className = 'plato fade-up';

  const message = document.createElement('p');
  message.textContent = 'No hay platos en esta categoría.';

  emptyCard.appendChild(message);
  observeFadeElement(emptyCard);

  return emptyCard;
}

function buildCategoryTitle(category) {
  const title = document.createElement('h2');
  title.className = 'section-title fade-up';
  title.id = category.id;
  title.textContent = category.nombre;
  observeFadeElement(title);

  return title;
}

function buildNavLink(category) {
  const navLink = document.createElement('a');
  navLink.href = `#${category.id}`;
  navLink.textContent = category.nombre;

  return navLink;
}

function groupPlatosByCategory(platos) {
  return platos.reduce((acc, plato) => {
    if (!acc.has(plato.categoria_id)) acc.set(plato.categoria_id, []);
    acc.get(plato.categoria_id).push(plato);
    return acc;
  }, new Map());
}

async function fetchMenuData() {
  const [platosResponse, categoriasResponse] = await Promise.all([
    supabaseClient.from('platos').select('*').order('orden', { ascending: true }),
    supabaseClient.from('categorias').select('*').order('orden', { ascending: true }),
  ]);

  if (platosResponse.error) throw platosResponse.error;
  if (categoriasResponse.error) throw categoriasResponse.error;

  return {
    platos: platosResponse.data || [],
    categorias: categoriasResponse.data || [],
  };
}

// ===============================
// CARGAR MENÚ Y NAVBAR
// ===============================
async function cargarMenu() {
  const menu = document.getElementById('menu');
  const nav = document.querySelector('.nav');
  if (!menu || !nav) return;

  try {
    const { platos, categorias } = await fetchMenuData();
    const platosByCategory = groupPlatosByCategory(platos);

    const menuFragment = document.createDocumentFragment();
    const navFragment = document.createDocumentFragment();

    categorias.forEach((category) => {
      navFragment.appendChild(buildNavLink(category));
      menuFragment.appendChild(buildCategoryTitle(category));

      const categoryItems = platosByCategory.get(category.id) || [];
      if (categoryItems.length === 0) {
        menuFragment.appendChild(buildEmptyCategoryMessage());
        return;
      }

      categoryItems.forEach((item) => {
        menuFragment.appendChild(buildPlatoCard(item));
      });
    });

    menu.replaceChildren(menuFragment);
    nav.replaceChildren(navFragment);
  } catch (err) {
    console.error('❌ Error cargando menú:', err);
    menu.innerHTML = '<p>Error cargando el menú. Revisa la consola.</p>';
  }
}

// ===============================
// REFRESH MANUAL PARA FRONT
// ===============================
window.refreshMenu = async function refreshMenu() {
  await cargarMenu();
};

// ===============================
// INIT
// ===============================
window.addEventListener('load', async () => {
  await cargarMenu();

  const loader = document.getElementById('loader');
  if (loader) setTimeout(() => loader.classList.add('hide'), 1500);
});
