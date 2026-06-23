// service-worker.js --> now combined with fact-checker.js and claim-detector.js for import conflicts
// transcription runs in content script via web speech API;
// responsibile for starting / stopping content script, receiving transcripts,
// and routing them to claim detection
// 5.31.2026 -- serper call before claude call for more accurate verdicts
// 6.12.2026 -- switch to deepgram; too many conflicts w/ webaudio

let ANTHROPIC_KEY = '';
const SERPER_KEY = '';

async function loadKeys() {
  return new Promise(resolve => {
    chrome.storage.local.get(['anthropicKey'], (data) => {
      ANTHROPIC_KEY = data.anthropicKey || '';
      resolve();
    });
  });
}

const EVALUATE_PROMPT = `Você é um assistente de checagem de fatos (fact-checking) em tempo real, altamente objetivo, imparcial e preciso.
Sua tarefa é analisar a transcrição de um discurso, debate ou entrevista e extrair alegações factuais.

Uma alegação é considerada factual se ela fizer uma afirmação objetiva sobre estatísticas, dados históricos, registros governamentais ou eventos passados e presentes que possam ser provados verdadeiros ou falsos. Ignore retórica geral, expressões de valores, opiniões pessoais e promessas futuras.

Para cada alegação identificada:
1. Extraia o texto da alegação resumido e claro em português (campo "claim").
2. Identifique qual participante do debate fez a afirmação (campo "speaker"). Use as regras de atribuição de orador descritas no contexto para mapear rótulos [Speaker N] para os nomes reais.
3. Avalie a veracidade da alegação comparando-a com as fontes de pesquisa web fornecidas (se houver) ou com seu conhecimento interno confiável. Atribua um dos seguintes vereditos (campo "verdict"):
   - "TRUE" (Verdadeiro): Totalmente alinhado aos fatos.
   - "SUBSTANTIALLY TRUE" (Majoritariamente Verdadeiro): Correto na essência, com pequenos detalhes omitidos ou imprecisões secundárias.
   - "MISLEADING" (Enganoso): Contém dados corretos fora de contexto para induzir a erro, distorcendo a realidade.
   - "FALSE" (Falso): Afirmação incorreta e contrária aos fatos.
   - "UNVERIFIABLE" (Não Verificável): Informações insuficientes para confirmar ou negar.
4. Explique brevemente o veredito em português (campo "explanation"), citando dados ou as fontes.
5. Indique o nível de certeza do veredito (campo "confidence"): "HIGH", "MEDIUM" ou "LOW".
6. Indique o nível de convicção ou evasividade do orador (campo "speaker_confidence"): "HIGH", "MEDIUM" ou "LOW". Baseie-se nos dados de "Análise léxica" (Lexical analysis) fornecidos no contexto: se houver alta taxa de palavras de hesitação/evasivas (hedging) ou preenchimento (filler), a convicção é "LOW"; se houver muitos marcadores de certeza e estatísticas, a convicção é "HIGH".
7. Escreva um termo de busca altamente preciso para o Google (campo "strict_query") contendo aspas exatas para números, estatísticas ou nomes próprios críticos (ex: Lula "marco temporal" ou IPCA 2022 "5,79%").
8. Escreva um termo de busca flexível e simplificado contendo apenas palavras-chave essenciais sem aspas (campo "fuzzy_query") para ampliar a busca caso a estrita não traga resultados (ex: inflação acumulada 2022 ibge ou veto marco temporal).

Você deve retornar EXCLUSIVAMENTE um array JSON contendo os objetos de alegação, seguindo estritamente a estrutura abaixo, sem comentários ou explicações fora do JSON:
[
  {
    "claim": "Alegação resumida",
    "verdict": "TRUE | SUBSTANTIALLY TRUE | FALSE | MISLEADING | UNVERIFIABLE",
    "speaker": "Nome do orador",
    "explanation": "Justificativa curta",
    "confidence": "HIGH | MEDIUM | LOW",
    "speaker_confidence": "HIGH | MEDIUM | LOW",
    "strict_query": "Termo de busca com aspas exatas",
    "fuzzy_query": "Termo de busca com palavras-chave abertas"
  }
]`;

