import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { ApiError, getProject, getProjectExport, saveSegment, statusForText } from './api';
import type { Project, ProjectExport, SegmentStatus } from './api';
import { downloadProject } from './download';

vi.mock('./api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./api')>(),
  getProject: vi.fn(), getProjectExport: vi.fn(), saveSegment: vi.fn(),
}));

vi.mock('./download', () => ({ downloadProject: vi.fn() }));

function project(text = '', revision = 0, status: SegmentStatus = statusForText(text)): Project {
  return {
    id: 1, title: 'Oficina de tradução', instructions: 'Traduz as informações para os participantes.',
    source_language: 'en', target_language: 'pt-PT',
    segments: [
      { id: 1, position: 1, source_text: 'The workshop starts at 10:30.', target_text: text, status, revision },
      { id: 2, position: 2, source_text: 'Bring a notebook.', target_text: '', status: 'untranslated', revision: 0 },
      { id: 3, position: 3, source_text: 'The session lasts 45 minutes.', target_text: '', status: 'untranslated', revision: 0 },
    ],
  };
}

const saved = (text: string, revision = 1, status: SegmentStatus = statusForText(text)) => (
  { id: 1, target_text: text, status, revision, saved_at: '2026-10-20T10:00:00Z' }
);

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
  vi.mocked(saveSegment).mockReset().mockImplementation(async (_project, _segment, text, base, status) => saved(text, base + 1, status));
  vi.mocked(getProjectExport).mockReset().mockResolvedValue({ format_version: 1, project: project() });
  vi.mocked(downloadProject).mockReset();
});

