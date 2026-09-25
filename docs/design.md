# Design "Descida"

O site é um mergulho: a home começa na superfície clara e cada seção desce um
pouco mais, até o azul abissal do rodapé. As outras páginas moram na
superfície e usam a água funda só no rodapé e em blocos de destaque.

## Onde está cada coisa

| Arquivo | O que tem |
|---|---|
| `app/public/css/design-system.css` | Tokens, tema claro/escuro, botões, formulários, cartão de experiência, chips, estados vazios |
| `app/public/css/mobile-shell.css` | Cabeçalho flutuante, menu em tela cheia, dock do celular, busca, sheets, consentimento |
| `app/public/css/header.css` | Menu de perfil e rodapé |
| `app/public/css/index.css` + `app/public/js/home.js` | Home: abertura com o logo, profundímetro, slides, carrossel, faixa, mapa, cartões empilhados |
| `app/public/js/intro-gate.js` | Decide antes da pintura se a abertura aparece (1ª visita da sessão, nunca com "reduzir movimento") |
| `app/views/partials/exp-card.ejs` | Cartão de experiência usado na home, no catálogo e em `/reservar` |
| `app/views/partials/mapa-brasil.ejs` | Pontos do mapa do Brasil (gerado do Natural Earth, não editar à mão) |

## Tokens

- **Profundidade:** `--d0` (superfície) a `--d6` (fundo). A home usa a escala toda.
- **Um acento só, da família ciano:** `--accent` (#0a6a93 no claro, passa AA
  sobre a espuma) e `--bio` (#5ce1e6, bioluminescente) no escuro e em blocos
  `.is-deep`.
- **`.is-deep`:** qualquer bloco com essa classe troca tinta, linha e acento
  para água funda, nos dois temas.
- **Nomes antigos** (`--brand`, `--ink-soft`, `--border`...) continuam como
  apelidos, então CSS antigo herda o visual novo.

## Tipografia

Inter variável com eixo de tamanho óptico (auto-hospedada). Títulos grandes em
peso 640 com `letter-spacing: -0.05em`. IBM Plex Mono só para números de
instrumento: profundidade, coordenadas, contagens e códigos.

## Movimento

GSAP + ScrollTrigger + Lenis, auto-hospedados em `app/public/vendor/` (a CSP
não aceita scripts de terceiros). Cada animação tem um motivo: a foto afunda
(descida), as categorias passam de lado (escolha), a faixa acelera com o scroll,
o cartão de trás recua (sequência). Com "reduzir movimento", nada se move e a
página continua completa.

## Regras que valem manter

- Nada de número, depoimento ou avaliação inventada. A área de prova social
  fica marcada como reservada até existir dado real.
- Foto sem lugar identificável quando for ilustrativa. Cartão sem foto do
  parceiro usa a imagem da categoria e isso é dito na página.
- Só Brasil: nada de destino internacional no discurso.
- Sem travessão em texto de interface. Os textos legais (termos e
  privacidade) ficaram como estavam, de propósito.

## Fotos que ainda precisam ser trocadas

As imagens abaixo são provisórias: não mostram o lugar da experiência.

| Onde | Arquivo atual | Precisa de |
|---|---|---|
| Categoria Praias e Caiaque (ilustração) | `img/praia.webp` | Praia ou remada no litoral brasileiro |
| Categoria Pesca (ilustração) | `img/mata.webp` | Rio amazônico ou pesca esportiva no Brasil |
| Categoria Expedições | `img/baleia.webp` | Pode ficar (baleia sem lugar identificável) ou roteiro brasileiro |
| Aquários | `img/santos.webp` | Já é o Aquário de Santos |
| Home, hero | `img/noronha-hero.webp` | Já é Fernando de Noronha |
