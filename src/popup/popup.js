// popup.js

const toggleBtn   = document.getElementById('toggleBtn');
const statusEl    = document.getElementById('status');
const anthropicEl = document.getElementById('anthropicKey');
const keyHint     = document.getElementById('keyHint');
const keysSection = document.getElementById('keysSection');

let isActive = false;

// ── Load saved key ────────────────────────────────────────────────────────────

chrome.storage.local.get(['anthropicKey'], (data) => {
  if (data.anthropicKey) { anthropicEl.value = data.anthropicKey; anthropicEl.classList.add('saved'); }
  updateHint();
});

// ── Save key on change ────────────────────────────────────────────────────────

anthropicEl.addEventListener('input', () => {
  anthropicEl.classList.remove('saved');
  updateHint();
});
anthropicEl.addEventListener('change', () => {
  chrome.storage.local.set({ anthropicKey: anthropicEl.value.trim() });
  anthropicEl.classList.add('saved');
  updateHint();
});

function updateHint() {
  if (!anthropicEl.value.trim()) {
    keyHint.textContent = 'Insira sua chave de API Anthropic para começar.';
    keyHint.className = 'key-hint';
    toggleBtn.disabled = isActive ? false : true;
  } else {
    keyHint.textContent = 'Chave salva.';
    keyHint.className = 'key-hint ok';
    toggleBtn.disabled = false;
  }
}

// ── Status ────────────────────────────────────────────────────────────────────

chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
  if (res?.isCapturing) setActive(true);
});

function setActive(active) {
  isActive = active;
  toggleBtn.textContent  = active ? 'Parar Checagem' : 'Iniciar Checagem';
  toggleBtn.className    = 'toggle-btn' + (active ? ' active' : '');
  statusEl.textContent   = active ? 'Ao Vivo • Checagem ativa' : 'Inativo';
  statusEl.className     = 'status' + (active ? ' active' : '');
  // hide key fields while active
  keysSection.style.display = active ? 'none' : 'flex';
  if (!active) updateHint();
}

// ── Toggle ────────────────────────────────────────────────────────────────────

toggleBtn.addEventListener('click', async () => {
  if (isActive) {
    chrome.runtime.sendMessage({ type: 'STOP_FACTCHECK' });
    setActive(false);
    return;
  }

  const anthropicKey = anthropicEl.value.trim();

  if (!anthropicKey) {
    keyHint.textContent = 'Por favor, insira sua chave de API Anthropic.';
    keyHint.className   = 'key-hint error';
    return;
  }

  // save key then start
  await new Promise(r => chrome.storage.local.set({ anthropicKey }, r));

  chrome.runtime.sendMessage({ type: 'START_FACTCHECK' }, (res) => {
    if (res?.ok) {
      setActive(true);
    } else {
      keyHint.textContent = 'Falha ao iniciar: ' + (res?.error || 'erro desconhecido');
      keyHint.className   = 'key-hint error';
    }
  });
});