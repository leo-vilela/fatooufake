// lexical-features.js
// extracts speaker commitment to an utterance from transcript text alone

// -- word lists

const EXCLUSIVE_WORDS = new Set([
  'mas', 'exceto', 'sem', 'excluir', 'excluindo', 'porem', 'entretanto', 'todavia',
  'contudo', 'embora', 'menos', 'apesar', 'imbativem', 'no entanto', 'entanto'
]);

const HEDGING_WORDS = new Set([
  'talvez', 'possivelmente', 'provavelmente', 'deveria', 'poderia', 'parece',
  'aparentemente', 'aproximadamente', 'cerca', 'pouco', 'quase', 'acho',
  'acredito', 'sinto', 'suponho', 'incerto', 'inseguro', 'alegadamente', 'supostamente'
]);

const CERTAINTY_WORDS = new Set([
  'sempre', 'nunca', 'definitivamente', 'certamente', 'absolutamente',
  'claramente', 'obviamente', 'indubitavelmente', 'provado', 'fato', 'fatos',
  'evidencia', 'evidencias', 'estudo', 'estudos', 'pesquisa', 'dados', 'estatisticas',
  'porcento', '%', 'milhao', 'milhoes', 'bilhao', 'bilhoes', 'cada', 'todos', 'tudo', 'nenhum', 'garantido'
]);

const EMOTIONAL_WORDS = new Set([
  'terrivel', 'horrivel', 'pessimo', 'otimo', 'incrivel', 'fantastico',
  'desastre', 'catastrofe', 'maravilhoso', 'inacreditavel', 'vergonha', 'vergonhoso',
  'absurdo', 'ridiculo', 'patetico', 'amor', 'odio', 'medo', 'bravo', 'raiva', 'triste', 'feliz',
  'animado', 'nojento', 'assustado', 'preocupado', 'orgulhoso', 'envergonhado', 'brilhante', 'estupido', 'mal', 'mau', 'corrupto'
]);

const FILLER_WORDS = new Set([
  'eh', 'ah', 'ahm', 'er', 'tipo', 'sabe', 'basicamente', 'literalmente',
  'na verdade', 'honestamente', 'francamente', 'certo', 'ok', 'entao', 'bem', 'de qualquer forma'
]);

const FIRST_PERSON_SINGULAR = new Set([
  'eu', 'me', 'mim', 'meu', 'minha', 'meus', 'minhas', 'comigo'
]);

const FIRST_PERSON_PLURAL = new Set([
  'nos', 'conosco', 'nosso', 'nossa', 'nossos', 'nossas'
]);

const THIRD_PERSON = new Set([
  'eles', 'elas', 'deles', 'delas', 'ele', 'ela', 'dele', 'dela', 'isso', 'consigo', 'o', 'a', 'lhe', 'se'
]);

// -- main extractor

/**
 * extract lexical commitment features from a transcript string
 * @param {string} text - the transcript chunk
 * @param {number} durationSeconds - approximate duration (optional, for speech rate)
 * @returns {object} feature object
 */
