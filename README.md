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

A primeira parte de 5B acrescenta os estados **Por traduzir**, **Em revisão** e **Concluído**, guardados juntamente com o texto em cada revisão. O botão Guardar também fica disponível quando só o estado muda.

A segunda parte de 5B acrescenta **Exportar exercício**: descarrega um JSON com os metadados e as versões atuais guardadas de todos os segmentos.

A terceira parte de 5B acrescenta a **gravação automática após 1 segundo sem alterações**, mantendo o botão Guardar e a proteção perante erros e conflitos.

O frontend está em `frontend/` (React, TypeScript e Vite) e a API em `backend/` (FastAPI, Pydantic e SQLAlchemy). A página em `docs/index.html` continua a ser a apresentação do projeto. QA e LLM pertencem às próximas alterações.

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

### Estados dos segmentos (primeira parte de 5B)

- Escrever ou editar texto coloca o rascunho **Em revisão**, incluindo quando estava concluído. Apagar todo o texto, ou deixar apenas espaços, coloca-o **Por traduzir**.
- O seletor **Estado do segmento** permite escolher qualquer dos três estados. **Concluído** exige texto não vazio e uma escolha explícita; é uma decisão do estudante, não uma avaliação automática da qualidade.
- É possível voltar a **Em revisão** ou **Por traduzir** sem apagar o texto. O estado é persistido juntamente com a tradução, por gravação automática ou pelo botão **Guardar**.
- Mudar apenas o estado cria uma revisão. Guardar o mesmo texto e estado não cria duplicados. Navegação, erros e conflitos protegem ambos os campos.

Ao atualizar a partir de 5A, reiniciar a API e atualizar a página. No arranque, o backend acrescenta automaticamente a coluna de estado à base de dados existente, numa transação. Mantém textos, identificadores, revisões e datas. As revisões antigas recebem **Por traduzir** se estiverem vazias/só com espaços, ou **Em revisão** caso contrário; estes estados são inferidos na migração, não decisões históricas do estudante. A migração só é aplicada uma vez e não exige novas dependências.

### Exportação JSON (segunda parte de 5B)

1. Esperar pela indicação **Guardado**, ou clicar em **Guardar** para antecipar a gravação.
2. Clicar em **Exportar exercício**, junto ao título.
3. Abrir `exercicio-1.json` na pasta de downloads do navegador.

