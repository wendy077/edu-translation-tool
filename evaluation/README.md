# Preparação da avaliação

Protocolo inicial, preparado em 17 de outubro de 2026 para revisão pelo grupo. Não há resultados medidos, modelo escolhido definitivamente, participantes recrutados ou anotações validadas por especialista.

## Materiais disponíveis

| Ficheiro | Finalidade |
| --- | --- |
| [data/development.json](data/development.json) | 20 exemplos sintéticos de desenvolvimento com anotações preliminares. |
| [prompt.txt](prompt.txt) | Instruções iniciais do feedback, em português europeu. |
| [feedback.schema.json](feedback.schema.json) | Estrutura JSON proposta para a resposta do modelo. |

Os exemplos e as anotações foram preparados por um assistente de IA; **não constituem um padrão de referência validado**. Devem ser revistos por pessoas com competência linguística, corrigidos e identificados como sintéticos no artigo. Não são dados de estudantes. São materiais do projeto, não uma amostra representativa de erros reais.

## Perguntas e evidência

| Pergunta do artigo | Evidência proposta | Limite da conclusão |
| --- | --- | --- |
| RQ1: diferenças entre regras, LLM e híbrido | Alertas sobre os mesmos pares anotados; precisão, recall, F1, falsos alertas e falhas. | Desempenho no conjunto delimitado, não qualidade universal da tradução. |
| RQ2: qualidade das pistas | Revisão humana de correção, evidência, clareza, utilidade e revelação da solução. | Utilidade pedagógica apreciada, não aprendizagem demonstrada. |
| RQ3: comportamento dos utilizadores | Participantes a executar tarefas e justificar escolhas, com registos associados. | Só responder se houver participantes; testes pelos autores não representam estudantes. |

Decidir a viabilidade de RQ3 até 23 de outubro, conforme a proposta. Sem participantes, propor reformulação/adiamento ao orientador e explicitar a limitação. Os exercícios de comparação e os seus registos continuam a fazer parte do protótipo.

## Categorias operacionais