// ── Speaker parsing (mirrors overlay.js) ─────────────────────────────────────

function parseSpeakersFromTitle(title) {
  if (!title) return [];
  const roleMatch = title.match(/(\d+)\s+([a-z\u00C0-\u00FF]+(?:\s+[a-z\u00C0-\u00FF]+)?)\s+(?:vs?\.?|versus|contra)\s+(\d+)\s+([a-z\u00C0-\u00FF]+(?:\s+[a-z\u00C0-\u00FF]+)?)/i);
  if (roleMatch) {
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    return [cap(roleMatch[2]), cap(roleMatch[4])];
  }
  const nameMatch = title.match(/([A-Z\u00C0-\u00DF][a-z\u00E0-\u00FF]+(?:\s+[A-Z\u00C0-\u00DF][a-z\u00E0-\u00FF]+)?)\s+(?:e|vs\.?|versus|contra|&)\s+([A-Z\u00C0-\u00DF][a-z\u00E0-\u00FF]+(?:\s+[A-Z\u00C0-\u00DF][a-z\u00E0-\u00FF]+)?)/);
  if (nameMatch) {
    const clean = name => name.trim().split(' ').pop();
    return [clean(nameMatch[1]), clean(nameMatch[2])];
  }
  return [];
}

// ── Serper ────────────────────────────────────────────────────────────────────

const BLOCKED_DOMAINS = [
  'reddit.com', 'facebook.com', 'twitter.com', 'x.com',
  'tiktok.com', 'instagram.com', 'pinterest.com', 'quora.com',
  'yelp.com', 'tripadvisor.com', 'youtube.com', 'kwai.com', 'kwai-video.com',
  'pt.org.br', 'pl.org.br', 'psdb.org.br', 'pmdb.org.br', 'mdb.org.br',
  'pdt.org.br', 'psol50.org.br', 'novo.org.br', 'pcdob.org.br',
  'planalto.gov.br', 'senado.leg.br', 'camara.leg.br', 'tse.jus.br',
  'stf.jus.br', 'gov.br'
];

const ALLOWED_OFFICIAL_DOMAINS = [
  'ibge.gov.br',
  'bcb.gov.br',
  'ipeadata.gov.br',
  'ipea.gov.br',
  'transparencia.gov.br',
  'datasus.saude.gov.br',
  'saude.gov.br',
  'inep.gov.br',
  'tse.jus.br'
];

function isUrlBlocked(url) {
  if (!url) return true;
  // Se pertencer a algum domínio oficial permitido, não bloqueia
  if (ALLOWED_OFFICIAL_DOMAINS.some(d => url.includes(d))) {
    return false;
  }
  return BLOCKED_DOMAINS.some(d => url.includes(d));
}

async function searchWeb(strictQuery, fuzzyQuery, fallbackQuery, retries = 2) {
  try {
    // Portais de checagem e bases de dados oficiais confiáveis no Brasil
    const FACTCHECK_SITES = 'site:g1.globo.com/fato-ou-fake OR site:lupa.uol.com.br OR site:aosfatos.org OR site:estadao.com.br/estadao-verifica OR site:boatos.org';
    const OFFICIAL_SITES = 'site:ibge.gov.br OR site:bcb.gov.br OR site:ipeadata.gov.br OR site:ipea.gov.br OR site:transparencia.gov.br OR site:datasus.saude.gov.br OR site:saude.gov.br OR site:inep.gov.br OR site:tse.jus.br';
    
    // Tenta primeiro a busca estrita com aspas (alta precisão)
    let finalQuery = `${strictQuery || fallbackQuery} (${FACTCHECK_SITES} OR ${OFFICIAL_SITES})`;
    
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': SERPER_KEY },
      body: JSON.stringify({ q: finalQuery, num: 6 }),
    });
    const data = await res.json();
    let links = (data.organic ?? [])
      .map(r => r.link)
      .filter(url => url && !isUrlBlocked(url));
    
    // Se a busca estrita retornar poucos ou nenhum resultado (menos de 2 links), tenta a busca flexível (alta revocação)
    if (links.length < 2 && fuzzyQuery) {
      finalQuery = `${fuzzyQuery} (${FACTCHECK_SITES} OR ${OFFICIAL_SITES})`;
      const resFuzzy = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': SERPER_KEY },
        body: JSON.stringify({ q: finalQuery, num: 6 }),
      });
      const dataFuzzy = await resFuzzy.json();
      const linksFuzzy = (dataFuzzy.organic ?? [])
        .map(r => r.link)
        .filter(url => url && !isUrlBlocked(url));
      
      // Mescla os resultados priorizando os estritos
      links = [...new Set([...links, ...linksFuzzy])];
    }

    // Se ainda não houver resultados, tenta a busca geral sem restrição de sites como fallback
    if (!links.length && fallbackQuery) {
      const fallbackRes = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': SERPER_KEY },
        body: JSON.stringify({ q: fallbackQuery, num: 6 }),
      });
      const fallbackData = await fallbackRes.json();
      links = (fallbackData.organic ?? [])
        .map(r => r.link)
        .filter(url => url && !isUrlBlocked(url));
    }
    return links.slice(0, 3);
  } catch (err) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 500));
      return searchWeb(strictQuery, fuzzyQuery, fallbackQuery, retries - 1);
    }
    console.error('[serper] error:', err);
    return [];
  }
}