describe('editor com gravação manual', () => {
  it('carrega três segmentos e preserva espaços, Unicode e quebras de linha ao guardar', async () => {
    const user = await open();
    expect(screen.getAllByRole('button', { name: /^Segmento \d$/ })).toHaveLength(3);
    const text = '  A oficina começa às 10:30.\n«Tradução» 📝\t ';
    edit(text);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(saveSegment).toHaveBeenCalledWith(1, 1, text, 0, 'in_review');
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
    expect(saveSegment).toHaveBeenLastCalledWith(1, 1, 'Versão mais recente ainda local', 1, 'in_review');
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
    expect(saveSegment).toHaveBeenLastCalledWith(1, 1, 'O meu rascunho', 1, 'in_review');
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
    expect(saveSegment).toHaveBeenLastCalledWith(1, 1, 'Nova versão', 1, 'in_review');
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

  it('permite guardar só o estado, reabrir e recuperar o estado guardado ao navegar', async () => {
    vi.mocked(getProject).mockResolvedValue(project('Tradução', 1));
    const user = await open();
    await user.selectOptions(screen.getByLabelText('Estado do segmento'), 'completed');
    expect(screen.getByRole('status')).toHaveTextContent('Alterações por guardar');
    const pending = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(pending);
    expect(pending.defaultPrevented).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(saveSegment).toHaveBeenLastCalledWith(1, 1, 'Tradução', 1, 'completed');
    expect(screen.getByRole('button', { name: 'Segmento 1' })).toHaveTextContent('Concluído');
    await user.click(screen.getByRole('button', { name: 'Segmento 2' }));
    await user.click(screen.getByRole('button', { name: 'Segmento 1' }));
    expect(screen.getByLabelText('Estado do segmento')).toHaveValue('completed');
    await user.selectOptions(screen.getByLabelText('Estado do segmento'), 'in_review');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(saveSegment).toHaveBeenLastCalledWith(1, 1, 'Tradução', 2, 'in_review');
  });

  it('reabre um segmento concluído ao editar e não permite concluir texto vazio', async () => {
    vi.mocked(getProject).mockResolvedValue(project('Tradução', 2, 'completed'));
    await open();
    expect(screen.getByLabelText('Estado do segmento')).toHaveValue('completed');
    edit('Tradução revista');
    expect(screen.getByLabelText('Estado do segmento')).toHaveValue('in_review');
    edit(' \t\n ');
    expect(screen.getByLabelText('Estado do segmento')).toHaveValue('untranslated');
    expect(screen.getByRole('option', { name: 'Concluído' })).toBeDisabled();
    expect(screen.getByLabelText('A tua tradução')).toHaveValue(' \t\n ');
  });

  it('protege alterações só de estado ao cancelar, descartar e guardar antes de navegar', async () => {
    vi.mocked(getProject).mockResolvedValue(project('Tradução', 1));
    const user = await open();
    await user.selectOptions(screen.getByLabelText('Estado do segmento'), 'completed');
    await user.click(screen.getByRole('button', { name: 'Segmento 2' }));
    await user.click(screen.getByRole('button', { name: 'Continuar a editar' }));
    expect(screen.getByLabelText('Estado do segmento')).toHaveValue('completed');
    await user.click(screen.getByRole('button', { name: 'Segmento 2' }));
    await user.click(screen.getByRole('button', { name: 'Descartar alterações' }));
    await user.click(screen.getByRole('button', { name: 'Segmento 1' }));
    expect(screen.getByLabelText('Estado do segmento')).toHaveValue('in_review');
    expect(saveSegment).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText('Estado do segmento'), 'completed');
    await user.click(screen.getByRole('button', { name: 'Segmento 2' }));
    await user.click(screen.getByRole('button', { name: 'Guardar e mudar' }));
    await user.click(screen.getByRole('button', { name: 'Segmento 1' }));
    expect(screen.getByLabelText('Estado do segmento')).toHaveValue('completed');
  });

  it('mantém a escolha de estado após erro e permite guardar novamente', async () => {
    vi.mocked(getProject).mockResolvedValue(project('Tradução', 1));
    vi.mocked(saveSegment).mockRejectedValueOnce(new ApiError(500, 'Falha de gravação.'));
    const user = await open();
    await user.selectOptions(screen.getByLabelText('Estado do segmento'), 'completed');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByLabelText('Estado do segmento')).toHaveValue('completed');
    expect(screen.getByRole('status')).toHaveTextContent('Erro ao guardar');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(saveSegment).toHaveBeenLastCalledWith(1, 1, 'Tradução', 1, 'completed');
    expect(screen.getByRole('status')).toHaveTextContent('Guardado');
  });

  it('uma resposta atrasada não confirma uma escolha de estado posterior ao pedido', async () => {
    vi.mocked(getProject).mockResolvedValue(project('Tradução', 1));
    let finish!: (value: ReturnType<typeof saved>) => void;
    vi.mocked(saveSegment).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const user = await open();
    await user.selectOptions(screen.getByLabelText('Estado do segmento'), 'completed');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await user.selectOptions(screen.getByLabelText('Estado do segmento'), 'in_review');
    await act(async () => finish(saved('Tradução', 2, 'completed')));
    expect(screen.getByLabelText('Estado do segmento')).toHaveValue('in_review');
    expect(screen.getByRole('status')).toHaveTextContent('Alterações por guardar');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(saveSegment).toHaveBeenLastCalledWith(1, 1, 'Tradução', 2, 'in_review');
  });

  it('deteta conflito só de estado mesmo quando o texto é igual', async () => {
    vi.mocked(getProject).mockResolvedValue(project('Tradução', 1));
    const user = await open();
    await user.selectOptions(screen.getByLabelText('Estado do segmento'), 'untranslated');
    vi.mocked(saveSegment).mockRejectedValueOnce(new ApiError(409, 'Conflito.'));
    vi.mocked(getProject).mockResolvedValueOnce(project('Tradução', 2, 'completed'));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByRole('status')).toHaveTextContent('Conflito de versões');
    expect(screen.getByRole('alert')).toHaveTextContent('Estado guardado: Concluído');
    expect(screen.getByLabelText('Estado do segmento')).toHaveValue('untranslated');
    await user.click(screen.getByRole('button', { name: 'Usar versão guardada' }));
    expect(screen.getByLabelText('Estado do segmento')).toHaveValue('completed');
    expect(saveSegment).toHaveBeenCalledTimes(1);
  });

  it('não confirma gravação perdida se apenas o texto coincidir; confirma quando o estado também coincidir', async () => {
    vi.mocked(getProject).mockResolvedValue(project('Tradução', 1));
    const user = await open();
    await user.selectOptions(screen.getByLabelText('Estado do segmento'), 'completed');
    vi.mocked(saveSegment).mockRejectedValueOnce(new TypeError('Network error'));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByRole('status')).toHaveTextContent('Erro ao guardar');
    expect(screen.getByLabelText('Estado do segmento')).toHaveValue('completed');
    vi.mocked(saveSegment).mockRejectedValueOnce(new TypeError('Network error'));
    vi.mocked(getProject).mockResolvedValueOnce(project('Tradução', 2, 'completed'));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByRole('status')).toHaveTextContent('Guardado');
    expect(saveSegment).toHaveBeenCalledTimes(2);
  });
});

