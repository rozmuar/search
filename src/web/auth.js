// Auth page JavaScript

document.addEventListener('DOMContentLoaded', function() {
    // Check URL parameter for initial tab
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');
    
    if (mode === 'register') {
        switchTab('register');
    }

    // Tab switching
    const tabs = document.querySelectorAll('.auth-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const tabName = this.getAttribute('data-tab');
            switchTab(tabName);
        });
    });

    function switchTab(tabName) {
        // Update tabs
        tabs.forEach(tab => {
            if (tab.getAttribute('data-tab') === tabName) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        // Update forms
        const loginForm = document.getElementById('loginForm');
        const registerForm = document.getElementById('registerForm');
        
        if (tabName === 'login') {
            loginForm.classList.remove('hidden');
            registerForm.classList.add('hidden');
        } else {
            loginForm.classList.add('hidden');
            registerForm.classList.remove('hidden');
        }
    }

    // Login form submission
    const loginForm = document.getElementById('loginForm');
    loginForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        
        // Simple validation
        if (!email || !password) {
            alert('Пожалуйста, заполните все поля');
            return;
        }

        // Mock login (replace with actual API call)
        console.log('Login attempt:', { email, password });
        alert('Вход выполнен успешно! (демо)');
        
        // Redirect to dashboard (when implemented)
        // window.location.href = 'dashboard.html';
    });

    // Register form submission
    const registerForm = document.getElementById('registerForm');
    const registerPassword = document.getElementById('registerPassword');
    const registerPasswordConfirm = document.getElementById('registerPasswordConfirm');
    
    // Password strength indicator
    registerPassword.addEventListener('input', function() {
        const password = this.value;
        const strengthBar = document.querySelector('.strength-bar');
        
        let strength = 0;
        if (password.length >= 8) strength += 25;
        if (password.match(/[a-z]+/)) strength += 25;
        if (password.match(/[A-Z]+/)) strength += 25;
        if (password.match(/[0-9]+/)) strength += 25;
        
        strengthBar.style.width = strength + '%';
        
        if (strength <= 25) {
            strengthBar.style.background = '#ef4444';
        } else if (strength <= 50) {
            strengthBar.style.background = '#f59e0b';
        } else if (strength <= 75) {
            strengthBar.style.background = '#3b82f6';
        } else {
            strengthBar.style.background = '#22c55e';
        }
    });

    registerForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const name = document.getElementById('registerName').value;
        const email = document.getElementById('registerEmail').value;
        const password = registerPassword.value;
        const passwordConfirm = registerPasswordConfirm.value;
        const termsAccepted = document.querySelector('input[name="terms"]').checked;
        
        // Validation
        if (!name || !email || !password || !passwordConfirm) {
            alert('Пожалуйста, заполните все поля');
            return;
        }
        
        if (password !== passwordConfirm) {
            alert('Пароли не совпадают');
            return;
        }
        
        if (password.length < 8) {
            alert('Пароль должен содержать минимум 8 символов');
            return;
        }
        
        if (!termsAccepted) {
            alert('Примите условия использования');
            return;
        }

        // Mock registration (replace with actual API call)
        console.log('Registration attempt:', { name, email, password });
        
        // Show success message
        const successMessage = document.getElementById('successMessage');
        registerForm.querySelectorAll('input, button').forEach(el => el.style.display = 'none');
        successMessage.classList.remove('hidden');
        
        setTimeout(() => {
            // Redirect to login or dashboard
            switchTab('login');
            registerForm.reset();
            registerForm.querySelectorAll('input, button').forEach(el => el.style.display = '');
            successMessage.classList.add('hidden');
        }, 3000);
    });

    // Google auth (mock)
    document.querySelectorAll('.btn-google').forEach(btn => {
        btn.addEventListener('click', function() {
            alert('Google OAuth будет реализован позже');
            console.log('Google auth clicked');
        });
    });

    // Forgot password link
    document.querySelector('a[href="#"]').addEventListener('click', function(e) {
        if (this.textContent.includes('Забыли')) {
            e.preventDefault();
            const email = document.getElementById('loginEmail').value;
            if (email) {
                alert(`Инструкции по восстановлению пароля отправлены на ${email}`);
            } else {
                alert('Пожалуйста, введите email');
            }
        }
    });
});
