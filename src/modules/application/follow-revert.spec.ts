import { revertFollowedTag } from './follow-revert';

describe('revertFollowedTag', () => {
  const revert = {
    followedRef: 'r/img:1.2.0',
    previousRef: 'r/img:1.1.0',
    previousDigest: 'sha256:old',
  };

  it('puts the previous reference and digest back, only while imageRef is still the followed one', async () => {
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    await expect(revertFollowedTag({ update }, 'a1', revert)).resolves.toBe(
      true,
    );
    expect(update).toHaveBeenCalledWith(
      { id: 'a1', imageRef: 'r/img:1.2.0' },
      { imageRef: 'r/img:1.1.0', imageDigest: 'sha256:old' },
    );
  });

  it('does nothing when the user changed imageRef meanwhile (no row matches)', async () => {
    const update = jest.fn().mockResolvedValue({ affected: 0 });
    await expect(revertFollowedTag({ update }, 'a1', revert)).resolves.toBe(
      false,
    );
  });

  it('never writes autoUpdateLastTag', async () => {
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    await revertFollowedTag({ update }, 'a1', revert);
    expect(Object.keys((update.mock.calls[0] as [unknown, object])[1])).toEqual(
      ['imageRef', 'imageDigest'],
    );
  });
});