// ── Claude ────────────────────────────────────────────────────────────────────

async function callClaude(userMessage, systemPrompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 768,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  const data = await res.json();
  if (data.error) {
    const msg = data.error.message || 'Unknown API error';
    console.error('[claude] API error:', msg);
    if (activeTabId) chrome.tabs.sendMessage(activeTabId, { type: 'PIPELINE_ERROR', message: msg }).catch(() => {});
    return '';
  }
  const raw = data.content?.[0]?.text?.trim() || '';
  return raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
}

function parseArray(str) {
  const start = str.indexOf('[');
  const end   = str.lastIndexOf(']');
  if (start === -1 || end === -1) return [];
  try { return JSON.parse(str.slice(start, end + 1)); }
  catch { return []; }
}

// ── Lexical features ──────────────────────────────────────────────────────────

const HEDGING_WORDS   = ['acho', 'acredito', 'talvez', 'provavelmente', 'parece', 'suponho', 'incerto', 'inseguro', 'deveria', 'poderia'];
const CERTAINTY_WORDS = ['definitivamente', 'certamente', 'absolutamente', 'sempre', 'nunca', 'claramente', 'obviamente', 'provado', 'fato', 'dados'];
const FILLER_WORDS    = ['eh', 'ah', 'tipo', 'sabe', 'basicamente', 'literalmente', 'certo', 'ok', 'entao'];
const EMOTIONAL_WORDS = ['desastre', 'terrivel', 'horrivel', 'incrivel', 'otimo', 'pessimo', 'fantastico', 'maravilhoso', 'amor', 'odio', 'corrupto'];
const EXCLUSIVE_WORDS = ['mas', 'exceto', 'porem', 'entretanto', 'embora', 'sem', 'excluir', 'no entanto'];
const FP_SINGULAR     = ['eu', 'me', 'mim', 'meu', 'minha', 'meus', 'minhas', 'comigo'];

function extractLexical(text) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const total = words.length || 1;
  const rate  = (list) => Math.round(words.filter(w => list.some(h => w.includes(h))).length / total * 100);
  return {
    rates: {
      hedging:       rate(HEDGING_WORDS),
      certainty:     rate(CERTAINTY_WORDS),
      filler:        rate(FILLER_WORDS),
      emotional:     rate(EMOTIONAL_WORDS),
      exclusive:     rate(EXCLUSIVE_WORDS),
      firstPersonSg: Math.round(words.filter(w => FP_SINGULAR.includes(w)).length / total * 100),
    },
    wordsPerSecond: null,
    wordCount: total,
  };
}

