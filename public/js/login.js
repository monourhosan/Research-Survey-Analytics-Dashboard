/**
 * Research Survey Analytics Dashboard
 * Admin Login Handler
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Check if already authenticated
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (data.authenticated) {
      window.location.href = '/dashboard.html';
      return;
    }
  } catch (err) {
    // Proceed to show login
  }

  const loginForm = document.getElementById('login-form');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const submitBtn = document.getElementById('btn-submit-login');
  const autofillBtn = document.getElementById('btn-autofill');

  // Autofill demo credentials
  if (autofillBtn) {
    autofillBtn.addEventListener('click', () => {
      emailInput.value = 'admin@research.local';
      passwordInput.value = 'Admin123!';
      showToast('Demo credentials filled', 'info');
    });
  }

  // Handle submit
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      showToast('Please enter both email and password', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in...';

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        showToast('Login successful! Redirecting...', 'success');
        setTimeout(() => {
          window.location.href = '/dashboard.html';
        }, 600);
      } else {
        showToast(data.error || 'Invalid credentials', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
      }
    } catch (err) {
      console.error('Login request failed:', err);
      showToast('Network or server error during sign in', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
    }
  });
});
