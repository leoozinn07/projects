# Verificação em duas etapas — AquaTrip

## Por que agora

O admin controla usuários, pagamentos, estornos e dados pessoais. Antes
disto, **só a senha** protegia tudo isso. Senha vaza (reuso em outro site,
phishing, computador com vírus). Com 2FA, a senha vazada sozinha não abre
o painel.

## Decisões

| Decisão | Motivo |
|---|---|
| TOTP (app autenticador), não SMS | SMS cai com clonagem de chip (SIM swap) — o golpe mais comum contra 2FA no Brasil |
| Segredo de 160 bits | Recomendação da RFC 4226 (o padrão da biblioteca era 80) |
| Segredo cifrado com AES-256-GCM | Um dump do banco sozinho não gera códigos; GCM também detecta adulteração |
| Código de uso único | Guardamos o último intervalo aceito; quem espia a tela não reusa o código |
| Tolerância de ±30 s | Celular com relógio levemente atrasado não trava a pessoa |
| 5 tentativas, depois exige a senha de novo | Adivinhar 6 dígitos deixa de ser viável |
| Etapa pendente expira em 5 min | A senha certa não fica "valendo" indefinidamente |
| 10 códigos de recuperação, só com hash | Salvam quem perdeu o celular; exibidos uma única vez |
| Obrigatório para admin, opcional para cliente | O risco do admin é o do negócio inteiro |
| Admin não desativa nem redefine o próprio | Seria o atalho exato que um invasor com a senha procuraria |
| Ativar derruba as outras sessões | Sessões abertas antes não passaram pelo segundo fator |

## Fluxos

**Primeiro acesso de um admin:** o painel redireciona para
`/conta/2fa`. Lê o QR code, confirma com o código e a senha, guarda os 10
códigos de recuperação.

**Login:** senha → `/login/2fa` → código do app (ou de recuperação).

**Perdeu o celular:** usa um código de recuperação. Se perdeu os códigos
também, **outro** administrador redefine pelo painel (Usuários → Redefinir
2FA). A pessoa é avisada por e-mail. Confirme a identidade dela por outro
canal antes — é exatamente o pedido que um golpista faria.

## A chave TOTP_ENCRYPTION_KEY

Obrigatória em produção. Guarde num cofre de segredos, **separada** do
backup do banco (se os dois vazarem juntos, a criptografia não ajuda). Se
a chave for perdida, os segredos ficam ilegíveis e todos precisam
reconfigurar o 2FA.

## Testes

`REQUIRE_ADMIN_2FA=false` no `.env.test` para as demais suítes, que entram
no painel como admin. A suíte `tests/twofactor.test.js` religa a exigência
e a testa explicitamente (22 testes). Mutações verificadas: desligar a
exigência e remover o bloqueio de reuso fazem os testes falharem.

---

## Revisão de segurança (auditoria posterior)

A implementação acima foi auditada contra requisitos que os testes originais
não cobriam. Resultado:

| Ponto | Situação |
|---|---|
| Anti-replay e limite de 5 tentativas | OK — confirmados por teste de mutação (removida a proteção, o teste falha) |
| Limite de requisições na segunda etapa | OK (`loginLimiter`) |
| Redefinir a senha pelo e-mail pula o 2FA? | **Não pula** — agora coberto por teste |
| Chave de cifragem validada na subida | **Corrigido.** Antes só era checada no primeiro uso: um servidor com chave ausente ou errada subia normalmente e travava todos os admins no primeiro login |
| Único admin sem celular e sem códigos | **Corrigido.** Não havia saída — o painel (corretamente) proíbe redefinir o próprio 2FA |

### Acesso de emergência

```bash
npm run 2fa:redefinir -- admin@exemplo.com              # só mostra
npm run 2fa:redefinir -- admin@exemplo.com --confirmar  # aplica
```

Exige acesso ao servidor e às credenciais do banco — nível de acesso acima do
painel. Simula por padrão, avisa se a conta ainda tem códigos de recuperação
válidos (nesse caso não é preciso redefinir), encerra as sessões, avisa o dono
por e-mail e registra `MFA_RESET_BY_SERVER` na auditoria com o usuário do
sistema e o host que executaram.

Trate cada uso como incidente: se o dono não pediu, alguém com acesso ao
servidor está agindo em nome dele.
