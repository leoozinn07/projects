/* Simulador: o número da conta digitado entra no código devolvido. */
(function () {
  const conta = document.getElementById("conta"), code = document.getElementById("code");
  if (!conta || !code) return;
  const sufixo = code.value.split(":")[1];
  conta.addEventListener("input", () => { code.value = `MOCK-CONTA-${conta.value.replace(/\D/g, "")}:${sufixo}`; });
})();
