/* ==============================================================
   AquaTrip — Central de ajuda (respostas prontas, SEM IA)
   ==============================================================
   Fonte única do botão "Ajuda". Cada item tem:
     chaves     palavras e expressões que indicam o assunto (qualquer
                idioma; sem acento e minúsculas não importam)
     pergunta   a pergunta como aparece nas sugestões, por idioma
     resposta   o texto respondido, por idioma. Linhas com "- " viram
                lista; caminhos como /reservar viram links.
   Descreve o funcionamento REAL do site: quando algo mudar no
   sistema, atualize aqui.
   ============================================================== */

const FAQ = [
  {
    id: "saudacao",
    chaves: ["oi", "ola", "bom dia", "boa tarde", "boa noite", "eai", "e ai", "hello", "hi", "hey", "hola", "buenas", "buenos dias"],
    pergunta: { pt: "Oi!", en: "Hi!", es: "¡Hola!" },
    resposta: {
      pt: "Oi! Sou a central de ajuda do AquaTrip. Pergunte sobre reservas, pagamento, criar sua experiência, comunidade, perfil ou privacidade. Também encontro experiências: tente \"mergulho em Noronha\".",
      en: "Hi! This is the AquaTrip help center. Ask about bookings, payment, creating your own experience, the community, your profile or privacy. I can also find experiences: try \"diving in Noronha\".",
      es: "¡Hola! Soy el centro de ayuda de AquaTrip. Pregunta sobre reservas, pago, crear tu experiencia, comunidad, perfil o privacidad. También encuentro experiencias: prueba \"buceo en Noronha\".",
    },
    relacionados: ["reservar", "criar_experiencia", "pagamento"],
  },
  {
    id: "obrigado",
    chaves: ["obrigado", "obrigada", "valeu", "vlw", "brigado", "thanks", "thank you", "gracias"],
    pergunta: { pt: "Obrigado!", en: "Thanks!", es: "¡Gracias!" },
    resposta: {
      pt: "De nada! Se precisar de mais alguma coisa, é só perguntar.",
      en: "You're welcome! If you need anything else, just ask.",
      es: "¡De nada! Si necesitas algo más, solo pregunta.",
    },
  },
  {
    id: "o_que_e",
    chaves: ["o que e o aquatrip", "aquatrip", "sobre o site", "como funciona o site", "o que e esse site", "what is aquatrip", "que es aquatrip", "plataforma"],
    pergunta: { pt: "O que é o AquaTrip?", en: "What is AquaTrip?", es: "¿Qué es AquaTrip?" },
    resposta: {
      pt: "O AquaTrip é uma plataforma de experiências aquáticas no Brasil: praias, aquários, mergulho, caiaque, pesca esportiva e expedições. Há três tipos de experiência:\n- da equipe AquaTrip;\n- de parceiros (empresas e profissionais);\n- da comunidade: viagens criadas por usuários que abrem vagas para outras pessoas irem junto.\nVeja tudo em /reservar e a comunidade em /comunidade.",
      en: "AquaTrip is a platform for water experiences in Brazil: beaches, aquariums, diving, kayaking, sport fishing and expeditions. There are three kinds of experience:\n- by the AquaTrip team;\n- by partners (companies and professionals);\n- by the community: trips created by users who open spots for others to join.\nSee everything at /reservar and the community at /comunidade.",
      es: "AquaTrip es una plataforma de experiencias acuáticas en Brasil: playas, acuarios, buceo, kayak, pesca deportiva y expediciones. Hay tres tipos de experiencia:\n- del equipo AquaTrip;\n- de socios (empresas y profesionales);\n- de la comunidad: viajes creados por usuarios que abren cupos para que otros vayan juntos.\nMira todo en /reservar y la comunidad en /comunidade.",
    },
    relacionados: ["simulador", "reservar", "comunidade"],
  },
  {
    id: "simulador",
    chaves: ["simulado", "simulador", "simulacao", "e real", "pagamento real", "dinheiro real", "cobranca real", "cobrado de verdade", "teste", "de verdade", "real money", "simulated", "dinero real", "prueba"],
    pergunta: { pt: "O pagamento é de verdade?", en: "Is the payment real?", es: "¿El pago es real?" },
    resposta: {
      pt: "Não. Hoje o AquaTrip funciona como SIMULADOR: o checkout é de teste e nenhum dinheiro é movimentado. O PIX mostra um QR Code de teste (não pode ser pago em banco nenhum) e o comprovante sai como \"Comprovante de teste\". Não use cartão real.",
      en: "No. AquaTrip currently works as a SIMULATOR: checkout is a test and no money is moved. PIX shows a test QR code (it cannot be paid at any bank) and the receipt says \"Test receipt\". Do not use a real card.",
      es: "No. Hoy AquaTrip funciona como SIMULADOR: el checkout es de prueba y no se mueve dinero. El PIX muestra un código QR de prueba (no se puede pagar en ningún banco) y el comprobante dice \"Comprobante de prueba\". No uses una tarjeta real.",
    },
    relacionados: ["pix", "cartao", "pagamento"],
  },
  {
    id: "criar_conta",
    chaves: ["criar conta", "cadastro", "cadastrar", "me cadastrar", "registrar", "inscrever", "abrir conta", "idade minima", "email de verificacao", "verificar email", "confirmar email", "sign up", "register", "create account", "registrarse", "crear cuenta"],
    pergunta: { pt: "Como crio uma conta?", en: "How do I create an account?", es: "¿Cómo creo una cuenta?" },
    resposta: {
      pt: "Em /cadastro, com nome, e-mail e senha. É preciso ter 18 anos ou mais e aceitar os Termos de Uso e a Política de Privacidade. Depois chega um e-mail de verificação (dá para reenviar em /perfil_editado). Ver experiências e preços não exige conta; reservar, curtir, comentar e seguir, sim.",
      en: "At /cadastro, with name, email and password. You must be 18 or older and accept the Terms of Use and Privacy Policy. A verification email follows (you can resend it at /perfil_editado). Browsing experiences and prices needs no account; booking, liking, commenting and following do.",
      es: "En /cadastro, con nombre, correo y contraseña. Debes tener 18 años o más y aceptar los Términos de Uso y la Política de Privacidad. Luego llega un correo de verificación (puedes reenviarlo en /perfil_editado). Ver experiencias y precios no requiere cuenta; reservar, dar me gusta, comentar y seguir, sí.",
    },
    relacionados: ["login", "esqueci_senha"],
  },
  {
    id: "login",
    chaves: ["login", "logar", "entrar", "acessar minha conta", "nao consigo entrar", "conta bloqueada", "bloqueou", "sair da conta", "logout", "sessao expirou", "sign in", "log in", "iniciar sesion", "cerrar sesion"],
    pergunta: { pt: "Não consigo entrar na minha conta", en: "I can't log in", es: "No puedo iniciar sesión" },
    resposta: {
      pt: "O login é em /login, com e-mail e senha. Algumas coisas que ajudam:\n- muitas tentativas erradas bloqueiam a conta por 15 minutos;\n- esqueceu a senha? Use /esqueci-senha;\n- a sessão expira depois de 8 horas: é só entrar de novo;\n- para sair: menu do perfil > Sair.",
      en: "Log in at /login with email and password. Tips:\n- too many wrong attempts lock the account for 15 minutes;\n- forgot your password? Use /esqueci-senha;\n- sessions expire after 8 hours: just log in again;\n- to log out: profile menu > Log out.",
      es: "El inicio de sesión es en /login, con correo y contraseña. Consejos:\n- muchos intentos fallidos bloquean la cuenta por 15 minutos;\n- ¿olvidaste la contraseña? Usa /esqueci-senha;\n- la sesión expira después de 8 horas: solo vuelve a entrar;\n- para salir: menú del perfil > Salir.",
    },
    relacionados: ["esqueci_senha", "dois_fatores"],
  },
  {
    id: "esqueci_senha",
    chaves: ["esqueci a senha", "esqueci minha senha", "esqueci senha", "recuperar senha", "redefinir senha", "resetar senha", "perdi a senha", "forgot password", "reset password", "olvide mi contrasena", "recuperar contrasena"],
    pergunta: { pt: "Esqueci minha senha", en: "I forgot my password", es: "Olvidé mi contraseña" },
    resposta: {
      pt: "Em /esqueci-senha você digita o e-mail da conta e recebe um link para criar uma senha nova. O link vale por tempo limitado. Depois de trocar, entre em /login.",
      en: "At /esqueci-senha enter your account email and you'll get a link to create a new password. The link expires after a while. After changing it, log in at /login.",
      es: "En /esqueci-senha escribes el correo de la cuenta y recibes un enlace para crear una contraseña nueva. El enlace vence en un tiempo. Después de cambiarla, entra en /login.",
    },
    relacionados: ["login", "trocar_dados"],
  },
  {
    id: "trocar_dados",
    chaves: ["trocar senha", "mudar senha", "alterar senha", "trocar email", "mudar email", "alterar email", "trocar nome", "mudar nome", "alterar meus dados", "editar conta", "minha conta", "change password", "change email", "cambiar contrasena", "cambiar correo"],
    pergunta: { pt: "Como troco minha senha ou e-mail?", en: "How do I change my password or email?", es: "¿Cómo cambio mi contraseña o correo?" },
    resposta: {
      pt: "Em /perfil_editado (Minha conta) você troca nome, e-mail e senha. Para trocar a senha ou o e-mail, o site pede a senha atual. Trocar a senha encerra as outras sessões abertas, por segurança.",
      en: "At /perfil_editado (My account) you can change name, email and password. Changing the password or email asks for your current password. Changing the password ends your other open sessions, for security.",
      es: "En /perfil_editado (Mi cuenta) cambias nombre, correo y contraseña. Para cambiar la contraseña o el correo, el sitio pide la contraseña actual. Cambiar la contraseña cierra las otras sesiones abiertas, por seguridad.",
    },
    relacionados: ["esqueci_senha", "dois_fatores"],
  },
  {
    id: "dois_fatores",
    chaves: ["2fa", "duas etapas", "dois fatores", "verificacao em duas etapas", "autenticador", "google authenticator", "authy", "codigo de verificacao", "codigos de recuperacao", "two factor", "authenticator", "dos pasos", "autenticacion"],
    pergunta: { pt: "Como ativo a verificação em duas etapas?", en: "How do I turn on two-step verification?", es: "¿Cómo activo la verificación en dos pasos?" },
    resposta: {
      pt: "Em /conta/2fa: leia o QR Code com um app autenticador (Google Authenticator, Microsoft Authenticator, Authy etc.) e confirme com o código e sua senha. Guarde os códigos de recuperação: eles servem se você perder o celular. Para administradores, é obrigatória.",
      en: "At /conta/2fa: scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy etc.) and confirm with the code and your password. Keep the recovery codes: they help if you lose your phone. It is mandatory for administrators.",
      es: "En /conta/2fa: lee el código QR con una app autenticadora (Google Authenticator, Microsoft Authenticator, Authy etc.) y confirma con el código y tu contraseña. Guarda los códigos de recuperación: sirven si pierdes el celular. Para administradores es obligatoria.",
    },
    relacionados: ["login", "trocar_dados"],
  },
  {
    id: "reservar",
    chaves: ["reservar", "reserva", "reservo", "como reservo", "agendar", "comprar", "participar", "garantir vaga", "quero ir", "fazer uma reserva", "book", "booking", "how to book", "reservar una", "hacer una reserva"],
    pergunta: { pt: "Como faço uma reserva?", en: "How do I book?", es: "¿Cómo hago una reserva?" },
    resposta: {
      pt: "Abra a experiência (em /reservar ou /comunidade), escolha a data/horário e o número de pessoas e clique em reservar (precisa estar logado).\n- Gratuita: a participação é confirmada na hora.\n- Paga: a vaga fica guardada por 15 minutos enquanto você paga; se não pagar no prazo, ela é liberada.\nDepois, tudo aparece em /minhas-reservas e /ingressos.",
      en: "Open the experience (at /reservar or /comunidade), choose date/time and number of people and click book (you must be logged in).\n- Free: your spot is confirmed right away.\n- Paid: the spot is held for 15 minutes while you pay; if you don't pay in time, it's released.\nAfterwards everything shows at /minhas-reservas and /ingressos.",
      es: "Abre la experiencia (en /reservar o /comunidade), elige fecha/horario y número de personas y haz clic en reservar (debes haber iniciado sesión).\n- Gratuita: tu lugar se confirma al instante.\n- Paga: el lugar se guarda 15 minutos mientras pagas; si no pagas a tiempo, se libera.\nDespués todo aparece en /minhas-reservas y /ingressos.",
    },
    relacionados: ["pagamento", "cancelar", "ingresso"],
  },
  {
    id: "pagamento",
    chaves: ["pagamento", "pagar", "formas de pagamento", "como pago", "meio de pagamento", "parcelar", "parcelado", "parcelas", "boleto", "payment", "pay", "installments", "pago", "cuotas", "como pagar"],
    pergunta: { pt: "Como funciona o pagamento?", en: "How does payment work?", es: "¿Cómo funciona el pago?" },
    resposta: {
      pt: "O checkout aceita PIX, cartão de crédito (até 12 parcelas) e cartão de débito (à vista). O valor é calculado pelo servidor e cada reserva aceita só uma cobrança ativa, sem cobrança dupla. Atenção: hoje tudo é SIMULADO, nenhum valor real é cobrado. Não existe boleto.",
      en: "Checkout accepts PIX, credit card (up to 12 installments) and debit card (single payment). The amount is calculated by the server and each booking accepts only one active charge, never double. Note: today everything is SIMULATED, no real money is charged. There is no bank slip (boleto).",
      es: "El checkout acepta PIX, tarjeta de crédito (hasta 12 cuotas) y tarjeta de débito (en un pago). El valor lo calcula el servidor y cada reserva acepta solo un cobro activo, sin cobro doble. Atención: hoy todo es SIMULADO, no se cobra dinero real. No existe boleto.",
    },
    relacionados: ["pix", "cartao", "simulador"],
  },
  {
    id: "pix",
    chaves: ["pix", "qr code", "qrcode", "copia e cola", "ja realizei o pagamento", "ja paguei", "pagar com pix", "pix nao aprovou"],
    pergunta: { pt: "Como pago com PIX?", en: "How do I pay with PIX?", es: "¿Cómo pago con PIX?" },
    resposta: {
      pt: "No checkout, escolha PIX e clique em \"Gerar QR Code PIX\". Aparece um QR Code de TESTE e o código copia e cola (não pagáveis em banco nenhum). Depois clique em \"Já realizei o pagamento\": a reserva é confirmada e você vai para o comprovante de teste. O PIX não pede nenhum dado de cartão.",
      en: "At checkout choose PIX and click \"Generate PIX QR code\". A TEST QR code and copy-and-paste code appear (they can't be paid at any bank). Then click \"I've already paid\": the booking is confirmed and you go to the test receipt. PIX never asks for card details.",
      es: "En el checkout elige PIX y haz clic en \"Generar código QR PIX\". Aparece un código QR de PRUEBA y el código copia y pega (no se pueden pagar en ningún banco). Luego haz clic en \"Ya realicé el pago\": la reserva se confirma y vas al comprobante de prueba. El PIX no pide datos de tarjeta.",
    },
    relacionados: ["cartao", "ingresso"],
  },
  {
    id: "cartao",
    chaves: ["cartao", "cartoes", "cartao de credito", "cartao de debito", "credito", "debito", "cvv", "codigo de seguranca", "validade", "numero do cartao", "cartao recusado", "cartao de teste", "cartoes de teste", "credit card", "debit card", "card declined", "tarjeta", "tarjeta de credito"],
    pergunta: { pt: "Como pago com cartão?", en: "How do I pay by card?", es: "¿Cómo pago con tarjeta?" },
    resposta: {
      pt: "Escolha crédito ou débito e preencha número completo, validade (MM/AA) e CVV. O débito tem 16 dígitos; o crédito, de 13 a 19. O número completo e o CVV são conferidos só no seu navegador e não vão para o servidor. Como o checkout é de teste, use só os cartões de teste:\n- 4111 1111 1111 1111: aprova\n- 4000 0000 0002 0000: recusa\n- 4000 0000 0001 0001: fica em análise\nValidade: qualquer data futura. CVV: quaisquer 3 dígitos.",
      en: "Choose credit or debit and fill in the full number, expiry (MM/YY) and CVV. Debit has 16 digits; credit, 13 to 19. The full number and CVV are checked only in your browser and never reach the server. Since checkout is a test, use only the test cards:\n- 4111 1111 1111 1111: approves\n- 4000 0000 0002 0000: declines\n- 4000 0000 0001 0001: stays under review\nExpiry: any future date. CVV: any 3 digits.",
      es: "Elige crédito o débito y completa número completo, vencimiento (MM/AA) y CVV. El débito tiene 16 dígitos; el crédito, de 13 a 19. El número completo y el CVV se verifican solo en tu navegador y no van al servidor. Como el checkout es de prueba, usa solo las tarjetas de prueba:\n- 4111 1111 1111 1111: aprueba\n- 4000 0000 0002 0000: rechaza\n- 4000 0000 0001 0001: queda en revisión\nVencimiento: cualquier fecha futura. CVV: 3 dígitos cualesquiera.",
    },
    relacionados: ["pix", "pagamento"],
  },
  {
    id: "ingresso",
    chaves: ["comprovante", "ingresso", "ingressos", "voucher", "bilhete", "codigo do ingresso", "minhas reservas", "onde vejo minha reserva", "recibo", "ticket", "receipt", "my bookings", "entrada", "comprobante", "mis reservas"],
    pergunta: { pt: "Onde vejo minha reserva e o ingresso?", en: "Where do I see my booking and ticket?", es: "¿Dónde veo mi reserva y la entrada?" },
    resposta: {
      pt: "Suas reservas ficam em /minhas-reservas e os ingressos (com o código para apresentar na chegada) em /ingressos. O comprovante de cada pagamento aprovado abre a partir da reserva. O diário de viagens fica em /viagens.",
      en: "Your bookings are at /minhas-reservas and tickets (with the code to show on arrival) at /ingressos. Each approved payment's receipt opens from the booking. Your travel journal is at /viagens.",
      es: "Tus reservas están en /minhas-reservas y las entradas (con el código para mostrar al llegar) en /ingressos. El comprobante de cada pago aprobado se abre desde la reserva. El diario de viajes está en /viagens.",
    },
    relacionados: ["cancelar", "avaliar"],
  },
  {
    id: "cancelar",
    chaves: ["cancelar", "cancelamento", "cancelo", "desistir", "reembolso", "estorno", "devolucao", "dinheiro de volta", "cancel", "cancel booking", "cancel my booking", "refund", "reembolso", "cancelar reserva", "devolver"],
    pergunta: { pt: "Posso cancelar uma reserva?", en: "Can I cancel a booking?", es: "¿Puedo cancelar una reserva?" },
    resposta: {
      pt: "Sim, em /minhas-reservas.\n- Reserva ainda não paga: cancela a qualquer momento, sem cobrança.\n- Reserva paga: o cancelamento pede o estorno; o prazo de devolução segue as regras do meio de pagamento.\n- Reserva gratuita confirmada: também pode ser cancelada.\nRegras específicas de quem organiza (antecedência, clima) aparecem na página da experiência. Se o parceiro cancelar, o reembolso é integral.",
      en: "Yes, at /minhas-reservas.\n- Unpaid booking: cancel anytime, no charge.\n- Paid booking: cancelling requests a refund; timing follows the payment method's rules.\n- Confirmed free booking: can be cancelled too.\nOrganizer-specific rules (notice, weather) are on the experience page. If the partner cancels, you get a full refund.",
      es: "Sí, en /minhas-reservas.\n- Reserva no pagada: cancela cuando quieras, sin cobro.\n- Reserva pagada: la cancelación pide el reembolso; el plazo sigue las reglas del medio de pago.\n- Reserva gratuita confirmada: también se puede cancelar.\nLas reglas de quien organiza (anticipación, clima) aparecen en la página de la experiencia. Si el socio cancela, el reembolso es total.",
    },
    relacionados: ["ingresso", "reservar"],
  },
  {
    id: "criar_experiencia",
    chaves: ["criar experiencia", "criar uma experiencia", "criar viagem", "publicar experiencia", "publicar viagem", "organizar viagem", "abrir vagas", "minha propria viagem", "anunciar", "divulgar passeio", "create experience", "create a trip", "crear experiencia", "crear un viaje"],
    pergunta: { pt: "Como crio uma experiência?", en: "How do I create an experience?", es: "¿Cómo creo una experiencia?" },
    resposta: {
      pt: "Qualquer pessoa com conta cria em /criar_experiencia (não precisa ser parceiro). A ideia: você vai viajar e abre vagas para outras pessoas irem junto. Preencha título, descrição, categoria, destino, data, horário, vagas (1 a 100), preço (pode ser gratuito), informações da viagem e até 6 fotos.\n- A data precisa ser pelo menos 1 hora no futuro e no máximo 2 anos à frente.\n- Gratuita: é publicada na hora.\n- Paga: veja como cobrar em \"Posso cobrar pela minha experiência?\".",
      en: "Anyone with an account can create one at /criar_experiencia (no need to be a partner). The idea: you're going on a trip and open spots for others to join. Fill in title, description, category, destination, date, time, spots (1 to 100), price (can be free), trip info and up to 6 photos.\n- The date must be at least 1 hour ahead and at most 2 years ahead.\n- Free: published right away.\n- Paid: see \"Can I charge for my experience?\".",
      es: "Cualquier persona con cuenta la crea en /criar_experiencia (no hace falta ser socio). La idea: vas a viajar y abres cupos para que otros vayan contigo. Completa título, descripción, categoría, destino, fecha, horario, cupos (1 a 100), precio (puede ser gratuito), información del viaje y hasta 6 fotos.\n- La fecha debe ser al menos 1 hora adelante y como máximo 2 años.\n- Gratuita: se publica al instante.\n- Paga: mira \"¿Puedo cobrar por mi experiencia?\".",
    },
    relacionados: ["cobrar", "fotos", "gerenciar"],
  },
  {
    id: "cobrar",
    chaves: ["cobrar", "cobrar pela viagem", "cobrar pela experiencia", "cobrar pelo passeio", "experiencia paga", "receber dinheiro", "recebo o dinheiro", "receber pagamento", "mercado pago", "vender", "preco da minha experiencia", "ganhar dinheiro", "charge", "get paid", "cobrar por", "recibir pagos"],
    pergunta: { pt: "Posso cobrar pela minha experiência?", en: "Can I charge for my experience?", es: "¿Puedo cobrar por mi experiencia?" },
    resposta: {
      pt: "Pode. O valor vai direto para quem organiza, pelo Mercado Pago (o AquaTrip não recebe o dinheiro para repassar depois). Para cobrar:\n- conclua o cadastro de parceiro em /parceiros (a área de parceiro é liberada na hora);\n- conecte o Mercado Pago na área do parceiro (/parceiro).\nSem isso, você publica apenas experiências gratuitas.",
      en: "Yes. The money goes straight to the organizer through Mercado Pago (AquaTrip doesn't collect and pass it on). To charge:\n- complete the partner signup at /parceiros (the partner area opens right away);\n- connect Mercado Pago in the partner area (/parceiro).\nWithout that, you can publish only free experiences.",
      es: "Sí. El dinero va directo a quien organiza, por Mercado Pago (AquaTrip no recibe el dinero para pasarlo después). Para cobrar:\n- completa el registro de socio en /parceiros (el área de socio se libera al instante);\n- conecta Mercado Pago en el área del socio (/parceiro).\nSin eso, solo publicas experiencias gratuitas.",
    },
    relacionados: ["parceiro", "criar_experiencia"],
  },
  {
    id: "fotos",
    chaves: ["foto", "fotos", "imagem", "imagens", "enviar foto", "foto nao aparece", "moderacao de foto", "photo", "picture", "image", "imagen"],
    pergunta: { pt: "Por que minha foto não aparece?", en: "Why doesn't my photo show?", es: "¿Por qué no aparece mi foto?" },
    resposta: {
      pt: "Toda foto enviada por usuários (da experiência, da avaliação ou de perfil) passa por moderação antes de aparecer para outras pessoas. Até a primeira foto ser aprovada, a experiência usa uma ilustração da categoria. Formatos: JPG, PNG ou WebP, até 5 MB. A localização (GPS) e outros metadados são removidos.",
      en: "Every photo uploaded by users (experience, review or profile) goes through moderation before others can see it. Until the first photo is approved, the experience uses a category illustration. Formats: JPG, PNG or WebP, up to 5 MB. Location (GPS) and other metadata are removed.",
      es: "Toda foto subida por usuarios (de la experiencia, reseña o perfil) pasa por moderación antes de que otros la vean. Hasta que se apruebe la primera, la experiencia usa una ilustración de la categoría. Formatos: JPG, PNG o WebP, hasta 5 MB. La ubicación (GPS) y otros metadatos se eliminan.",
    },
    relacionados: ["criar_experiencia", "perfil"],
  },
  {
    id: "gerenciar",
    chaves: ["editar experiencia", "alterar experiencia", "mudar data", "pausar", "despublicar", "gerenciar", "participantes", "quem vai", "quem se inscreveu", "inscritos", "inscricoes", "quem confirmou", "interessados", "lista de participantes", "edit experience", "manage", "participants", "editar mi experiencia", "participantes de mi"],
    pergunta: { pt: "Como edito minha experiência e vejo os participantes?", en: "How do I edit my experience and see participants?", es: "¿Cómo edito mi experiencia y veo los participantes?" },
    resposta: {
      pt: "Em /meu-perfil (aba de experiências) ou em /criar_experiencia?editar=<id> você edita textos, preço, vagas e fotos, pausa ou publica de novo e vê participantes e interessados. Depois que alguém confirmou participação, a data não pode mudar e as vagas não podem ficar abaixo das já ocupadas.",
      en: "At /meu-perfil (experiences tab) or /criar_experiencia?editar=<id> you can edit texts, price, spots and photos, pause or republish, and see participants and interested people. Once someone has confirmed, the date can't change and spots can't go below those already taken.",
      es: "En /meu-perfil (pestaña de experiencias) o en /criar_experiencia?editar=<id> editas textos, precio, cupos y fotos, pausas o publicas de nuevo y ves participantes e interesados. Cuando alguien ya confirmó, la fecha no puede cambiar y los cupos no pueden quedar por debajo de los ocupados.",
    },
    relacionados: ["criar_experiencia", "denunciar"],
  },
  {
    id: "comunidade",
    chaves: ["comunidade", "viagens de usuarios", "ir junto", "companhia", "viajar junto", "grupo", "community", "join a trip", "comunidad", "viajar juntos"],
    pergunta: { pt: "O que é a Comunidade?", en: "What is the Community?", es: "¿Qué es la Comunidad?" },
    resposta: {
      pt: "Em /comunidade ficam as viagens criadas por usuários, com data, vagas e valor definidos por quem organiza. Você pode curtir, comentar, seguir quem organiza, marcar \"Tenho interesse\" e participar (a gratuita confirma na hora). O filtro \"De quem sigo\" mostra só as viagens de quem você segue.",
      en: "At /comunidade you find trips created by users, with date, spots and price set by the organizer. You can like, comment, follow the organizer, tap \"I'm interested\" and join (free ones confirm right away). The \"People I follow\" filter shows only trips from people you follow.",
      es: "En /comunidade están los viajes creados por usuarios, con fecha, cupos y precio definidos por quien organiza. Puedes dar me gusta, comentar, seguir a quien organiza, marcar \"Me interesa\" y participar (la gratuita se confirma al instante). El filtro \"De quien sigo\" muestra solo los viajes de quien sigues.",
    },
    relacionados: ["criar_experiencia", "social", "exemplo"],
  },
  {
    id: "social",
    chaves: ["curtir", "curtida", "like", "coracao", "comentar", "comentario", "comentarios", "apagar comentario", "seguir", "seguidores", "deixar de seguir", "tenho interesse", "interesse", "follow", "comment", "me gusta", "comentar", "seguir a"],
    pergunta: { pt: "Como curtir, comentar e seguir?", en: "How do I like, comment and follow?", es: "¿Cómo dar me gusta, comentar y seguir?" },
    resposta: {
      pt: "Tudo na página da experiência (com login):\n- Curtir: o coração. Uma curtida por pessoa; clicar de novo desfaz.\n- Comentar: de 2 a 600 caracteres. Você apaga os seus; quem organiza pode apagar os da página dele.\n- Seguir: botão \"Seguir\" no perfil ou na experiência; dá para deixar de seguir quando quiser.\n- \"Tenho interesse\": avisa quem organiza sem fazer reserva.",
      en: "All on the experience page (logged in):\n- Like: the heart. One like per person; tap again to undo.\n- Comment: 2 to 600 characters. You can delete yours; the organizer can delete comments on their page.\n- Follow: \"Follow\" button on the profile or experience; unfollow anytime.\n- \"I'm interested\": lets the organizer know without booking.",
      es: "Todo en la página de la experiencia (con sesión iniciada):\n- Me gusta: el corazón. Uno por persona; tocar de nuevo lo quita.\n- Comentar: de 2 a 600 caracteres. Borras los tuyos; quien organiza puede borrar los de su página.\n- Seguir: botón \"Seguir\" en el perfil o la experiencia; puedes dejar de seguir cuando quieras.\n- \"Me interesa\": avisa a quien organiza sin reservar.",
    },
    relacionados: ["perfil", "denunciar"],
  },
  {
    id: "avaliar",
    chaves: ["avaliar", "avaliacao", "avaliacoes", "nota", "estrelas", "review", "deixar avaliacao", "opiniao", "rate", "rating", "resena", "calificar", "opinion"],
    pergunta: { pt: "Como avalio uma experiência?", en: "How do I review an experience?", es: "¿Cómo califico una experiencia?" },
    resposta: {
      pt: "Em /avaliacao. Só quem participou (reserva confirmada) pode avaliar, e só depois da data da experiência. Uma avaliação por reserva, com nota de 1 a 5, título, texto e até 3 fotos (as fotos passam por moderação).",
      en: "At /avaliacao. Only people who took part (confirmed booking) can review, and only after the experience date. One review per booking, with a 1 to 5 rating, title, text and up to 3 photos (photos are moderated).",
      es: "En /avaliacao. Solo quien participó (reserva confirmada) puede calificar, y solo después de la fecha de la experiencia. Una reseña por reserva, con nota de 1 a 5, título, texto y hasta 3 fotos (las fotos pasan por moderación).",
    },
    relacionados: ["ingresso", "feedback"],
  },
  {
    id: "perfil",
    chaves: ["perfil", "meu perfil", "foto de perfil", "bio", "perfil publico", "profile", "my profile", "perfil publico", "mi perfil"],
    pergunta: { pt: "Como edito meu perfil?", en: "How do I edit my profile?", es: "¿Cómo edito mi perfil?" },
    resposta: {
      pt: "Em /meu-perfil você muda a foto (passa por moderação) e a bio (até 280 caracteres) e vê seguidores, quem você segue, curtidas e comentários recebidos. No perfil público aparecem nome no formato \"Nome S.\", foto aprovada, bio, contadores e experiências publicadas. E-mail, CPF e contato nunca aparecem.",
      en: "At /meu-perfil you change your photo (moderated) and bio (up to 280 characters) and see followers, following, likes and comments received. The public profile shows the name as \"Name S.\", approved photo, bio, counters and published experiences. Email, CPF and contact details never show.",
      es: "En /meu-perfil cambias la foto (pasa por moderación) y la bio (hasta 280 caracteres) y ves seguidores, a quién sigues, me gusta y comentarios recibidos. El perfil público muestra el nombre como \"Nombre S.\", foto aprobada, bio, contadores y experiencias publicadas. Correo, CPF y contacto nunca aparecen.",
    },
    relacionados: ["fotos", "privacidade"],
  },
  {
    id: "denunciar",
    chaves: ["denunciar", "denuncia", "golpe", "fraude", "conteudo ofensivo", "abuso", "reportar", "report", "scam", "denunciar una", "estafa"],
    pergunta: { pt: "Como denuncio uma experiência?", en: "How do I report an experience?", es: "¿Cómo denuncio una experiencia?" },
    resposta: {
      pt: "Na página da experiência, use \"Denunciar\" e escolha o motivo (dá para acrescentar detalhes). A moderação do AquaTrip analisa e pode suspender ou banir experiências e contas que violem os Termos de Uso.",
      en: "On the experience page use \"Report\" and choose a reason (you can add details). AquaTrip moderation reviews it and may suspend or ban experiences and accounts that break the Terms of Use.",
      es: "En la página de la experiencia usa \"Denunciar\" y elige el motivo (puedes agregar detalles). La moderación de AquaTrip lo analiza y puede suspender o bloquear experiencias y cuentas que violen los Términos de Uso.",
    },
    relacionados: ["feedback", "seguranca"],
  },
  {
    id: "parceiro",
    chaves: ["parceiro", "parceria", "ser parceiro", "empresa", "barqueiro", "operadora", "guia", "pousada", "vender passeios", "cnpj", "comissao", "partner", "business", "socio", "empresa de turismo", "comision"],
    pergunta: { pt: "Como vendo meus passeios como parceiro?", en: "How do I sell tours as a partner?", es: "¿Cómo vendo mis paseos como socio?" },
    resposta: {
      pt: "Barqueiros, operadoras de mergulho, guias, aquários, pousadas e outros profissionais podem vender. O caminho:\n- /parceiros > criar conta > cadastro em /parceiro com CPF ou CNPJ (a área é liberada na hora);\n- publique experiências (vão ao ar na hora; a moderação age depois, por denúncias);\n- conecte o Mercado Pago para aparecer ao público e receber.\nSem mensalidade: a comissão só incide sobre reservas pagas. Na área do parceiro há reservas (com o código do ingresso), vendas, comissões e valor líquido.",
      en: "Boat operators, dive shops, guides, aquariums, inns and other professionals can sell. The path:\n- /parceiros > create account > signup at /parceiro with CPF or CNPJ (the area opens right away);\n- publish experiences (live right away; moderation acts later, on reports);\n- connect Mercado Pago to be visible to the public and get paid.\nNo monthly fee: commission only applies to paid bookings. The partner area shows bookings (with ticket codes), sales, commissions and net amount.",
      es: "Barqueros, operadoras de buceo, guías, acuarios, posadas y otros profesionales pueden vender. El camino:\n- /parceiros > crear cuenta > registro en /parceiro con CPF o CNPJ (el área se libera al instante);\n- publica experiencias (salen al instante; la moderación actúa después, por denuncias);\n- conecta Mercado Pago para aparecer al público y cobrar.\nSin mensualidad: la comisión solo se aplica a reservas pagadas. El área del socio muestra reservas (con el código de la entrada), ventas, comisiones y valor neto.",
    },
    relacionados: ["cobrar", "feedback"],
  },
  {
    id: "feedback",
    chaves: ["reclamacao", "reclamar", "sugestao", "sugerir", "problema", "suporte", "atendimento", "falar com a equipe", "falar com alguem", "contato", "ajuda humana", "avaliar o aquatrip", "complaint", "support", "contact", "reclamo", "soporte", "contacto", "queja"],
    pergunta: { pt: "Como falo com a equipe ou faço uma reclamação?", en: "How do I contact the team or complain?", es: "¿Cómo hablo con el equipo o hago un reclamo?" },
    resposta: {
      pt: "Em /feedback (com login) você registra uma reclamação, uma sugestão ou uma avaliação do AquaTrip (nota de 1 a 5). A equipe responde na própria página e atualiza o status: aberta, em andamento, resolvida ou encerrada. Empresas que querem oferecer experiências também podem usar /contato.",
      en: "At /feedback (logged in) you can file a complaint, a suggestion or a rating of AquaTrip (1 to 5). The team replies on that page and updates the status: open, in progress, resolved or closed. Businesses wanting to offer experiences can also use /contato.",
      es: "En /feedback (con sesión iniciada) registras un reclamo, una sugerencia o una calificación de AquaTrip (nota de 1 a 5). El equipo responde en la misma página y actualiza el estado: abierto, en curso, resuelto o cerrado. Las empresas que quieren ofrecer experiencias también pueden usar /contato.",
    },
    relacionados: ["denunciar", "privacidade"],
  },
  {
    id: "privacidade",
    chaves: ["privacidade", "lgpd", "meus dados", "dados pessoais", "excluir conta", "apagar conta", "deletar conta", "encerrar conta", "excluir cadastro", "apagar cadastro", "excluir meus dados", "baixar meus dados", "exportar dados", "cookies", "anonimizar", "privacy", "delete account", "my data", "privacidad", "borrar cuenta", "mis datos"],
    pergunta: { pt: "Como vejo ou apago meus dados (LGPD)?", en: "How do I see or delete my data?", es: "¿Cómo veo o borro mis datos?" },
    resposta: {
      pt: "Na Central de Privacidade (/configuracoes/privacidade) você baixa todos os seus dados na hora (JSON), revê o consentimento de cookies e pede correção, eliminação ou anonimização. Pedidos que exigem análise são respondidos em até 15 dias. Contas com pagamento concluído têm obrigação fiscal de guarda: nesse caso a eliminação vira anonimização. Dados de cartão não são armazenados.",
      en: "In the Privacy Center (/configuracoes/privacidade) you can download all your data instantly (JSON), review cookie consent and request correction, deletion or anonymization. Requests needing review are answered within 15 days. Accounts with completed payments have a tax retention duty: deletion becomes anonymization. Card data is not stored.",
      es: "En la Central de Privacidad (/configuracoes/privacidade) descargas todos tus datos al instante (JSON), revisas el consentimiento de cookies y pides corrección, eliminación o anonimización. Los pedidos que requieren análisis se responden en hasta 15 días. Las cuentas con pago concluido tienen obligación fiscal de guarda: la eliminación se convierte en anonimización. Los datos de tarjeta no se guardan.",
    },
    relacionados: ["perfil", "termos"],
  },
  {
    id: "idioma_tema",
    chaves: ["idioma", "lingua", "ingles", "espanhol", "portugues", "tema escuro", "modo escuro", "tema claro", "language", "english", "spanish", "dark mode", "dark theme", "idioma ingles", "modo oscuro"],
    pergunta: { pt: "Como mudo o idioma ou o tema?", en: "How do I change language or theme?", es: "¿Cómo cambio el idioma o el tema?" },
    resposta: {
      pt: "Em /configuracoes você escolhe português, inglês ou espanhol e o tema claro ou escuro. O botão de sol/lua no topo também alterna o tema.",
      en: "At /configuracoes you choose Portuguese, English or Spanish and light or dark theme. The sun/moon button at the top also toggles the theme.",
      es: "En /configuracoes eliges portugués, inglés o español y el tema claro u oscuro. El botón de sol/luna arriba también cambia el tema.",
    },
  },
  {
    id: "exemplo",
    chaves: ["exemplo", "selo exemplo", "perfil de exemplo", "conteudo de exemplo", "demonstracao", "perfil falso", "e falso", "sample", "demo", "ejemplo"],
    pergunta: { pt: "O que é o selo \"Exemplo\"?", en: "What is the \"Sample\" badge?", es: "¿Qué es la etiqueta \"Ejemplo\"?" },
    resposta: {
      pt: "Viagens, perfis, comentários e avaliações com o selo \"Exemplo\" são conteúdo de demonstração, criado só para testar o site. Não são pessoas nem viagens reais e ficam fora do catálogo e da busca.",
      en: "Trips, profiles, comments and reviews with the \"Sample\" badge are demo content created only to test the site. They are not real people or trips and are kept out of the catalog and search.",
      es: "Viajes, perfiles, comentarios y reseñas con la etiqueta \"Ejemplo\" son contenido de demostración, creado solo para probar el sitio. No son personas ni viajes reales y quedan fuera del catálogo y la búsqueda.",
    },
  },
  {
    id: "nao_existe",
    chaves: ["aplicativo", "app", "baixar app", "app celular", "app pra celular", "aplicativo celular", "cupom", "cupom de desconto", "desconto", "promocao", "programa de pontos", "pontos", "milhas", "chat entre usuarios", "mensagem privada", "coupon", "discount", "points", "aplicacion", "cupon", "descuento"],
    pergunta: { pt: "Tem aplicativo, cupom ou programa de pontos?", en: "Is there an app, coupon or points program?", es: "¿Hay app, cupón o programa de puntos?" },
    resposta: {
      pt: "Ainda não. Hoje o AquaTrip não tem aplicativo nativo, cupons de desconto, programa de pontos nem chat entre usuários. O site funciona no navegador do celular. Para sugerir algo, use /feedback.",
      en: "Not yet. AquaTrip currently has no native app, discount coupons, points program or user-to-user chat. The site works in your phone's browser. To suggest something, use /feedback.",
      es: "Todavía no. Hoy AquaTrip no tiene app nativa, cupones de descuento, programa de puntos ni chat entre usuarios. El sitio funciona en el navegador del celular. Para sugerir algo, usa /feedback.",
    },
  },
  {
    id: "seguranca",
    chaves: ["seguranca", "seguro", "e seguro", "risco", "perigo", "responsabilidade", "acidente", "colete", "equipamento", "safety", "safe", "seguridad", "peligro"],
    pergunta: { pt: "As atividades são seguras? Quem é responsável?", en: "Are activities safe? Who is responsible?", es: "¿Las actividades son seguras? ¿Quién es responsable?" },
    resposta: {
      pt: "Atividades aquáticas envolvem risco: siga as orientações de segurança de quem organiza. A execução da experiência (segurança, equipamento, pontualidade) é responsabilidade de quem a realiza; o AquaTrip cuida da plataforma, da reserva, do pagamento e do suporte. Viu algo errado? Denuncie na página da experiência.",
      en: "Water activities involve risk: follow the organizer's safety guidance. Running the experience (safety, equipment, punctuality) is the organizer's responsibility; AquaTrip handles the platform, booking, payment and support. Saw something wrong? Report it on the experience page.",
      es: "Las actividades acuáticas implican riesgo: sigue las orientaciones de seguridad de quien organiza. La ejecución de la experiencia (seguridad, equipo, puntualidad) es responsabilidad de quien la realiza; AquaTrip se encarga de la plataforma, la reserva, el pago y el soporte. ¿Viste algo mal? Denúncialo en la página de la experiencia.",
    },
    relacionados: ["denunciar", "termos"],
  },
  {
    id: "termos",
    chaves: ["termos", "termos de uso", "politica de privacidade", "regras", "proibido", "banido", "suspenso", "terms", "rules", "banned", "terminos", "reglas"],
    pergunta: { pt: "Quais são as regras do site?", en: "What are the site rules?", es: "¿Cuáles son las reglas del sitio?" },
    resposta: {
      pt: "Estão nos Termos de Uso (/termos-de-uso) e na Política de Privacidade (/politica-de-privacidade). É proibido criar contas falsas, se passar por outra pessoa, tentar acessar dados de outros usuários, burlar limites do sistema ou publicar conteúdo ilegal ou ofensivo. Contas que violam os termos podem ser suspensas ou banidas; reservas pagas são preservadas ou reembolsadas.",
      en: "They're in the Terms of Use (/termos-de-uso) and the Privacy Policy (/politica-de-privacidade). Fake accounts, impersonation, trying to access other users' data, bypassing system limits and posting illegal or offensive content are forbidden. Accounts that break the terms may be suspended or banned; paid bookings are kept or refunded.",
      es: "Están en los Términos de Uso (/termos-de-uso) y la Política de Privacidad (/politica-de-privacidade). Está prohibido crear cuentas falsas, hacerse pasar por otra persona, intentar acceder a datos de otros usuarios, burlar límites del sistema o publicar contenido ilegal u ofensivo. Las cuentas que violan los términos pueden ser suspendidas o bloqueadas; las reservas pagadas se mantienen o se reembolsan.",
    },
    relacionados: ["privacidade", "denunciar"],
  },
  {
    id: "catalogo",
    chaves: ["experiencias", "passeios", "destinos", "onde ir", "o que tem", "catalogo", "todas as experiencias", "praias", "mergulho", "aquarios", "caiaque", "pesca", "expedicoes", "experiences", "tours", "destinations", "experiencias disponibles", "paseos"],
    pergunta: { pt: "Quais experiências existem?", en: "What experiences are there?", es: "¿Qué experiencias hay?" },
    resposta: {
      pt: "Todas as experiências estão em /reservar (a busca também abre pela lupa ou pela tecla \"/\"). Por tipo: /praias, /aquarios, /mergulho, /caiaque, /pesca e /expedicoes. As viagens da comunidade ficam em /comunidade. Dica: me pergunte, por exemplo, \"mergulho em Noronha\" que eu procuro para você.",
      en: "All experiences are at /reservar (search also opens from the magnifier or the \"/\" key). By type: /praias, /aquarios, /mergulho, /caiaque, /pesca and /expedicoes. Community trips are at /comunidade. Tip: ask me, for example, \"diving in Noronha\" and I'll look it up.",
      es: "Todas las experiencias están en /reservar (la búsqueda también se abre con la lupa o la tecla \"/\"). Por tipo: /praias, /aquarios, /mergulho, /caiaque, /pesca y /expedicoes. Los viajes de la comunidad están en /comunidade. Consejo: pregúntame, por ejemplo, \"buceo en Noronha\" y lo busco.",
    },
    relacionados: ["reservar", "comunidade"],
  },
];

/* Sugestões iniciais e quando a pergunta não é entendida. */
const POPULARES = ["reservar", "pagamento", "criar_experiencia", "cancelar"];

module.exports = { FAQ, POPULARES };
