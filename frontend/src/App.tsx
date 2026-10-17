import { useEffect, useRef, useState } from 'react';
import { ApiError, getProject, getProjectExport, saveSegment, statusForText, statusLabels } from './api';
import type { Project, Segment, SegmentStatus } from './api';
import { NavigationDialog } from './NavigationDialog';
import { downloadProject } from './download';

type Phase = 'idle' | 'saving' | 'checking' | 'error' | 'conflict' | 'uncertain';
interface SaveAttempt { segment: Segment; text: string; status: SegmentStatus }
const AUTOSAVE_DELAY_MS = 1000;

export default function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  const [draftStatus, setDraftStatus] = useState<SegmentStatus>('untranslated');
  const draftStatusRef = useRef<SegmentStatus>('untranslated');
  const lastEditAt = useRef(0);
  const [autosavePaused, setAutosavePaused] = useState(false);
  const inFlight = useRef(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [remote, setRemote] = useState<Segment | null>(null);
  const [uncertain, setUncertain] = useState<SaveAttempt | null>(null);
  const [destination, setDestination] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<{ text: string; error: boolean } | null>(null);

  const selected = project?.segments.find((segment) => segment.id === selectedId);
  const dirty = selected !== undefined && (draft !== selected.target_text || draftStatus !== selected.status);
  const busy = phase === 'saving' || phase === 'checking';

  useEffect(() => {
    const controller = new AbortController();
    setLoadError(false);
    getProject(controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      if (data.segments.length === 0) throw new Error('Exercício sem segmentos.');
      setProject(data);
      setSelectedId(data.segments[0].id);
      setDraft(data.segments[0].target_text);
      draftRef.current = data.segments[0].target_text;
      changeStatus(data.segments[0].status);
    }).catch(() => {
      if (!controller.signal.aborted) setLoadError(true);
    });
    return () => controller.abort();
  }, [loadAttempt]);

  useEffect(() => {
    if (!dirty && !busy && !uncertain) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy, uncertain]);

  // Reavaliar em cada render mantém o pedido ligado ao rascunho e à revisão atuais.
  // O prazo depende da última edição, por isso outros renders não adiam a gravação.
  useEffect(() => {
    if (!dirty || phase !== 'idle' || autosavePaused || destination !== null || exporting) return;
    const remaining = Math.max(0, lastEditAt.current + AUTOSAVE_DELAY_MS - Date.now());
    const timer = window.setTimeout(() => { void saveCurrent(); }, remaining);
    return () => window.clearTimeout(timer);
  });

  function changeStatus(value: SegmentStatus) {
    setExportNotice(null);
    setDraftStatus(value);
    draftStatusRef.current = value;
  }

  function editText(text: string) {
    if (text !== draftRef.current) {
      lastEditAt.current = Date.now();
      changeStatus(statusForText(text));
    }
    setDraft(text);
    draftRef.current = text;
  }

  function editStatus(value: SegmentStatus) {
    if (value !== draftStatusRef.current) lastEditAt.current = Date.now();
    changeStatus(value);
  }

  function rememberSaved(segment: Pick<Segment, 'id' | 'target_text' | 'status' | 'revision'>) {
    setProject((current) => current && ({
      ...current,
      segments: current.segments.map((item) => item.id === segment.id ? { ...item, ...segment } : item),
    }));
  }

  function acceptSaved(segment: Pick<Segment, 'id' | 'target_text' | 'status' | 'revision'>, attempt: SaveAttempt) {
    setExportNotice(null);
    setAutosavePaused(false);
    rememberSaved(segment);
    setPhase('idle');
    setMessage('');
    setRemote(null);
    setUncertain(null);
    // O rascunho pode ter mudado enquanto o pedido estava pendente.
    return draftRef.current === attempt.text && draftStatusRef.current === attempt.status;
  }

  async function reconcile(attempt: SaveAttempt) {
    setPhase('checking');
    try {
      const latest = await getProject();
      const persisted = latest.segments.find((item) => item.id === attempt.segment.id);
      if (!persisted) throw new Error('Segmento não encontrado.');
      setUncertain(null);
      if (persisted.target_text === attempt.text && persisted.status === attempt.status) {
        return acceptSaved(persisted, attempt);
      }
      setAutosavePaused(true);
      if (persisted.revision !== attempt.segment.revision) {
        setRemote(persisted);
        setPhase('conflict');
        setMessage('Existe uma versão mais recente. Compara os textos antes de voltar a guardar.');
      } else {
        setPhase('error');
        setMessage('A tradução não foi guardada. O teu rascunho continua aqui; clica em Guardar para tentar novamente.');
      }
    } catch {
      setAutosavePaused(true);
      setUncertain(attempt);
      setPhase('uncertain');
      setMessage('Não foi possível confirmar a gravação. Mantém esta página aberta e verifica a ligação.');
    }
    return false;
  }

  async function saveCurrent() {
    if (!project || !selected || inFlight.current || remote || uncertain) return false;
    setExportNotice(null);
    if (!dirty) return true;
    const attempt = { segment: selected, text: draftRef.current, status: draftStatusRef.current };
    inFlight.current = true;
    setPhase('saving');
    setMessage('');
    try {
      const result = await saveSegment(project.id, selected.id, attempt.text, selected.revision, attempt.status);
      return acceptSaved(result, attempt);
    } catch (error) {
      if (error instanceof ApiError && [404, 422, 500].includes(error.status)) {
        setAutosavePaused(true);
        setPhase('error');
        setMessage(`${error.message} O teu rascunho continua aqui. Clica em Guardar para tentar novamente.`);
        return false;
      }
      // Timeout/ligação interrompida pode acontecer depois do commit; ler antes de reenviar.
      return await reconcile(attempt);
    } finally {
      inFlight.current = false;
    }
  }

  async function verifySave() {
    if (!uncertain || inFlight.current) return;
    setExportNotice(null);
    inFlight.current = true;
    try { await reconcile(uncertain); }
    finally { inFlight.current = false; }
  }

  async function exportProject() {
    if (!project || inFlight.current) return;
    setExportNotice(null);
    if (remote || uncertain) {
      setExportNotice({ text: 'Resolve o conflito ou confirma a gravação antes de exportar.', error: true });
      return;
    }
    if (dirty) {
      setExportNotice({ text: 'Guarda as alterações de texto e estado antes de exportar.', error: true });
      return;
    }
    inFlight.current = true;
    setExporting(true);
    try {
      const data = await getProjectExport(project.id);
      downloadProject(data);
      setExportNotice({ text: 'Download iniciado. O ficheiro contém as versões guardadas do exercício.', error: false });
    } catch {
      setExportNotice({ text: 'Não foi possível exportar o exercício. Tenta novamente; o teu trabalho mantém-se.', error: true });
    } finally {
      inFlight.current = false;
      setExporting(false);
    }
  }

  function activate(id: number) {
    const segment = project!.segments.find((item) => item.id === id)!;
    setSelectedId(id);
    setDraft(segment.target_text);
    draftRef.current = segment.target_text;
    changeStatus(segment.status);
    setAutosavePaused(false);
    setPhase('idle');
    setMessage('');
    setRemote(null);
    setDestination(null);
    editorRef.current?.focus();
  }

  function navigate(id: number) {
    if (id === selectedId || inFlight.current || uncertain || remote) return;
    if (dirty) setDestination(id);
    else activate(id);
  }

  async function saveAndNavigate() {
    const next = destination;
    if (await saveCurrent()) {
      if (next !== null) activate(next);
    } else {
      setDestination(null);
    }
  }

  function resolveConflict(useSaved: boolean) {
    if (!remote) return;
    setExportNotice(null);
    rememberSaved(remote);
    if (useSaved) {
      setDraft(remote.target_text);
      draftRef.current = remote.target_text;
      changeStatus(remote.status);
    }
    // Manter o rascunho não autoriza sobrescrever automaticamente a versão remota.
    setAutosavePaused(!useSaved);
    setRemote(null);
    setPhase('idle');
    setMessage(useSaved ? '' : 'Rascunho mantido. Revê o texto e o estado e clica em Guardar para confirmar a nova versão.');
    editorRef.current?.focus();
  }

  let status = dirty ? 'Alterações por guardar' : 'Guardado';
  if (phase === 'saving') status = 'A guardar…';
  if (phase === 'checking') status = 'A verificar gravação…';
  if (phase === 'error') status = 'Erro ao guardar';
  if (phase === 'uncertain') status = 'Gravação por confirmar';
  if (phase === 'conflict') status = 'Conflito de versões';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark" aria-hidden="true">et.</span>
          <span>Educational Translation Tool<small>Um espaço para aprender a traduzir</small></span>
        </div>
        <span className="university">MEI · Universidade do Minho</span>
      </header>

      <main>
        {!project || !selected ? (
          <section className="loading-panel" aria-live="polite">
            <h1>{loadError ? 'Não foi possível abrir o exercício' : 'A preparar o teu espaço…'}</h1>
            {loadError && <><p>Verifica se o serviço local está a funcionar e tenta novamente.</p>
              <button className="primary" onClick={() => setLoadAttempt((value) => value + 1)}>Tentar novamente</button></>}
          </section>
        ) : <>
          <section className="exercise-heading">
            <div><p className="eyebrow">Prática de tradução</p><h1>{project.title}</h1>
              <p className="instructions">{project.instructions}</p></div>
            <div className="exercise-actions">
              <div className="language-pair" aria-label="Inglês para português europeu">
                <span>EN</span><span aria-hidden="true">→</span><span>PT-PT</span>
              </div>
              <button type="button" onClick={() => void exportProject()} disabled={busy || exporting}>
                {exporting ? 'A exportar…' : 'Exportar exercício'}
              </button>
            </div>
          </section>
          {exportNotice && <p className={`export-notice ${exportNotice.error ? 'error' : ''}`}
            role={exportNotice.error ? 'alert' : 'status'}>{exportNotice.text}</p>}

          <div className="workspace">
            <nav className="segment-nav" aria-label="Segmentos do exercício">
              <div className="nav-heading"><h2>Segmentos</h2><span>{project.segments.length}</span></div>
              <ol>{project.segments.map((segment) => (
                <li key={segment.id}>
                  <button type="button" className="segment-button"
                    aria-current={segment.id === selectedId ? 'step' : undefined}
                    aria-label={`Segmento ${segment.position}`}
                    disabled={busy || exporting || !!remote || !!uncertain} onClick={() => navigate(segment.id)}>
                    <span className="segment-number">{String(segment.position).padStart(2, '0')}</span>
                    <span className="segment-preview">{segment.source_text}
                      <small>{statusLabels[segment.id === selectedId ? draftStatus : segment.status]}
                        {segment.id === selectedId && dirty && ' · Por guardar'}</small>
                    </span>
                  </button>
                </li>
              ))}</ol>
              <p className="nav-note">Trabalha ao teu ritmo,<br />um segmento de cada vez.</p>
            </nav>

            <section className="editor" aria-label={`Editor do segmento ${selected.position}`}>
              <div className="editor-heading"><h2>Segmento {String(selected.position).padStart(2, '0')}</h2>
                <span>{selected.position} de {project.segments.length}</span></div>
              <div className="translation-columns">
                <section className="source-panel" aria-labelledby="source-label">
                  <div className="panel-label"><h3 id="source-label">Original</h3><span>Inglês</span></div>
                  <p className="source-text" lang="en">{selected.source_text}</p>
                </section>
                <div className="target-panel">
                  <div className="panel-label"><label htmlFor="translation">A tua tradução</label><span>Português europeu</span></div>
                  <textarea ref={editorRef} id="translation" value={draft} lang="pt-PT" spellCheck disabled={exporting}
                    placeholder="Escreve aqui a tua tradução…" aria-describedby="save-guidance"
                    onChange={(event) => editText(event.target.value)} />
                  <span className="character-count">{Array.from(draft).length} caracteres</span>
                </div>
              </div>
              <div className="segment-state">
                <label htmlFor="segment-status">Estado do segmento</label>
                <select id="segment-status" value={draftStatus} aria-describedby="state-guidance" disabled={exporting}
                  onChange={(event) => editStatus(event.target.value as SegmentStatus)}>
                  <option value="untranslated">Por traduzir</option>
                  <option value="in_review">Em revisão</option>
                  <option value="completed" disabled={!draft.trim()}>Concluído</option>
                </select>
                <p id="state-guidance">Escolhe Concluído quando terminares a revisão. Editar o texto volta a colocá-lo em revisão.</p>
              </div>
              <div className="save-bar">
                <div><p role="status" className={`save-status ${dirty || phase !== 'idle' ? 'pending' : ''}`}>
                  <span className="status-dot" aria-hidden="true" />{status}</p>
                  <p id="save-guidance">{autosavePaused
                    ? 'Gravação automática em pausa. Segue as instruções abaixo.'
                    : 'Gravação automática após 1 segundo sem alterações. Podes também clicar em Guardar.'}</p></div>
                <button className="primary" type="button" onClick={() => void saveCurrent()}
                  disabled={!dirty || busy || exporting || !!remote || !!uncertain}>{busy ? 'A guardar…' : 'Guardar'}</button>
              </div>
              {message && <div className="feedback-panel" role="alert"><p>{message}</p>
                {uncertain && <button type="button" disabled={busy} onClick={() => void verifySave()}>Verificar gravação</button>}
                {remote && <>
                  <h3>Versão guardada</h3><pre>{remote.target_text || '(Sem texto)'}</pre>
                  <p>Estado guardado: <strong>{statusLabels[remote.status]}</strong></p>
                  <p>Manter o rascunho permite revê-lo e guardar uma nova versão. Nada será sobrescrito automaticamente.</p>
                  <div className="conflict-actions">
                    <button type="button" onClick={() => resolveConflict(false)}>Manter o meu rascunho</button>
                    <button type="button" onClick={() => resolveConflict(true)}>Usar versão guardada</button>
                  </div>
                </>}
              </div>}
            </section>
          </div>
          <footer className="workspace-footer"><span>Observa o original. Experimenta. Revê.</span>
            <span>Oficina EN → PT-PT</span></footer>
        </>}
      </main>
      {destination !== null && <NavigationDialog busy={busy}
        onSave={() => void saveAndNavigate()} onDiscard={() => activate(destination)} onCancel={() => setDestination(null)} />}
    </div>
  );
}