describe('exportação do exercício', () => {
  it('descarrega as versões atuais da API sem escrever nem substituir o editor', async () => {
    const user = await open();
    // Outra aba guardou depois de este editor ter sido aberto.
    const latest: ProjectExport = { format_version: 1, project: project('Tradução guardada noutra aba', 2, 'completed') };
    vi.mocked(getProjectExport).mockResolvedValueOnce(latest);
    await user.click(screen.getByRole('button', { name: 'Exportar exercício' }));
    expect(getProjectExport).toHaveBeenCalledWith(1);
    expect(downloadProject).toHaveBeenCalledWith(latest);
    expect(saveSegment).not.toHaveBeenCalled();
    expect(screen.getByLabelText('A tua tradução')).toHaveValue('');
    expect(screen.getByText(/Download iniciado/)).toBeVisible();
  });

  it.each(['texto', 'estado'])('pede para guardar alterações de %s antes de exportar', async (field) => {
    vi.mocked(getProject).mockResolvedValue(project('Tradução', 1));
    const user = await open();
    if (field === 'texto') edit('Nova tradução');
    else await user.selectOptions(screen.getByLabelText('Estado do segmento'), 'completed');
    await user.click(screen.getByRole('button', { name: 'Exportar exercício' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Guarda as alterações');
    expect(getProjectExport).not.toHaveBeenCalled();
    expect(downloadProject).not.toHaveBeenCalled();
    expect(saveSegment).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.queryByText(/Guarda as alterações de texto/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Exportar exercício' }));
    expect(getProjectExport).toHaveBeenCalledTimes(1);
    expect(downloadProject).toHaveBeenCalledTimes(1);
  });

  it('não exporta enquanto a gravação está pendente ou falhou', async () => {
    let fail!: (error: Error) => void;
    vi.mocked(saveSegment).mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
    const user = await open();
    edit('Rascunho');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByRole('button', { name: 'Exportar exercício' })).toBeDisabled();
    await act(async () => fail(new ApiError(500, 'Falha ao guardar.')));
    await user.click(screen.getByRole('button', { name: 'Exportar exercício' }));
    expect(getProjectExport).not.toHaveBeenCalled();
    expect(downloadProject).not.toHaveBeenCalled();
    expect(screen.getByLabelText('A tua tradução')).toHaveValue('Rascunho');
  });

  it.each(['conflito', 'incerta'])('bloqueia exportação com gravação %s', async (failure) => {
    const user = await open();
    edit('Rascunho');
    vi.mocked(saveSegment).mockRejectedValueOnce(new TypeError('Network error'));
    if (failure === 'conflito') vi.mocked(getProject).mockResolvedValueOnce(project('Outra tradução', 1));
    else vi.mocked(getProject).mockRejectedValueOnce(new TypeError('Offline'));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await user.click(screen.getByRole('button', { name: 'Exportar exercício' }));
    expect(screen.getByText(/Resolve o conflito ou confirma a gravação/)).toBeVisible();
    expect(getProjectExport).not.toHaveBeenCalled();
    expect(downloadProject).not.toHaveBeenCalled();
    expect(screen.getByLabelText('A tua tradução')).toHaveValue('Rascunho');
  });

  it('bloqueia edições e pedidos duplicados durante a exportação e permite repetir após erro', async () => {
    let fail!: (error: Error) => void;
    vi.mocked(getProjectExport).mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Exportar exercício' }));
    expect(screen.getByRole('button', { name: 'A exportar…' })).toBeDisabled();
    expect(screen.getByLabelText('A tua tradução')).toBeDisabled();
    expect(screen.getByLabelText('Estado do segmento')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Segmento 2' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'A exportar…' }));
    expect(getProjectExport).toHaveBeenCalledTimes(1);
    await act(async () => fail(new TypeError('Offline')));
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível exportar');
    expect(screen.getByLabelText('A tua tradução')).toBeEnabled();
    expect(screen.getByLabelText('Estado do segmento')).toBeEnabled();
    expect(downloadProject).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Exportar exercício' }));
    expect(downloadProject).toHaveBeenCalledTimes(1);
  });

  it('apresenta erro se o navegador não conseguir iniciar o download', async () => {
    vi.mocked(downloadProject).mockImplementationOnce(() => { throw new Error('Download failed'); });
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Exportar exercício' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível exportar');
    expect(screen.getByLabelText('A tua tradução')).toBeEnabled();
    expect(screen.queryByText(/Download iniciado/)).not.toBeInTheDocument();
  });
});
