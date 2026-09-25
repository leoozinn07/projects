/* ==============================================================
   AquaTrip — robots.txt e sitemap.xml
   ============================================================== */
const db = require("../lib/db");
const { visivel, semExemplo } = require("../lib/visibilidade");
const { base, PRIVADO } = require("../middlewares/seo");
const { PAGINAS } = require("./catalogController");

function robots(req, res) {
  // Em ambiente que não é produção, nada deve ser indexado: um
  // staging no Google compete com o site real e expõe dado de teste.
  const producao = process.env.NODE_ENV === "production";
  const linhas = producao
    ? [
        "User-agent: *",
        "Disallow: /admin", "Disallow: /gestao", "Disallow: /api/", "Disallow: /conta",
        "Disallow: /perfil", "Disallow: /minhas-reservas", "Disallow: /reservas/",
        "Disallow: /ingressos", "Disallow: /viagens", "Disallow: /avaliacao",
        "Disallow: /configuracoes", "Disallow: /login", "Disallow: /dev/",
        "",
        `Sitemap: ${base()}/sitemap.xml`,
      ]
    : ["User-agent: *", "Disallow: /", "", "# Ambiente de desenvolvimento/teste: nada é indexado."];
  res.type("text/plain").set("Cache-Control", "public, max-age=3600").send(linhas.join("\n") + "\n");
}

function xmlEscape(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
}

async function sitemap(req, res, next) {
  try {
    // Só experiência ativa. URL morta no sitemap faz o buscador
    // desconfiar do site inteiro.
    const { rows } = await db.query(
      `SELECT slug, GREATEST(created_at, COALESCE(
                (SELECT MAX(created_at) FROM reviews r WHERE r.service_id = s.id), created_at)) AS alterado
       FROM services s WHERE ${visivel("s")} AND ${semExemplo("s")} ORDER BY created_at DESC LIMIT 5000`
    );
    const b = base();
    const urls = [
      { loc: `${b}/`, prioridade: "1.0" },
      { loc: `${b}/reservar`, prioridade: "0.9" },
      ...Object.keys(PAGINAS).map((r) => ({ loc: `${b}/${r}`, prioridade: "0.8" })),
      ...rows.map((s) => ({
        loc: `${b}/reservar/${encodeURIComponent(s.slug)}`,
        lastmod: new Date(s.alterado).toISOString().slice(0, 10),
        prioridade: "0.7",
      })),
      { loc: `${b}/parceiros`, prioridade: "0.5" },
      { loc: `${b}/contato`, prioridade: "0.4" },
      { loc: `${b}/termos-de-uso`, prioridade: "0.2" },
      { loc: `${b}/politica-de-privacidade`, prioridade: "0.2" },
    ];
    // Defesa: nada privado entra, mesmo que alguém edite a lista acima.
    const publicas = urls.filter((u) => !PRIVADO.some((r) => r.test(new URL(u.loc).pathname)));

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      publicas.map((u) =>
        `  <url><loc>${xmlEscape(u.loc)}</loc>` +
        (u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : "") +
        `<priority>${u.prioridade}</priority></url>`
      ).join("\n") +
      "\n</urlset>\n";
    res.type("application/xml").set("Cache-Control", "public, max-age=3600").send(xml);
  } catch (err) { next(err); }
}

module.exports = { robots, sitemap };
