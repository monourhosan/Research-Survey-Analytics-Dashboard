(() => {
  let members = [];
  let currentUser = null;
  const $ = (selector) => document.querySelector(selector);

  function formatDate(value) {
    if (!value) return 'Never';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Not available' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function escapeValue(value) { return escapeHtml(value || ''); }

  function renderMembers() {
    const container = $('#team-members-container');
    const summary = $('#team-members-summary');
    if (!members.length) {
      summary.textContent = 'No collaborators have been added yet.';
      container.innerHTML = '<div class="empty-state team-empty-state"><strong>No team members yet.</strong><p>Add a team member to collaborate in this workspace.</p><button class="btn btn-primary" type="button" data-action="add">Add Team Member</button></div>';
      return;
    }
    const activeCount = members.filter(member => member.isActive).length;
    summary.textContent = `${activeCount} active collaborator${activeCount === 1 ? '' : 's'} · ${members.length} total`;
    container.innerHTML = `<table class="data-table team-members-table"><thead><tr><th scope="col">Member</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Last login</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${members.map(member => `<tr><td data-label="Member"><strong>${escapeValue(member.name)}</strong><span class="team-member-email">${escapeValue(member.email)}</span></td><td data-label="Role"><span class="team-role">Team member</span></td><td data-label="Status"><span class="team-status ${member.isActive ? 'is-active' : 'is-disabled'}">${member.isActive ? 'Active' : 'Disabled'}</span></td><td data-label="Last login">${escapeValue(formatDate(member.lastLoginAt))}</td><td data-label="Actions"><div class="table-actions"><button class="btn btn-secondary btn-sm" type="button" data-action="edit" data-id="${member.id}">Edit</button><button class="btn btn-secondary btn-sm" type="button" data-action="reset" data-id="${member.id}">Reset password</button><button class="btn ${member.isActive ? 'btn-danger' : 'btn-primary'} btn-sm" type="button" data-action="${member.isActive ? 'disable' : 'enable'}" data-id="${member.id}">${member.isActive ? 'Remove access' : 'Reactivate'}</button></div></td></tr>`).join('')}</tbody></table>`;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }

  async function loadMembers() {
    const data = await api('/api/team-members');
    members = data.teamMembers || [];
    renderMembers();
  }

  function openMemberDialog(member = null) {
    const dialog = $('#member-dialog');
    $('#member-id').value = member ? member.id : '';
    $('#member-name').value = member ? member.name : '';
    $('#member-email').value = member ? member.email : '';
    $('#member-password').value = '';
    $('#member-form-error').textContent = '';
    $('#member-dialog-title').textContent = member ? 'Edit Team Member' : 'Add Team Member';
    $('#member-dialog-description').textContent = member ? 'Update this collaborator’s name or sign-in email. Roles cannot be changed here.' : 'Create a team-member account. Administrators retain full workspace control.';
    $('#member-password-group').hidden = Boolean(member);
    $('#btn-save-member').textContent = member ? 'Save changes' : 'Create Member';
    dialog.showModal();
    setTimeout(() => $('#member-name').focus(), 0);
  }

  function showTemporaryPassword(password) {
    if (!password) return;
    $('#temporary-password-value').textContent = password;
    $('#temporary-password-dialog').showModal();
  }

  async function saveMember(event) {
    event.preventDefault();
    const id = $('#member-id').value;
    const body = { name: $('#member-name').value, email: $('#member-email').value };
    if (!id && $('#member-password').value) body.password = $('#member-password').value;
    try {
      const result = await api(id ? `/api/team-members/${id}` : '/api/team-members', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
      $('#member-dialog').close();
      showToast(id ? 'Team member updated.' : 'Team member created.', 'success');
      await loadMembers();
      showTemporaryPassword(result.temporaryPassword);
    } catch (error) {
      $('#member-form-error').textContent = error.message;
    }
  }

  async function updateAccess(member, makeActive) {
    const action = makeActive ? 'reactivate' : 'remove access for';
    showConfirmDialog(
      makeActive ? `Reactivate ${member.name}?` : `Remove ${member.name}'s workspace access?`,
      makeActive ? 'This member will be able to sign in again with their existing password.' : 'They will no longer be able to sign in. Existing research and activity history will be preserved.',
      async () => {
        try {
          await api(`/api/team-members/${member.id}/${makeActive ? 'enable' : 'disable'}`, { method: 'POST' });
          showToast(makeActive ? 'Workspace access restored.' : 'Workspace access removed.', 'success');
          await loadMembers();
        } catch (error) { showToast(error.message, 'error'); }
      },
      makeActive ? 'Reactivate' : 'Remove Access',
      !makeActive
    );
  }

  function resetPassword(member) {
    showConfirmDialog(
      `Reset ${member.name}'s password?`,
      'Their current password will stop working immediately. A new temporary password will be shown once.',
      async () => {
        try {
          const result = await api(`/api/team-members/${member.id}/reset-password`, { method: 'POST', body: JSON.stringify({}) });
          showTemporaryPassword(result.temporaryPassword);
          showToast('Temporary password generated.', 'success');
        } catch (error) { showToast(error.message, 'error'); }
      },
      'Reset Password',
      true
    );
  }

  document.addEventListener('DOMContentLoaded', async () => {
    currentUser = await initAdminAuth();
    if (!currentUser) return;
    if (currentUser.role !== 'admin') {
      $('#btn-add-member').hidden = true;
      $('#team-members-container').hidden = true;
      const message = $('#settings-access-message');
      message.hidden = false;
      message.textContent = 'Team management is available to workspace administrators only.';
      $('#team-members-summary').textContent = 'Administrator access required';
      return;
    }
    try { await loadMembers(); } catch (error) { $('#team-members-container').innerHTML = `<div class="empty-state"><strong>Unable to load team members.</strong><p>${escapeValue(error.message)}</p></div>`; }
    $('#btn-add-member').addEventListener('click', () => openMemberDialog());
    $('#btn-cancel-member').addEventListener('click', () => $('#member-dialog').close());
    $('#btn-close-member-dialog').addEventListener('click', () => $('#member-dialog').close());
    $('#member-form').addEventListener('submit', saveMember);
    $('#team-members-container').addEventListener('click', event => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      if (button.dataset.action === 'add') return openMemberDialog();
      const member = members.find(item => item.id === Number(button.dataset.id));
      if (!member) return;
      if (button.dataset.action === 'edit') openMemberDialog(member);
      if (button.dataset.action === 'disable') updateAccess(member, false);
      if (button.dataset.action === 'enable') updateAccess(member, true);
      if (button.dataset.action === 'reset') resetPassword(member);
    });
    $('#btn-copy-temporary-password').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#temporary-password-value').textContent); showToast('Temporary password copied.', 'success'); } catch (_) { showToast('Copy the password manually.', 'info'); } });
    $('#btn-close-temporary-password').addEventListener('click', () => $('#temporary-password-dialog').close());
  });
})();