function extractLexicalFeatures(text, durationSeconds) {
  const lower = text.toLowerCase();
  const words = lower.match(/\b\w+\b/g) || [];
  const wordCount = words.length;

  if (wordCount === 0) return null;

  let exclusiveCount  = 0;
  let hedgingCount    = 0;
  let certaintyCount  = 0;
  let emotionalCount  = 0;
  let fillerCount     = 0;
  let firstPersonSing = 0;
  let firstPersonPlur = 0;
  let thirdPerson     = 0;

  for (const word of words) {
    if (EXCLUSIVE_WORDS.has(word))        exclusiveCount++;
    if (HEDGING_WORDS.has(word))          hedgingCount++;
    if (CERTAINTY_WORDS.has(word))        certaintyCount++;
    if (EMOTIONAL_WORDS.has(word))        emotionalCount++;
    if (FILLER_WORDS.has(word))           fillerCount++;
    if (FIRST_PERSON_SINGULAR.has(word))  firstPersonSing++;
    if (FIRST_PERSON_PLURAL.has(word))    firstPersonPlur++;
    if (THIRD_PERSON.has(word))           thirdPerson++;
  }

  // also check multi-word phrases
  if (lower.includes('eu acho'))          hedgingCount++;
  if (lower.includes('eu acredito'))      hedgingCount++;
  if (lower.includes('eu creio'))         hedgingCount++;
  if (lower.includes('eu suponho'))       hedgingCount++;
  if (lower.includes('nao tenho certeza')) hedgingCount++;
  if (lower.includes('tipo de'))          hedgingCount++;
  if (lower.includes('sabe como e'))      fillerCount++;
  if (lower.includes('quero dizer'))      fillerCount++;

  // -- rates (per 100 words for normalization) 

  const per100 = (n) => parseFloat(((n / wordCount) * 100).toFixed(1));

  // -- rough speech rate calculation

  const wordsPerSecond = durationSeconds && durationSeconds > 0
    ? parseFloat((wordCount / durationSeconds).toFixed(1))
    : null;

  // -- avg word length (proxy for phoneme density) 

  const avgWordLength = parseFloat(
    (words.reduce((sum, w) => sum + w.length, 0) / wordCount).toFixed(1)
  );

  // -- commitment score (heuristic -1 to +1) 
  // positive = high commitment, negative = low commitment
  // certainty words and first-person singular push positive
  // hedging words and filler push negative
  // emotional words push negative (overconfidence is a form of low precision)

  const commitmentScore = parseFloat((
    (certaintyCount * 0.3)
    + (firstPersonSing * 0.15)
    - (hedgingCount * 0.4)
    - (fillerCount * 0.25)
    - (emotionalCount * 0.1)
    + (exclusiveCount * 0.1) // exclusive words signal careful qualification
  ).toFixed(2));

  const commitmentLabel =
    commitmentScore >  0.3 ? 'HIGH'   :
    commitmentScore < -0.3 ? 'LOW'    :
                             'MEDIUM';

  // -- result

  return {
    wordCount,
    wordsPerSecond,
    avgWordLength,
    rates: {
      hedging:       per100(hedgingCount),
      certainty:     per100(certaintyCount),
      emotional:     per100(emotionalCount),
      filler:        per100(fillerCount),
      exclusive:     per100(exclusiveCount),
      firstPersonSg: per100(firstPersonSing),
      firstPersonPl: per100(firstPersonPlur),
      thirdPerson:   per100(thirdPerson),
    },
    commitmentScore,
    commitmentLabel,
    // human-readable summary for Claude
    summary: buildSummary({
      wordCount, wordsPerSecond, hedgingCount, certaintyCount,
      emotionalCount, fillerCount, exclusiveCount,
      firstPersonSing, firstPersonPlur, commitmentLabel
    })
  };
}

function buildSummary({ wordCount, wordsPerSecond, hedgingCount, certaintyCount,
  emotionalCount, fillerCount, exclusiveCount, firstPersonSing,
  firstPersonPlur, commitmentLabel }) {

  const parts = [];

  if (wordsPerSecond !== null) {
    const rateDesc = wordsPerSecond > 3.5 ? 'fast' : wordsPerSecond < 2 ? 'slow' : 'moderate';
    const ratePt = rateDesc === 'fast' ? 'rápida' : rateDesc === 'slow' ? 'lenta' : 'moderada';
    parts.push(`velocidade da fala: ${wordsPerSecond} palavras/seg (${ratePt})`);
  }

  if (hedgingCount > 0)
    parts.push(`${hedgingCount} expressão${hedgingCount > 1 ? 'ões' : 'ão'} de hesitação (ex: "talvez", "eu acho")`);

  if (fillerCount > 0)
    parts.push(`${fillerCount} palavra${fillerCount > 1 ? 's' : ''} de preenchimento (ex: "tipo", "sabe")`);

  if (certaintyCount > 0)
    parts.push(`${certaintyCount} marcador${certaintyCount > 1 ? 'es' : ''} de certeza (ex: "sempre", "definitivamente", estatísticas)`);

  if (emotionalCount > 0)
    parts.push(`${emotionalCount} palavra${emotionalCount > 1 ? 's' : ''} emocional${emotionalCount > 1 ? 'is' : ''}`);

  if (exclusiveCount > 0)
    parts.push(`${exclusiveCount} palavra${exclusiveCount > 1 ? 's' : ''} qualificadora${exclusiveCount > 1 ? 's' : ''} (ex: "mas", "exceto")`);

  if (firstPersonSing > 0)
    parts.push(`${firstPersonSing} pronome${firstPersonSing > 1 ? 's' : ''} da primeira pessoa do singular (eu/me/meu)`);

  if (firstPersonPlur > 0)
    parts.push(`${firstPersonPlur} pronome${firstPersonPlur > 1 ? 's' : ''} da primeira pessoa do plural (nós/nosso)`);

  const labelMap = { 'HIGH': 'ALTA', 'MEDIUM': 'MÉDIA', 'LOW': 'BAIXA' };
  const labelPt = labelMap[commitmentLabel] || commitmentLabel;

  const summary = parts.length
    ? `Recursos léxicos: ${parts.join(', ')}. Convicção geral: ${labelPt}.`
    : `Nenhum sinal forte de convicção detectado. Convicção geral: ${labelPt}.`;

  return summary;
}