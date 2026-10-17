import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadProject } from './download';
import type { ProjectExport } from './api';

beforeEach(() => {
  // FileReader usa setImmediate no jsdom; apenas a libertação do URL precisa de relógio simulado.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:export-test');
    static revokeObjectURL = vi.fn();
  });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const data: ProjectExport = {
  format_version: 1,
  project: {
    id: 42, title: 'Oficina — tradução', instructions: 'Traduz.', source_language: 'en', target_language: 'pt-PT',
    segments: [{ id: 7, position: 1, source_text: 'Original', target_text: '  «Tradução» 📝\n"aspas"\t\\\r\n ', status: 'completed', revision: 3 }],
  },
};

describe('ficheiro JSON para download', () => {
  it('preserva o documento e os caracteres, usa o nome certo e liberta os recursos', async () => {
    let clicked: HTMLAnchorElement | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked = this;
      expect(this.isConnected).toBe(true);
    });
    downloadProject(data);
    expect(clicked?.download).toBe('exercicio-42.json');
    expect(clicked?.href).toBe('blob:export-test');
    expect(clicked?.isConnected).toBe(false);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/json;charset=utf-8');
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    expect(JSON.parse(text)).toEqual(data);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:export-test');
  });

  it('remove o link e liberta o URL mesmo se iniciar o download falhar', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('Download failed'); });
    expect(() => downloadProject(data)).toThrow('Download failed');
    expect(document.querySelector('a[download]')).toBeNull();
    vi.runOnlyPendingTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:export-test');
  });
});
