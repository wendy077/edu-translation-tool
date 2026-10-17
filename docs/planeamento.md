# Preparação do primeiro incremento

Documento de trabalho de 17 de outubro de 2026. As decisões abaixo distinguem o que foi confirmado pelo grupo das propostas de implementação. Não descrevem funcionalidades já implementadas.

## Decisões e pressupostos

| Assunto | Decisão de trabalho | Estado |
| --- | --- | --- |
| Entrega | Artigo e apresentação universitária em 30 de novembro de 2026; formato ACL escolhido pelo grupo. | Confirmado pelo utilizador. |
| Produto | Aplicação web educativa; textos curtos e exercícios preparados. | Direção presente no artigo e na proposta. |
| Línguas | Inglês para português europeu. | Âmbito inicial do artigo. |
| Tecnologias | React, TypeScript e Vite; FastAPI/Pydantic; SQLite/SQLAlchemy. | Proposta do artigo, adotada como base do primeiro incremento. |
| LLM | Sem pagamentos; começar por um modelo local. | Restrição confirmada; modelo ainda por experimentar. |
| Utilização inicial | Uma pessoa por instalação local, sem contas nem publicação na Internet. | Simplificação proposta para o primeiro incremento. Não equivale a isolamento de utilizadores. |
| Investigação | RQ1 e RQ2 como avaliação principal; RQ3 dependente de participantes. | Recomendação a validar com o grupo/orientador; o artigo ainda contém as três RQ. |
| Reutilização | Núcleo próprio pequeno, limitado a exercícios segmentados. | Recomendação para começar; não implica uma avaliação técnica completa de alternativas. |

## Núcleo da entrega

O estudante abre um exercício, traduz, guarda, consulta recursos, executa QA, pede pistas, revê e exporta. Na comparação crítica, escolhe e justifica antes de consultar o comentário de referência.

| ID | Resultado necessário | Evidência de conclusão |
| --- | --- | --- |
| R1 | Editor por segmentos e persistência. | Recuperar exatamente o texto guardado após reiniciar a aplicação. |
| R2 | Revisões e estados por traduzir/em revisão/concluído. | Histórico ordenado e versão final exportável. |
| R3 | Glossário e memória de tradução simples, exata e aproximada. | Mostrar equivalentes e sugestões com origem; inserção apenas por ação do utilizador. |
| R4 | QA de segmentos vazios, números e terminologia. | Casos positivos e negativos documentados; motivo de cada alerta visível. |
| R5 | Pistas e explicações por um LLM a pedido. | Resposta estruturada, associada à revisão avaliada; falhas não apagam o texto. |
| R6 | Comparação crítica com exercícios preparados. | Guardar alternativas apresentadas, escolha e justificação antes de revelar o comentário. |
| R7 | Exportação de projeto, traduções e dados de processo. | JSON para recuperar o projeto e CSV para análise; ambos com identificadores estáveis. |
| R8 | Avaliação e instruções de execução. | Métodos, versões, anotações e resultados descritos; execução reproduzível. |

Importação inicial: exercícios JSON e, posteriormente, texto com um segmento por linha e glossário CSV. Implementar estes formatos incrementalmente. Contas, turmas, colaboração em tempo real, múltiplos modelos na interface, treino de modelos e preservação do layout de PDF/DOCX ficam fora do compromisso inicial. Pontuação e verificações adicionais são extensões após estabilizar as três famílias de QA.

## O que implementar primeiro

**Incremento 5A:** abrir um exercício fixo de três segmentos, escrever uma tradução, clicar em Guardar, recarregar e recuperar o mesmo conteúdo. Guardar revisões desde este incremento.

O primeiro ecrã só necessita de lista de segmentos, original, campo de tradução, botão Guardar e indicação de alterações por guardar/guardado/erro. O [desenho e contrato de dados](editor.md) especifica esse percurso.

**Incremento 5B:** gravação automática, estados e exportação JSON. Adicionar depois de o percurso com gravação explícita estar verificado.