São categorias locais para este ensaio. A ligação conceptual à [tipologia MQM](https://www.themqm.org/mqm-pillars/typology/) deve ser documentada na revisão; não se assume equivalência integral ou certificação MQM.

| Código | Critério | Regras iniciais | LLM |
| --- | --- | --- | --- |
| `empty` | Original com conteúdo e tradução vazia ou só com espaços. | Sim. | Sim. |
| `numbers` | Valores em algarismos alterados, adicionados ou omitidos, incluindo percentagens e repetições. | Sim, dentro das convenções delimitadas abaixo. | Sim. |
| `terminology` | Equivalente prescrito e pertinente do glossário não respeitado. | Correspondência literal normalizada com limites de palavra. | Sim, com apreciação contextual. |
| `meaning` | Outro desvio de sentido, por exemplo negação, omissão ou falso amigo. | Não. | Experimental. |

Se a tradução estiver vazia, emitir apenas `empty`. Não contar um problema numérico ou terminológico novamente como `meaning`.

Regra numérica inicial: suportar inteiros e decimais com convenções EN/PT-PT e percentagens. Comparar ocorrências de valores e unidades, não apenas valores distintos. Normalizar agrupamento de milhares e separador decimal; não confundir `25%` com `2,5%` ou com o número sem unidade `25`. Datas, horas, intervalos, números por extenso e formatos ambíguos ficam fora da cobertura inicial e devem ser tratados como casos não suportados, não como deteção semântica fiável. Identificar esses casos no conjunto final e reportar a cobertura.

Regra terminológica inicial: normalização Unicode NFC e comparação sem distinção de maiúsculas quando a entrada o permitir; respeitar termos compostos e limites de palavra. Qualquer equivalente listado é aceite. Não inferir flexões automaticamente. Um termo como `port` não ocorre autonomamente em `report`.

## Conjunto de desenvolvimento

O JSON contém 19 casos de feedback e um caso exclusivamente técnico (`dev-013`, original e tradução vazios). Nas anotações preliminares dos 19 casos: 9 traduções aceitáveis e 10 com um problema cada — 2 `empty`, 3 `numbers`, 1 `terminology` e 4 `meaning`.

Esta distribuição serve para depuração e inclui deliberadamente casos limite; é insuficiente para conclusões estatísticas. Em particular, um único erro positivo de terminologia não permite caracterizar a qualidade dessa categoria.

Cada caso separa:

- `input`: línguas, original, tradução, contexto e glossário que os métodos podem receber.
- `annotation`: problemas esperados e notas que só os avaliadores podem consultar.
- `source_group`: família de original/documento usada para evitar partilhar variantes entre desenvolvimento e teste.
- `evaluation_scope`: distingue o exercício de tradução de um teste técnico.

**Nunca enviar ao LLM `annotation`, `purpose` ou a resposta de referência.** O prompt recebe apenas `input`. O contexto deve ser disponível ao estudante e não pode ser acrescentado apenas a um dos métodos.

## Construção do conjunto de teste

1. Rever as definições e os exemplos de desenvolvimento antes de anotar os novos pares.
2. Manter a meta da proposta: cerca de 20 pares para desenvolvimento e 80 novos pares para teste, ajustável à capacidade de revisão. Os 20 ficheiros atuais incluem um caso técnico, por isso não representam 20 observações científicas.
3. Criar os pares de teste com originais e famílias diferentes; variantes do mesmo original ficam todas no mesmo conjunto. Não produzir o teste apenas com pequenas alterações dos exemplos atuais.
4. Incluir traduções aceitáveis, alternativas legítimas e várias ocorrências positivas por categoria. Definir a distribuição antes de ver as respostas dos modelos.
5. Anotar presença, categoria e evidência. Não usar uma tradução única como única definição de correção. Se possível, duas pessoas anotam uma parte independentemente e registam a resolução de divergências.
6. Manter a referência humana independente das respostas do LLM avaliado. Se só os autores anotarem, explicitar a natureza exploratória e a ausência de validação especializada.
7. Registar origem e contexto de cada par. Se forem acrescentados exemplos reais autorizados, separar a sua análise da dos exemplos sintéticos.
8. Congelar dados, prompt, regras, modelo e parâmetros antes das execuções finais. Não afinar o método a partir dos resultados de teste; correções posteriores exigem nova versão e explicação no artigo.

## Comparação e métricas de RQ1

Todos os métodos recebem os mesmos segmentos, contexto e glossário. Executar cada exemplo separadamente e sem histórico de conversa entre casos. As regras não usam anotação nem traduções de referência.

O híbrido é a união dos alertas de regras e LLM, preservando origem. Para pontuar deteção, a unidade é `(case_id, category)` e duplicados da mesma categoria no mesmo segmento contam uma única vez. Preservar alertas e explicações originais para inspeção; não fundir semanticamente as explicações antes de as avaliar.

- **Comparação comum:** projetar referências e previsões para `empty`, `numbers` e `terminology`, nos casos com cobertura definida para as regras. Incluir traduções corretas para medir falsos alertas.
- **Análise complementar:** avaliar `meaning` para LLM e híbrido; não apresentar ausência de cobertura das regras como desempenho equivalente.
- **TP:** categoria prevista e anotada no segmento. **FP:** prevista mas não anotada. **FN:** anotada mas não prevista.
- Precisão = `TP / (TP + FP)`; recall = `TP / (TP + FN)`; F1 = `2*TP / (2*TP + FP + FN)`.
- Se o denominador for zero, apresentar `N/A`, não substituir por zero silenciosamente.
- Reportar contagens e métricas por categoria; no agregado micro somar TP, FP e FN antes de calcular. Dar o denominador e o número de exemplos em cada tabela.
- Reportar também a proporção de traduções aceitáveis com pelo menos um alerta. A correção da localização dos excertos é uma análise separada da deteção por categoria.

Não assumir que a união melhora a precisão. Resultados semelhantes ou inferiores aos das regras podem ser resultados relevantes do estudo.

### Falhas e tempo de execução

Timeout, erro HTTP, JSON inválido, violação do esquema, resposta truncada e evidência não encontrada no texto são falhas técnicas. Não as converter silenciosamente em `issues: []`.

Reportar primeiro quantos casos cada método conseguiu processar. Comparar métricas dos três métodos no mesmo subconjunto de execuções válidas, indicando exclusões. Acrescentar uma análise operacional que conte como não detetados os problemas de casos falhados; esta análise não transforma as falhas em traduções aceitáveis. Se o LLM falhar no híbrido, identificar a resposta só com regras como degradada, em vez de a misturar com execuções completas.

Medir duração total, duração de carregamento quando disponível, tokens, tipo de falha e pressão de memória observada. Separar arranque a frio de pedidos com modelo carregado; executar um pedido de cada vez. Usar mediana e intervalo de tempos, indicando o número de observações. Não inferir esforço cognitivo a partir da duração de uma sessão.

## Revisão de RQ2

Rever todas as pistas dos 19 casos de desenvolvimento. No conjunto final, definir previamente uma amostra por categoria que inclua acertos e falsos alertas; se o volume permitir, rever todas. Evitar selecionar apenas exemplos favoráveis.

| Dimensão | Escala proposta |
| --- | --- |
| Correção | 0: diagnóstico incorreto; 1: parcialmente correto; 2: correto. |
| Evidência | 0: inventada/sem apoio; 1: parcial; 2: excerto e contexto sustentam a afirmação. |
| Clareza | 0: incompreensível; 1: exige interpretação; 2: clara para o público definido. |
| Utilidade da pista | 0: não orienta a revisão; 1: orientação vaga; 2: questão/indicação que ajuda a rever sem substituir a decisão. |
| Revelação da solução | Sim/não: oferece uma formulação corrigida para copiar em vez de uma pista. |

Guardar notas e exemplos justificativos, além das pontuações. Apresentar cada dimensão separadamente; não inventar um índice composto. Se houver dois avaliadores, recolher julgamentos independentes antes da discussão. Sem especialista ou estudantes, não afirmar eficácia pedagógica demonstrada.

Repetir um subconjunto fixo de cinco casos três vezes para observar variabilidade, registando as repetições separadamente. Temperatura zero não garante igualdade entre todas as execuções.

## Ensaio local do modelo — passo 3 preparado

**Estado:** não foi encontrado `ollama` no PATH nem `/Applications/Ollama.app` durante a preparação. Não foram instalados modelos nem executadas inferências.

Máquina de referência indicada pelo utilizador: MacBook Pro M5, 16 GB. A compatibilidade de Apple Silicon é documentada pelo [Ollama](https://docs.ollama.com/macos); desempenho e qualidade ainda precisam de medição. Começar com [qwen3:4b](https://ollama.com/library/qwen3:4b), quantizado, cujo ficheiro é aproximadamente 2,5 GB. O consumo em execução é superior e depende do contexto. Considerar [qwen3:8b](https://ollama.com/library/qwen3:8b) apenas se a qualidade justificar a experiência adicional.

Instalar e abrir o Ollama pela distribuição oficial. Depois, no terminal:

```bash
ollama pull qwen3:4b
ollama --version
ollama list
ollama show qwen3:4b
```

O primeiro comando descarrega vários GB; não foi executado nesta preparação. Registar versão do Ollama, identificador do modelo, quantização, data e configuração. O nome de uma tag não basta para identificar permanentemente os pesos.

### Preparar um pedido sem expor a anotação

Executar na raiz do repositório. Este bloco só prepara ficheiros temporários; não chama o modelo. Trocar `dev-014` para experimentar outro caso.

```bash
ensaio_dir=$(mktemp -d /tmp/edu-translation-XXXXXX)
python3 - "$ensaio_dir" dev-014 <<'PY'
import json
import sys
from pathlib import Path

root = Path("evaluation")
cases = json.loads((root / "data/development.json").read_text(encoding="utf-8"))["cases"]
case = next(item for item in cases if item["id"] == sys.argv[2])
payload = {
    "model": "qwen3:4b",
    "messages": [
        {"role": "system", "content": (root / "prompt.txt").read_text(encoding="utf-8")},
        {"role": "user", "content": json.dumps(case["input"], ensure_ascii=False)},
    ],
    "format": json.loads((root / "feedback.schema.json").read_text(encoding="utf-8")),
    "stream": False,
    "think": False,
    "options": {"temperature": 0, "num_ctx": 4096, "num_predict": 512},
}
output = Path(sys.argv[1])
(output / "request.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
(output / "case-id.txt").write_text(case["id"] + "\n", encoding="utf-8")
print(output)
PY
```

Depois, com o serviço local ativo, executar na mesma sessão do terminal:

```bash
curl --fail --silent --show-error --max-time 120 \
  --header 'Content-Type: application/json' \
  --data-binary @"$ensaio_dir/request.json" \
  --output "$ensaio_dir/response.json" \
  --write-out 'HTTP %{http_code}; duração %{time_total} s\n' \
  http://127.0.0.1:11434/api/chat > "$ensaio_dir/transport.txt"
```

Se o comando falhar, registar a falha e o erro do terminal; não pontuar como resposta sem problemas. Conservar a pasta indicada fora de `/tmp` antes de terminar o ensaio, pois os ficheiros temporários podem ser removidos pelo sistema. Guardar também as versões, a configuração e a avaliação humana; não publicar logs de participantes por defeito.

O limite de 120 segundos é uma proteção do ensaio, não uma meta de latência da aplicação. Contexto de 4096 e limite de 512 tokens são valores iniciais para estes textos curtos; alterações devem ser registadas. `think: false` pede resposta sem raciocínio separado; confirmar suporte na versão/modelo usados. A [API de chat](https://docs.ollama.com/api/chat) e as [respostas estruturadas](https://docs.ollama.com/capabilities/structured-outputs) documentam estes mecanismos.

Antes de classificar uma resposta, verificar:

1. O HTTP foi bem-sucedido e a resposta terminou; não terminou por limite de geração.
2. `message.content` contém um JSON compatível com `feedback.schema.json`; uma resposta JSON exterior válida não basta.
3. Cada evidência de origem é um excerto literal do original; a evidência de destino é literal ou vazia por ausência/omissão. Não aceitar índices ou excertos inventados.
4. Comparar o diagnóstico com as anotações humanas e aplicar a grelha de RQ2. Conformidade com o esquema não demonstra correção linguística.

Repetir a receita para os 20 casos, conservando resultados separados; o caso técnico não entra nas métricas linguísticas. Este procedimento prepara o ensaio exploratório, não é ainda um executor automático de métricas. Se o 4B produzir pistas insuficientes, comparar o 8B com os mesmos dados e configuração. Escolher pela correção e frequência de falsos alertas, considerando depois a latência e a memória. Não escolher a partir do conjunto final de teste.

## Critérios de saída desta preparação

- Âmbito e contrato do editor disponíveis nos documentos de `docs/`.
- Exemplos sintéticos disponíveis e corretamente separados das anotações no pedido do modelo.
- Protocolo, rubrica e formato de feedback definidos como rascunho.
- Pendentes: revisão humana dos exemplos, ensaio real do modelo, construção do conjunto final e decisão sobre participantes.

Estas pendências não bloqueiam o incremento 5A de edição e persistência. Não declarar os passos de avaliação e escolha do modelo como concluídos antes de as resolver.
