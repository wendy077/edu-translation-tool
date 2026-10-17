import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { ApiError, getProject, getProjectExport, saveSegment, statusForText } from './api';
import type { Project, SavedSegment, SegmentStatus } from './api';
import { downloadProject } from './download';

vi.mock('./api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./api')>(),
  getProject: vi.fn(), getProjectExport: vi.fn(), saveSegment: vi.fn(),
}));
vi.mock('./download', () => ({ downloadProject: vi.fn() }));

function project(text = '', revision = 0, status: SegmentStatus = statusForText(text)): Project {
  return {
    id: 1, title: 'Oficina', instructions: 'Traduz.', source_language: 'en', target_language: 'pt-PT',
    segments: [
      { id: 1, position: 1, source_text: 'Original 1', target_text: text, status, revision },
      { id: 2, position: 2, source_text: 'Original 2', target_text: '', status: 'untranslated', revision: 0 },
    ],
  };
}

function saved(text: string, revision: number, status: SegmentStatus = statusForText(text)): SavedSegment {
  return { id: 1, target_text: text, status, revision, saved_at: '2026-10-17T10:00:00Z' };
}

async function open() {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<StrictMode><App /></StrictMode>); });
  expect(screen.getByLabelText('A tua tradução')).toBeVisible();
  return view;
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

async function click(name: string) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
}

function edit(text: string) {
  fireEvent.change(screen.getByLabelText('A tua tradução'), { target: { value: text } });
}