function buildLexicalSummary(f) {
  const r = f.rates || f;
  const notes = [];
  if (r.hedging > 8)       notes.push(`linguagem evasiva (${r.hedging}%)`);
  if (r.certainty > 8)     notes.push(`marcadores de certeza (${r.certainty}%)`);
  if (r.filler > 8)        notes.push(`palavras de preenchimento (${r.filler}%)`);
  if (r.emotional > 8)     notes.push(`linguagem emocional (${r.emotional}%)`);
  if (r.exclusive > 8)     notes.push(`palavras qualificadoras (${r.exclusive}%)`);
  if (r.firstPersonSg > 8) notes.push(`primeira pessoa do singular (${r.firstPersonSg}%)`);
  if (f.wordsPerSecond) {
    const pace = f.wordsPerSecond > 3.5 ? 'fast' : f.wordsPerSecond < 2 ? 'slow' : 'moderate';
    const pacePt = pace === 'fast' ? 'rápida' : pace === 'slow' ? 'lenta' : 'moderada';
    notes.push(`velocidade da fala ${f.wordsPerSecond} p/s (${pacePt})`);
  }
  return notes.length ? `Recursos detectados: ${notes.join(', ')}.` : 'Expressão neutra.';
}

// ── Claim deduplication ───────────────────────────────────────────────────────

const recentClaims   = new Map(); // key → [timestamp, originalClaim]
const CLAIM_DEDUP_MS = 200000;

function normalizeClaimKey(claim) {
  return claim.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length >= 4)
    .sort()
    .join(' ');
}

function isDuplicate(claim) {
  const key = normalizeClaimKey(claim);
  const now = Date.now();

  for (const [k, v] of recentClaims) {
    const t = Array.isArray(v) ? v[0] : v;
    if (now - t > CLAIM_DEDUP_MS) recentClaims.delete(k);
  }

  if (recentClaims.has(key)) return true;

  const keyWords = new Set(key.split(' ').filter(Boolean));
  const figures  = (claim.match(/\$[\d,.]+(?:\s*(?:trillion|billion|million|thousand))?/gi) || [])
    .map(d => d.replace(/[,\s]/g, '').toLowerCase());

  for (const [k, v] of recentClaims) {
    const kWords = k.split(' ').filter(Boolean);
    if (kWords.filter(w => keyWords.has(w)).length / Math.max(keyWords.size, kWords.length) >= 0.35) return true;
    if (figures.length) {
      const origClaim = Array.isArray(v) ? v[1] : '';
      if (origClaim) {
        const origFigures = (origClaim.match(/\$[\d,.]+(?:\s*(?:trillion|billion|million|thousand))?/gi) || [])
          .map(d => d.replace(/[,\s]/g, '').toLowerCase());
        if (figures.some(f => origFigures.includes(f))) return true;
      }
    }
  }

  recentClaims.set(key, [now, claim]);
  return false;
}

// ── Rolling window ────────────────────────────────────────────────────────────

const WINDOW_SIZE = 4;
const WINDOW_KEEP = 15;

// Each entry: { text, speakerId, speakerName }
let sentenceWindow  = [];
let sentenceCount   = 0;
let windowLexical   = { rates: { hedging: 0, certainty: 0, filler: 0, emotional: 0, exclusive: 0, firstPersonSg: 0 }, wordsPerSecond: null, wordCount: 0 };
let windowStartTime = null;
let pageTitle       = '';
let pageDate        = '';
let currentSpeakerId  = null;
let speakerIdToName   = {};  // confirmed: { 0: 'Harris', 1: 'Trump' }
let confirmedSpeakers = new Set(); // IDs that have been confirmed by user

function resetWindow() {
  sentenceWindow   = [];
  sentenceCount    = 0;
  windowLexical    = { rates: { hedging: 0, certainty: 0, filler: 0, emotional: 0, exclusive: 0, firstPersonSg: 0 }, wordsPerSecond: null, wordCount: 0 };
  windowStartTime  = null;
  currentSpeakerId  = null;
  lastSpeakerId     = null;
  speakerIdToName   = {};
  confirmedSpeakers = new Set();
}

