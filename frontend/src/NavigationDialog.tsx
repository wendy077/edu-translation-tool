import { useEffect, useRef } from 'react';

interface Props {
  busy: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function NavigationDialog({ busy, onSave, onDiscard, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog ref={ref} aria-labelledby="navigation-title" onCancel={(event) => {
      event.preventDefault();
      if (!busy) onCancel();
    }}>
      <p className="eyebrow">Antes de continuar</p>
      <h2 id="navigation-title">Tens alterações por guardar</h2>
      <p>Queres guardar a tradução antes de mudar de segmento?</p>
      <div className="dialog-actions">
        <button type="button" className="primary" disabled={busy} onClick={onSave}>
          {busy ? 'A guardar…' : 'Guardar e mudar'}
        </button>
        <button type="button" disabled={busy} onClick={onDiscard}>Descartar alterações</button>
        <button type="button" className="text-button" disabled={busy} onClick={onCancel} autoFocus>
          Continuar a editar
        </button>
      </div>
    </dialog>
  );
}