function chooseStatus(status: SegmentStatus) {
  fireEvent.change(screen.getByLabelText('Estado do segmento'), { target: { value: status } });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-10-17T10:00:00Z'));
  vi.mocked(getProject).mockReset().mockResolvedValue(project());
  vi.mocked(saveSegment).mockReset().mockImplementation(async (_projectId, segmentId, text, base, status) => (
    { ...saved(text, base + 1, status), id: segmentId }
  ));
  vi.mocked(getProjectExport).mockReset().mockResolvedValue({ format_version: 1, project: project() });
  vi.mocked(downloadProject).mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('gravação automática', () => {
  it('não grava ao carregar; espera um segundo após a última edição de texto ou estado', async () => {
    await open();
    await advance(5000);
    expect(saveSegment).not.toHaveBeenCalled();
    edit('Primeiro rascunho');
    await advance(700);
    const text = '  «Tradução» 📝\nSegunda linha\t ';
    edit(text);
    await advance(700);
    chooseStatus('completed');
    await advance(999);
    expect(saveSegment).not.toHaveBeenCalled();
    await advance(1);
    expect(saveSegment).toHaveBeenCalledExactlyOnceWith(1, 1, text, 0, 'completed');
    expect(screen.getByRole('status')).toHaveTextContent('Guardado');
    expect(screen.getByLabelText('A tua tradução')).toHaveValue(text);
    await advance(10_000);
    expect(saveSegment).toHaveBeenCalledTimes(1);
  });

  it('grava uma alteração só de estado e cancela alterações desfeitas antes do prazo', async () => {
    vi.mocked(getProject).mockResolvedValue(project('Tradução', 1));
    await open();
    chooseStatus('completed');
    await advance(1000);
    expect(saveSegment).toHaveBeenCalledExactlyOnceWith(1, 1, 'Tradução', 1, 'completed');
    chooseStatus('in_review');
    await advance(500);
    chooseStatus('completed');
    await advance(5000);
    expect(saveSegment).toHaveBeenCalledTimes(1);
  });

  it('Guardar antecipa o temporizador sem duplicar pedidos', async () => {
    await open();
    edit('Guardar já');
    await advance(700);
    await click('Guardar');
    expect(saveSegment).toHaveBeenCalledTimes(1);
    await advance(5000);
    expect(saveSegment).toHaveBeenCalledTimes(1);
  });

  it('aguarda a resposta atrasada e envia apenas o rascunho mais recente com a revisão confirmada', async () => {
    let finish!: (value: SavedSegment) => void;
    vi.mocked(saveSegment).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await open();
    edit('Primeira');
    await advance(1000);
    expect(screen.getByRole('status')).toHaveTextContent('A guardar');
    edit('Intermédia');
    await advance(500);
    edit('Mais recente');
    chooseStatus('completed');
    await advance(5000);
    expect(saveSegment).toHaveBeenCalledTimes(1);
    await act(async () => finish(saved('Primeira', 1)));
    expect(screen.getByRole('status')).toHaveTextContent('Alterações por guardar');
    expect(screen.getByLabelText('A tua tradução')).toHaveValue('Mais recente');
    await advance(0);
    expect(saveSegment).toHaveBeenLastCalledWith(1, 1, 'Mais recente', 1, 'completed');
    expect(saveSegment).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent('Guardado');
  });

  it('espera o tempo restante da última edição quando a resposta chega depressa', async () => {
    let finish!: (value: SavedSegment) => void;
    vi.mocked(saveSegment).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await open();
    edit('Primeira');
    await advance(1000);
    edit('Segunda');
    await advance(400);
    await act(async () => finish(saved('Primeira', 1)));
    await advance(599);
    expect(saveSegment).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(saveSegment).toHaveBeenLastCalledWith(1, 1, 'Segunda', 1, 'in_review');
  });

  it('pausa após erro, mantém edições posteriores e retoma após gravação manual confirmada', async () => {
    vi.mocked(saveSegment).mockRejectedValueOnce(new ApiError(500, 'Falha ao guardar.'));
    await open();
    edit('Rascunho');
    await advance(1000);
    expect(screen.getByRole('status')).toHaveTextContent('Erro ao guardar');
    edit('Trabalho mais recente');
    await advance(60_000);
    expect(saveSegment).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Gravação automática em pausa/)).toBeVisible();
    expect(screen.getByLabelText('A tua tradução')).toHaveValue('Trabalho mais recente');
    await click('Guardar');
    expect(saveSegment).toHaveBeenLastCalledWith(1, 1, 'Trabalho mais recente', 0, 'in_review');
    edit('Edição seguinte');
    await advance(1000);
    expect(saveSegment).toHaveBeenLastCalledWith(1, 1, 'Edição seguinte', 1, 'in_review');
    expect(saveSegment).toHaveBeenCalledTimes(3);
  });

  it('confirma uma resposta perdida sem reenviar a revisão e continua com as edições seguintes', async () => {
    vi.mocked(saveSegment).mockRejectedValueOnce(new TypeError('Network error'));
    await open();
    vi.mocked(getProject).mockResolvedValueOnce(project('Texto enviado', 1));
    edit('Texto enviado');
    await advance(1000);
    expect(screen.getByRole('status')).toHaveTextContent('Guardado');
    expect(saveSegment).toHaveBeenCalledTimes(1);
    edit('Nova tradução');
    await advance(1000);
    expect(saveSegment).toHaveBeenLastCalledWith(1, 1, 'Nova tradução', 1, 'in_review');
  });

  it('uma gravação incerta exige verificação antes de enviar texto novo', async () => {
    await open();
    vi.mocked(saveSegment).mockRejectedValueOnce(new TypeError('Network error'));
    vi.mocked(getProject).mockRejectedValueOnce(new TypeError('Offline'));
    edit('Enviado');
    await advance(1000);
    expect(screen.getByRole('status')).toHaveTextContent('Gravação por confirmar');
    edit('Novo rascunho');
    await advance(60_000);
    expect(saveSegment).toHaveBeenCalledTimes(1);
    vi.mocked(getProject).mockResolvedValueOnce(project('Enviado', 1));
    await click('Verificar gravação');
    await advance(0);
    expect(saveSegment).toHaveBeenLastCalledWith(1, 1, 'Novo rascunho', 1, 'in_review');
  });

  it.each([false, true])('não sobrescreve conflitos automaticamente (usar versão guardada: %s)', async (useSaved) => {
    await open();
    vi.mocked(saveSegment).mockRejectedValueOnce(new ApiError(409, 'Conflito.'));
    vi.mocked(getProject).mockResolvedValueOnce(project('Outra aba', 1, 'completed'));
    edit('O meu rascunho');
    await advance(1000);
    await advance(60_000);
    expect(saveSegment).toHaveBeenCalledTimes(1);
    await click(useSaved ? 'Usar versão guardada' : 'Manter o meu rascunho');
    await advance(60_000);
    expect(saveSegment).toHaveBeenCalledTimes(1);
    if (useSaved) {
      expect(screen.getByLabelText('A tua tradução')).toHaveValue('Outra aba');
      edit('Revisão posterior');
      await advance(1000);
      expect(saveSegment).toHaveBeenLastCalledWith(1, 1, 'Revisão posterior', 1, 'in_review');
    } else {
      edit('Rascunho revisto');
      await advance(5000);
      expect(saveSegment).toHaveBeenCalledTimes(1);
      await click('Guardar');
      expect(saveSegment).toHaveBeenLastCalledWith(1, 1, 'Rascunho revisto', 1, 'in_review');
    }
  });

  it.each(['Continuar a editar', 'Descartar alterações', 'Guardar e mudar'])('suspende o temporizador no diálogo de navegação: %s', async (choice) => {
    await open();
    edit('Rascunho');
    await advance(500);
    await click('Segmento 2');
    await advance(5000);
    expect(saveSegment).not.toHaveBeenCalled();
    await click(choice);
    await advance(0);
    if (choice === 'Descartar alterações') {
      await advance(5000);
      expect(saveSegment).not.toHaveBeenCalled();
      edit('Segundo segmento');
      await advance(1000);
      expect(saveSegment).toHaveBeenCalledExactlyOnceWith(1, 2, 'Segundo segmento', 0, 'in_review');
    } else {
      expect(saveSegment).toHaveBeenCalledExactlyOnceWith(1, 1, 'Rascunho', 0, 'in_review');
      expect(screen.getByRole('region', { name: `Editor do segmento ${choice === 'Guardar e mudar' ? 2 : 1}` })).toBeVisible();
    }
  });

  it('um aviso de exportação não adia a gravação nem exporta texto pendente', async () => {
    await open();
    edit('Tradução');
    await advance(700);
    await click('Exportar exercício');
    expect(getProjectExport).not.toHaveBeenCalled();
    await advance(299);
    expect(saveSegment).not.toHaveBeenCalled();
    await advance(1);
    expect(saveSegment).toHaveBeenCalledTimes(1);
    await click('Exportar exercício');
    expect(downloadProject).toHaveBeenCalledTimes(1);
    await advance(5000);
    expect(saveSegment).toHaveBeenCalledTimes(1);
  });

  it('cancela o temporizador ao desmontar e avisa antes de sair com texto pendente', async () => {
    const view = await open();
    edit('Rascunho');
    const pending = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(pending);
    expect(pending.defaultPrevented).toBe(true);
    view.unmount();
    await advance(5000);
    expect(saveSegment).not.toHaveBeenCalled();
  });
});
