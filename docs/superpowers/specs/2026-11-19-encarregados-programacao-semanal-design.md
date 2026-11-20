# Encarregados e Programação Semanal — desenho

Data: 2026-11-19 · Estado: aprovado · Atualizado 2026-11-20

> **Alteração 2026-11-20:** a utilizadora passou a ter o Excel da Programação Semanal. A 1.ª versão importa
> **o Excel diretamente** (exato, sem IA nem chave). A leitura da imagem com Claude fica para uma fase seguinte,
> reaproveitando a mesma revisão (semanas · obras por abrir · nomes). Formato do Excel: coluna `ENCARREGADOS`
> (+ `TAG`), linha de datas por cima, por dia uma coluna com a obra e a seguinte com o nº (`#`); linhas sem nome
> continuam o encarregado de cima; várias semanas lado a lado. Leitura em `programacao.js`.

## Porquê
A Diretora de Logística quer saber, dia a dia, que encarregado está em que obra, para numa fase seguinte
**avisar cada encarregado por WhatsApp das viaturas afetas à sua obra**. A distribuição vem da
"Programação Semanal", que só chega em **imagem** (print do Excel de outra pessoa).

## Objetivos
1. Base de dados de **Encarregados** (nome, telemóvel, extensão, nomes alternativos) no separador Obras/Clientes.
2. **Programação Semanal**: carregar a imagem, a app lê-a com IA (Claude), mostra uma grelha para rever/corrigir e grava as afetações **por dia**.
3. Ao gravar, **todos os nº de obra têm de corresponder a obras abertas**:
   - código que não existe → aviso + botão **Criar obra** (formulário pré-preenchido com código e nome);
   - obra existe mas está inativa → aviso + botão **Reativar**.

## Não-objetivos (nesta fase)
- Envio por WhatsApp (fica preparado: telemóvel + afetação diária + obra).
- Cores da folha (azul "valorizar material", verde "alteração").
- Ler o Excel original (.xlsx) da programação.

## Anti-objetivos
- Gravar afetações com obras desconhecidas ou encarregados trocados sem a utilizadora ver.
- A leitura por IA nunca grava sozinha: há sempre revisão e confirmação.

## Abordagens consideradas
| | Abordagem | Decisão |
|---|---|---|
| A | Grelha manual + "copiar semana anterior" | Fica como apoio (mesma grelha), não é o caminho principal |
| **B** | **Carregar imagem → Claude lê → grelha de revisão** | **Escolhida pela utilizadora** |
| C | Pedir o .xlsx a quem faz a programação | Fora de âmbito |

## Desenho
### Dados (tabela `docs` existente, novas coleções em `COLS`)
- `encarregados/{id}`: `{nome, telemovel, extensao, aliases:[...], ativo, obs}`.
  Importação inicial a partir de "LISTA DE CONTACTOS DE ENCARREGADOS.xlsx" (colunas: função, nome, telemóvel, extensão).
- `programacao/{sábado AAAA-MM-DD}`: `{semana, dias:[6 datas sáb→sex], linhas:[{encId|null, nomeFolha, semEncarregado, dias:{data:[{tipo:"obra",codigo,obraId,nomeFolha} | {tipo:"ausente",motivo}]}}], estado:"rascunho"|"confirmada", lidoEm, confirmadoEm/Por}`.

### Leitura da imagem
- Supabase Edge Function `ler-programacao` (Deno, `npm:@anthropic-ai/sdk`), só para utilizadores autenticados.
- Modelo `claude-opus-5-5`, imagem em base64, resposta em JSON com esquema fixo (structured outputs).
- Chave `ANTHROPIC_API_KEY` guardada como segredo no Supabase — **definida pela utilizadora**, nunca no código.
- Custo estimado: ~0,10–0,20 € por leitura.

### Ecrã (Obras/Clientes → abas Obras · Cisternas · **Encarregados** · **Programação semanal**)
- Encarregados: tabela, novo/editar, importar Excel, sem telemóvel a vermelho.
- Programação: escolher semana → "Ler imagem" → grelha (linhas = encarregados, colunas = dias) editável;
  painel de problemas: nomes não reconhecidos (associar a encarregado existente → guarda alias, ou criar), obras por abrir (criar/reativar).
  "Gravar rascunho" sempre; "Confirmar semana" só sem problemas. "Copiar semana anterior" disponível.
- Permissões: edição só para perfil logística (`can.log()`); consulta para quem vê obras.

### Correspondência de nomes
Normalizar (maiúsculas, sem acentos, sem parênteses) → igual a nome ou alias → senão sugere por apelido/primeiro nome
→ a utilizadora confirma uma vez; o nome da folha passa a alias.

## Fica ao critério de quem implementa
Layout fino da grelha, mensagens, ordem das linhas (igual à folha).
