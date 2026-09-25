#!/usr/bin/env node
/* ==============================================================
   AquaTrip — Conteúdo de DEMONSTRAÇÃO da Comunidade
   ==============================================================
   Cria perfis, viagens, curtidas, comentários, seguidores e avaliações
   de exemplo em destinos brasileiros reais, para testar o site com a
   Comunidade "cheia".

   Regras (conteúdo fictício nunca pode passar por real):
   - Toda conta criada aqui tem users.is_demo = TRUE. Tudo o que ela
     publica, comenta ou avalia aparece com o selo "Exemplo".
   - Viagens de exemplo ficam só na Comunidade: fora do catálogo, das
     contagens, do sitemap, do assistente e das métricas do admin, e
     com "noindex" para buscadores.
   - Contas de exemplo não têm senha utilizável: ninguém entra nelas.
   - Fotos: só fotos reais do próprio destino — as que já estão no site
     (app/public/img) e as enviadas pelo dono do projeto
     (database/fotos-exemplo). Sem foto real, a viagem usa a ilustração
     da categoria. Sem pessoas reconhecíveis (recortadas quando preciso);
     os perfis usam a inicial do nome.
   - Recusa rodar em produção.

   Uso:
     npm run db:seed:comunidade           cria (ou recria) tudo
     npm run db:seed:comunidade:limpar    apaga tudo o que foi criado
   ============================================================== */
require("dotenv").config({ quiet: true });
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const argon2 = require("argon2");
const db = require("../app/lib/db");
const mediaService = require("../app/services/mediaService");

const DOMINIO = "exemplo.aquatrip";
// Fotos: caminho relativo à raiz do projeto. Só fotos reais do destino —
// as do site (app/public/img) e as enviadas pelo dono (database/fotos-exemplo).
const RAIZ = path.join(__dirname, "..");

function exigirForaDeProducao() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seed_comunidade recusado: NODE_ENV=production. Conteúdo de exemplo não vai para o site real.");
  }
}

/* ---------- Pessoas (fictícias, identificadas como exemplo) ---------- */

const PESSOAS = [
  ["ana", "Ana Beatriz Lima", "Mergulhadora de fim de semana. Sempre atrás de água clara."],
  ["caio", "Caio Henrique Rocha", "Remo, trilha e praia deserta. Moro em Niterói."],
  ["juliana", "Juliana Martins", "Fotografia subaquática e viagens em grupo pequeno."],
  ["pedro", "Pedro Alves Nogueira", "Pescador esportivo, só pesque e solte."],
  ["larissa", "Larissa Carvalho", "Planejo viagens com calma e com roteiro."],
  ["rafael", "Rafael Souza Prado", "Primeira vez organizando viagem por aqui."],
  ["marina", "Marina Tavares", "Aquários, museus e praias com criança."],
  ["thiago", "Thiago Ferreira Dias", "Kitesurf no Nordeste sempre que dá."],
];

/* ---------- Viagens ----------
   dias: a partir de hoje (negativo = já aconteceu). hora: Brasília.
   fotos: arquivos de app/public/img (fotos reais do próprio destino). */
