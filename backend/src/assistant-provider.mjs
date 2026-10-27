// Phase 9B prepares a provider boundary only. Nothing in this module installs,
// downloads, probes, starts or sends data to Ollama, including when configured.
const disabledReason = 'Local AI generation is disabled until installation and model benchmarking are separately approved.';

function configurationError() {
  const error = new Error('The local assistant provider configuration is invalid.');
  error.code = 'assistant_provider_configuration';
  return error;
}

export function localEndpoint(value) {
  if (typeof value !== 'string' || value.length > 200) throw configurationError();
  let endpoint;
  try { endpoint = new URL(value); } catch { throw configurationError(); }
  // Literal loopback only: no DNS resolution/rebinding, credentials, HTTPS
  // proxies, unix sockets, redirects, arbitrary paths or external providers.
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(endpoint.hostname)
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || endpoint.pathname !== '/' || !/^http:\/\/(?:127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?\/?$/.test(value)) throw configurationError();
  return endpoint.origin;
}

export function createOllamaProvider(options = {}) {
  const { enabled = false, baseUrl = 'http://127.0.0.1:11434', model = null,
    benchmarkApproved = false, modelDigest = null } = options;
  const endpoint = localEndpoint(baseUrl);
  if (typeof enabled !== 'boolean' || typeof benchmarkApproved !== 'boolean'
    || (model !== null && (typeof model !== 'string' || model.length > 160
      || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*(?::[a-zA-Z0-9._-]+)?$/.test(model) || /:cloud$/i.test(model)))
    || (modelDigest !== null && (typeof modelDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(modelDigest)))) throw configurationError();
  if (enabled && (!benchmarkApproved || model === null || modelDigest === null)) throw configurationError();
  return Object.freeze({
    configured: false,
    reason: disabledReason,
    provider: 'ollama-local',
    prepared: enabled && benchmarkApproved && model !== null && modelDigest !== null,
    settings: Object.freeze({ baseUrl: endpoint, model, modelDigest, cloudAllowed: false, autoPull: false }),
    async generate() {
      const error = new Error(disabledReason);
      error.code = 'assistant_provider_disabled';
      throw error;
    },
  });
}
