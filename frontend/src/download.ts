import type { ProjectExport } from './api';

export function downloadProject(data: ProjectExport) {
  const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = `exercicio-${data.project.id}.json`;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    // Dar tempo ao navegador para iniciar a leitura antes de libertar o URL temporário.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
