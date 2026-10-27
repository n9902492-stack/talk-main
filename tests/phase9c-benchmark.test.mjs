import test from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkFixture, benchmarkLanguages } from './fixtures/assistant-benchmark/meetings.mjs';
import { approvedModel, approvedModels, benchmarkRequest, compactReportSchema, assessReport, main } from '../scripts/phase9c-benchmark.mjs';
import { assistantReportSchema, assistantReportSections, emptyAssistantReport, validateAssistantReport } from '../backend/src/assistant-grounding.mjs';
import { transcriptContentHash } from '../backend/src/transcript-revisions.mjs';

test('English, Hindi and Hinglish synthetic sources have stable Phase 9B hashes and unknown speakers', () => {
  assert.deepEqual(benchmarkLanguages, ['en', 'hi', 'hinglish']);
  for (const language of benchmarkLanguages) {
    const fixture = benchmarkFixture(language), source = fixture.sources[0];
    assert.equal(fixture.synthetic, true);
    assert.equal(source.contentHash, transcriptContentHash(source));
    assert.equal(source.segments[5].speaker, null);
    assert.equal(source.segments.length, 7);
    assert.deepEqual(validateAssistantReport(emptyAssistantReport(), fixture.sources), emptyAssistantReport());
  }
  assert.match(benchmarkFixture('hi').sources[0].segments[0].text, /आशा/u);
  assert.throws(() => benchmarkFixture('../../private'));
});

test('compact structured schema preserves every existing Phase 9B section and item contract', () => {
  const schema = compactReportSchema();
  assert.deepEqual(schema.required, assistantReportSchema.required);
  assert.deepEqual(schema.$defs.reportItem, assistantReportSchema.properties.summary.items);
  for (const section of assistantReportSections) assert.deepEqual(schema.properties[section].items, { $ref: '#/$defs/reportItem' });
  assert.notEqual(schema.$defs.reportItem, assistantReportSchema.properties.summary.items);
});

test('approved requests disable thinking and streaming, bound context and output, and use synthetic sources only', () => {
  assert.equal(approvedModel, 'qwen3:1.7b-q4_K_M');
  assert.deepEqual(approvedModels, ['qwen3:1.7b-q4_K_M', 'qwen3:1.7b']);
  for (const language of benchmarkLanguages) {
    const { request, estimatedPromptTokens } = benchmarkRequest(language);
    assert.equal(request.think, false); assert.equal(request.stream, false);
    assert.equal(request.options.num_ctx, 4096); assert.equal(request.options.temperature, 0);
    assert.ok(estimatedPromptTokens + request.options.num_predict <= 4096);
    assert.ok(JSON.parse(request.messages[1].content)[0].id.startsWith('synthetic-'));
  }
});

test('deterministic checks preserve unknown assignments and require separate human semantic review', () => {
  const fixture = benchmarkFixture('en'), source = fixture.sources[0], content = emptyAssistantReport();
  for (const [index, expected] of fixture.expected.coverage.entries()) {
    const segment = source.segments.find(value => value.segmentId === expected.segmentId);
    content[expected.section].push({ id: `fact-${index}`, text: expected.fact, speaker: segment.speaker,
      owner: expected.segmentId === '4' ? 'Asha' : null, deadline: expected.segmentId === '4' ? 'Friday' : null,
      uncertainty: [], evidence: [{ recordingId: source.recordingId, revisionId: source.id, segmentId: segment.segmentId,
        startMs: segment.startMs, endMs: segment.endMs, quote: segment.text }] });
  }
  const quality = assessReport(validateAssistantReport(content, fixture.sources), fixture);
  assert.equal(quality.expectedFactCoverage, '7/7'); assert.equal(quality.assignedActionCorrect, true);
  assert.equal(quality.unknownActionPreserved, true); assert.equal(quality.manualReviewRequired, true);
  assert.ok(quality.manualReviewChecklist.some(value => value.includes('NOT approved')));
});

test('run rejects missing digest and arbitrary model/endpoint options before any inference', async () => {
  await assert.rejects(main(['--run']), /requires --digest/);
  await assert.rejects(main(['--model', 'large-model']), /Only the approved/);
  await assert.rejects(main(['--url', 'https://external.example']), /Unknown option/);
  await assert.rejects(main(['--language', 'private']), /Use --language/);
});
