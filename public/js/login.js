/** Role-intent login controller. The server always verifies the stored role. */
document.addEventListener('DOMContentLoaded', async () => {
  const selection = document.getElementById('access-selection');
  const form = document.getElementById('login-form');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const submitBtn = document.getElementById('btn-submit-login');
  const inlineError = document.getElementById('login-inline-error');
  const modeTitle = document.getElementById('login-mode-title');
  const eyebrow = document.getElementById('login-eyebrow');
  const subtitle = document.getElementById('login-subtitle');
  const teamHelp = document.getElementById('team-access-help');
  const demoBox = document.getElementById('demo-credentials-box');
  let selectedMode = null;

  try {
    const response = await fetch('/api/auth/me');
    const data = await response.json();
    if (data.authenticated) window.location.href = data.user?.mustChangePassword ? '/account.html' : '/dashboard.html';
  } catch (_) {}

  function showSelection() {
    selectedMode = null;
    form.hidden = true;
    selection.hidden = false;
    eyebrow.textContent = 'Research workspace';
    subtitle.textContent = 'Choose how you want to access the workspace.';
    demoBox.hidden = false;
    inlineError.textContent = '';
    document.querySelector('[data-access-mode="admin"]').focus();
  }

  function chooseMode(mode) {
    selectedMode = mode;
    const isAdmin = mode === 'admin';
    selection.hidden = true;
    form.hidden = false;
    eyebrow.textContent = isAdmin ? 'Administrator access' : 'Team member access';
    modeTitle.textContent = isAdmin ? 'Administrator Login' : 'Team Member Login';
    subtitle.textContent = isAdmin ? 'Sign in to manage your research workspace.' : 'Sign in to contribute to the research workspace.';
    teamHelp.hidden = isAdmin;
    demoBox.hidden = !isAdmin;
    inlineError.textContent = '';
    emailInput.focus();
  }

  document.querySelectorAll('[data-access-mode]').forEach(button => button.addEventListener('click', () => chooseMode(button.dataset.accessMode)));
  document.getElementById('btn-login-back').addEventListener('click', showSelection);
  document.getElementById('btn-toggle-password').addEventListener('click', event => {
    const reveal = passwordInput.type === 'password';
    passwordInput.type = reveal ? 'text' : 'password';
    event.currentTarget.textContent = reveal ? 'Hide password' : 'Show password';
    event.currentTarget.setAttribute('aria-pressed', String(reveal));
  });
  document.getElementById('btn-autofill')?.addEventListener('click', () => {
    emailInput.value = 'admin@research.local'; passwordInput.value = 'Admin123!'; emailInput.focus();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    inlineError.textContent = '';
    if (!selectedMode || !email || !password) { inlineError.textContent = 'Enter your email and password to continue.'; return; }
    submitBtn.disabled = true; submitBtn.textContent = 'Signing in…';
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, accessMode: selectedMode }) });
      const data = await response.json();
      if (response.ok && data.success) window.location.href = data.mustChangePassword ? '/account.html' : '/dashboard.html';
      else inlineError.textContent = data.error || 'Unable to sign in. Please try again.';
    } catch (_) { inlineError.textContent = 'Network error. Check your connection and try again.'; }
    finally { submitBtn.disabled = false; submitBtn.innerHTML = 'Sign In <span aria-hidden="true">→</span>'; }
  });
});
