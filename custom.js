(() => {
  'use strict';

  function customizeSettings() {
    const container = document.getElementById('pageContainer');
    const form = document.getElementById('settingsForm');
    if (!container || !form || form.dataset.moneyboardCustomized === 'true') return;

    form.dataset.moneyboardCustomized = 'true';

    const sectionHeads = [...container.querySelectorAll(':scope > .section-head')];
    const dataHead = sectionHeads.find(head => head.querySelector('h2')?.textContent.trim() === '데이터 관리');
    const dataSection = dataHead?.nextElementSibling;
    const logoutButton = dataSection?.querySelector('#logoutBtn');

    if (logoutButton) {
      const accountActions = document.createElement('section');
      accountActions.className = 'account-actions';
      accountActions.appendChild(logoutButton);
      form.insertAdjacentElement('afterend', accountActions);
    }

    dataHead?.remove();
    dataSection?.remove();

    const storageCard = [...container.querySelectorAll('.card')].find(card =>
      card.querySelector('.metric-label')?.textContent.trim() === '현재 저장 방식'
    );
    storageCard?.remove();
  }

  function applyCustomizations() {
    customizeSettings();
  }

  const observer = new MutationObserver(applyCustomizations);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', applyCustomizations);
  applyCustomizations();
})();