async function onNewSentence(text, speakerId) {
  // flush window early on speaker change (mid-window turn transition)
  if (lastSpeakerId !== null &&
      speakerId !== null &&
      speakerId !== undefined &&
      speakerId !== lastSpeakerId &&
      sentenceCount % WINDOW_SIZE !== 0 &&
      sentenceWindow.length >= 2) {
    // fire evaluation for the previous speaker's sentences before processing this one
    const flushText = sentenceWindow.map(s => s.text).join(' ');
    const flushCounts = {};
    sentenceWindow.slice(-WINDOW_SIZE).forEach(s => {
      if (s.speakerId !== null && s.speakerId !== undefined)
        flushCounts[s.speakerId] = (flushCounts[s.speakerId] || 0) + 1;
    });
    const flushDominantId = Object.keys(flushCounts).length
      ? Object.entries(flushCounts).sort((a,b) => b[1]-a[1])[0][0]
      : null;
    const flushDominantSpeaker = flushDominantId !== null ? (speakerIdToName[flushDominantId] || null) : null;
    const flushLexSnapshot = JSON.parse(JSON.stringify(windowLexical));
    const flushLexSummary  = buildLexicalSummary(flushLexSnapshot);
    windowLexical   = { rates: { hedging: 0, certainty: 0, filler: 0, emotional: 0, exclusive: 0, firstPersonSg: 0 }, wordsPerSecond: null, wordCount: 0 };
    windowStartTime = null;
    await evaluateClaims(flushText, pageTitle, flushLexSummary, flushLexSnapshot, flushDominantSpeaker, flushDominantId);
  }
  lastSpeakerId = speakerId;

  // label with confirmed name if available, else Speaker N for Claude to infer
  const confirmedName = (speakerId !== null && speakerId !== undefined) ? speakerIdToName[speakerId] : null;
  const label         = confirmedName ? `[${confirmedName}]` : (speakerId !== null && speakerId !== undefined ? `[Speaker ${speakerId}]` : null);
  const labeledText   = label ? `${label} ${text}` : text;

  sentenceWindow.push({ text: labeledText, speakerId, speakerName: confirmedName });
  if (sentenceWindow.length > WINDOW_KEEP) sentenceWindow.shift();
  sentenceCount++;

  if (!windowStartTime) windowStartTime = Date.now();

  // accumulate lexical
  const f = extractLexical(text);
  const r = f.rates, wr = windowLexical.rates;
  wr.hedging       = Math.round((wr.hedging       + r.hedging)       / 2);
  wr.certainty     = Math.round((wr.certainty     + r.certainty)     / 2);
  wr.filler        = Math.round((wr.filler        + r.filler)        / 2);
  wr.emotional     = Math.round((wr.emotional     + r.emotional)     / 2);
  wr.exclusive     = Math.round((wr.exclusive     + r.exclusive)     / 2);
  wr.firstPersonSg = Math.round((wr.firstPersonSg + r.firstPersonSg) / 2);
  windowLexical.wordCount += f.wordCount;

  if (sentenceCount % WINDOW_SIZE === 0) {
    const contextText = sentenceWindow.map(s => s.text).join(' ');

    // dominant speaker ID = whoever appears most in this window
    // count only the CURRENT window's sentences (last WINDOW_SIZE), not full rolling buffer
    const currentWindowSentences = sentenceWindow.slice(-WINDOW_SIZE);
    const counts = {};
    currentWindowSentences.forEach(s => {
      if (s.speakerId !== null && s.speakerId !== undefined) {
        counts[s.speakerId] = (counts[s.speakerId] || 0) + 1;
      }
    });
    const dominantSpeakerId = Object.keys(counts).length
      ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
      : null;
    // use confirmed name from speakerIdToName — ground truth from Deepgram + user confirmation
    const dominantSpeaker = dominantSpeakerId !== null
      ? (speakerIdToName[dominantSpeakerId] || null)
      : null;

    // speech rate
    const elapsed = windowStartTime ? (Date.now() - windowStartTime) / 1000 : null;
    if (elapsed && elapsed > 0) windowLexical.wordsPerSecond = Math.round(windowLexical.wordCount / elapsed * 10) / 10;
    windowStartTime = null;

    const lexicalSnapshot = JSON.parse(JSON.stringify(windowLexical));
    const lexicalSummary  = buildLexicalSummary(lexicalSnapshot);

    // reset for next window
    windowLexical   = { rates: { hedging: 0, certainty: 0, filler: 0, emotional: 0, exclusive: 0, firstPersonSg: 0 }, wordsPerSecond: null, wordCount: 0 };
    windowStartTime = null;

    try {
      await evaluateClaims(contextText, pageTitle, lexicalSummary, lexicalSnapshot, dominantSpeaker, dominantSpeakerId);
    } catch (e) {
    }
  }
}

