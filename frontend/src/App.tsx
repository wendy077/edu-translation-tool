import { useEffect, useRef, useState } from 'react';
import { ApiError, getProject, saveSegment } from './api';
import type { Project, Segment } from './api';
import { NavigationDialog } from './NavigationDialog';

type Phase = 'idle' | 'saving' | 'checking' | 'error' | 'conflict' | 'uncertain';
interface SaveAttempt { segment: Segment; text: string }

export default function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  const inFlight = useRef(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [remote, setRemote] = useState<Segment | null>(null);
  const [uncertain, setUncertain] = useState<SaveAttempt | null>(null);
  const [destination, setDestination] = useState<number | null>(null);

  const selected = project?.segments.find((segment) => segment.id === selectedId);
  const dirty = selected !== undefined && draft !== selected.target_text;
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

  function rememberSaved(segment: Pick<Segment, 'id' | 'target_text' | 'revision'>) {
    setProject((current) => current && ({
      ...current,
      segments: current.segments.map((item) => item.id === segment.id ? { ...item, ...segment } : item),
    }));
  }

  function acceptSaved(segment: Pick<Segment, 'id' | 'target_text' | 'revision'>, sentText: string) {
    rememberSaved(segment);
    setPhase('idle');
    setMessage('');
    setRemote(null);
    setUncertain(null);
    // O rascunho pode ter mudado enquanto o pedido estava pendente.
    return draftRef.current === sentText;
  }

  async function reconcile(attempt: SaveAttempt) {
    setPhase('checking');
    try {
      const latest = await getProject();
      const persisted = latest.segments.find((item) => item.id === attempt.segment.id);
      if (!persisted) throw new Error('Segmento não encontrado.');
      setUncertain(null);
      if (persisted.target_text === attempt.text) {
        return acceptSaved(persisted, attempt.text);
      }
      if (persisted.revision !== attempt.segment.revision) {
        setRemote(persisted);
        setPhase('conflict');
        setMessage('Existe uma versão mais recente. Compara os textos antes de voltar a guardar.');
      } else {
        setPhase('error');
        setMessage('A tradução não foi guardada. O teu rascunho continua aqui; tenta novamente.');
      }
    } catch {
      setUncertain(attempt);
      setPhase('uncertain');
      setMessage('Não foi possível confirmar a gravação. Mantém esta página aberta e verifica a ligação.');
    }
    return false;
  }

  async function saveCurrent() {
    if (!project || !selected || inFlight.current || remote || uncertain) return false;
    if (!dirty) return true;
    const attempt = { segment: selected, text: draftRef.current };
    inFlight.current = true;
    setPhase('saving');
    setMessage('');
    try {
      const result = await saveSegment(project.id, selected.id, attempt.text, selected.revision);
      return acceptSaved(result, attempt.text);
    } catch (error) {
      if (error instanceof ApiError && [404, 422, 500].includes(error.status)) {
        setPhase('error');
        setMessage(`${error.message} O teu rascunho continua aqui.`);
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
    inFlight.current = true;
    try { await reconcile(uncertain); }
    finally { inFlight.current = false; }
  }

  function activate(id: number) {
    const segment = project!.segments.find((item) => item.id === id)!;
    setSelectedId(id);
    setDraft(segment.target_text);
    draftRef.current = segment.target_text;
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
    rememberSaved(remote);
    if (useSaved) {
      setDraft(remote.target_text);
      draftRef.current = remote.target_text;
    }
    setRemote(null);
    setPhase('idle');
    setMessage('');
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
            <div className="language-pair" aria-label="Inglês para português europeu">
              <span>EN</span><span aria-hidden="true">→</span><span>PT-PT</span>
            </div>
          </section>

          <div className="workspace">
            <nav className="segment-nav" aria-label="Segmentos do exercício">
              <div className="nav-heading"><h2>Segmentos</h2><span>{project.segments.length}</span></div>
              <ol>{project.segments.map((segment) => (
                <li key={segment.id}>
                  <button type="button" className="segment-button"
                    aria-current={segment.id === selectedId ? 'step' : undefined}
                    aria-label={`Segmento ${segment.position}`}
                    disabled={busy || !!remote || !!uncertain} onClick={() => navigate(segment.id)}>
                    <span className="segment-number">{String(segment.position).padStart(2, '0')}</span>
                    <span className="segment-preview">{segment.source_text}
                      <small>{segment.id === selectedId && dirty ? 'Por guardar' : segment.target_text.trim() ? 'Com tradução' : 'Sem tradução'}</small>
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
                  <textarea ref={editorRef} id="translation" value={draft} lang="pt-PT" spellCheck
                    placeholder="Escreve aqui a tua tradução…" aria-describedby="save-guidance"
                    onChange={(event) => { setDraft(event.target.value); draftRef.current = event.target.value; }} />
                  <span className="character-count">{Array.from(draft).length} caracteres</span>
                </div>
              </div>
              <div className="save-bar">
                <div><p role="status" className={`save-status ${dirty || phase !== 'idle' ? 'pending' : ''}`}>
                  <span className="status-dot" aria-hidden="true" />{status}</p>
                  <p id="save-guidance">Guarda a tradução antes de sair.</p></div>
                <button className="primary" type="button" onClick={() => void saveCurrent()}
                  disabled={!dirty || busy || !!remote || !!uncertain}>{busy ? 'A guardar…' : 'Guardar'}</button>
              </div>
              {message && <div className="feedback-panel" role="alert"><p>{message}</p>
                {uncertain && <button type="button" disabled={busy} onClick={() => void verifySave()}>Verificar gravação</button>}
                {remote && <>
                  <h3>Versão guardada</h3><pre>{remote.target_text || '(Sem texto)'}</pre>
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
