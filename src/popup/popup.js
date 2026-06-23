// popup.js

const toggleBtn     = document.getElementById('toggleBtn');
const statusEl      = document.getElementById('status');
const apiProviderEl = document.getElementById('apiProvider');
const apiKeyEl      = document.getElementById('apiKey');
const keyLabelEl    = document.getElementById('keyLabel');
const apiModelEl    = document.getElementById('apiModel');
const deepgramKeyEl = document.getElementById('deepgramKey');
const keyHint       = document.getElementById('keyHint');
const keysSection   = document.getElementById('keysSection');

let isActive = false;

const PROVIDERS = {
  anthropic: {
    label: 'Chave de API Anthropic',
    placeholder: 'sk-ant-...',
    defaultModel: 'claude-3-5-haiku-20241022'
  },
  openai: {
    label: 'Chave de API OpenAI',
    placeholder: 'sk-...',
    defaultModel: 'gpt-4o-mini'
  },
  gemini: {
    label: 'Chave de API Gemini',
    placeholder: 'AIzaSy...',
    defaultModel: 'gemini-1.5-flash'
  },
  openrouter: {
    label: 'Chave de API OpenRouter',
    placeholder: 'sk-or-...',
    defaultModel: 'google/gemini-2.5-flash'
  },
  groq: {
    label: 'Chave de API Groq',
    placeholder: 'gsk_...',
    defaultModel: 'llama-3.3-70b-versatile'
  },
  deepseek: {
    label: 'Chave de API DeepSeek',
    placeholder: 'sk-...',
    defaultModel: 'deepseek-chat'
  }
};

// ── Switch Provider ────────────────────────────────────────────────────────────

function loadProviderConfig(provider) {
  const conf = PROVIDERS[provider];
  keyLabelEl.textContent = conf.label;
  apiKeyEl.placeholder   = conf.placeholder;
  apiModelEl.placeholder = conf.defaultModel;

  const keyStorageName   = `${provider}Key`;
  const modelStorageName = `${provider}Model`;

  chrome.storage.local.get([keyStorageName, modelStorageName], (data) => {
    apiKeyEl.value = data[keyStorageName] || '';
    apiModelEl.value = data[modelStorageName] || '';
    
    if (apiKeyEl.value) {
      apiKeyEl.classList.add('saved');
    } else {
      apiKeyEl.classList.remove('saved');
    }
    
    if (apiModelEl.value) {
      apiModelEl.classList.add('saved');
    } else {
      apiModelEl.classList.remove('saved');
    }
    
    updateHint();
  });
}

apiProviderEl.addEventListener('change', () => {
  const provider = apiProviderEl.value;
  chrome.storage.local.set({ selectedProvider: provider });
  loadProviderConfig(provider);
});

// ── Load saved state ──────────────────────────────────────────────────────────

chrome.storage.local.get(['selectedProvider', 'deepgramKey'], (data) => {
  const provider = data.selectedProvider || 'anthropic';
  apiProviderEl.value = provider;
  loadProviderConfig(provider);

  if (data.deepgramKey) {
    deepgramKeyEl.value = data.deepgramKey;
    deepgramKeyEl.classList.add('saved');
  }
});

// ── Save configuration on change ──────────────────────────────────────────────

apiKeyEl.addEventListener('input', () => {
  apiKeyEl.classList.remove('saved');
  updateHint();
});
apiKeyEl.addEventListener('change', () => {
  const provider = apiProviderEl.value;
  chrome.storage.local.set({ [`${provider}Key`]: apiKeyEl.value.trim() });
  apiKeyEl.classList.add('saved');
  updateHint();
});

apiModelEl.addEventListener('input', () => {
  apiModelEl.classList.remove('saved');
});
apiModelEl.addEventListener('change', () => {
  const provider = apiProviderEl.value;
  chrome.storage.local.set({ [`${provider}Model`]: apiModelEl.value.trim() });
  apiModelEl.classList.add('saved');
});

deepgramKeyEl.addEventListener('input', () => {
  deepgramKeyEl.classList.remove('saved');
  updateHint();
});
deepgramKeyEl.addEventListener('change', () => {
  chrome.storage.local.set({ deepgramKey: deepgramKeyEl.value.trim() });
  deepgramKeyEl.classList.add('saved');
  updateHint();
});

function updateHint() {
  const providerName = PROVIDERS[apiProviderEl.value].label.replace('Chave de API ', '');
  if (!deepgramKeyEl.value.trim()) {
    keyHint.textContent = 'Insira sua chave de API do Deepgram.';
    keyHint.className = 'key-hint';
    toggleBtn.disabled = isActive ? false : true;
  } else if (!apiKeyEl.value.trim()) {
    keyHint.textContent = `Insira sua chave para ${providerName} para começar.`;
    keyHint.className = 'key-hint';
    toggleBtn.disabled = isActive ? false : true;
  } else {
    keyHint.textContent = 'Chaves salvas.';
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
  // hide keys config while running
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

  const provider = apiProviderEl.value;
  const key = apiKeyEl.value.trim();
  const model = apiModelEl.value.trim() || PROVIDERS[provider].defaultModel;
  const deepgramKey = deepgramKeyEl.value.trim();

  if (!deepgramKey) {
    keyHint.textContent = 'Por favor, insira sua chave de API do Deepgram.';
    keyHint.className   = 'key-hint error';
    return;
  }

  if (!key) {
    keyHint.textContent = `Por favor, insira sua chave de API para ${PROVIDERS[provider].label.replace('Chave de API ', '')}.`;
    keyHint.className   = 'key-hint error';
    return;
  }

  // save everything to storage before starting
  await new Promise(r => {
    chrome.storage.local.set({
      selectedProvider: provider,
      [`${provider}Key`]: key,
      [`${provider}Model`]: model,
      deepgramKey: deepgramKey
    }, r);
  });

  chrome.runtime.sendMessage({ type: 'START_FACTCHECK' }, (res) => {
    if (res?.ok) {
      setActive(true);
    } else {
      keyHint.textContent = 'Falha ao iniciar: ' + (res?.error || 'erro desconhecido');
      keyHint.className   = 'key-hint error';
    }
  });
});