// ── Evaluation pipeline ───────────────────────────────────────────────────────

async function evaluateClaims(contextText, title, lexicalSummary, lexicalSnapshot, dominantSpeaker, dominantSpeakerId) {
  try {
    const dateContext    = pageDate ? `\nDate: ${pageDate}` : '';

    // build speaker legend from title names for Claude
    const titleNames    = parseSpeakersFromTitle(title || '');
    const nameList = titleNames.join(' and ');
    const speakerLegend = titleNames.length
      ? `\nParticipantes do debate: ${nameList}.` +
        `\nRegras de atribuição de orador:` +
        `\n- Os rótulos [Speaker N] indicam apenas a ordem de fala dos oradores — NÃO associe necessariamente Speaker 0 ao primeiro nome listado.` +
        `\n- Identifique os oradores usando: (1) linguagem em primeira pessoa — quando alguém disser "eu", "meu plano", "eu pretendo", a pessoa É o orador — associe a alegação ao participante correspondente; (2) conteúdo de propostas e políticas — associe as posições declaradas ao plano conhecido de cada orador; (3) referências cruzadas — os oradores costumam chamar uns aos outros pelo nome.` +
        `\n- Utilize seu conhecimento sobre o histórico, propostas e cargos de cada participante nomeado para atribuir corretamente.` +
        `\n- Se um mediador ou terceiro orador estiver falando, atribua a ele se identificável, caso contrário use "Unknown".` +
        `\n- NUNCA retorne "Speaker N" ou qualquer formato como [Speaker N] nos campos de resposta.`
      : `\nIdentifique os oradores usando linguagem em primeira pessoa, propostas políticas e padrões de fala. Nunca retorne "Speaker N".`;

    const titleContext = title
      ? `Video: "${title}"${dateContext}${speakerLegend}\n\nEvaluate claims as they were made at the time of this recording. Do not apply knowledge of events after this date.\n\n`
      : '';
    const lexicalContext = lexicalSummary ? `\n\nLexical analysis: ${lexicalSummary}` : '';

    // already-checked claims list for Claude
    const checkedList = [...recentClaims.values()]
      .filter(v => Array.isArray(v) && v[1])
      .map(v => v[1])
      .slice(-15)
      .join('\n- ');
    const alreadyChecked = checkedList
      ? `\n\nClaims already fact-checked this session — do NOT re-evaluate these or close variants:\n- ${checkedList}\n`
      : '';

    const raw     = await callClaude(
      `${titleContext}Transcript: "${contextText}"${alreadyChecked}${lexicalContext}`,
      EVALUATE_PROMPT
    );
    const results = parseArray(raw);
    const valid   = results.filter(r => r.claim && r.verdict && !isDuplicate(r.claim));

    if (!valid.length) return;

    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, {
        type: 'NEW_VERDICT',
        results: valid.map(r => ({
          ...r,
          sources:          [],
          pending:          true,
          lexical:          lexicalSnapshot,
          dominantSpeakerId, // raw Deepgram ID — overlay resolves to name at render time
          speaker:          dominantSpeaker || (r.speaker && !r.speaker.match(/^(?:Speaker|Orador)\s*\d+$/i) ? r.speaker : null),
        })),
      }).catch(() => {});
      console.log('[pipeline] fast verdicts sent:', valid.length, '| speaker:', dominantSpeaker);
    }

    groundAndUpdate(contextText, valid, title, lexicalSummary, lexicalSnapshot, dominantSpeaker, dominantSpeakerId);

  } catch (err) {
    console.error('[pipeline] error:', err);
  }
}

