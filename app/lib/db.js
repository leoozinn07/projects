/* ==============================================================
   AquaTrip — Pool de conexão MySQL (singleton)
   Todo acesso ao banco passa por aqui. Nenhum outro arquivo deve
   criar seu próprio Pool/Connection.

   Migrado de Postgres (pg) para MySQL 8.0 (mysql2). Para reduzir o
   diff nos repositórios, mantemos a mesma interface pública usada
   antes — db.query(sql, params) devolvendo { rows } — e traduzimos
   automaticamente placeholders no estilo Postgres ($1, $2...) para
   o estilo MySQL (?) aqui dentro. Isso é uma rede de segurança:
   cada arquivo já foi reescrito para usar $N/? corretamente, mas o
   tradutor evita que um $N esquecido durante o port vire um bug
   silencioso.
   ============================================================== */
const mysql = require("mysql2/promise");
const log = require("./logger").forModule("db");

if (!process.env.DATABASE_URL) {
  const fs = require("fs");
  const path = require("path");
  const temEnv = fs.existsSync(path.join(process.cwd(), ".env"));
  // Mensagem que diz O QUE FAZER — antes só apontava o .env.example,
  // e "cp .env.example .env" nem existe no Prompt de Comando do Windows.
  throw new Error(
    temEnv
      ? "[db] O arquivo .env existe, mas não tem DATABASE_URL. Adicione a linha, por exemplo:\n" +
        "     DATABASE_URL=mysql://aquatrip:aquatrip_dev_pw@localhost:3306/aquatrip"
      : "[db] Arquivo .env não encontrado nesta pasta (" + process.cwd() + ").\n" +
        "     Rode:  npm run setup   (cria o .env e mostra como criar o banco)"
  );
}

/* Colunas TINYINT(1) voltam como boolean JS (equivalente ao BOOLEAN
   nativo do Postgres), em vez do 0/1 cru que o mysql2 devolve por
   padrão — evita reescrever comparações "=== true/false" espalhadas
   pelo código. */
function typeCast(field, next) {
  if (field.type === "TINY" && field.length === 1) {
    const valor = field.string();
    return valor === null ? null : valor === "1";
  }
  return next();
}

const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  namedPlaceholders: false,
  timezone: "Z", // tudo em UTC, equivalente ao TIMESTAMPTZ de antes
  dateStrings: false,
  decimalNumbers: true,
  typeCast,
});

/* Toda conexão trabalha em UTC. As datas são gravadas em UTC (timezone
   "Z" acima), mas NOW(), CURRENT_TIMESTAMP e os DEFAULTs usam o fuso da
   SESSÃO, que por padrão é o do sistema: num MySQL instalado no Brasil
   (UTC-3), NOW() ficava 3 horas atrás das datas gravadas — horário já
   passado parecia futuro, o prazo de 15 minutos da reserva e o bloqueio
   de login saíam errados. '+00:00' é um deslocamento numérico: não
   depende das tabelas de fuso do MySQL. */
pool.on("connection", (conexao) => {
  conexao.query("SET time_zone = '+00:00'");
});

pool.on("error", (err) => {
  // Erros em conexões ociosas do pool não devem derrubar o processo,
  // mas precisam ser visíveis nos logs.
  log.error({ err }, "erro inesperado no pool de conexões");
});

/**
 * Converte "SELECT ... WHERE id = $1 AND status = $2" (estilo Postgres)
 * para "SELECT ... WHERE id = ? AND status = ?" (estilo MySQL).
 * Não reordena nada — funciona porque, no código já portado, cada
 * placeholder $N aparece uma única vez e na ordem dos parâmetros.
 */
function paraPlaceholdersMysql(sql) {
  return sql.replace(/\$\d+/g, "?");
}

/**
 * Normaliza o retorno do mysql2 pro formato { rows, rowCount } usado
 * em todo o código (equivalente ao do 'pg'). IMPORTANTE: pro mysql2,
 * um SELECT devolve um array de linhas — mas INSERT/UPDATE/DELETE
 * devolvem um objeto ResultSetHeader (affectedRows, insertId...), não
 * um array. Tratar os dois casos como "iguais" (como uma primeira
 * versão deste arquivo fazia) zera silenciosamente o rowCount de todo
 * INSERT/UPDATE/DELETE — bug sério para qualquer código que confere
 * "a linha foi mesmo atualizada?" antes de seguir.
 */
function empacotar(resultadoBruto) {
  if (Array.isArray(resultadoBruto)) {
    return { rows: resultadoBruto, rowCount: resultadoBruto.length };
  }
  return {
    rows: [],
    rowCount: resultadoBruto?.affectedRows || 0,
    insertId: resultadoBruto?.insertId,
  };
}

/**
 * Interface compatível com o antigo db.query(text, params) do 'pg':
 * devolve { rows, rowCount }. Usa pool.execute() (prepared statement
 * com plano cacheado) em vez de pool.query() nos caminhos normais —
 * ganho de performance real sobre consultas repetidas.
 */
async function query(text, params = []) {
  const sql = paraPlaceholdersMysql(text);
  const [resultadoBruto] = await pool.execute(sql, params);
  return empacotar(resultadoBruto);
}

/**
 * Centraliza o padrão getConnection() → beginTransaction() →
 * commit()/rollback() → release(), no lugar do BEGIN/COMMIT/ROLLBACK
 * manual que cada serviço fazia antes com o client do 'pg'.
 *
 * fn recebe um objeto { query(text, params) } já amarrado à conexão
 * da transação (mesma interface do db.query acima).
 */
async function withTransaction(fn) {
  const connection = await pool.getConnection();
  const conexaoQuery = async (text, params = []) => {
    const sql = paraPlaceholdersMysql(text);
    const [resultadoBruto] = await connection.execute(sql, params);
    return empacotar(resultadoBruto);
  };

  try {
    await connection.beginTransaction();
    const resultado = await fn({ query: conexaoQuery });
    await connection.commit();
    return resultado;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

/**
 * Compatível com o antigo pg Pool#connect(): devolve um "client" com
 * .query(text, params) e .release(). Mantido porque vários arquivos já
 * usam o padrão manual `const client = await db.connect(); await
 * client.query("BEGIN"); ... await client.query("COMMIT"); client.release();`
 * — em vez de reescrever o controle de fluxo de cada um, o client aqui
 * traduz "BEGIN"/"COMMIT"/"ROLLBACK" para as chamadas reais do mysql2.
 * Para código novo, prefira withTransaction().
 */
async function connect() {
  const connection = await pool.getConnection();
  return {
    async query(text, params = []) {
      const comando = text.trim().toUpperCase();
      if (comando === "BEGIN") {
        await connection.beginTransaction();
        return { rows: [], rowCount: 0 };
      }
      if (comando === "COMMIT") {
        await connection.commit();
        return { rows: [], rowCount: 0 };
      }
      if (comando === "ROLLBACK") {
        await connection.rollback();
        return { rows: [], rowCount: 0 };
      }
      const sql = paraPlaceholdersMysql(text);
      const [resultadoBruto] = await connection.execute(sql, params);
      return empacotar(resultadoBruto);
    },
    release() {
      connection.release();
    },
  };
}

/**
 * Fecha o pool de conexões. Equivalente ao antigo pg Pool#end() — usado
 * pela suíte de testes (tests/helpers/setup.js) para o Jest não travar
 * com handles abertos ao final da execução.
 */
async function end() {
  await pool.end();
}

module.exports = { query, withTransaction, connect, pool, end };
