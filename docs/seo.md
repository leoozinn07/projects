# SEO — AquaTrip

## O que existe

| Item | Onde | Observação |
|---|---|---|
| `robots.txt` | `/robots.txt` | Fora de produção **bloqueia tudo** — staging no Google compete com o site real e expõe dado de teste |
| `sitemap.xml` | `/sitemap.xml` | Só experiências **ativas**; filtro final impede URL privada mesmo se alguém editar a lista |
| Não indexar privado | `X-Robots-Tag` | Cabeçalho, não só meta tag: vale para JSON, imagens e redirecionamentos |
| Título/descrição/canônica | `partials/seo.ejs` | Um lugar só; cada página define seus valores antes do `<title>` |
| Prévia social (WhatsApp, redes) | Open Graph | Usa a foto real da experiência quando existe |
| Dados estruturados | JSON-LD `Product` | Preço e disponibilidade reais; nota **só com avaliação real** |

## Decisões

- **Canônica sem query string**: `?utm_source=...` e filtros não viram páginas duplicadas.
- **Título começa pela experiência**, marca no fim. O cliente busca "mergulho em Noronha", não "AquaTrip".
- **Disponibilidade real no JSON-LD**: sem horário com vaga, o Google recebe `SoldOut`.
- **Nota nos dados estruturados só com avaliação verificada.** Declarar nota que não existe
  viola as regras do Google para dados estruturados — e é o mesmo problema de publicidade
  enganosa que tiramos do catálogo.

## Segurança

O JSON-LD é um `<script>` gerado a partir de dados do banco (título digitado pelo admin).
Todo `<` vira `\u003c` antes de entrar na página. Sem isso, um título como
`</script><script>...` encerraria a tag e viraria **XSS armazenado** na página pública.
É a mesma classe de erro que quebrou o preview das telas; há teste com o ataque real e
teste de mutação provando que ele falha sem o escape.

## Para produção

- `PUBLIC_BASE_URL` precisa ser o domínio real com `https://` — canônica, sitemap e
  Open Graph são montados a partir dele.
- Cadastre o site no Google Search Console e envie `https://seudominio/sitemap.xml`.
