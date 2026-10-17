# Educational Translation Tool

> Development of an open-source educational translation tool.  
> Creates a student-oriented translation support tool to teach practical translation workflows while promoting open-source and educational use cases.

Projeto desenvolvido no âmbito do Mestrado em Engenharia Informática da Universidade do Minho.

---

## Visão Geral
Este projeto tem como propósito o desenvolvimento e avaliação de uma ferramenta educativa web para apoio ao ensino e prática de tradução. O objetivo central é criar um ambiente direcionado para estudantes que promova a aprendizagem reflexiva, articulando funcionalidades CAT essenciais com verificações de consistência e feedback pedagógico contextual.

## Objetivos Centrais
* **Ensino e Apoio Pedagógico:** Fornecer pistas orientadoras e explicações em vez de apresentar apenas traduções prontas.
* **Reflexão e Julgamento Crítico:** Apoiar o utilizador na compreensão dos problemas identificados e na justificação fundamentada das suas escolhas.
* **Acompanhamento do Processo:** Registar revisões e decisões para permitir a análise e reflexão sobre a evolução do trabalho.
* **Ferramenta Aberta e Acessível:** Desenvolver a solução como software de código aberto (*open-source*), acompanhada de documentação clara e reproduzível.

## Estado Atual
O incremento 5A implementa um editor local com um exercício fixo de três segmentos EN → PT-PT, gravação manual em SQLite e revisões por segmento. O editor conserva o rascunho quando há erros e permite resolver conflitos entre janelas antes de voltar a guardar.

O frontend está em `frontend/` (React, TypeScript e Vite) e a API em `backend/` (FastAPI, Pydantic e SQLAlchemy). A página em `docs/index.html` continua a ser a apresentação do projeto. Gravação automática, estados pedagógicos, exportação, QA e LLM pertencem aos próximos incrementos.

## Executar o editor localmente

Requisitos: Python 3.11 e Node.js 22.12 ou superior. Os comandos seguintes partem da raiz do repositório. No Mac usado no desenvolvimento, `python3` aponta para uma versão antiga, pelo que se usa explicitamente `python3.11`.

Na primeira execução, preparar o backend:

```bash
cd backend
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

No **terminal 1**, iniciar a API a partir de `backend/`:

```bash
.venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

No **terminal 2**, a partir da raiz do repositório, preparar e iniciar o frontend:

```bash
cd frontend
npm ci
npm run dev
```

Abrir **http://127.0.0.1:5173**. Manter ambos os terminais abertos; `Ctrl+C` termina cada serviço. Nas execuções seguintes, basta iniciar a API e executar `npm run dev`. A configuração do Vite encaminha `/api` para a porta 8000, que deve estar livre; a porta 5173 também é fixa.

O backend cria `backend/data/translation.sqlite3` e os três segmentos na primeira execução. Os dados guardados persistem entre reinícios; este ficheiro e os ambientes locais são ignorados pelo Git. A variável de ambiente `EDU_DATABASE_PATH` permite usar outro ficheiro SQLite. Não há contas: todas as janelas que usam esta instalação partilham o mesmo exercício.

## Verificar o incremento 5A

A partir da raiz do repositório:

```bash
backend/.venv/bin/python -m pytest -q backend
npm --prefix frontend test
npm --prefix frontend run build
```

Os testes da API usam bases de dados temporárias e cobrem persistência entre reinícios, preservação do texto, revisões, gravações concorrentes, validação e reversão de transações com erro. Os testes do editor usam Vitest, Testing Library e jsdom para verificar as interações, incluindo falhas, navegação e respostas atrasadas, sem necessitar de um LLM. As dependências estão fixadas em `requirements.txt` e `package-lock.json`; `requirements.in` identifica as dependências diretas de Python.

Verificação manual no navegador:

1. Traduzir um segmento, incluindo acentos, espaços e quebras de linha; clicar em **Guardar**.
2. Atualizar a página e reiniciar a API; confirmar que o texto guardado permanece.
3. Editar sem guardar e escolher outro segmento; experimentar guardar, descartar e continuar a editar.
4. Abrir duas janelas antes de editar o mesmo segmento; guardar numa e depois na outra. A segunda deve mostrar o conflito e preservar o seu rascunho.
5. Parar a API e tentar guardar; confirmar que o rascunho permanece. Reiniciar a API e voltar a tentar ou verificar a gravação.
6. Percorrer os controlos por teclado e verificar o ecrã numa janela estreita.

Os testes de interação não substituem a revisão visual, do foco e dos diálogos nativos num navegador real. O rascunho ainda não é recuperável depois de fechar a página sem guardar; a persistência garantida aplica-se às gravações confirmadas pela API.

## Preparação do desenvolvimento
* [Âmbito, prioridades e tarefas do primeiro incremento](docs/planeamento.md).
* [Desenho do editor e contrato mínimo da API](docs/editor.md).
* [Protocolo de avaliação, exemplos de desenvolvimento e ensaio do LLM local](evaluation/README.md).

O planeamento distingue o incremento implementado das funcionalidades seguintes. Os exemplos de avaliação têm anotações preliminares para revisão humana; ainda não existem resultados experimentais sobre a eficácia pedagógica.

## Equipa
* Diogo Pinto (PG61515)
* Mariana Pinto (PG61534)