async function groundAndUpdate(contextText, fastResults, title, lexicalSummary, lexicalSnapshot, dominantSpeaker, dominantSpeakerId) {
  try {
    const dateCtx      = pageDate ? `\nDate: ${pageDate}` : '';
    const titleContext = title
      ? `Video: "${title}"${dateCtx}\nEvaluate claims as they were made at the time of this recording. Web search results may include articles published after the debate date — ignore any information that was not publicly known at the time of the debate.\n\n`
      : '';
    const lexicalContext = lexicalSummary ? `\n\nLexical analysis: ${lexicalSummary}` : '';

    const groundedAll = await Promise.all(fastResults.map(async (fastResult) => {
      try {
        const urls = await searchWeb(fastResult.strict_query, fastResult.fuzzy_query, fastResult.claim);
        if (!urls.length) return null;
        const raw = await callClaude(
          `${titleContext}Transcript: "${contextText}"\n\nEvaluate ONLY this specific claim:\n1. ${fastResult.claim}\n\nWeb search results:\n${urls.join('\n')}${lexicalContext}`,
          EVALUATE_PROMPT
        );
        const results = parseArray(raw);
        const match   = results.find(r => r.claim && r.verdict);
        if (!match) return null;
        // re-resolve speaker at grounding time — user may have confirmed since fast pass
        const lateResolved = dominantSpeakerId !== null && dominantSpeakerId !== undefined
          ? speakerIdToName[dominantSpeakerId] || null
          : null;
        const resolvedSpeaker = lateResolved
          || dominantSpeaker
          || (match.speaker && !match.speaker.match(/^(?:Speaker|Orador)\s*\d+$/i) ? match.speaker : null)
          || (fastResult.speaker && !fastResult.speaker.match(/^(?:Speaker|Orador)\s*\d+$/i) ? fastResult.speaker : null);

        // never downgrade TRUE to MISLEADING in grounded pass — fast verdict had no sources to nitpick
        const fastWasTrue = fastResult.verdict === 'TRUE' || fastResult.verdict === 'SUBSTANTIALLY TRUE';
        const groundedIsMisleading = match.verdict === 'MISLEADING';
        const finalVerdict = (fastWasTrue && groundedIsMisleading) ? fastResult.verdict : match.verdict;

        return { ...match, verdict: finalVerdict, sources: urls, pending: false, lexical: lexicalSnapshot, speaker: resolvedSpeaker, dominantSpeakerId };
      } catch (err) {
        console.error('[grounded] error:', fastResult.claim.slice(0, 40), err);
        return null;
      }
    }));

    const valid = groundedAll.filter(Boolean);
    if (valid.length && activeTabId) {
      chrome.tabs.sendMessage(activeTabId, { type: 'UPDATE_VERDICTS', results: valid }).catch(() => {});
      console.log('[pipeline] grounded verdicts sent:', valid.length);
    }
  } catch (err) {
    console.error('[grounded] error:', err);
  }
}

// ── State ─────────────────────────────────────────────────────────────────────

let activeTabId = null;
let isCapturing = false;
let keepAliveInterval = null;

function startKeepAlive() {
  keepAliveInterval = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
}

function stopKeepAlive() {
  clearInterval(keepAliveInterval);
  keepAliveInterval = null;
}

// ── Messages ──────────────────────────────────────────────────────────────────

chrome.runtime.onConnect.addListener(() => console.log('[service-worker] woken by port connect'));

