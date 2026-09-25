# Trilha de auditoria — AquaTrip

## Para que serve

Responder, meses depois, perguntas como: *quem cancelou esta reserva?*,
*de qual IP partiram as tentativas de invasão naquela noite?*, *este
estorno foi feito pelo cliente ou por um operador?*

Sem isso, um sistema que movimenta dinheiro não tem como investigar
incidente nem comprovar conformidade.

## Onde ver

`/admin/auditoria` — somente para ADMIN. Tem filtro por ação e
paginação. O próprio acesso ao painel é auditado.

## Eventos registrados

| Categoria | Ações |
|---|---|
| Autenticação | `LOGIN_SUCCESS`, `LOGIN_FAILED`, `LOGOUT`, `USER_REGISTERED`, `ACCOUNT_LOCKED` |
| Autorização | `ADMIN_ACCESS`, `ACCESS_DENIED` |
| Reservas | `BOOKING_CREATED`, `BOOKING_CONFIRMED`, `BOOKING_CANCELLED`, `BOOKING_EXPIRED` |
| Pagamentos | `PAYMENT_STARTED`, `PAYMENT_STATUS_CHANGED`, `PAYMENT_REFUNDED` |
| Webhooks | `WEBHOOK_RECEIVED`, `WEBHOOK_REJECTED` |

Cada registro guarda: ação, usuário (quando houver), IP, timestamp e
um `metadata` em JSON com o contexto relevante.

## O que NUNCA entra na trilha

A trilha é lida por operadores e costuma ser exportada — vazar segredo
aqui é tão grave quanto vazar no log da aplicação. O `auditService`
descarta automaticamente qualquer chave que contenha: `senha`,
`password`, `csrf`, `token`, `cvv`, `card_number`, `authorization`,
`cookie`, `secret`.

Objetos aninhados também são substituídos por `[objeto]`: é o caminho
por onde dado sensível costuma entrar sem ninguém perceber.

## Princípio: auditoria não pode derrubar o sistema

Se a gravação do evento falhar, o erro é logado e **a requisição segue
normalmente**. Perder um registro é ruim; impedir alguém de pagar uma
reserva porque a auditoria caiu é pior. Há teste automatizado
cobrindo exatamente esse cenário.

## Usar em código novo

```js
const auditService = require("../services/auditService");
const { AuditAction } = auditService;

await auditService.log(AuditAction.BOOKING_CANCELLED, {
  req,                                  // extrai usuário e IP sozinho
  metadata: { bookingId, motivo: "..." },
});
```

Use sempre uma constante de `AuditAction`, nunca string solta — é o
que impede o mesmo evento de virar `LOGIN`, `login` e `user_login` em
lugares diferentes, inutilizando qualquer consulta depois.

---

# Rate limiting

| Escopo | Limite | Protege contra |
|---|---|---|
| `/login`, `/cadastro` | 20 / 15 min por IP | Brute force, credential stuffing |
| Rotas de escrita (`/reservar`, `/pagar`, `/cancelar`) | 40 / 10 min por **usuário** | DoS de negócio (esgotar vagas sem pagar) |
| `/webhooks/payments` | 120 / min por IP | Flood de eventos forjados |

Notas de implementação:

- Nas rotas de escrita a chave é o **id do usuário**, não o IP: vários
  clientes atrás do mesmo NAT não devem se prejudicar entre si.
- O `keyGenerator` usa `ipKeyGenerator` para normalizar IPv6 em /64 —
  sem isso, quem tem um bloco IPv6 troca de endereço a cada requisição
  e passa pelo limite à vontade.
- O limite por IP no login é **camada adicional** ao bloqueio
  progressivo por conta (5 tentativas → 15 min). Um limita por IP, o
  outro por conta.
- Em `NODE_ENV=test` os limites sobem 1000×, senão a suíte (dezenas de
  requisições legítimas em segundos) falharia de forma intermitente.
