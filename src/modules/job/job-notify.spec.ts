import {
  finishMessage,
  finishNotice,
  formatRunDuration,
  JobFinishInput,
  normalizeJobNotify,
  notifiesStart,
  ownerText,
  startedMessage,
} from './job-notify';

describe('job notify levels', () => {
  it('reads unknown or missing levels as failure', () => {
    expect(normalizeJobNotify(undefined)).toBe('failure');
    expect(normalizeJobNotify('loud')).toBe('failure');
    expect(normalizeJobNotify('finish')).toBe('finish');
  });

  it('only `all` announces the start', () => {
    expect(notifiesStart('all')).toBe(true);
    expect(notifiesStart('finish')).toBe(false);
    expect(notifiesStart('failure')).toBe(false);
    expect(notifiesStart(undefined)).toBe(false);
  });

  it('failures and timeouts notify at every level', () => {
    for (const level of ['failure', 'finish', 'all', undefined]) {
      expect(finishNotice(level, 'failed', null)).toBe('failure');
      expect(finishNotice(level, 'timeout', 'success')).toBe('failure');
      expect(finishNotice(level, 'failed', 'failed')).toBe('failure');
    }
  });

  it('a success notifies only from `finish` on', () => {
    expect(finishNotice('failure', 'success', null)).toBeNull();
    expect(finishNotice('failure', 'success', 'success')).toBeNull();
    expect(finishNotice('finish', 'success', 'success')).toBe('success');
    expect(finishNotice('all', 'success', null)).toBe('success');
  });

  it('a success after a failed or timed-out run is one recovered message at every level', () => {
    for (const level of ['failure', 'finish', 'all']) {
      expect(finishNotice(level, 'success', 'failed')).toBe('recovered');
      expect(finishNotice(level, 'success', 'timeout')).toBe('recovered');
    }
  });

  it('a run still marked running never notifies', () => {
    expect(finishNotice('all', 'running', null)).toBeNull();
  });
});

describe('job messages', () => {
  const base: JobFinishInput = {
    job: {
      id: 'j1',
      name: 'nightly',
      command: 'php artisan schedule:run',
      applicationId: null,
      databaseId: null,
      composeAppId: 'c1',
    },
    owner: {
      kind: 'compose',
      name: 'shop',
      service: 'worker',
      project: 'Store',
    },
    trigger: 'scheduled',
    runId: 'r1',
    url: 'https://panel/compose/c1',
    status: 'failed',
    exitCode: 2,
    durationSeconds: 75.4,
    output: 'line1\nERROR boom',
  };

  it('formats durations and owners', () => {
    expect(formatRunDuration(4.6)).toBe('5s');
    expect(formatRunDuration(200)).toBe('3m 20s');
    expect(formatRunDuration(120)).toBe('2m');
    expect(formatRunDuration(7500)).toBe('2h 5m');
    expect(ownerText(base.owner)).toBe('shop (worker)');
    expect(
      ownerText({
        kind: 'application',
        name: 'web',
        service: null,
        project: null,
      }),
    ).toBe('web');
    expect(ownerText({ ...base.owner, name: null })).toBeNull();
  });

  it('started: info level, no output, params and ids for the inbox', () => {
    const { event, message } = startedMessage(base);
    expect(event).toBe('jobStarted');
    expect(message.level).toBe('info');
    expect(message.fields.map(([k]) => k)).not.toContain('Output');
    expect(message.fields).toContainEqual(['Stack', 'shop (worker)']);
    expect(message.params).toEqual({
      job: 'nightly',
      owner: 'shop (worker)',
      ownerKind: 'compose',
      project: 'Store',
      trigger: 'scheduled',
    });
    expect(message.data).toMatchObject({
      event: 'job.started',
      composeAppId: 'c1',
      jobId: 'j1',
    });
    expect(message.url).toBe('https://panel/compose/c1');
  });

  it('failure carries the output tail in the channel fields only', () => {
    const { event, message } = finishMessage('failure', base);
    expect(event).toBe('jobFailure');
    expect(message.title).toBe('Job failed: nightly');
    expect(message.level).toBe('failure');
    expect(message.fields).toContainEqual(['Output', 'line1\nERROR boom']);
    expect(message.channelOnlyFields).toEqual(['Output']);
    expect(message.fields).toContainEqual(['Duration', '1m 15s']);
    expect(message.fields).toContainEqual(['Exit code', '2']);
    expect(message.params).toEqual({
      variant: 'failure',
      job: 'nightly',
      owner: 'shop (worker)',
      ownerKind: 'compose',
      project: 'Store',
      trigger: 'scheduled',
      status: 'failed',
      durationSeconds: 75,
      exitCode: 2,
    });
    expect(JSON.stringify(message.params)).not.toContain('boom');
    expect(message.data).toMatchObject({ event: 'job.failure' });
  });

  it('timeout title', () => {
    expect(
      finishMessage('failure', { ...base, status: 'timeout' }).message.title,
    ).toBe('Job timed out: nightly');
  });

  it('success and recovered never carry output', () => {
    const ok = { ...base, status: 'success' as const, exitCode: 0 };
    const success = finishMessage('success', ok);
    expect(success.event).toBe('jobSuccess');
    expect(success.message.level).toBe('success');
    expect(success.message.params).not.toHaveProperty('variant');
    expect(success.message.data).toMatchObject({ event: 'job.success' });
    const recovered = finishMessage('recovered', ok);
    expect(recovered.event).toBe('jobFailure');
    expect(recovered.message.level).toBe('success');
    expect(recovered.message.params).toMatchObject({ variant: 'recovered' });
    expect(recovered.message.data).toMatchObject({ event: 'job.recovered' });
    for (const m of [success.message, recovered.message]) {
      expect(m.fields.map(([k]) => k)).not.toContain('Output');
      expect(JSON.stringify(m)).not.toContain('boom');
    }
  });

  it('omits the exit code when there is none (the run never started)', () => {
    const { message } = finishMessage('failure', { ...base, exitCode: null });
    expect(message.fields.map(([k]) => k)).not.toContain('Exit code');
    expect(message.params).toMatchObject({ exitCode: null });
  });
});
