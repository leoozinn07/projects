/* ==============================================================
   AquaTrip — Auth Service
   Regras de negócio de autenticação. Nenhuma query SQL aqui
   (isso vive no userRepository) e nenhum req/res aqui (isso vive
   no controller). Isso permite testar as regras isoladamente.
   ============================================================== */
const argon2 = require("argon2");
const fmt = require("../lib/datas");
const userRepository = require("../repositories/userRepository");

// Argon2id: variante recomendada atualmente (resistente tanto a
// ataques de GPU/ASIC quanto a side-channel), custo calibrado para
// ~um dígito de milissegundos em hardware de servidor comum.
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // ~19 MB
  timeCost: 2,
  parallelism: 1,
};

class AuthError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code; // "INVALID_CREDENTIALS" | "ACCOUNT_LOCKED" | "EMAIL_IN_USE"
  }
}

async function registerUser({ name, email, password, termsVersion = null, locale = null }) {
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await userRepository.findByEmail(normalizedEmail);
  if (existing) {
    // Mensagem genérica no controller — aqui só sinalizamos o motivo
    // internamente (não expor "e-mail já existe" evita enumeração
    // de usuários pela camada acima, se assim decidirem tratar).
    throw new AuthError("E-mail já cadastrado.", "EMAIL_IN_USE");
  }

  const passwordHash = await argon2.hash(password, HASH_OPTIONS);
  const user = await userRepository.create({
    name: name.trim(),
    email: normalizedEmail,
    passwordHash,
    role: "USER",
    termsVersion,
    locale,
  });

  return user;
}

async function verifyCredentials({ email, password }) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await userRepository.findByEmail(normalizedEmail);

  // Mensagem de erro idêntica para "usuário não existe" e "senha
  // errada" — evita user enumeration (ver ameaça #47 do prompt mestre).
  const genericError = () =>
    new AuthError("E-mail ou senha inválidos.", "INVALID_CREDENTIALS");

  if (!user) {
    // Ainda assim gastamos tempo com um hash "fake" para que a
    // resposta não seja mensuravelmente mais rápida quando o e-mail
    // não existe (mitiga timing attack de enumeração).
    await argon2.hash(password, HASH_OPTIONS).catch(() => {});
    throw genericError();
  }

  // Suspensão administrativa. A senha é conferida ANTES: sem isso,
  // "conta suspensa" responderia a quem nem sabe a senha, revelando
  // que o e-mail existe (enumeração). Só quem prova ser o dono fica
  // sabendo do motivo.
  if (user.status === "SUSPENDED") {
    const vigente = !user.suspended_until || new Date(user.suspended_until) > new Date();
    if (vigente) {
      const senhaOk = await argon2.verify(user.password_hash, password);
      if (!senhaOk) throw genericError();
      const ate = user.suspended_until
        ? ` até ${fmt.data(user.suspended_until)}`
        : "";
      throw new AuthError(
        `Esta conta está suspensa${ate}. Fale com o suporte se acha que é um engano.`,
        "ACCOUNT_SUSPENDED"
      );
    }
  }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new AuthError(
      "Conta temporariamente bloqueada por excesso de tentativas. Tente novamente mais tarde.",
      "ACCOUNT_LOCKED"
    );
  }

  const valid = await argon2.verify(user.password_hash, password);
  if (!valid) {
    await userRepository.registerFailedLogin(user.id);
    throw genericError();
  }

  await userRepository.registerSuccessfulLogin(user.id);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    locale: user.locale || null,
    termsOk: require("../lib/termos").aceitouVigente(user),
  };
}

module.exports = {
  AuthError,
  registerUser,
  verifyCredentials,
};
