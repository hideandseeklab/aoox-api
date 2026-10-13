import {
  slugifySetName,
  uniqueSetName,
  uniqueSetSlug,
} from './variable-set-names';
import { VARIABLE_SET_SLUG } from './variable-set.entity';

describe('variable set names', () => {
  it('slugifies names into valid slugs', () => {
    expect(slugifySetName('My Shop API')).toBe('my-shop-api');
    expect(slugifySetName('  Café / Ünïcode!! ')).toBe('cafe-unicode');
    expect(slugifySetName('***')).toBe('set');
    const long = slugifySetName('a-'.repeat(80));
    expect(long.length).toBeLessThanOrEqual(64);
    for (const s of ['my-shop-api', 'cafe-unicode', 'set', long]) {
      expect(VARIABLE_SET_SLUG.test(s)).toBe(true);
    }
  });

  it('deduplicates names case-insensitively with a (n) suffix', () => {
    expect(uniqueSetName('Shop', [])).toBe('Shop');
    expect(uniqueSetName('Shop', ['shop'])).toBe('Shop (2)');
    expect(uniqueSetName('Shop', ['Shop', 'Shop (2)'])).toBe('Shop (3)');
    expect(uniqueSetName('x'.repeat(100), ['x'.repeat(100)])).toHaveLength(100);
  });

  it('deduplicates slugs with a -n suffix', () => {
    expect(uniqueSetSlug('shop', [])).toBe('shop');
    expect(uniqueSetSlug('shop', ['shop', 'shop-2'])).toBe('shop-3');
    expect(uniqueSetSlug('a'.repeat(64), ['a'.repeat(64)])).toHaveLength(64);
  });
});
