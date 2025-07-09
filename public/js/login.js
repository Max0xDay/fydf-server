document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    
    checkAuth();
    
    loginForm.addEventListener('submit', handleLogin);
});

async function checkAuth() {
    try {
        const response = await fetch('/api/files');
        if (response.ok) {
            window.location.href = '/home';
        }
    } catch (error) {
    }
}

async function handleLogin(e) {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const submitButton = e.target.querySelector('button[type="submit"]');
    
    submitButton.disabled = true;
    submitButton.textContent = 'Logging in...';
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        if (data.success) {
            window.location.href = data.redirect || '/home';
        } else {
            showError('Invalid credentials');
        }
    } catch (error) {
        showError('Login failed. Please try again.');
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Login';
    }
}

function showError(message) {
    const existingError = document.querySelector('.error-message');
    if (existingError) {
        existingError.remove();
    }
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    
    const form = document.getElementById('loginForm');
    form.appendChild(errorDiv);
    
    setTimeout(() => {
        if (errorDiv.parentNode) {
            errorDiv.remove();
        }
    }, 5000);
}
