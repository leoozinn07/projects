# Backend real das telas — AquaTrip

## O que era casca

| Tela | Antes | Agora |
|---|---|---|
| `/admin` | 3 arrays fixos + métricas escritas no HTML ("1.284 usuários", "R$ 84.320") | API `/api/admin/*` |
| `/gestao` | 3 arrays fixos, **outros** dados inventados, nomes de campo diferentes | Mesma API |
| `/ingressos` | Array fixo de 5 ingressos | Reservas confirmadas reais |
| `/viagens` | Lia `localStorage` que **nenhuma tela gravava** → todo usuário via as mesmas viagens inventadas como se fossem dele | Tabela `trips`, CRUD por usuário |

`/viagens` e `/ingressos` também estavam **abertas sem login**. Agora exigem.

## Uma API para dois painéis

`/admin` e `/gestao` fazem a mesma coisa. Em vez de dois backends, existe um
(`adminRepository` → `adminService` → `adminController`) e os dois painéis o
consomem. **Consolidar as duas telas numa só é decisão de produto** — o
backend já está pronto para isso.

| Endpoint | O que faz |
|---|---|
| `GET /api/admin/painel` | Métricas, receita dos últimos 6 meses, inconsistências |
| `GET /api/admin/usuarios` | Lista com nº de reservas |
| `POST /api/admin/usuarios/:id/suspender` | `{dias, motivo}` — sem `dias` = sem prazo |
| `POST /api/admin/usuarios/:id/reativar` | |
| `GET/POST /api/admin/experiencias` | Lista com vendidos, ocupação e receita; cria |
| `PUT /api/admin/experiencias/:id` | Edita |
| `POST /api/admin/experiencias/:id/status` | `{ativa}` |
| `GET /api/admin/transacoes` | `?status=&dias=7|30|90` |

Toda rota tem `requireRole('ADMIN')` individualmente, não num prefixo: uma
rota nova esquecida fora de um bloco não fica aberta por acidente.

## Decisões

**Suspensão é aplicada no login e derruba sessões abertas.** Suspender sem
isso seria só um rótulo na tela. A senha é conferida *antes* de informar a
suspensão — senão "conta suspensa" responderia a quem nem sabe a senha,
revelando que o e-mail existe.

**Admin não suspende a si mesmo nem outro admin.** Um clique errado — ou uma
conta de admin comprometida — não tranca a equipe fora do sistema.

**Experiência é desativada, nunca excluída.** Comprovantes, pagamentos e a
guarda fiscal de 5 anos (declarada na Política de Privacidade) apontam para
ela. Desativar tira da vitrine e é reversível. Com reserva viva, nem
desativar é permitido (409).

**Telefone saiu da tela de gestão.** A política diz que coletamos nome e
e-mail. Passar a coletar telefone contradiria o documento (minimização,
LGPD art. 6º, III).

**Upload de imagem ficou fora.** Upload é superfície de ataque própria
(tipo real do arquivo, tamanho, armazenamento). Merece fase dedicada.

**Ingresso não é tabela.** É uma reserva confirmada. Tabela separada abriria
espaço para os dois divergirem (ingresso válido de reserva estornada). O
código exibido é derivado por HMAC: estável, curto para ler em voz alta, e
não permite chegar ao id da reserva.

## Problemas de dado encontrados ao ligar o painel

### 1. Cliente que pagou e não tinha reserva confirmada

Um pagamento `APPROVED` com reserva `PENDING` — a assinatura exata do bug da
Fase 4. O código foi corrigido lá, **mas os registros que o bug estragou
continuavam no banco**. Corrigir o código não conserta o dado.

- O painel agora mostra um alerta de integridade quando esse estado existe.
- `npm run pagamentos:reconciliar` lista os casos (simulação por padrão).
- `npm run pagamentos:reconciliar -- --aplicar` corrige, auditando cada caso.
- Se confirmar causaria overbooking (a vaga foi vendida enquanto a reserva
  estava presa), o script **não decide sozinho**: lista para decisão humana.

### 2. Categoria gravada em dois formatos

O seed gravava `"Mergulho"` e a API grava `"mergulho"`. Os dois coexistiam e
seriam contados como categorias diferentes. A migration 006 normalizou e
adicionou `CHECK` no banco. O rótulo com acento vive em `app/lib/categorias.js`.

## Segurança do front

- Todo dado do servidor passa por `escHTML` antes de `innerHTML`. Título de
  experiência e nome de usuário são texto digitado por pessoas.
- APIs com cookie de sessão exigem `X-CSRF-Token`. A comparação do token
  passou a ser em tempo constante (`timingSafeEqual`; antes era `!==`).
- `requireAuth`/`requireRole` respondem JSON 401/403 em `/api/*`.
- Exportação CSV do faturamento neutraliza fórmulas (`=`, `+`, `-`, `@`),
  senão o Excel as executaria (CSV injection).

## O que ainda falta

- **Cadastro de horários (slots).** O admin cria experiência, mas não os
  horários dela — sem horário, ninguém consegue reservar. Hoje só o seed cria.
- **Autor da experiência.** A tela de gestão foi pensada para experiências
  criadas por usuários; o modelo atual não tem autor.
- **Upload de imagem** (ver acima).


---

## Unificação (feita depois)

`/gestao` foi absorvido pelo `/admin` e hoje responde **301 → /admin**
(favoritos e links antigos continuam funcionando; o `/admin` segue exigindo
ADMIN, então o redirecionamento não abre nada).

Vieram da gestão para o painel único:

| Recurso | Observação |
|---|---|
| Busca e filtros de experiência | categoria, ativas/inativas, **sem horários futuros**, **sem foto** |
| Indicador de ocupação | vendidos ÷ vagas oferecidas; barra + número |
| Filtro de usuário por situação | ativo, suspenso com prazo, suspenso sem prazo |
| Diálogo de suspensão | lista fechada de durações + motivo obrigatório (antes: `window.prompt`, aceitava qualquer texto) |
| Totais do faturamento **filtrado** | recebido, pendente, estornado, taxa; o CSV exportado segue o mesmo filtro |

Arquivos removidos: `gestao.ejs`, `gestao.js`, `gestao.css`.

O JavaScript do painel foi executado num DOM com dados reais da API, operando
cada controle (filtros, diálogo, totais) — não só verificado por leitura.
