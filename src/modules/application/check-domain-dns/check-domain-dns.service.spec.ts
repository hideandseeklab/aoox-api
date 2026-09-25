import { CheckDomainDnsService } from './check-domain-dns.service';

describe('CheckDomainDnsService.evaluate', () => {
  it('is ok when any record matches the expected IP', () => {
    expect(
      CheckDomainDnsService.evaluate(['1.1.1.1', '203.0.113.7'], '203.0.113.7'),
    ).toBe('ok');
  });

  it('is a mismatch when records exist but none match', () => {
    expect(CheckDomainDnsService.evaluate(['1.1.1.1'], '203.0.113.7')).toBe(
      'mismatch',
    );
  });

  it('is unresolved without records, regardless of expectation', () => {
    expect(CheckDomainDnsService.evaluate([], '203.0.113.7')).toBe(
      'unresolved',
    );
    expect(CheckDomainDnsService.evaluate([], null)).toBe('unresolved');
  });

  it('is unknown when the expected IP could not be determined', () => {
    expect(CheckDomainDnsService.evaluate(['1.1.1.1'], null)).toBe('unknown');
  });
});

describe('CheckDomainDnsService.describe', () => {
  it('mentions the CNAME hop when present', () => {
    expect(
      CheckDomainDnsService.describe(
        'mismatch',
        { addresses: ['1.1.1.1'], cname: 'edge.example.net' },
        '203.0.113.7',
      ),
    ).toBe(
      'Resolves to 1.1.1.1 (CNAME → edge.example.net), expected 203.0.113.7',
    );
  });
});
