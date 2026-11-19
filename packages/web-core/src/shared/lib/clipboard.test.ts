import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeClipboardText } from './clipboard';

const link = 'http://example.test/invitations/example/accept';

afterEach(() => vi.unstubAllGlobals());

describe('writeClipboardText', () => {
  it('uses the modern clipboard when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const selectFallback = vi.fn();
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(writeClipboardText(link, selectFallback)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith(link);
    expect(selectFallback).not.toHaveBeenCalled();
  });

  it('copies the selection in the same click handler when HTTP has no clipboard API', async () => {
    const selectFallback = vi.fn();
    const execCommand = vi.fn(() => {
      expect(selectFallback).toHaveBeenCalledOnce();
      return true;
    });
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', { execCommand });

    const result = writeClipboardText(link, selectFallback);
    expect(execCommand).toHaveBeenCalledWith('copy');
    await expect(result).resolves.toBe(true);
  });

  it('reports failure when the browser blocks both clipboard methods', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Permission denied'));
    const selectFallback = vi.fn();
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('document', { execCommand: vi.fn().mockReturnValue(false) });

    await expect(writeClipboardText(link, selectFallback)).resolves.toBe(false);
    expect(selectFallback).toHaveBeenCalledOnce();
  });
});