const VIAGENS = [
  {
    chave: "noronha", criador: "ana", categoria: "mergulho", dias: 20, hora: "08:00", vagas: 6,
    titulo: "Mergulho em Fernando de Noronha",
    local: "Fernando de Noronha, PE",
    descricao: "Vou passar cinco dias na ilha e quero dividir os passeios de mergulho com quem também vai. " +
      "A ideia é fazer o batismo ou mergulho credenciado com uma operadora local e aproveitar as praias entre um mergulho e outro.",
    info: "Cada pessoa compra a própria passagem e paga a taxa de preservação da ilha. " +
      "Ponto de encontro no porto de Santo Antônio. Levar protetor solar biodegradável e documento com foto.",
    fotos: ["app/public/img/fernandonoronha.jpg"],
    alt: "Morro Dois Irmãos visto da praia, em Fernando de Noronha",
  },
  {
    chave: "santos", criador: "marina", categoria: "aquario", dias: 9, hora: "10:00", vagas: 8,
    titulo: "Passeio em família no Aquário de Santos",
    local: "Santos, SP",
    descricao: "Vou levar meus filhos ao Aquário Municipal de Santos e depois caminhar pela orla. " +
      "Se outras famílias quiserem ir junto, a gente combina o horário e divide as dicas.",
    info: "Encontro na entrada do aquário, na Ponta da Praia. Cada família compra o próprio ingresso na bilheteria. " +
      "Depois, almoço na orla (opcional).",
    fotos: ["app/public/img/aquarium_santos.jpg"],
    alt: "Aquário Municipal de Santos",
  },
  {
    chave: "bonito", criador: "juliana", categoria: "mergulho", dias: 35, hora: "09:00", vagas: 5,
    titulo: "Flutuação no Rio da Prata, em Bonito",
    local: "Bonito, MS",
    descricao: "Viagem para Bonito com foco na flutuação em rio de água cristalina. " +
      "Quero montar um grupo pequeno para dividir o transporte entre a cidade e os atrativos.",
    info: "Os passeios em Bonito têm vagas limitadas por dia e são comprados com agência credenciada: cada pessoa reserva o seu. " +
      "Divisão do carro combinada no grupo.",
    fotos: ["database/fotos-exemplo/bonito-1.jpg"],
    alt: "Pessoas flutuando em rio de água cristalina entre a mata, em Bonito",
  },
  {
    chave: "arraial", criador: "caio", categoria: "caiaque", dias: 14, hora: "07:30", vagas: 4,
    titulo: "Caiaque ao amanhecer em Arraial do Cabo",
    local: "Arraial do Cabo, RJ",
    descricao: "Remada cedo, antes do movimento dos barcos, saindo da Praia dos Anjos. " +
      "Ritmo tranquilo, com paradas para snorkel se o mar estiver calmo.",
    info: "Aluguel de caiaque e colete no local (cada um paga o seu). Levar água, lanche leve e roupa que pode molhar. " +
      "Com mar agitado, a saída é cancelada.",
    fotos: ["database/fotos-exemplo/arraial-1.jpg", "database/fotos-exemplo/arraial-2.jpg"],
    alt: "Praia de água verde-clara em Arraial do Cabo, vista do alto",
  },
  {
    chave: "lencois", criador: "larissa", categoria: "expedicao", dias: 50, hora: "06:00", vagas: 6,
    titulo: "Expedição aos Lençóis Maranhenses",
    local: "Barreirinhas, MA",
    descricao: "Três dias em Barreirinhas com passeio de 4x4 pelas dunas e lagoas, e um dia de barco pelo Rio Preguiças.",
    info: "Hospedagem e passeios contratados por cada pessoa. Saída cedo por causa do calor nas dunas. " +
      "Levar chapéu, protetor solar e garrafa de água.",
    fotos: ["database/fotos-exemplo/lencois-1.jpg", "database/fotos-exemplo/lencois-2.jpg", "database/fotos-exemplo/lencois-3.jpg"],
    alt: "Lagoa de água azul entre as dunas dos Lençóis Maranhenses",
  },
  {
    chave: "barcelos", criador: "pedro", categoria: "pesca", dias: 60, hora: "05:30", vagas: 4,
    titulo: "Pesca esportiva de tucunaré no Rio Negro",
    local: "Barcelos, AM",
    descricao: "Pesca esportiva no sistema pesque e solte, com guia local. " +
      "Procuro parceiros para dividir o barco durante a semana.",
    info: "Licença de pesca amadora é obrigatória para cada pescador. Equipamento próprio. " +
      "Saída do porto da cidade logo cedo.",
    fotos: ["database/fotos-exemplo/barcelos-1.jpg", "database/fotos-exemplo/barcelos-2.jpg"],
    alt: "Praia de areia branca e barcos nas águas escuras do Rio Negro",
  },
  {
    chave: "jeri", criador: "thiago", categoria: "praia", dias: 28, hora: "16:30", vagas: 10,
    titulo: "Pôr do sol na Duna em Jericoacoara",
    local: "Jijoca de Jericoacoara, CE",
    descricao: "Encontro para subir a Duna do Pôr do Sol e depois caminhar até a Pedra Furada no dia seguinte, na maré baixa.",
    info: "Ponto de encontro na Rua Principal, perto da igreja. Levar lanterna para a volta e água.",
    fotos: ["database/fotos-exemplo/jericoacoara-1.jpg", "database/fotos-exemplo/jericoacoara-2.jpg"],
    alt: "Pedra Furada ao pôr do sol, em Jericoacoara",
  },
  {
    chave: "maragogi", criador: "rafael", categoria: "praia", dias: 18, hora: "09:00", vagas: 6,
    titulo: "Piscinas naturais de Maragogi",
    local: "Maragogi, AL",
    descricao: "Passeio às galés de Maragogi na maré baixa, com snorkel entre os recifes.",
    info: "O passeio de barco é comprado com operadora credenciada, que confirma o horário conforme a tábua de maré. " +
      "Não pise nos corais.",
    fotos: ["database/fotos-exemplo/maragogi-1.jpg", "database/fotos-exemplo/maragogi-2.jpg"],
    alt: "Piscinas naturais de água cristalina sobre os recifes de Maragogi",
  },
  // Já aconteceram: servem para mostrar participantes e avaliações.
  {
    chave: "porto", criador: "juliana", categoria: "mergulho", dias: -20, hora: "09:00", vagas: 6,
    titulo: "Piscinas naturais de Porto de Galinhas",
    local: "Ipojuca, PE",
    descricao: "Passeio de jangada até as piscinas naturais na maré baixa, com snorkel.",
    info: "Encontro na praia central, em frente às jangadas.",
  },
  {
    chave: "praiadoforte", criador: "larissa", categoria: "expedicao", dias: -40, hora: "08:30", vagas: 8,
    titulo: "Observação de baleias na Praia do Forte",
    local: "Mata de São João, BA",
    descricao: "Saída de barco para observação de baleias-jubarte durante a temporada, com operadora local.",
    info: "Encontro no píer da vila. Levar casaco leve e remédio para enjoo, se costuma precisar.",
  },
];

