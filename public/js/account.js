document.addEventListener('DOMContentLoaded', async () => {
  const user = await initAdminAuth({ allowPasswordChange: true });
  if (!user) return;
  const forced = Boolean(user.mustChangePassword);
  document.getElementById('forced-password-notice').hidden = !forced;
  document.getElementById('account-workspace-link').hidden = forced;
  const form = document.getElementById('change-password-form');
  const error = document.getElementById('change-password-error');
  const submit = document.getElementById('btn-change-password');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.textContent = '';
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    if (!currentPassword || !newPassword || !confirmPassword) { error.textContent = 'Complete all password fields.'; return; }
    if (newPassword.length < 10 || newPassword.length > 128) { error.textContent = 'New password must contain 10–128 characters.'; return; }
    if (newPassword !== confirmPassword) { error.textContent = 'New password and confirmation must match.'; return; }
    submit.disabled = true; submit.textContent = 'Updating…';
    try {
      const response = await fetch('/api/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword, confirmPassword }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to change password.');
      showToast('Password updated. Your workspace is ready.', 'success');
      setTimeout(() => window.location.assign('/dashboard.html'), 500);
    } catch (requestError) {
      error.textContent = requestError.message;
      submit.disabled = false; submit.textContent = 'Update Password';
    }
  });
});
