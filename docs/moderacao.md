# Moderação de fotos — AquaTrip

## Regra

| Conteúdo | Publicação |
|---|---|
| Nota e texto da avaliação | Na hora (moderação posterior, só por violação) |
| Foto enviada por cliente | **Só depois de aprovada** |
| Capa enviada pelo admin | Na hora (quem envia é da equipe) |

Foto tem riscos que texto não tem — rosto de criança ou de terceiros, documento,
placa de carro, nudez — e não há triagem automática confiável aqui. Por isso,
pré-moderação.

A fila é **genérica** (`media.status`), não específica de avaliação: com o
marketplace, fotos que parceiros enviarem para as próprias experiências entram
na mesma fila.

## Garantias (todas com teste)

- Foto pendente **não aparece** na página pública e **não é entregue** pela URL
  direta a visitantes nem a outros clientes (404, não confirma que existe).
- Autor e moderador veem a pendente com `Cache-Control: private, no-store` —
  nunca em cache compartilhado, onde um CDN a serviria antes da aprovação.
- Até 3 fotos por avaliação, com trava na transação: 5 envios simultâneos
  resultam em 3 aceitos e nenhum arquivo órfão.
- Mesmo pipeline das capas: tipo real, limites, **remoção de metadados e GPS**.
- Recusa exige motivo de uma **lista fechada**; o arquivo é apagado, o registro
  (quem, quando, motivo) fica; o autor é avisado por e-mail e vê o motivo em
  Minhas reservas. A vaga volta a ficar livre.
- Decisão não é tomada duas vezes (transição só a partir de `PENDING`).
- Excluir a avaliação ou anonimizar a conta apaga os **arquivos**, não só as
  linhas do banco (o `ON DELETE CASCADE` não toca no disco). Na anonimização,
  os arquivos só saem depois do COMMIT.

## Motivos de recusa

`PESSOAS_IDENTIFICAVEIS`, `DADOS_PESSOAIS`, `CONTEUDO_IMPROPRIO`, `FORA_DO_TEMA`,
`QUALIDADE`, `DIREITOS` — definidos em `app/services/mediaService.js`.

## Não coberto

Conteúdo ilegal grave (ex.: abuso infantil) pode exigir **preservação e
comunicação às autoridades**, não só remoção. Isso é procedimento jurídico, não
técnico: defina com o jurídico antes de abrir o marketplace.