const VIAGENS_POR = Object.fromEntries(VIAGENS.map((v) => [v.chave, v]));

/* Interações. Autor sempre diferente do criador da viagem. */
const COMENTARIOS = {
  noronha: [
    ["caio", "Já tem operadora escolhida? Tenho credencial básica e topo dividir o barco."],
    ["ana", "Ainda comparando duas. Aviso aqui assim que fechar!"],
    ["juliana", "Levo câmera subaquática, se alguém quiser fotos do mergulho."],
  ],
  santos: [
    ["larissa", "Vou com meu sobrinho de 7 anos, dá para ir junto?"],
    ["marina", "Claro! O passeio é tranquilo para criança."],
  ],
  bonito: [
    ["ana", "Rio da Prata está na minha lista há anos. Qual época vocês vão?"],
    ["pedro", "Tenho carro alugado, posso levar mais duas pessoas."],
  ],
  arraial: [["thiago", "Que horas vocês voltam? Queria emendar com a Prainhas do Pontal."]],
  lencois: [
    ["rafael", "Vale a pena ficar três dias ou dois bastam?"],
    ["larissa", "Três dá para ver com calma e ter um dia de folga se chover."],
  ],
  barcelos: [["caio", "Nunca pesquei, mas tenho muita vontade. Serve para iniciante?"]],
  jeri: [
    ["marina", "Que lugar! Fui ano passado e o pôr do sol é inesquecível."],
    ["juliana", "Levem casaco, venta bastante lá em cima."],
  ],
  maragogi: [["larissa", "Já confirmaram a maré desse dia?"]],
  porto: [["caio", "Foi incrível, obrigado pela organização!"]],
};

