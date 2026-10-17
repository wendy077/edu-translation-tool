import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { ApiError, getProject, saveSegment } from './api';
import type { Project } from './api';

vi.mock('./api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./api')>(),
  getProject: vi.fn(), saveSegment: vi.fn(),
}));

function project(text = '', revision = 0): Project {
  return {
    id: 1, title: 'Oficina de tradução', instructions: 'Traduz as informações para os participantes.',
    source_language: 'en', target_language: 'pt-PT',
    segments: [
      { id: 1, position: 1, source_text: 'The workshop starts at 10:30.', target_text: text, revision },
      { id: 2, position: 2, source_text: 'Bring a notebook.', target_text: '', revision: 0 },
      { id: 3, position: 3, source_text: 'The session lasts 45 minutes.', target_text: '', revision: 0 },
    ],
  };
}

const saved = (text: string, revision = 1) => ({ id: 1, target_text: text, revision, saved_at: '2026-10-20T10:00:00Z' });

async function open() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByLabelText('A tua tradução');
  return user;
}

function edit(text: string) {
  fireEvent.change(screen.getByLabelText('A tua tradução'), { target: { value: text } });
}

beforeEach(() => {
  vi.mocked(getProject).mockReset().mockResolvedValue(project());
  vi.mocked(saveSegment).mockReset().mockImplementation(async (_project, _segment, text, base) => saved(text, base + 1));
});

