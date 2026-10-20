import { builtRepositoriesFor, slugPart } from './built-repositories';

describe('builtRepositoriesFor', () => {
  it('names the deployment and preview repositories like the runner', () => {
    expect(
      builtRepositoriesFor('My Project!', {
        appName: 'web-1',
        sourceType: 'git',
      }),
    ).toEqual(['my-project/web-1', 'my-project/web-1-preview']);
  });

  it('returns nothing for an image-source application', () => {
    expect(
      builtRepositoriesFor('p', { appName: 'demo', sourceType: 'image' }),
    ).toEqual([]);
  });

  it('slugPart falls back and truncates', () => {
    expect(slugPart('!!!')).toBe('project');
    expect(slugPart('a'.repeat(60))).toHaveLength(40);
  });
});
