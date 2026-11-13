// Toasts, modal dialogs, confirmation prompts and file transfer.

import { html } from './format.js';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

export function createUi(doc, win) {
  const toastHost = doc.getElementById('toasts');
  const modalHost = doc.getElementById('modals');
  const openModals = [];

  /** type: 'info' | 'success' | 'warning' | 'error' */
  function toast(message, type = 'info') {
    const el = doc.createElement('p');
    el.className = `toast ${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.textContent = message;
    // The same message replaces itself, and at most three are shown, so they never pile up.
    for (const shown of [...toastHost.children]) if (shown.textContent === message) shown.remove();
    while (toastHost.children.length >= 3) toastHost.firstElementChild.remove();
    toastHost.append(el);
    win.setTimeout(() => el.remove(), type === 'error' || type === 'warning' ? 7000 : 4000);
  }

  /** Opens a dialog and returns { body, close, focusFirst }. Fill `body` with content. */
  function openModal({ title, wide = false, onClose } = {}) {
    const opener = doc.activeElement;
    const overlay = doc.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = String(html`
      <div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}">
        <header class="modal-head">
          <h2>${title}</h2>
          <button type="button" class="link" data-close>Zatvori</button>
        </header>
        <div class="modal-body"></div>
      </div>`);

    const entry = { close };
    function close() {
      const index = openModals.indexOf(entry);
      if (index === -1) return;
      openModals.splice(index, 1);
      overlay.remove();
      doc.documentElement.classList.toggle('has-modal', openModals.length > 0);
      onClose?.();
      if (opener?.isConnected) opener.focus();
    }

    // Keep Tab inside the dialog.
    overlay.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const items = [...overlay.querySelectorAll(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && doc.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && doc.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    overlay.querySelector('[data-close]').addEventListener('click', close);

    openModals.push(entry);
    modalHost.append(overlay);
    doc.documentElement.classList.add('has-modal');

    const body = overlay.querySelector('.modal-body');
    return {
      body,
      close,
      focusFirst: () => (body.querySelector(FOCUSABLE) ?? overlay.querySelector('[data-close]')).focus(),
    };
  }

  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && openModals.length) openModals[openModals.length - 1].close();
  });

  /** Resolves to true only when the user presses the confirm button. */
  function confirm({ title, message, confirmLabel = 'Potvrdi', danger = false }) {
    return new Promise((resolve) => {
      let answer = false;
      const modal = openModal({ title, onClose: () => resolve(answer) });
      modal.body.innerHTML = String(html`
        <p class="confirm-text">${message}</p>
        <div class="actions">
          <button type="button" class="btn${danger ? ' danger' : ' primary'}" data-answer="yes">${confirmLabel}</button>
          <button type="button" class="btn" data-answer="no">Otkaži</button>
        </div>`);
      modal.body.addEventListener('click', (event) => {
        const button = event.target.closest('[data-answer]');
        if (!button) return;
        answer = button.dataset.answer === 'yes';
        modal.close();
      });
      modal.body.querySelector('[data-answer="no"]').focus();
    });
  }

  function download(filename, type, content) {
    const url = win.URL.createObjectURL(new win.Blob([content], { type }));
    const link = doc.createElement('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;
    doc.body.append(link);
    link.click();
    link.remove();
    win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);
  }

  /** Lets the user choose a file and resolves to its text, or null when nothing was chosen. */
  function pickFile(accept) {
    return new Promise((resolve, reject) => {
      const input = doc.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.hidden = true;
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) {
          resolve(null);
          return;
        }
        const reader = new win.FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Fajl nije mogao da se pročita.'));
        reader.readAsText(file);
      });
      input.addEventListener('cancel', () => {
        input.remove();
        resolve(null);
      });
      doc.body.append(input);
      input.click();
    });
  }

  return { toast, openModal, confirm, download, pickFile };
}