describe('editor com gravação manual', () => {
  it('carrega três segmentos e preserva espaços, Unicode e quebras de linha ao guardar', async () => {
    const user = await open();
    expect(screen.getAllByRole('button', { name: /^Segmento \d$/ })).toHaveLength(3);
    const text = '  A oficina começa às 10:30.\n«Tradução» 📝\t ';
    edit(text);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(saveSegment).toHaveBeenCalledWith(1, 1, text, 0);
    expect(screen.getByRole('status')).toHaveTextContent('Guardado');
    expect(screen.getByLabelText('A tua tradução')).toHaveValue(text);
  });

  it('uma resposta atrasada não marca o texto novo como guardado nem duplica pedidos', async () => {
    let finish!: (value: ReturnType<typeof saved>) => void;
    vi.mocked(saveSegment).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const user = await open();
    edit('Primeira versão');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByRole('button', { name: 'A guardar…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Segmento 2' })).toBeDisabled();
    edit('Versão mais recente ainda local');
    await act(async () => finish(saved('Primeira versão')));
    expect(screen.getByLabelText('A tua tradução')).toHaveValue('Versão mais recente ainda local');
    expect(screen.getByRole('status')).toHaveTextContent('Alterações por guardar');
    expect(saveSegment).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(saveSegment).toHaveBeenLastCalledWith(1, 1, 'Versão mais recente ainda local', 1);
  });

  it('mantém o rascunho após falha de persistência e permite tentar novamente', async () => {
    vi.mocked(saveSegment).mockRejectedValueOnce(new ApiError(500, 'Não foi possível guardar a tradução.'));
    const user = await open();
    edit('O meu trabalho');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('O teu rascunho continua aqui');
    expect(screen.getByLabelText('A tua tradução')).toHaveValue('O meu trabalho');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByRole('status')).toHaveTextContent('Guardado');
  });

  it('permite cancelar ou descartar antes de mudar de segmento', async () => {
    const user = await open();
    edit('Rascunho');
    await user.click(screen.getByRole('button', { name: 'Segmento 2' }));
    expect(screen.getByRole('dialog')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Continuar a editar' }));
    expect(screen.getByLabelText('A tua tradução')).toHaveValue('Rascunho');
    await user.click(screen.getByRole('button', { name: 'Segmento 2' }));
    await user.click(screen.getByRole('button', { name: 'Descartar alterações' }));
    expect(screen.getByRole('region', { name: 'Editor do segmento 2' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Segmento 1' }));
    expect(screen.getByLabelText('A tua tradução')).toHaveValue('');
    expect(saveSegment).not.toHaveBeenCalled();
  });

  it('só muda de segmento depois de guardar com sucesso', async () => {
    vi.mocked(saveSegment).mockRejectedValueOnce(new ApiError(500, 'Falha de gravação.'));
    const user = await open();
    edit('Texto a preservar');
    await user.click(screen.getByRole('button', { name: 'Segmento 2' }));
    await user.click(screen.getByRole('button', { name: 'Guardar e mudar' }));
    expect(screen.getByRole('region', { name: 'Editor do segmento 1' })).toBeVisible();
    expect(screen.getByLabelText('A tua tradução')).toHaveValue('Texto a preservar');
    await user.click(screen.getByRole('button', { name: 'Segmento 2' }));
    await user.click(screen.getByRole('button', { name: 'Guardar e mudar' }));
    expect(screen.getByRole('region', { name: 'Editor do segmento 2' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Segmento 1' }));
    expect(screen.getByLabelText('A tua tradução')).toHaveValue('Texto a preservar');
  });

  it('mostra conflito sem sobrescrever e só usa a revisão nova após escolha explícita', async () => {
    const user = await open();
    vi.mocked(saveSegment).mockRejectedValueOnce(new ApiError(409, 'Existe uma revisão mais recente.'));
    vi.mocked(getProject).mockResolvedValueOnce(project('Texto de outra janela', 1));
    edit('O meu rascunho');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Texto de outra janela');
    expect(screen.getByLabelText('A tua tradução')).toHaveValue('O meu rascunho');
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Manter o meu rascunho' }));
    expect(saveSegment).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(saveSegment).toHaveBeenLastCalledWith(1, 1, 'O meu rascunho', 1);
  });

  it('permite usar a versão guardada após comparar um conflito', async () => {
    const user = await open();
    vi.mocked(saveSegment).mockRejectedValueOnce(new ApiError(409, 'Conflito.'));
    vi.mocked(getProject).mockResolvedValueOnce(project('Outra versão', 2));
    edit('Rascunho');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await user.click(screen.getByRole('button', { name: 'Usar versão guardada' }));
    expect(screen.getByLabelText('A tua tradução')).toHaveValue('Outra versão');
    expect(screen.getByRole('status')).toHaveTextContent('Guardado');
    expect(saveSegment).toHaveBeenCalledTimes(1);
  });

  it('confirma uma gravação cuja resposta se perdeu sem reenviar o PUT', async () => {
    const user = await open();
    vi.mocked(saveSegment).mockRejectedValueOnce(new TypeError('Network error'));
    vi.mocked(getProject).mockResolvedValueOnce(project('Texto enviado', 1));
    edit('Texto enviado');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByRole('status')).toHaveTextContent('Guardado');
    expect(saveSegment).toHaveBeenCalledTimes(1);
    edit('Nova versão');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(saveSegment).toHaveBeenLastCalledWith(1, 1, 'Nova versão', 1);
  });

  it('bloqueia reenvio incerto até conseguir confirmar o estado na API', async () => {
    const user = await open();
    vi.mocked(saveSegment).mockRejectedValueOnce(new TypeError('Network error'));
    vi.mocked(getProject).mockRejectedValueOnce(new TypeError('Still offline'));
    edit('Trabalho local');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByRole('status')).toHaveTextContent('Gravação por confirmar');
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Segmento 2' })).toBeDisabled();
    vi.mocked(getProject).mockResolvedValueOnce(project('Trabalho local', 1));
    await user.click(screen.getByRole('button', { name: 'Verificar gravação' }));
    expect(screen.getByRole('status')).toHaveTextContent('Guardado');
    expect(saveSegment).toHaveBeenCalledTimes(1);
  });

  it('permite recuperar de uma falha no carregamento inicial', async () => {
    vi.mocked(getProject).mockRejectedValueOnce(new TypeError('Offline'));
    render(<App />);
    const retry = await screen.findByRole('button', { name: 'Tentar novamente' });
    await userEvent.click(retry);
    expect(await screen.findByLabelText('A tua tradução')).toHaveValue('');
  });

  it('avisa ao sair com alterações e remove o aviso depois de guardar', async () => {
    const user = await open();
    edit('Alterações');
    const pending = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(pending);
    expect(pending.defaultPrevented).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Guardado'));
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
  });
});
