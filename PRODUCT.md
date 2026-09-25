# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **Viajante** — pessoa no Brasil que quer descobrir e reservar uma experiência aquática (praia, aquário, mergulho, caiaque, pesca, expedição), escolher data com vaga e pagar sem intermediário escondido.
- **Parceiro** — barqueiros, operadoras de mergulho, guias de pesca, aquários e pousadas com passeios que querem publicar experiências, receber reservas pagas e acompanhar tudo num painel.
- Os dois públicos têm o mesmo peso no redesign. A vitrine pública precisa convencer o viajante a reservar e o parceiro a se cadastrar.

## Product Purpose
AquaTrip é um marketplace de experiências aquáticas **no Brasil**: o cliente reserva e paga, e o parceiro publica e recebe com a comissão do AquaTrip descontada na hora da venda. Sucesso é o viajante chegar da descoberta à reserva confirmada, e o parceiro do cadastro à primeira venda.

## Positioning
Um lugar só para experiências *na água* pelo Brasil, com datas e vagas reais, reserva direta com quem organiza e o pagamento indo direto para o parceiro (Mercado Pago, com divisão automática).

## Operating Context
- **É um simulador.** Pagamentos (PIX/cartão), a conexão com o Mercado Pago e os e-mails funcionam de ponta a ponta, mas simulados. Nenhum dinheiro real se move.
- Jornada do viajante: descobrir (busca e 6 categorias) → escolher data/horário com vaga → reservar (vaga segura por 15 min) → pagar → comprovante → avaliação com fotos.
- Jornada do parceiro: `/parceiros` (landing) → conta → cadastro (CPF/CNPJ, revisão em até 2 dias úteis) → publicar experiências (revisão antes de ir ao ar) → conectar o Mercado Pago → operar reservas e vendas em `/parceiro`.
- Admin único em `/admin` (moderação, auditoria, atendimento).

## Capabilities and Constraints
- Stack: Node.js 22 · Express · EJS · MySQL 8.0, com 422 testes automatizados. Deploy no Render.
- **CSP rígida:** `script-src 'self'`, `font-src 'self'`. Nenhum script, fonte ou CDN de terceiros: bibliotecas e fontes precisam ser auto-hospedadas em `app/public/`. Nada de script inline.
- Tema claro/escuro já existe (`theme.js`, `data-theme`, com fallback em `prefers-color-scheme`) e deve continuar.
- Ícones: Lucide auto-hospedado.
- Rotas e URLs públicas devem ser mantidas (`/`, `/praias`, `/aquarios`, `/mergulho`, `/caiaque`, `/pesca`, `/expedicoes`, `/reservar`, `/reservar/:slug`, `/parceiros` etc.).
- Projeto tratado como produção: segurança, acessibilidade e mobile-first.
- Categorias: Praias, Aquários, Mergulho, Caiaque, Pesca, Expedições.

## Brand Commitments
- Nome: **AquaTrip**. Tagline atual: “Para onde a água te leva?”
- O usuário vai enviar o logo. Ele deve ser **a primeira coisa a aparecer ao entrar no site, de forma animada**.
- Alcance: **só Brasil**. Destinos internacionais (Galápagos, Okinawa, Sydney, Barcelona, fiordes etc.) saem do discurso.
- Restrições visuais definidas pelo usuário: paleta de azuis do mar, temas claro e escuro, tipografia Inter, Open Sans ou Satoshi, seções com scroll e movimento de carrossel/slides. Meta de qualidade: nível Awwwards.

## Evidence on Hand
- Experiências cadastradas (seed): Batismo de mergulho em Fernando de Noronha (PE), Visita ao Aquário de Santos (SP), Caiaque ao pôr do sol em Ilhabela (SP) e Pesca esportiva no Rio Negro (Manaus, AM), além das experiências do parceiro de demonstração.
- Imagens em `app/public/img/`. Muitas são de lugares fora do Brasil (Galápagos, Okinawa/Churaumi, Sydney, Dubai, Georgia Aquarium, Amalfi, fiordes, Quênia, Everest) e não podem ser apresentadas como destinos brasileiros. `amalfitana.webp` está sendo usada hoje para Ilhabela.
- **Não existem** números reais de uso, depoimentos, avaliações reais agregadas nem imprensa. A área de prova social deve continuar marcada como exemplo e nada deve ser inventado como verdadeiro.
- A comissão do parceiro vem de configuração (`comissao`).

## Product Principles
1. Verdade antes de brilho: vaga real, preço real, simulação sinalizada. Nada de números ou depoimentos inventados.
2. A água é o assunto: toda a experiência gira em torno de estar dentro, sobre ou embaixo d’água, no Brasil.
3. Dois públicos, uma vitrine: o viajante é convidado a reservar e o parceiro a vender, sem que um apague o outro.
4. Sem intermediário escondido: fica claro quem organiza, quanto custa e para onde vai o dinheiro.

## Accessibility & Inclusion
- Contraste WCAG AA (o design system atual já documenta as razões de contraste).
- Link para pular ao conteúdo, navegação por teclado e rótulos ARIA já presentes, que devem ser mantidos.
- Animações devem respeitar `prefers-reduced-motion`, incluindo a abertura com o logo.
