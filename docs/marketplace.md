# Marketplace — AquaTrip

Decisões do dono do produto: **marketplace** (parceiros cadastram experiências)
e **divisão de pagamento pelo Mercado Pago** (a venda é feita em nome do
parceiro; a comissão do AquaTrip é descontada na hora; o AquaTrip não recebe o
dinheiro do parceiro).

| Fase | Conteúdo | Situação |
|---|---|---|
| 1 | Parceiros: cadastro, aprovação, área do parceiro | **Concluída** |
| 2 | Experiências do parceiro + fila de moderação | **Concluída** |
| 3 | Conexão com o Mercado Pago (OAuth) + divisão do pagamento | **Concluída no simulador** — falta o teste real (ver ativar-mercado-pago.md) |
| 4 | Operação: reservas do parceiro, relatório de vendas e comissões | — |

## Fase 1

**Modelo:** parceiro é um cadastro ligado à conta (`partners`), não um papel de
usuário — a mesma pessoa pode ser cliente e parceira, e os dados de parceiro só
existem para quem é.

**Fluxo:** `/parceiros` (apresentação pública) → conta → `/parceiro` (cadastro)
→ área do parceiro liberada na hora → e-mail de boas-vindas com os próximos passos.

**Documento:**
- **CNPJ alfanumérico aceito** — em produção desde 31/07/2026 (IN RFB 2.229/2024).
  Validação testada contra o primeiro CNPJ alfanumérico real emitido pela Receita
  (`00.000.000/E08G-12`). Uma validação "só dígitos" recusaria toda empresa aberta
  desde julho — justamente os parceiros novos.
- Trava de formato no banco (migration 014).
- CPF é dado pessoal: mascarado em todas as telas, exceto para o admin na análise;
  nunca vai para a auditoria.
- Documento já usado recebe resposta **genérica** — "CPF já cadastrado" revelaria
  que a pessoa é parceira.

**Aprovação no cadastro (set/2026):** por decisão do dono do produto, o
cadastro nasce aprovado e a área do parceiro abre na hora (migration 020
aprovou quem estava aguardando). Continuam valendo: CPF/CNPJ com dígito
verificador, documento único e aceite dos termos.

**Decisões do admin (depois do cadastro):** suspender com motivo de **lista
fechada**, reativar e ajustar a comissão (0–50%; vale para as próximas vendas).
Aprovar/recusar só existem para cadastros antigos ainda pendentes. Transições só
a partir do estado esperado.

**Suspensão tira da vitrine de verdade.** Uma regra única (`app/lib/visibilidade.js`)
é usada por catálogo, vitrine, página da experiência, sitemap **e pela criação da
reserva**. Ao escrever essa regra apareceu um bug anterior: a criação da reserva
não verificava nem se a experiência estava ativa — um horário de experiência
desativada continuava reservável por quem tivesse o id. Corrigido.

**LGPD:** Política atualizada (seção "Se você é parceiro"); exportação inclui o
cadastro (sem tokens do Mercado Pago); anonimização de parceiro ativo exige
encerrar a parceria antes (guarda fiscal das vendas); candidatura pendente ou
recusada é apagada na anonimização.

## Fase 3 — aviso antecipado

A conexão com o Mercado Pago (OAuth do vendedor) e a criação do pagamento com a
comissão da plataforma serão escritas seguindo a documentação oficial, mas **só
poderão ser executadas contra o simulador** neste ambiente (rede bloqueada para o
Mercado Pago). O primeiro teste real precisa ser feito em sandbox, no Render,
com uma aplicação do tipo marketplace criada no painel do Mercado Pago.


## Fase 2

**Publicação imediata (set/2026):** a revisão prévia acabou por decisão do dono
do produto. A experiência vai ao ar ao ser criada (descrição com no mínimo 40
caracteres) e o controle passou a ser depois: denúncias dos usuários e moderação
em **Painel → Comunidade → Moderação** (suspender, banir, reativar), a mesma das
experiências da comunidade. Rascunhos e recusadas de antes da mudança são
publicados pelo botão "Publicar"; as que estavam na fila foram publicadas pela
migration 019.

**Proteção do modelo de negócio:** experiência de parceiro só vai à vitrine
(e só aceita reserva) quando o parceiro tem o **Mercado Pago conectado**. Sem
isso, o pagamento cairia na conta do AquaTrip — o modelo "recebe e repassa" que
foi recusado. A regra está em `app/lib/visibilidade.js`, usada também pela
criação da reserva.

**Edição de experiência publicada:** tudo muda na hora, sem sair do ar (o
valor de cada reserva já feita fica congelado nela). Experiência suspensa ou
banida pela moderação não pode ser editada. Pausar/retomar vendas continua
disponível.

**Capa:** foto nova fica pendente na fila de moderação (a mesma das fotos de
avaliação) sem derrubar a capa atual; aprovada, substitui e a antiga é apagada.

**Posse:** toda operação confere que a experiência é do parceiro; de outro
parceiro ou da equipe AquaTrip responde 404.

**Transparência (CDC, art. 31):** a página da experiência mostra
"Operado por" — o parceiro ou o AquaTrip.