const CURTIDAS = {
  noronha: ["caio", "juliana", "larissa", "pedro", "marina", "thiago", "rafael"],
  santos: ["larissa", "ana", "rafael"],
  bonito: ["ana", "pedro", "caio", "larissa", "marina"],
  arraial: ["thiago", "ana"],
  lencois: ["rafael", "juliana", "ana", "thiago"],
  barcelos: ["caio", "thiago"],
  jeri: ["marina", "juliana", "caio", "ana", "pedro", "rafael"],
  maragogi: ["larissa", "marina", "ana"],
  porto: ["caio", "ana", "thiago"],
  praiadoforte: ["marina", "juliana", "pedro"],
};

const INTERESSES = {
  noronha: ["pedro", "thiago"],
  bonito: ["marina"],
  lencois: ["ana", "caio"],
  jeri: ["rafael"],
};

/* Participações confirmadas (gratuitas). */
const PARTICIPANTES = {
  noronha: ["caio", "juliana"],
  santos: ["larissa"],
  bonito: ["pedro"],
  jeri: ["marina", "juliana", "caio"],
  porto: ["caio", "ana", "thiago"],
  praiadoforte: ["marina", "juliana", "pedro"],
};

/* Avaliações: só em viagens que já aconteceram, de quem participou. */
const AVALIACOES = {
  porto: [
    ["caio", 5, "Água muito clara", "Organização tranquila e horário certo com a maré. Vi muitos peixes no snorkel."],
    ["ana", 4, "Vale a pena", "Passeio bonito. Estava bem cheio no horário da maré, então chegue cedo."],
    ["thiago", 5, null, "Primeira vez em Porto de Galinhas e com certeza volto."],
  ],
  praiadoforte: [
    ["marina", 5, "Vimos três baleias", "Barco confortável e explicação muito boa sobre as jubartes."],
    ["juliana", 4, null, "Mar um pouco agitado na volta, mas valeu cada minuto."],
    ["pedro", 5, "Experiência única", "Grupo pequeno e animado. Recomendo."],
  ],
};

const SEGUE = [
  ["caio", "ana"], ["juliana", "ana"], ["pedro", "ana"], ["thiago", "ana"],
  ["ana", "juliana"], ["larissa", "juliana"], ["marina", "juliana"],
  ["rafael", "larissa"], ["ana", "larissa"],
  ["larissa", "marina"], ["juliana", "thiago"], ["caio", "pedro"],
];

/* ---------- Apoio ---------- */

/** Data/hora de Brasília (UTC-3 fixo) daqui a N dias, em UTC. */
function emBrasilia(dias, hora) {
  const [h, m] = hora.split(":").map(Number);
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dias);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h + 3, m, 0));
}

/** Momento no passado (horas atrás), para espalhar as interações no tempo. */
const horasAtras = (h) => new Date(Date.now() - h * 3600 * 1000);

/** Momento entre a publicação da viagem (0) e agora (1). */
const entre = (desde, fracao) => new Date(desde.getTime() + (Date.now() - desde.getTime()) * fracao);

function slugify(titulo) {
  return titulo.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);
}

/* ---------- Limpar ---------- */

/**
 * Apaga TUDO o que o seed criou: contas de exemplo e, em cascata, as
 * viagens, curtidas, comentários, avaliações e seguidores delas; as
 * participações de outras contas nas viagens de exemplo; e as fotos
 * (registro e arquivo).
 */
