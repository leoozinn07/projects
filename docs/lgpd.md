# LGPD — AquaTrip

## O que estava errado antes

O banner de consentimento existia, mas era **fachada**:

1. A escolha era gravada **só no `localStorage`** do visitante. Isso não
   demonstra consentimento (art. 8º, §2º): o dado vive no dispositivo dele,
   some quando limpa o navegador e o serviço não tem registro nenhum.
2. Os links de "Política de Privacidade" e "Termos" apontavam para `#`.
   As páginas **não existiam**.
3. O banner prometia "nenhum script de terceiro antes do consentimento",
   mas o `unpkg.com` carregava incondicionalmente no `<head>` — vazando o
   IP do visitante antes de qualquer decisão.

## O que existe agora

### Registro server-side (art. 8º, §2º)

Cada decisão vira uma linha em `consent_records`, com:

- `visitor_id` — id aleatório do dispositivo, gerado pelo servidor. Permite
  registrar a escolha de quem ainda não tem conta.
- `user_id` — preenchido quando há sessão, para o titular ver e revogar.
- `policy_version` — **a que texto a pessoa consentiu**. Sem isso, não há
  como saber ao que ela concordou quando a política mudar.
- `action` — `accept_all` | `reject_non_essential` | `custom` | `withdrawn`.
- `ip_address` — **truncado** (último octeto descartado). Prova a origem
  sem identificar o dispositivo exato: minimização, art. 6º, III.

Histórico é imutável: cada decisão é uma linha nova, nunca um UPDATE.

### Versionamento

`PRIVACY_POLICY_VERSION` no `.env`. Ao publicar texto novo, incremente:
quem consentiu com a versão antiga volta a ver o aviso, porque consentiu
com outro documento.

### Granularidade (art. 9º, §1º)

`analytics` e `marketing` são finalidades separadas. **"Necessários" não é
consentimento** — a base legal é execução de contrato, e por isso aparece
como "sempre ativo", sem interruptor falso que simula escolha.

### Revogação (art. 8º, §5º)

Um botão na Central de Privacidade, sem recarregar a página. Revogar é tão
fácil quanto aceitar — que é exatamente o que a lei exige.

> Bug encontrado e corrigido durante os testes: a revogação gravava o cache
> de sessão como se fosse decisão válida, então o aviso nunca voltava a
> aparecer — na prática impedindo a pessoa de consentir de novo. Hoje a
> revogação limpa o espelho da sessão. Há teste cobrindo.

### Direitos do titular (arts. 18 e 19)

Dois caminhos, propositalmente diferentes:

| Direito | Como é atendido |
|---|---|
| Acesso e portabilidade | **Na hora.** Download de JSON com perfil, reservas, pagamentos, consentimentos e registros de acesso. |
| Correção, eliminação, anonimização, info de compartilhamento | Solicitação registrada em `data_requests`, respondida em até 15 dias. |

Os segundos exigem análise humana porque apagar conta com pagamento
concluído esbarra em obrigação fiscal de guarda. O registro é o que prova
o cumprimento do prazo do art. 19.

**A exportação não inclui** hash de senha nem tokens: não são dado pessoal
exportável e expô-los criaria risco. Há teste verificando que não vazam.

### Terceiros

Os ícones passaram a ser servidos do próprio domínio
(`app/public/vendor/lucide.min.js`, instalado via npm). Com isso:

- a CSP foi endurecida para **`script-src 'self'`** — nenhum script externo;
- fechou-se o vetor de supply chain (antes, `unpkg@latest`, sem versão
  travada nem SRI);
- a promessa do banner passou a ser verdadeira.

**Pendência conhecida:** o Google Fonts ainda carrega do domínio da Google,
o que compartilha o IP do visitante. Duas saídas:

1. **Auto-hospedar** (recomendado): baixe os `.woff2` do Inter e do Manrope,
   coloque em `app/public/fonts/` e sirva com `@font-face` local. Aí dá para
   remover `fonts.googleapis.com`/`fonts.gstatic.com` da CSP também.
2. Manter e declarar na política, tratando como necessário à renderização.

Hoje está declarado na política. A opção 1 é melhor e não foi feita aqui
porque o ambiente de desenvolvimento não tem acesso de rede aos domínios
da Google para baixar os arquivos.

## Páginas

| Rota | O que é | Acesso |
|---|---|---|
| `/politica-de-privacidade` | Política, com sumário navegável | Público |
| `/termos-de-uso` | Termos de uso | Público |
| `/configuracoes/privacidade` | Central do titular | Requer login |
| `/configuracoes/privacidade/exportar` | Download dos dados | Requer login |
| `/api/consentimento` | GET estado, POST decisão | Público |

## Sobre os textos legais

Foram escritos **a partir do comportamento real do código** — prazo de 15
minutos, confirmação por webhook, Argon2id, retenção de 6 meses do Marco
Civil, não armazenamento de cartão. Não são modelo genérico.

Mesmo assim, **não substituem revisão jurídica**. Falta o que só você tem:
razão social, CNPJ, endereço, foro e as cláusulas do contrato com os
parceiros. Ambas as páginas trazem esse aviso de forma visível.

---

## Atendimento das solicitações (adicionado depois)

Na primeira versão desta fase, o titular conseguia **abrir** uma
solicitação, mas não havia onde o admin **atender**. A Central prometia
resposta em 15 dias sem que ninguém pudesse cumprir. Corrigido:

- Painel admin → **Atendimento**: lista com dias restantes, destaque para
  atrasadas e contador no menu desde a entrada no painel.
- Encerrar exige resposta escrita (recusa precisa ser fundamentada,
  art. 18, §4º). A resposta vai por e-mail e aparece na Central do titular.
- Fica registrado quem atendeu (`handled_by`) e quando (`resolved_at`).

### Eliminação = anonimização

Apagar a conta inteira violaria a guarda fiscal; marcar como "concluída"
sem apagar nada seria conformidade de fachada. O que acontece (art. 16):

| Some | Fica, sem identificação |
|---|---|
| Nome, e-mail, senha (substituídos) | Reservas e pagamentos (5 anos) |
| Diário de viagens | Registro de consentimento (prova) |
| Mensagens de contato do mesmo e-mail | IP e data na auditoria (Marco Civil) |
| E-mail dentro da auditoria | |
| Sessões abertas | |

Travas: não anonimiza admin, nem quem tem reserva futura ou pendente
(quebraria a viagem da própria pessoa), nem a partir de outro tipo de
pedido. É irreversível e o painel pede confirmação.
