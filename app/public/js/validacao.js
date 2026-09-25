
document.addEventListener('DOMContentLoaded', () => {

    const emailRegex = /^\w+([-+.']\w+)*@\w+([-.]?\w+)*\.\w+([-.]?\w+)*$/;

    const form           = document.getElementById('form');
    const inputNome      = document.querySelector('input[name="nome"]');
    const inputEmail     = document.querySelector('input[name="email"]');
    const inputSenha     = document.querySelector('input[name="senha"]');
    const inputConfirma  = document.querySelector('input[name="confirma-senha"]');

    if (!form) return; 


    function setError(input) {
        if (!input) return;
        input.classList.add('is-invalid');
        input.setAttribute('aria-invalid', 'true');
        const span = input.parentElement.querySelector('.span-required');
        if (span) span.classList.add('is-on');
    }

    function removeError(input) {
        if (!input) return;
        input.classList.remove('is-invalid');
        input.removeAttribute('aria-invalid');
        const span = input.parentElement.querySelector('.span-required');
        if (span) span.classList.remove('is-on');
    }


    function nameValidate() {
        if (!inputNome) return true; // campo inexistente na página = ignora
        if (inputNome.value.trim().length < 3) {
            setError(inputNome);
            return false;
        }
        removeError(inputNome);
        return true;
    }

    function emailValidate() {
        if (!inputEmail) return true;
        if (!emailRegex.test(inputEmail.value.trim())) {
            setError(inputEmail);
            return false;
        }
        removeError(inputEmail);
        return true;
    }

    function mainPasswordValidate() {
        if (!inputSenha) return true;
        if (inputSenha.value.length < 8) {
            setError(inputSenha);
            return false;
        }
        removeError(inputSenha);
        return true;
    }

    // Aceite dos Termos (só no cadastro). O aviso fica fora do <label>.
    const inputAceite = document.querySelector('input[name="aceite"]');
    function aceiteValidate() {
        if (!inputAceite) return true;
        const aviso = inputAceite.closest('.field') && inputAceite.closest('.field').querySelector('.span-required');
        if (aviso) aviso.classList.toggle('is-on', !inputAceite.checked);
        inputAceite.setAttribute('aria-invalid', String(!inputAceite.checked));
        return inputAceite.checked;
    }
    if (inputAceite) inputAceite.addEventListener('change', aceiteValidate);

    function comparePassword() {
        if (!inputConfirma) return true; // login não tem confirmação = ignora
        if (inputConfirma.value.length < 8 || inputConfirma.value !== inputSenha.value) {
            setError(inputConfirma);
            return false;
        }
        removeError(inputConfirma);
        return true;
    }



    if (inputNome)     inputNome.addEventListener('input', nameValidate);
    if (inputEmail)    inputEmail.addEventListener('input', emailValidate);
    if (inputSenha)    inputSenha.addEventListener('input', () => {
        mainPasswordValidate();
        if (inputConfirma && inputConfirma.value.length > 0) comparePassword();
    });
    if (inputConfirma) inputConfirma.addEventListener('input', comparePassword);


    form.addEventListener('submit', (event) => {
        const ok = [
            nameValidate(),
            emailValidate(),
            mainPasswordValidate(),
            comparePassword(),
            aceiteValidate()
        ].every(Boolean);

        // Só bloqueia o envio se a validação falhar. Antes desta correção,
        // o preventDefault() era incondicional e o formulário nunca era
        // enviado ao servidor mesmo com dados válidos.
        if (!ok) {
            event.preventDefault();
            const primeiro = form.querySelector('[aria-invalid="true"]');
            if (primeiro) primeiro.focus();
            return;
        }
        // Login: a próxima tela é a de boas-vindas, então a abertura
        // com o logo não precisa tocar de novo nesta sessão.
        if (!inputConfirma) { try { sessionStorage.setItem('aquatrip_intro', '1'); } catch (e) {} }
    });

});