// notify overlay if service worker was killed and restarted mid-session
chrome.runtime.onStartup.addListener(() => {
  isCapturing = false;
  activeTabId = null;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {

    case 'START_FACTCHECK':
      startFactCheck()
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case 'STOP_FACTCHECK':
      stopFactCheck();
      sendResponse({ ok: true });
      break;

    case 'TRANSCRIPT_RESULT':
      // always process transcript for pipeline — activeTabId only needed for forwarding to overlay
      if (msg.isFinal) {
        if (msg.speaker !== null && msg.speaker !== undefined) {
          currentSpeakerId = msg.speaker;
          if (activeTabId && !confirmedSpeakers.has(currentSpeakerId) && !speakerIdToName[currentSpeakerId]) {
            chrome.tabs.sendMessage(activeTabId, {
              type:      'NEW_SPEAKER',
              speakerId: currentSpeakerId,
              sample:    msg.text.slice(0, 80),
            }).catch(() => {});
          }
        }
        onNewSentence(msg.text, currentSpeakerId);
      }
      if (activeTabId) {
        chrome.tabs.sendMessage(activeTabId, {
          type: 'TRANSCRIPT_RESULT', text: msg.text, isFinal: msg.isFinal, interim: msg.interim,
        }).catch(() => {});
      }
      break;

    case 'SPEAKER_NAMES':
      // merge incoming confirmed entries — never overwrite already-confirmed IDs
      if (msg.speakerIdToName) {
        Object.entries(msg.speakerIdToName).forEach(([id, name]) => {
          const numId = parseInt(id);
          if (!confirmedSpeakers.has(numId)) {
            speakerIdToName[numId] = name;
            confirmedSpeakers.add(numId);
          }
        });
        console.log('[service-worker] speaker map updated:', speakerIdToName);
      }
      break;

    case 'PAGE_TITLE':
      pageTitle = msg.title || '';
      pageDate  = msg.date  || '';
      console.log('[service-worker] page title:', pageTitle.slice(0, 60));
      console.log('[service-worker] page date:', pageDate);
      // speaker names passed to Claude as context — Claude resolves attribution
      break;

    case 'PIPELINE_ERROR':
      // forward from offscreen doc to overlay
      if (activeTabId) {
        chrome.tabs.sendMessage(activeTabId, { type: 'PIPELINE_ERROR', message: msg.message }).catch(() => {});
      }
      break;

    case 'REQUEST_NEW_STREAM':
      // offscreen doc lost its stream — get a fresh tabCapture stream ID
      if (activeTabId && isCapturing) {
        chrome.tabCapture.getMediaStreamId({ targetTabId: activeTabId }, (streamId) => {
          if (chrome.runtime.lastError) {
            console.error('[service-worker] failed to get new stream:', chrome.runtime.lastError.message);
            return;
          }
          chrome.runtime.sendMessage({ type: 'START_CAPTURE', streamId }).catch(() => {});
        });
      }
      break;

    case 'GET_STATUS':
      sendResponse({ isCapturing });
      break;
  }
});

// ── Start / stop ──────────────────────────────────────────────────────────────

async function startFactCheck() {
  if (isCapturing) return;

  await loadKeys();
  if (!ANTHROPIC_KEY) {
    throw new Error('Chave de API Anthropic não configurada. Por favor, insira-a no popup da extensão.');
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('Nenhuma aba ativa encontrada.');
  activeTabId = tab.id;

  try {
    await ensureOffscreenDocument();
    console.log('[service-worker] offscreen document created');
  } catch (err) {
    console.error('[service-worker] offscreen creation failed:', err);
  }

  const streamId = await new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: activeTabId }, id => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(id);
    });
  });

  const response = await chrome.runtime.sendMessage({ type: 'START_CAPTURE', streamId });
  if (!response?.ok) throw new Error('Falha ao iniciar captura: ' + response?.error);

  // reset BEFORE sending START_FACTCHECK — transcripts arrive immediately after
  isCapturing = true;
  resetWindow();
  recentClaims.clear();
  startKeepAlive();

  await chrome.tabs.sendMessage(activeTabId, { type: 'START_FACTCHECK' });
  console.log('[service-worker] started on tab', activeTabId);
}

function stopFactCheck() {
  resetWindow();
  recentClaims.clear();
  pageTitle = '';
  pageDate  = '';

  if (!isCapturing) return;

  chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' }).catch(() => {});
  chrome.offscreen.closeDocument().catch(() => {});
  if (activeTabId) chrome.tabs.sendMessage(activeTabId, { type: 'STOP_FACTCHECK' }).catch(() => {});

  activeTabId = null;
  isCapturing = false;
  stopKeepAlive();
  console.log('[service-worker] stopped');
}

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL('src/offscreen/offscreen.html'),
    reasons: ['USER_MEDIA'],
    justification: 'Capture tab audio for Deepgram transcription',
  });
}