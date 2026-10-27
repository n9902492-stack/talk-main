// The model's output is untrusted data. These checks establish traceability,
// not semantic truth: a manager must review interpretations against the audio.
export const assistantReportSections = Object.freeze([
  'summary', 'topics', 'employeeUpdates', 'completedWork', 'workInProgress',
  'blockers', 'risks', 'decisions', 'actionItems', 'followUpNotes',
]);

const itemKeys = ['id', 'text', 'speaker', 'owner', 'deadline', 'uncertainty', 'evidence'];
const evidenceKeys = ['recordingId', 'revisionId', 'segmentId', 'startMs', 'endMs', 'quote'];
const invalid = () => {
  const error = new Error('The assistant report contains invalid or unsupported transcript evidence.');
  error.code = 'assistant_evidence_invalid';
  return error;
};

function object(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !allowed.includes(key)
    || !Object.hasOwn(descriptors[key], 'value'))
    || required.some(key => !Object.hasOwn(descriptors, key))) throw invalid();
  return value;
}

function string(value, maximum, { empty = false } = {}) {
  if (typeof value !== 'string' || value.length > maximum || (!empty && !value.trim())
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) throw invalid();
  return value;
}

function identifier(value) {
  return string(value, 160);
}

function milliseconds(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 31 * 24 * 60 * 60 * 1000) throw invalid();
  return value;
}

function nullable(value, maximum = 200) {
  return value === null ? null : string(value, maximum);
}

function sourceIndex(sources) {
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > 128) throw invalid();
  const revisions = new Map(); let segmentCount = 0;
  for (const source of sources) {
    // Additional trusted snapshot metadata may be present, but never forms
    // part of evidence identity. No code or properties are evaluated.
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw invalid();
    const id = identifier(source.id), recordingId = identifier(source.recordingId);
    if (!Number.isSafeInteger(source.revision) || source.revision < 1
      || !/^[a-f0-9]{64}$/i.test(source.contentHash || '') || revisions.has(id)
      || !Array.isArray(source.segments) || source.segments.length > 30000) throw invalid();
    const segments = new Map();
    for (const segment of source.segments) {
      if (!segment || typeof segment !== 'object' || Array.isArray(segment)) throw invalid();
      const segmentId = identifier(segment.segmentId), startMs = milliseconds(segment.startMs), endMs = milliseconds(segment.endMs);
      if (endMs < startMs || segments.has(segmentId) || ++segmentCount > 100000) throw invalid();
      segments.set(segmentId, { startMs, endMs, text: string(segment.text, 10000), speaker: nullable(segment.speaker) });
    }
    revisions.set(id, { recordingId, segments });
  }
  return revisions;
}

export function emptyAssistantReport() {
  return { schemaVersion: 1, ...Object.fromEntries(assistantReportSections.map(key => [key, []])) };
}

export function validateAssistantReport(content, sources) {
  object(content, ['schemaVersion', ...assistantReportSections]);
  if (content.schemaVersion !== 1) throw invalid();
  const revisions = sourceIndex(sources), ids = new Set(), result = emptyAssistantReport();
  let itemCount = 0;
  for (const section of assistantReportSections) {
    if (!Array.isArray(content[section]) || content[section].length > 100) throw invalid();
    for (const input of content[section]) {
      object(input, itemKeys);
      const id = string(input.id, 100);
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id) || ids.has(id) || ++itemCount > 500) throw invalid();
      ids.add(id);
      if (!Array.isArray(input.evidence) || input.evidence.length < 1 || input.evidence.length > 12
        || !Array.isArray(input.uncertainty) || input.uncertainty.length > 16) throw invalid();
      const evidence = [], quotes = [], speakers = new Set(); let unknownSpeaker = false;
      const evidenceIds = new Set();
      for (const reference of input.evidence) {
        object(reference, evidenceKeys);
        const recordingId = identifier(reference.recordingId), revisionId = identifier(reference.revisionId), segmentId = identifier(reference.segmentId);
        const startMs = milliseconds(reference.startMs), endMs = milliseconds(reference.endMs), quote = string(reference.quote, 4000);
        const revision = revisions.get(revisionId), segment = revision?.segments.get(segmentId);
        const key = JSON.stringify([revisionId, segmentId, startMs, endMs, quote]);
        if (!segment || revision.recordingId !== recordingId || startMs < segment.startMs
          || endMs > segment.endMs || endMs < startMs || !segment.text.includes(quote)
          || evidenceIds.has(key)) throw invalid();
        evidenceIds.add(key);
        if (segment.speaker === null) unknownSpeaker = true;
        else speakers.add(segment.speaker);
        evidence.push({ recordingId, revisionId, segmentId, startMs, endMs, quote });
        quotes.push(quote);
      }
      const speaker = nullable(input.speaker), owner = nullable(input.owner), deadline = nullable(input.deadline, 300);
      // A name mentioned in speech is not a verified speaker identity.
      if (speaker !== null && !speakers.has(speaker)) throw invalid();
      // Literal support is necessary, not sufficient, for owner/deadline
      // interpretation. Every such assertion is explicitly marked for review.
      if ((owner !== null && !quotes.some(quote => quote.includes(owner)))
        || (deadline !== null && !quotes.some(quote => quote.includes(deadline)))) throw invalid();
      const uncertainty = new Set(input.uncertainty.map(flag => string(flag, 200)));
      if (speaker === null) uncertainty.add('unknown_speaker');
      if (unknownSpeaker && speaker !== null) uncertainty.add('ambiguous_speaker');
      if (owner === null) uncertainty.add('unknown_owner');
      if (deadline === null) uncertainty.add('unknown_deadline');
      // This foundation never auto-approves any model conclusion.
      uncertainty.add('needs_review');
      if (uncertainty.size > 16) throw invalid();
      result[section].push({ id, text: string(input.text, 4000), speaker, owner, deadline,
        uncertainty: [...uncertainty].sort(), evidence });
    }
  }
  // Bound persistence size independently of individual field limits.
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 2 * 1024 * 1024) throw invalid();
  return result;
}

const nullableStringSchema = { type: ['string', 'null'], minLength: 1, maxLength: 200 };
const evidenceSchema = { type: 'object', additionalProperties: false, required: evidenceKeys,
  properties: {
    recordingId: { type: 'string', minLength: 1, maxLength: 160 }, revisionId: { type: 'string', minLength: 1, maxLength: 160 },
    segmentId: { type: 'string', minLength: 1, maxLength: 160 }, startMs: { type: 'integer', minimum: 0 }, endMs: { type: 'integer', minimum: 0 },
    quote: { type: 'string', minLength: 1, maxLength: 4000 },
  } };
const itemSchema = { type: 'object', additionalProperties: false, required: itemKeys,
  properties: { id: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]*$', maxLength: 100 },
    text: { type: 'string', minLength: 1, maxLength: 4000 }, speaker: nullableStringSchema, owner: nullableStringSchema,
    deadline: { ...nullableStringSchema, maxLength: 300 }, uncertainty: { type: 'array', maxItems: 16, items: { type: 'string', minLength: 1, maxLength: 200 } },
    evidence: { type: 'array', minItems: 1, maxItems: 12, items: evidenceSchema } } };

export const assistantReportSchema = {
  type: 'object', additionalProperties: false, required: ['schemaVersion', ...assistantReportSections],
  properties: { schemaVersion: { const: 1 }, ...Object.fromEntries(assistantReportSections.map(key => [key,
    { type: 'array', maxItems: 100, items: itemSchema }])) },
};