O ficheiro inclui `format_version: 1` e `project`, com os metadados do exercício e todos os segmentos ordenados. Cada segmento contém identificador, posição, original, tradução, estado e número da revisão guardada. Acentos, espaços e quebras de linha são preservados nos valores JSON. O [contrato do editor](docs/editor.md#exportação-json-segunda-parte-de-5b) documenta o formato.

Se houver alterações pendentes, o editor pede para guardar antes de exportar. Resolver conflitos e confirmar gravações incertas também precede a exportação. Durante o pedido, a edição fica temporariamente bloqueada; uma falha permite repetir sem perder trabalho. O download lê o estado atual da base de dados, incluindo alterações guardadas noutras abas, e não cria revisões.

Esta versão exporta a revisão atual de cada segmento. O histórico completo continua na base de dados; a importação de JSON e a exportação de dados de processo ficam para etapas posteriores. Não são necessárias novas dependências nem alterações ao esquema da base de dados para esta funcionalidade.

### Gravação automática (terceira parte de 5B)

- Alterar texto ou estado inicia um intervalo de 1 segundo. Cada nova edição reinicia esse prazo. **Guardar** permite enviar imediatamente.
- Só existe um pedido de gravação pendente. É possível continuar a escrever durante esse pedido; o editor guarda depois o rascunho mais recente com a revisão confirmada, assim que tiver passado 1 segundo desde a última edição.
- **Guardado** só aparece depois da confirmação da API para o texto e estado atuais. Abrir o exercício, navegar sem alterações ou exportar não cria revisões.
- Erros suspendem a gravação automática, mesmo que se continue a escrever. O rascunho fica no editor. Corrigir a ligação/erro e clicar em **Guardar** permite retomar após confirmação; não há tentativas automáticas repetidas.
- Se uma resposta se perder, o editor consulta a API para confirmar se guardou. Se também não conseguir consultar, é necessário usar **Verificar gravação**. Esta ação apenas lê; as edições posteriores podem ser guardadas automaticamente depois de confirmar a gravação anterior.
- Num conflito, **Manter o meu rascunho** continua a exigir um clique explícito em **Guardar**. **Usar versão guardada** carrega a versão remota e permite voltar a editar normalmente.
- O temporizador fica suspenso enquanto está aberto o diálogo de mudança de segmento. Guardar, descartar e continuar a editar mantêm o seu significado; descartar cancela a gravação que estava agendada para esse rascunho.

A API e a base de dados são as mesmas usadas pela gravação manual, sem novas dependências. Antes de recarregar ou fechar a página, esperar pela indicação **Guardado**: o intervalo de 1 segundo agenda o pedido, mas a confirmação depende da ligação e do servidor.

## Verificar os incrementos implementados

A partir da raiz do repositório:

```bash
backend/.venv/bin/python -m pytest -q backend
npm --prefix frontend test
npm --prefix frontend run build
```

Os testes da API usam bases de dados temporárias e cobrem persistência entre reinícios, preservação do texto, revisões, gravações concorrentes, validação, reversão de transações com erro, migração de bases de dados de 5A e exportação sem escrita. Os testes do frontend usam Vitest, Testing Library e jsdom para verificar as interações, incluindo falhas, navegação, respostas atrasadas, alterações apenas de estado, bloqueios de exportação e conteúdo do ficheiro JSON, sem necessitar de um LLM. Os testes de gravação automática usam tempo controlado para verificar o intervalo, pedidos pendentes e pausa/retoma após erros. As dependências estão fixadas em `requirements.txt` e `package-lock.json`; `requirements.in` identifica as dependências diretas de Python.

Verificação manual no navegador:

1. Traduzir um segmento, incluindo acentos, espaços e quebras de linha; clicar em **Guardar**.
2. Atualizar a página e reiniciar a API; confirmar que o texto guardado permanece.
3. Editar e escolher imediatamente outro segmento, antes da gravação automática; experimentar guardar, descartar e continuar a editar.
4. Abrir duas janelas antes de editar o mesmo segmento; guardar numa e depois na outra. A segunda deve mostrar o conflito e preservar o seu rascunho.
5. Parar a API e tentar guardar; confirmar que o rascunho permanece. Reiniciar a API e voltar a tentar ou verificar a gravação.
6. Percorrer os controlos por teclado e verificar o ecrã numa janela estreita.
7. Com uma tradução guardada, escolher **Concluído**, guardar e atualizar a página; o estado deve manter-se. Editar o texto deve voltar a **Em revisão**. Um texto vazio não pode ser concluído.
8. Alterar apenas o estado e tentar mudar de segmento antes da gravação automática; devem aparecer as mesmas opções de guardar, descartar e continuar a editar. Experimentar também estados diferentes em duas abas com a mesma revisão inicial.
9. Clicar em **Exportar exercício** com alterações pendentes: deve aparecer um aviso e não iniciar o download. Esperar por **Guardado** ou guardar manualmente, exportar e comparar as traduções e estados do JSON com o conteúdo guardado.
10. Parar a API e exportar um exercício sem alterações pendentes: deve aparecer um erro sem descarregar um ficheiro. Reiniciar a API e repetir.
11. Escrever sem clicar em Guardar, parar e esperar pela indicação **Guardado**; atualizar a página e confirmar que texto e estado permanecem. Repetir alterando apenas o estado.
12. Parar a API, editar e aguardar a tentativa automática. Confirmar que aparece um erro e a gravação automática fica em pausa, conservando o rascunho. Reiniciar a API, clicar em **Guardar** (ou **Verificar gravação**, se estiver incerta) e confirmar que as edições seguintes voltam a ser guardadas automaticamente.

Os testes de interação não substituem a revisão visual, do foco, dos diálogos nativos e do download num navegador real. O rascunho ainda não é recuperável depois de fechar a página sem guardar; a persistência garantida aplica-se às gravações confirmadas pela API.

## Preparação do desenvolvimento
* [Âmbito, prioridades e tarefas do primeiro incremento](docs/planeamento.md).
* [Desenho do editor e contrato mínimo da API](docs/editor.md).
* [Protocolo de avaliação, exemplos de desenvolvimento e ensaio do LLM local](evaluation/README.md).

O planeamento distingue o incremento implementado das funcionalidades seguintes. Os exemplos de avaliação têm anotações preliminares para revisão humana; ainda não existem resultados experimentais sobre a eficácia pedagógica.

## Equipa
* Diogo Pinto (PG61515)
* Mariana Pinto (PG61534)
