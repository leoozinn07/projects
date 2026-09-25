# Base de conhecimento do AquaTrip

Fonte única do assistente virtual. Descreve o funcionamento REAL do site.
Quando algo mudar no sistema, atualize este arquivo.

## O que é o AquaTrip
- Plataforma de experiências aquáticas no Brasil: praias, aquários, mergulho, caiaque, pesca esportiva e expedições.
- Três formas de experiência: (1) da equipe AquaTrip, (2) de parceiros (empresas e profissionais aprovados) e (3) da comunidade (viagens criadas por usuários que abrem vagas para outras pessoas irem junto).
- O site funciona hoje como SIMULADOR: pagamentos (PIX e cartão), a conexão de parceiros com o Mercado Pago e os e-mails funcionam de ponta a ponta, mas simulados. Nenhum dinheiro real é movimentado.
- Alcance: só Brasil.
- Idiomas do site: português, inglês e espanhol (em Configurações). Tema claro ou escuro.
- Slogan: "Para onde a água te leva?"

## Páginas principais
- Início: /
- Todas as experiências e busca: /reservar (busca também pelo botão de lupa ou tecla "/")
- Categorias: /praias, /aquarios, /mergulho, /caiaque, /pesca, /expedicoes
- Página de uma experiência: /reservar/<nome-da-experiencia>
- Comunidade (viagens criadas por usuários): /comunidade
- Criar experiência (qualquer usuário com conta): /criar_experiencia
- Meu perfil social: /meu-perfil  |  Perfil público de alguém: /usuarios/<id>
- Minha conta (nome, e-mail, senha): /perfil_editado
- Minhas reservas: /minhas-reservas  |  Ingressos: /ingressos  |  Diário de viagens: /viagens
- Avaliar experiência: /avaliacao
- Reclamações, sugestões e avaliação do AquaTrip: /feedback
- Contato (principalmente empresas que querem oferecer experiências): /contato
- Para parceiros: /parceiros (apresentação) e /parceiro (área do parceiro)
- Configurações (idioma e tema): /configuracoes
- Central de Privacidade (LGPD): /configuracoes/privacidade
- Termos de Uso: /termos-de-uso  |  Política de Privacidade: /politica-de-privacidade

## Conta, cadastro e login
- Cadastro em /cadastro com nome, e-mail e senha. É preciso ter 18 anos ou mais e aceitar os Termos de Uso e a Política de Privacidade.
- Após o cadastro chega um e-mail de verificação (em /perfil_editado é possível reenviar).
- Login em /login com e-mail e senha. Muitas tentativas erradas bloqueiam a conta temporariamente.
- Esqueci a senha: /esqueci-senha envia um link de redefinição por e-mail, com prazo de validade.
- Verificação em duas etapas (app autenticador como Google Authenticator ou Authy) pode ser ativada em /conta/2fa. É obrigatória para administradores.
- Trocar nome, e-mail ou senha: /perfil_editado. Trocar a senha encerra as outras sessões abertas.
- Sair: menu do perfil > Sair.
- A sessão expira após 8 horas.

## Perfil social
- Em /meu-perfil a pessoa vê: foto, nome, bio (até 280 caracteres), número de seguidores, de pessoas que segue, total de curtidas recebidas nas experiências que publicou, curtidas e comentários de cada experiência e os comentários recebidos.
- Foto de perfil: JPG, PNG ou WebP, até 5 MB. Como toda foto enviada por usuários, ela passa por moderação antes de aparecer para outras pessoas; o próprio dono já vê a foto enquanto ela aguarda.
- No perfil público aparecem o nome no formato "Nome S." (sobrenome abreviado), foto aprovada, bio, contadores e experiências publicadas. E-mail, CPF e dados de contato nunca aparecem.

## Experiências da comunidade (criar a própria viagem)
- Qualquer usuário com conta ativa pode criar uma experiência em /criar_experiencia. Não é exclusivo de parceiros.
- A ideia: você vai fazer uma viagem (por exemplo, para Santos) e abre vagas para outras pessoas irem junto.
- Campos: título, descrição, categoria (praia, mergulho, caiaque, pesca esportiva, expedição, aquário), destino, data, horário, quantidade de vagas (1 a 100), preço por pessoa (pode ser gratuito), informações da viagem (ponto de encontro, o que levar etc.) e até 6 fotos.
- A data precisa ser pelo menos 1 hora no futuro e no máximo 2 anos à frente.
- Experiência GRATUITA: é publicada na hora.
- Experiência PAGA: o valor vai direto para quem organiza, pelo Mercado Pago. Para cobrar, a pessoa precisa concluir o cadastro de parceiro em /parceiros (a área de parceiro é liberada na hora) e conectar o Mercado Pago na área do parceiro. Sem isso, apenas experiências gratuitas podem ser publicadas. O AquaTrip não recebe o dinheiro para repassar depois.
- Fotos passam por moderação antes de aparecer. Até a primeira foto ser aprovada, a experiência usa uma ilustração da categoria.
- O criador gerencia tudo em /meu-perfil (aba de experiências) ou /criar_experiencia?editar=<id>: editar textos, preço, vagas, fotos, pausar ou publicar de novo e ver participantes e interessados.
- Depois que alguém confirmou participação, a data não pode mais ser alterada e o número de vagas não pode ficar abaixo das vagas já ocupadas.
- A moderação do AquaTrip pode suspender ou banir experiências que violem os Termos. Qualquer pessoa pode denunciar uma experiência na página dela.