O incremento 5A não depende de instalar um modelo, concluir o estado da arte, terminar o conjunto de teste ou recrutar participantes. Depende apenas de aceitar o contrato mínimo do editor e o âmbito acima.

## Tarefas pequenas para começar

| Ordem | Tarefa | Depende de | Critério de conclusão |
| --- | --- | --- | --- |
| P1 | Rever este âmbito e as decisões pendentes. | — | Ambos compreendem o que entra no incremento 5A. |
| P2 | Rever os 20 exemplos de desenvolvimento e o protocolo. | — | Corrigir ambiguidades e identificar quem fará a validação linguística. Pode decorrer durante 5A. |
| P3 | Executar o ensaio local do LLM. | Instalação local do Ollama e modelo. | Registar respostas reais, falhas e duração; decidir o candidato. Pode decorrer durante 5A. |
| P4 | Rever o ecrã e os pedidos/respostas da API. | P1 | Frontend e backend usam os mesmos campos e estados de gravação. |
| 5A.1 | Criar o ambiente mínimo de frontend/backend. | P4 | Ambos executam a base local com instruções no README. |
| 5A.2 | Criar dados iniciais e leitura do exercício. | 5A.1 | A API devolve os três segmentos na ordem definida, sem os duplicar ao reiniciar. |
| 5A.3 | Implementar guardar revisão numa transação. | 5A.2 | Guardar e recuperar texto; tratar revisão desatualizada e erro de escrita. |
| 5A.4 | Ligar o ecrã à leitura e gravação. | 5A.2 e 5A.3 | Estado guardado só aparece após confirmação da API; erro mantém o rascunho. |
| 5A.5 | Verificar o percurso e documentar execução. | 5A.4 | Recarregar e reiniciar preservam o conteúdo; caracteres e espaços não são alterados. |

Liderança proposta, ajustável à experiência: Diogo na API, persistência e ensaio LLM no M5; Mariana no editor. Exemplos, decisões, revisão e artigo são partilhados. Integrar o primeiro ecrã assim que a leitura da API existir, sem esperar por todos os módulos.

## Marcos do Gantt

| Período de 2026 | Resultado a demonstrar |
| --- | --- |
| Até 18/10 | Âmbito inicial e contrato do editor revistos. |
| 19–25/10 | Incrementos 5A/5B, protocolo inicial e primeiro ensaio LLM. |
| 26/10–01/11 | Glossário, QA, memória e revisões integrados. |
| 02–08/11 | Pistas LLM e comparação crítica integradas. |
| 09–15/11 | Estabilização; congelar métodos e conjunto de teste. |
| 16–22/11 | Avaliação e primeira versão completa do artigo. |
| 23–27/11 | Revisão, documentação e ensaio da apresentação. |
| 28–30/11 | Margem final e entrega universitária. |

São marcos de planeamento, não estimativas de progresso. Rever semanalmente face às horas efetivamente disponíveis. Se um marco falhar, reduzir extensões e discutir alterações ao núcleo, preservando tempo para avaliação e escrita.

## Antes de integrar no artigo

- Preencher o protocolo experimental a partir de [evaluation/README.md](../evaluation/README.md), depois da revisão do grupo.
- Decidir se RQ3 será estudada com participantes ou reformulada/adiada. Ensaios pelos autores não representam estudantes de tradução.
- Manter a pilha tecnológica numa descrição breve e justificada; retirar a dúvida editorial «APAGAR?» quando a decisão estiver tomada.
- Corrigir os campos `url` da bibliografia: atualmente contêm ligações Markdown em vez de URLs simples.
- Rever afirmações de ausência de funcionalidades e de melhoria da aprendizagem à luz das fontes; «não documentado» não significa «inexistente».
- Substituir a promessa absoluta de privacidade por uma descrição verificável do processamento local e do tratamento dos dados.

Estas sugestões não foram aplicadas a `paper/main.typ`.