async function limpar() {
  exigirForaDeProducao();
  const { rows: fotos } = await db.query(
    `SELECT m.id FROM media m
     WHERE m.uploaded_by IN (SELECT id FROM users WHERE is_demo)
        OR m.id IN (SELECT sp.media_id FROM service_photos sp JOIN services s ON s.id = sp.service_id
                    JOIN users u ON u.id = s.creator_user_id WHERE u.is_demo)`
  );
  // Reserva aponta para o horário com RESTRICT: sai antes das viagens.
  await db.query(
    `DELETE b FROM bookings b
     JOIN service_slots sl ON sl.id = b.slot_id
     JOIN services s ON s.id = sl.service_id
     JOIN users u ON u.id = s.creator_user_id
     WHERE u.is_demo`
  );
  // Registro e arquivo, pelo mesmo caminho que a plataforma usa.
  for (const f of fotos) await mediaService.apagar(f.id);
  const { rowCount } = await db.query(`DELETE FROM users WHERE is_demo`);
  return { contas: rowCount, fotos: fotos.length };
}

/* ---------- Semear ---------- */

async function semear() {
  exigirForaDeProducao();
  await limpar(); // recria do zero: rodar de novo não duplica nada

  // Senha aleatória descartada: a conta existe, mas ninguém entra nela.
  const hashInutil = await argon2.hash(crypto.randomBytes(32).toString("hex"), { type: argon2.argon2id });
  const ids = {};
  for (const [i, [chave, nome, bio]] of PESSOAS.entries()) {
    ids[chave] = crypto.randomUUID();
    await db.query(
      `INSERT INTO users (id, name, email, password_hash, email_verified_at, bio, is_demo, created_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, TRUE, ?)`,
      [ids[chave], nome, `${chave}@${DOMINIO}`, hashInutil, bio, horasAtras(24 * (120 - i * 9))]
    );
  }

  const viagens = {};
  for (const [i, v] of VIAGENS.entries()) {
    const id = crypto.randomUUID();
    const criadaEm = v.dias < 0 ? horasAtras(24 * (-v.dias + 15)) : horasAtras(24 * (i + 1) + i * 5);
    let slug = `${slugify(v.titulo)}-exemplo`;
    const { rows: existe } = await db.query(`SELECT 1 FROM services WHERE slug = ?`, [slug]);
    if (existe.length) slug = `${slug}-${id.slice(0, 6)}`;
    await db.query(
      `INSERT INTO services (id, slug, title, location, category, price_cents, description, trip_info, cover_alt,
                             creator_user_id, review_status, reviewed_at, active, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'APPROVED', ?, TRUE, ?)`,
      [id, slug, v.titulo, v.local, v.categoria, v.descricao, v.info, v.alt || null, ids[v.criador], criadaEm, criadaEm]
    );
    const slotId = crypto.randomUUID();
    await db.query(
      `INSERT INTO service_slots (id, service_id, starts_at, capacity) VALUES (?, ?, ?, ?)`,
      [slotId, id, emBrasilia(v.dias, v.hora), v.vagas]
    );

    for (const [pos, arquivo] of (v.fotos || []).entries()) {
      const buffer = fs.readFileSync(path.join(RAIZ, arquivo));
      const media = await mediaService.salvarImagem({ buffer, usuarioId: ids[v.criador], purpose: "EXPERIENCE", status: "APPROVED" });
      await db.query(`INSERT INTO service_photos (service_id, media_id, position) VALUES (?, ?, ?)`, [id, media.id, pos + 1]);
      if (pos === 0) await db.query(`UPDATE services SET cover_media_id = ? WHERE id = ?`, [media.id, id]);
    }
    viagens[v.chave] = { id, slotId, criador: v.criador, criadaEm };
  }

  // Participações confirmadas (todas gratuitas) e avaliações de quem foi.
  let reservas = 0;
  let avaliacoes = 0;
  for (const [chave, quem] of Object.entries(PARTICIPANTES)) {
    const v = viagens[chave];
    for (const [i, p] of quem.entries()) {
      const bookingId = crypto.randomUUID();
      const quando = new Date(v.criadaEm.getTime() + (i + 1) * 7 * 3600 * 1000);
      await db.query(
        `INSERT INTO bookings (id, user_id, slot_id, status, quantity, amount_cents, confirmed_at, created_at)
         VALUES (?, ?, ?, 'CONFIRMED', 1, 0, ?, ?)`,
        [bookingId, ids[p], v.slotId, quando, quando]
      );
      reservas++;
      const av = (AVALIACOES[chave] || []).find((a) => a[0] === p);
      if (av) {
        const dias = -VIAGENS_POR[chave].dias;
        await db.query(
          `INSERT INTO reviews (id, booking_id, user_id, service_id, rating, title, body, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [crypto.randomUUID(), bookingId, ids[p], v.id, av[1], av[2], av[3], horasAtras(24 * (dias - 2) - i * 6)]
        );
        avaliacoes++;
      }
    }
  }

  let comentarios = 0;
  for (const [chave, lista] of Object.entries(COMENTARIOS)) {
    const v = viagens[chave];
    // Viagem que já aconteceu: comentário depois da data (é sobre como foi).
    const depois = VIAGENS_POR[chave].dias < 0 ? 0.6 : 0;
    for (const [i, [autor, texto]] of lista.entries()) {
      await db.query(
        `INSERT INTO experience_comments (id, service_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), v.id, ids[autor], texto, entre(v.criadaEm, 0.2 + i * 0.2 + depois)]
      );
      comentarios++;
    }
  }

  let curtidas = 0;
  for (const [chave, quem] of Object.entries(CURTIDAS)) {
    for (const [i, p] of quem.entries()) {
      if (p === viagens[chave].criador) continue;
      await db.query(`INSERT INTO experience_likes (user_id, service_id, created_at) VALUES (?, ?, ?)`,
        [ids[p], viagens[chave].id, entre(viagens[chave].criadaEm, (i + 1) / (quem.length + 1))]);
      curtidas++;
    }
  }
  for (const [chave, quem] of Object.entries(INTERESSES)) {
    for (const [i, p] of quem.entries()) {
      await db.query(`INSERT INTO experience_interests (user_id, service_id, created_at) VALUES (?, ?, ?)`,
        [ids[p], viagens[chave].id, entre(viagens[chave].criadaEm, (i + 1) / (quem.length + 2))]);
    }
  }
  for (const [i, [de, para]] of SEGUE.entries()) {
    await db.query(`INSERT INTO user_follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)`,
      [ids[de], ids[para], horasAtras(24 * (30 - i))]);
  }

  return {
    contas: PESSOAS.length, viagens: VIAGENS.length, reservas, avaliacoes, comentarios, curtidas,
    seguidores: SEGUE.length,
  };
}

module.exports = { semear, limpar, DOMINIO };

if (require.main === module) {
  const apagar = process.argv.includes("--limpar");
  (apagar ? limpar() : semear())
    .then((r) => {
      if (apagar) {
        console.log(`\nConteúdo de exemplo apagado: ${r.contas} conta(s) e ${r.fotos} foto(s), com tudo o que publicaram.\n`);
      } else {
        console.log("\nConteúdo de exemplo da Comunidade criado (todo com o selo \"Exemplo\"):");
        console.log(`  ${r.contas} perfis, ${r.viagens} viagens, ${r.reservas} participações, ${r.avaliacoes} avaliações,`);
        console.log(`  ${r.comentarios} comentários, ${r.curtidas} curtidas e ${r.seguidores} conexões de seguidores.`);
        console.log("  Veja em /comunidade. Para apagar tudo: npm run db:seed:comunidade:limpar\n");
      }
    })
    .catch((e) => { console.error(e.message); process.exitCode = 1; })
    .finally(() => db.pool.end());
}
