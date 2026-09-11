/**
 * Research Survey Analytics Dashboard
 * Common Frontend Utilities (Vanilla JavaScript)
 * 
 * Includes:
 * - Session verification & auth guards
 * - Clean Vanilla Toast notifications
 * - Custom accessible <dialog> confirmation helper
 * - Global logout handler
 * - Active navigation highlight & mobile menu toggle
 */

// Toast notification helper
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  toast.innerHTML = `<span><strong>${icon}</strong></span> <span>${escapeHtml(message)}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

// HTML Escaper for security (XSS prevention)
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

// Confirmation Dialog using native <dialog>
function showConfirmDialog(title, message, onConfirm, confirmText = 'Confirm', isDanger = false) {
  let dialog = document.getElementById('global-confirm-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'global-confirm-dialog';
    dialog.className = 'custom-modal';
    document.body.appendChild(dialog);
  }

  dialog.innerHTML = `
    <h3 class="modal-title">${escapeHtml(title)}</h3>
    <p class="modal-desc">${escapeHtml(message)}</p>
    <div class="modal-actions">
      <button type="button" class="btn btn-secondary btn-sm" id="modal-cancel-btn">Cancel</button>
      <button type="button" class="btn ${isDanger ? 'btn-danger' : 'btn-primary'} btn-sm" id="modal-confirm-btn">
        ${escapeHtml(confirmText)}
      </button>
    </div>
  `;

  const cancelBtn = dialog.querySelector('#modal-cancel-btn');
  const confirmBtn = dialog.querySelector('#modal-confirm-btn');

  cancelBtn.onclick = () => dialog.close();
  confirmBtn.onclick = () => {
    dialog.close();
    if (typeof onConfirm === 'function') onConfirm();
  };

  dialog.showModal();
}

// Verify Admin Session on Protected Pages
async function initAdminAuth() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();

    if (!data.authenticated) {
      window.location.href = '/login.html';
      return null;
    }

    // Populate user profile info in sidebar if present
    const nameEl = document.getElementById('nav-user-name');
    const emailEl = document.getElementById('nav-user-email');
    const avatarEl = document.getElementById('nav-user-avatar');

    if (nameEl) nameEl.textContent = data.user.name;
    if (emailEl) emailEl.textContent = data.user.email;
    if (avatarEl) avatarEl.textContent = data.user.name.charAt(0).toUpperCase();

    document.querySelectorAll('[data-admin-only]').forEach(element => {
      element.hidden = data.user.role !== 'admin';
    });

    return data.user;
  } catch (err) {
    console.error('Session check failed:', err);
    window.location.href = '/login.html';
    return null;
  }
}

// Global Logout Handler
async function handleLogout() {
  try {
    const res = await fetch('/api/auth/logout', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      window.location.href = '/login.html';
    } else {
      showToast('Logout failed', 'error');
    }
  } catch (err) {
    console.error('Logout error:', err);
    window.location.href = '/login.html';
  }
}

// Document Ready Setup (Navigation active states & Mobile toggle)
document.addEventListener('DOMContentLoaded', () => {
  // Setup logout button
  const logoutBtn = document.getElementById('btn-global-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showConfirmDialog(
        'Log Out',
        'Are you sure you want to log out of your session?',
        handleLogout,
        'Log Out',
        false
      );
    });
  }

  // Highlight active link
  const currentPath = window.location.pathname;
  const navLinks = document.querySelectorAll('.nav-link');
  navLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (href && (currentPath.endsWith(href) || (currentPath === '/' && href === 'dashboard.html'))) {
      link.classList.add('active');
    }
  });

  // Mobile drawer toggle
  const mobileToggle = document.getElementById('mobile-menu-toggle');
  const sidebar = document.querySelector('.sidebar');
  if (mobileToggle && sidebar) {
    mobileToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && !mobileToggle.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    });
  }
});
