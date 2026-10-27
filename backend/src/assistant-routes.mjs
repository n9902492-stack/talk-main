export function mountAssistantRoutes({ app, assistant, meetingSession, assistantWrite, safeAsync }) {
  if (!assistant) return;
  const read = handler => safeAsync(async (req, res) => {
    const session = await meetingSession(req, res); if (session) await handler(req, res, session);
  });
  app.get('/api/auth/meetings/:meetingId/ai-eligibility', read(async (req, res, session) => {
    const query = req.query.recordingId;
    const recordingIds = query === undefined ? undefined : Array.isArray(query) ? query : [query];
    res.json(await assistant.eligibility(req.params.meetingId, session, { recordingIds }));
  }));
  app.get('/api/auth/recordings/:recordingId/ai-consent', read(async (req, res, session) => res.json(await assistant.consentState(req.params.recordingId, session))));
  app.post('/api/auth/recordings/:recordingId/ai-consent', ...assistantWrite(async (req, res, session) => res.json(await assistant.consent(req.params.recordingId, session, req.body))));
  app.get('/api/auth/meetings/:meetingId/ai-reports', read(async (req, res, session) => res.json(await assistant.list(req.params.meetingId, session))));
  app.post('/api/auth/meetings/:meetingId/ai-reports', ...assistantWrite(async (req, res, session) => res.status(201).json(await assistant.create(req.params.meetingId, session, req.body))));
  app.get('/api/auth/ai-reports/:reportId', read(async (req, res, session) => res.json(await assistant.get(req.params.reportId, session))));
  app.post('/api/auth/ai-reports/:reportId/revisions', ...assistantWrite(async (req, res, session) => res.json(await assistant.edit(req.params.reportId, session, req.body))));
  app.post('/api/auth/ai-reports/:reportId/generate', ...assistantWrite(async (req, res, session) => res.status(202).json(await assistant.generate(req.params.reportId, session, req.body))));
  app.post('/api/auth/ai-reports/:reportId/retry', ...assistantWrite(async (req, res, session) => res.status(202).json(await assistant.retry(req.params.reportId, session, req.body))));
  app.post('/api/auth/ai-reports/:reportId/approve', ...assistantWrite(async (req, res, session) => res.json(await assistant.approve(req.params.reportId, session, req.body))));
  app.post('/api/auth/ai-reports/:reportId/cancel', ...assistantWrite(async (req, res, session) => res.json(await assistant.cancel(req.params.reportId, session))));
  app.post('/api/auth/ai-reports/:reportId/delete', ...assistantWrite(async (req, res, session) => res.json(await assistant.remove(req.params.reportId, session))));
}