## Participar de uma experiência
- Na página da experiência a pessoa escolhe a data/horário e o número de pessoas.
- Gratuita: a participação é confirmada na hora e aparece em Minhas reservas e Ingressos.
- Paga: a vaga fica reservada por 15 minutos enquanto a pessoa paga. A reserva só é confirmada depois que o pagamento é aprovado. Se não pagar no prazo, a vaga é liberada.
- "Tenho interesse": botão na página da experiência para sinalizar interesse sem reservar. O criador vê a lista de interessados.
- Ver experiências e preços não exige conta. Reservar, curtir, comentar, seguir e demonstrar interesse exigem login.

## Pagamentos
- Formas: PIX, cartão de crédito (até 12 parcelas) e cartão de débito (sem parcelamento), conforme disponível no checkout.
- O valor é calculado pelo servidor. Cada reserva aceita só uma cobrança ativa; tentativas duplicadas não geram cobrança dupla.
- O AquaTrip não recebe nem armazena número de cartão ou código de segurança.
- Em experiências de parceiros, o pagamento vai direto para o parceiro pelo Mercado Pago, com a comissão do AquaTrip descontada na hora.
- Após a aprovação há comprovante e ingresso com código para apresentar na chegada.
- Hoje tudo é SIMULADO: nenhum valor real é cobrado.

## Cancelamento e estorno
- Reserva pendente (ainda não paga): pode ser cancelada a qualquer momento, sem cobrança.
- Reserva confirmada e paga: o cancelamento pede o estorno ao provedor de pagamento. O prazo de devolução segue as regras do meio de pagamento e da instituição financeira.
- Reserva confirmada gratuita: pode ser cancelada em Minhas reservas.
- Regras específicas do parceiro (antecedência mínima, clima) aparecem na página da experiência e prevalecem quando mais específicas.
- Se a experiência for cancelada pelo parceiro, a pessoa tem direito a reembolso integral.
- Cancelar: /minhas-reservas.

## Curtidas, comentários, avaliações e seguidores
- Curtir: coração na página da experiência ou no card da comunidade. Uma curtida por pessoa por experiência; clicar de novo desfaz.
- Comentários: na página da experiência, de 2 a 600 caracteres. O autor pode apagar o próprio comentário; o criador da experiência também pode apagar comentários da página dele. A moderação pode ocultar comentários que violem as regras.
- Avaliações de experiência (nota de 1 a 5, título, texto e até 3 fotos): só quem participou, com reserva confirmada, e depois da data da experiência. Uma avaliação por reserva. Em /avaliacao.
- Seguir: botão "Seguir" no perfil público ou na página de uma experiência da comunidade. Dá para deixar de seguir a qualquer momento. As experiências de quem você segue aparecem no filtro "Seguindo" em /comunidade.

## Parceiros
- Barqueiros, operadoras de mergulho, guias de pesca, aquários, pousadas e outros profissionais podem vender experiências.
- Caminho: /parceiros > criar conta > cadastro em /parceiro com CPF ou CNPJ (CNPJ alfanumérico é aceito); a área de parceiro é liberada na hora, sem espera de análise > publicar experiências (vão ao ar na hora em que são criadas; a moderação age depois, por denúncias) > conectar o Mercado Pago > receber reservas. Sem o Mercado Pago conectado, as experiências do parceiro não aparecem para o público.
- Fotos de capa enviadas pelo parceiro passam por moderação antes de aparecer; a capa anterior continua no ar enquanto isso.
- Sem mensalidade: a comissão só é cobrada sobre reservas pagas.
- Na área do parceiro há reservas (com código do ingresso para conferir na chegada), vendas, comissões e valor líquido.

## Reclamações, sugestões e avaliação do AquaTrip
- Em /feedback (com login) a pessoa registra uma reclamação, uma sugestão ou uma avaliação do AquaTrip (nota de 1 a 5).
- A equipe responde na própria página e atualiza o status: aberta, em andamento, resolvida ou encerrada.
- Empresas que querem oferecer experiências também podem usar /contato.

## Privacidade e LGPD
- O AquaTrip segue a LGPD. Na Central de Privacidade (/configuracoes/privacidade) a pessoa pode baixar todos os seus dados (exportação imediata em JSON), rever o consentimento de cookies e pedir correção, eliminação ou anonimização.
- Pedidos que exigem análise são respondidos em até 15 dias. Contas com pagamento concluído têm obrigação fiscal de guarda, por isso a eliminação vira anonimização.
- O banner de cookies permite aceitar tudo, recusar o que não é essencial ou personalizar.
- Fotos enviadas têm os metadados (como localização GPS) removidos.
- Dados de cartão não são armazenados.

## Uso adequado (Termos de Uso)
- Proibido: contas falsas, se passar por outra pessoa, tentar acessar dados de outros usuários, burlar limites técnicos ou testar vulnerabilidades sem autorização, publicar conteúdo ilegal ou ofensivo.
- Contas que violem os termos podem ser suspensas ou banidas. Reservas já confirmadas e pagas são preservadas ou reembolsadas.
- Atividades aquáticas envolvem risco: siga as orientações de segurança de quem organiza.
- A execução da experiência (segurança, equipamento, pontualidade) é responsabilidade de quem a realiza; o AquaTrip cuida da plataforma, reserva, pagamento e suporte.

## O que o assistente NÃO sabe ou não faz
- Não tem acesso a reservas, pagamentos, dados pessoais ou contas de ninguém; não altera nada no site.
- Não informa preço, vagas ou datas de cor: para isso usa a busca no catálogo público ou orienta a abrir a página da experiência.
- Não existe hoje: aplicativo nativo para celular, chat entre usuários, cupons de desconto, programa de pontos.
