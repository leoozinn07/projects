/* ==============================================================
   Testes — tm(): tradução de mensagens vindas do servidor
   ============================================================== */
const { tradutor } = require("../app/lib/i18n");

describe("tm()", () => {
  it("traduz por correspondência exata", () => {
    const { tm } = tradutor("en");
    expect(tm("Dados inválidos.")).toBe("Invalid data.");
  });

  it("traduz por padrão, preservando a parte dinâmica", () => {
    const { tm } = tradutor("en");
    expect(tm("Não há vagas suficientes nesse horário (restam 3).")).toBe(
      "Not enough spots at this time (3 left)."
    );
    const { tm: tmEs } = tradutor("es");
    expect(tmEs("Não há vagas suficientes nesse horário (restam 3).")).toBe(
      "No hay cupos suficientes en ese horario (quedan 3)."
    );
  });

  it("mensagem desconhecida volta como veio", () => {
    const { tm } = tradutor("en");
    const original = "Isto não existe em lugar nenhum.";
    expect(tm(original)).toBe(original);
  });

  it("em português, tm sempre devolve o original", () => {
    const { tm } = tradutor("pt");
    expect(tm("Dados inválidos.")).toBe("Dados inválidos.");
    expect(tm("Não há vagas suficientes nesse horário (restam 3).")).toBe(
      "Não há vagas suficientes nesse horário (restam 3)."
    );
  });
});
