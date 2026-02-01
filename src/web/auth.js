/**
 * Авторизация и регистрация
 */

document.addEventListener('DOMContentLoaded', function() {
    // Если уже авторизован - редирект в dashboard
    if (API.isAuthenticated()) {
        window.location.href = '/dashboard.html';
        return;
    }

    // Переключение табов
    const tabs = document.querySelectorAll('.auth-tab');
    const forms = document.querySelectorAll('.auth-form');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetForm = tab.dataset.form;
            
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            forms.forEach(form => {
                form.classList.remove('active');
                if (form.id === `${targetForm}Form`) {
                    form.classList.add('active');
                }
            });
        });
    });

    // Форма входа
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = document.getElementById('loginEmail').value;
            const password = document.getElementById('loginPassword').value;
            const errorDiv = document.getElementById('loginError');
            const submitBtn = loginForm.querySelector('button[type="submit"]');
            
            errorDiv.style.display = 'none';
            submitBtn.disabled = true;
            submitBtn.textContent = 'Вход...';
            
            try {
                await API.login(email, password);
                window.location.href = '/dashboard.html';
            } catch (error) {
                errorDiv.textContent = error.message === 'Invalid email or password' 
                    ? 'Неверный email или пароль' 
                    : 'Ошибка входа: ' + error.message;
                errorDiv.style.display = 'block';
                submitBtn.disabled = false;
                submitBtn.textContent = 'Войти';
            }
        });
    }

    // Форма регистрации
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const name = document.getElementById('registerName').value;
            const email = document.getElementById('registerEmail').value;
            const password = document.getElementById('registerPassword').value;
            const passwordConfirm = document.getElementById('registerPasswordConfirm').value;
            const errorDiv = document.getElementById('registerError');
            const submitBtn = registerForm.querySelector('button[type="submit"]');
            
            errorDiv.style.display = 'none';
            
            // Валидация
            if (password !== passwordConfirm) {
                errorDiv.textContent = 'Пароли не совпадают';
                errorDiv.style.display = 'block';
                return;
            }
            
            if (password.length < 6) {
                errorDiv.textContent = 'Пароль должен быть не менее 6 символов';
                errorDiv.style.display = 'block';
                return;
            }
            
            submitBtn.disabled = true;
            submitBtn.textContent = 'Регистрация...';
            
            try {
                await API.register(email, password, name);
                window.location.href = '/dashboard.html';
            } catch (error) {
                errorDiv.textContent = error.message === 'Email already exists' 
                    ? 'Этот email уже зарегистрирован' 
                    : 'Ошибка регистрации: ' + error.message;
                errorDiv.style.display = 'block';
                submitBtn.disabled = false;
                submitBtn.textContent = 'Зарегистрироваться';
            }
        });
    }

    // Показ/скрытие пароля
    document.querySelectorAll('.toggle-password').forEach(toggle => {
        toggle.addEventListener('click', function() {
            const input = this.previousElementSibling;
            const type = input.type === 'password' ? 'text' : 'password';
            input.type = type;
            this.textContent = type === 'password' ? '👁️' : '🔒';
        });
    });

    // Индикатор силы пароля
    const passwordInput = document.getElementById('registerPassword');
    const strengthBar = document.querySelector('.strength-bar');
    const strengthText = document.querySelector('.strength-text');
    
    if (passwordInput && strengthBar) {
        passwordInput.addEventListener('input', function() {
            const password = this.value;
            let strength = 0;
            
            if (password.length >= 6) strength++;
            if (password.length >= 10) strength++;
            if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength++;
            if (/[0-9]/.test(password)) strength++;
            if (/[^a-zA-Z0-9]/.test(password)) strength++;
            
            const colors = ['#ef4444', '#f59e0b', '#eab308', '#84cc16', '#22c55e'];
            const labels = ['Очень слабый', 'Слабый', 'Средний', 'Хороший', 'Отличный'];
            const widths = ['20%', '40%', '60%', '80%', '100%'];
            
            const index = Math.min(strength, 4);
            strengthBar.style.width = widths[index];
            strengthBar.style.backgroundColor = colors[index];
            if (strengthText) strengthText.textContent = labels[index];
        });
    }
});
