// Lectores de tiendas que no son VTEX, con el mismo formato que /api/vtex:
//  · Kinderland (Shopify): el buscador de la tienda (search/suggest.json).
//  · Dexter, Moov y Stock Center (Salesforce Commerce Cloud): la grilla de resultados de su buscador (HTML).
//    El código del producto (NIFQ1833-016) trae el código de modelo de la marca (FQ1833-016): sirve para comparar.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

async function pedir(url, opciones, json) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, Object.assign({ signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: json ? 'application/json' : 'text/html' } }, opciones || {}));
    if (!r.ok) throw new Error('http ' + r.status);
    return json ? await r.json() : await r.text();
  } finally { clearTimeout(t); }
}
const des = s => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&eacute;/g, 'é').replace(/&aacute;/g, 'á')
  .replace(/&iacute;/g, 'í').replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú').replace(/&ntilde;/g, 'ñ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

function base(o) {
  return Object.assign({ marca: '', ean: '', precio_lista: null, precio_promo: null, promo: '', promo_condicion: '', nota: '', exacto: false, sin_stock: false, rubro: '', sku: '', seller: '1', modelo: '' }, o);
}
const descuento = (precio, regular) => regular > precio + 0.5 ? { precio_lista: regular, promo: Math.round((1 - precio / regular) * 100) + '% off' } : {};

// ---------- Shopify ----------
async function shopify(host, { q, limite }) {
  if (!q) return [];
  const d = await pedir(host + '/search/suggest.json?q=' + encodeURIComponent(q) + '&resources[type]=product&resources[limit]=' + Math.min(limite || 10, 10), null, true);
  const ps = (((d || {}).resources || {}).results || {}).products || [];
  return ps.map(p => {
    const precio = Number(p.price) || 0, regular = Number(p.compare_at_price_max) || 0;
    if (!(precio > 0)) return null;
    return base(Object.assign({
      nombre: des(p.title), marca: p.vendor || '', precio, sin_stock: p.available === false,
      imagen: p.image || p.featured_image && p.featured_image.url || '', link: host + String(p.url || '').split('?')[0], sku: String(p.id || ''), rubro: p.type || '',
    }, descuento(precio, regular)));
  }).filter(Boolean);
}

// ---------- Salesforce Commerce Cloud (grupo Dexter) ----------
async function sfcc(host, sitio, { q, limite }) {
  if (!q) return [];
  const html = await pedir(host + '/on/demandware.store/' + sitio + '/default/Search-UpdateGrid?q=' + encodeURIComponent(q) + '&start=0&sz=' + Math.min(limite || 24, 36));
  const partes = html.split('<div class="product" data-pid="').slice(1);
  return partes.map(t => {
    const pid = t.slice(0, t.indexOf('"'));
    const nombre = des((/class="pdp-link"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/.exec(t) || [])[1] || (/alt="([^"]+)"/.exec(t) || [])[1]);
    const href = (/<a href="([^"]+\.html)"/.exec(t) || [])[1] || '';
    const img = ((/<img class="tile-image primary-image" src="([^"]+)"/.exec(t) || [])[1] || '').replace(/&amp;/g, '&');
    const ventas = /class="sales"[\s\S]*?content="([\d.]+)"/.exec(t), lista = /class="(?:strike-through[^"]*|list[^"]*)"[\s\S]*?content="([\d.]+)"/.exec(t);
    const precio = ventas ? Number(ventas[1]) : Number((/content="([\d.]+)"/.exec(t) || [])[1] || 0);
    if (!nombre || !(precio > 0)) return null;
    const regular = lista ? Number(lista[1]) : 0;
    const cuotas = des((/class="installments-container[^"]*"[\s\S]*?<span>([\s\S]*?)<\/span>/.exec(t) || [])[1] || '');
    return base(Object.assign({
      nombre, precio, imagen: img, link: href ? host + href : '', sku: pid,
      modelo: pid.replace(/^[A-Z]{2}(?=[A-Z0-9]{2,}\d)/, ''),   // NIFQ1833-016 -> FQ1833-016 (las 2 primeras letras son la marca)
      nota: /cuotas/i.test(cuotas) ? cuotas.replace(/inter\S*s/i, 'interés') : '',
    }, descuento(precio, regular)));
  }).filter(Boolean);
}

module.exports = { shopify, sfcc };
