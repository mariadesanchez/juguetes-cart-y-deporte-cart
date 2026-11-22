// Tiendas hechas con Tiendanube (Brickstore, la tienda oficial de LEGO en Argentina).
// La página de búsqueda trae cada producto con sus datos (precio, stock, SKU) en el atributo data-variants
// y un bloque ld+json con el nombre, la foto y el link.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36';

const desHtml = s => String(s || '').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function parsear(html, host, opciones) {
  const o = opciones || {};
  const bloques = String(html || '').split(/class="js-item-product[\s"]/).slice(1);
  return bloques.map(b => {
    let v = {};
    const mv = /data-variants="([^"]*)"/.exec(b);
    if (mv) { try { v = (JSON.parse(desHtml(mv[1])) || [])[0] || {}; } catch (_) { v = {}; } }
    let ld = {};
    const ml = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(b);
    if (ml) { try { ld = JSON.parse(ml[1]); } catch (_) { ld = {}; } }
    const precio = Number(v.price_number) || Number(ld.offers && ld.offers.price) || 0;
    if (!(precio > 0)) return null;
    let nombre = String(ld.name || desHtml((/title="([^"]+)"/.exec(b) || [])[1]) || '').replace(/\s+/g, ' ').trim();
    if (!nombre) return null;
    if (o.marca && !new RegExp('\\b' + o.marca + '\\b', 'i').test(nombre)) nombre = o.marca + ' ' + nombre;   // "LEGO Bombardero TIE #75347": así se reconoce el número de set
    const lista = Number(v.compare_at_price_number) || 0;
    const link = (ld.offers && ld.offers.url) || ((/href="(https?:\/\/[^"]*\/productos\/[^"]+)"/.exec(b) || [])[1]) || '';
    let imagen = Array.isArray(ld.image) ? ld.image[0] : ld.image;
    if (!imagen) { const mi = /(?:data-srcset|srcset|data-src|src)="([^" ]*mitiendanube[^" ]*)/.exec(b); imagen = mi ? mi[1] : ''; }
    imagen = String(imagen || '').replace(/^\/\//, 'https://');
    const sku = String(v.sku || ld.sku || '');
    const disponible = v.available !== false && !(v.stock === 0);
    return {
      nombre, marca: o.marca || ((ld.brand && ld.brand.name) || ''),
      ean: /^\d{8,14}$/.test(String(ld.gtin13 || ld.gtin || '')) ? String(ld.gtin13 || ld.gtin) : '',
      precio, precio_lista: lista > precio ? lista : null, precio_promo: null,
      promo: lista > precio ? Math.round((1 - precio / lista) * 100) + '% OFF' : '', promo_condicion: '',
      nota: '', por_peso: false, precio_por_medida: null, medida: '',
      imagen, exacto: false, sin_stock: !disponible, rubro: '',
      link: link.split('?')[0], modelo: sku, sku, seller: '1',
    };
  }).filter(Boolean);
}

async function tiendanube(host, { q, limite }, opciones) {
  if (!q) return [];
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(host + '/search/?q=' + encodeURIComponent(q), { headers: { 'user-agent': UA, accept: 'text/html' }, signal: ctrl.signal });
    if (!r.ok) throw new Error('Tiendanube ' + r.status);
    return parsear(await r.text(), host, opciones).slice(0, limite || 24);
  } finally { clearTimeout(t); }
}

module.exports = { tiendanube, parsear };
