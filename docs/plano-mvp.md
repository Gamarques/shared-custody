# MVP – App de Guarda Partilhada

Oct 14, 2026 · @Gabriel Marques

## Visão geral

O MVP é um PWA para dois responsáveis dividirem a guarda semanal de um filho e registrarem despesas, com o saldo entre eles calculado automaticamente.

| Item | Definição |
| --- | --- |
| Usuários | Apenas os dois responsáveis (sem advogado, mediador ou acesso de leitura) |
| Guarda | Sempre semanal e alternada, com dia e hora de troca definidos pelo casal |
| Despesas | Divisão configurável: cada despesa tem o percentual de quem pagou, com um padrão definido pela família |
| Stack | Next.js (App Router), Supabase no plano grátis (Auth, Postgres, Storage), PWA instalável |
| Fora do escopo | Notificações push, pedidos de troca com aceite, relatórios em PDF, chat, vários filhos com despesas por filho |

## Requisitos funcionais

O MVP tem 17 requisitos; o que ficou de fora está na lista pós-MVP, ao final da seção.

| ID | Requisito | Prioridade |
| --- | --- | --- |
| RF-01 | Login por e-mail com magic link | Must |
| RF-02 | Criar a "família" e convidar o outro responsável por link/e-mail | Must |
| RF-03 | Cadastrar o filho (nome) e a cor de cada responsável | Must |
| RF-04 | Configurar a regra de guarda: quem começa, data de início, dia e hora da troca | Must |
| RF-05 | Home mostrando "com quem está hoje" e quando é a próxima troca | Must |
| RF-06 | Calendário mensal com cada semana colorida pelo responsável | Must |
| RF-07 | Exceção pontual: trocar dias específicos, férias ou feriados, com motivo | Should |
| RF-08 | Cadastrar despesa: valor, data, descrição, categoria, quem pagou, comprovante em foto | Must |
| RF-09 | Definir o percentual de cada responsável por despesa, com padrão da família editável | Must |
| RF-10 | Lista de despesas com filtro por mês, categoria e quem pagou | Must |
| RF-11 | O outro responsável confirma ou contesta a despesa, com comentário | Should |
| RF-12 | Histórico de alterações de cada despesa (quem mudou o quê e quando) | Must |
| RF-13 | Saldo do período: quem deve quanto ao outro | Must |
| RF-14 | Registrar um acerto de contas (pagamento entre os dois) e abater do saldo | Must |
| RF-15 | Exportar despesas do mês em CSV | Could |
| RF-16 | PWA instalável, com leitura offline do calendário | Must |
| RF-17 | Edição e exclusão de despesa com exclusão lógica, sem apagar o histórico | Should |

**Ideias para depois do MVP**

- Notificações push (no iOS só funcionam com o PWA instalado)
- Pedido de troca de dias com aceite do outro responsável
- Vários filhos, com despesas por filho
- Relatório mensal em PDF
- Despesas recorrentes (mensalidade escolar, plano de saúde)
- Esquemas de guarda além do semanal (2-2-3, quinzenal)
- Anexos e documentos, como vacinas e consultas médicas

## Requisitos não funcionais

Os dados são de família e envolvem dinheiro, então o isolamento por família e a rastreabilidade pesam mais que qualquer funcionalidade extra.

| ID | Requisito | Detalhe |
| --- | --- | --- |
| RNF-01 | Isolamento de dados | RLS ativo em todas as tabelas, com acesso só a membros da própria família |
| RNF-02 | Valores monetários | Inteiros em centavos, nunca float; moeda por família (padrão EUR) |
| RNF-03 | Rastreabilidade | Toda criação, edição e exclusão de despesa grava um registro de auditoria imutável |
| RNF-04 | Fuso horário | Troca de guarda calculada no fuso da família (padrão Europe/Lisbon), não em UTC puro |
| RNF-05 | PWA | Manifest, service worker, instalável no Android e iOS; calendário legível offline |
| RNF-06 | Plano grátis do Supabase | Projeto pausa após cerca de 7 dias sem atividade: ping periódico por cron; Storage de 1 GB: comprimir fotos no cliente (máx. \~300 KB) |
| RNF-07 | Desempenho | Home carrega em menos de 2 s em 4G, com os dados do dia vindos de uma única consulta |
| RNF-08 | Privacidade | Comprovantes em bucket privado, acessados por URL assinada de curta duração |
| RNF-09 | Testes | Testes unitários das regras de guarda e de saldo, que concentram o risco do produto |

## Modelo de dados

São 9 tabelas no Postgres do Supabase, todas com `family_id` para que uma única regra de RLS isole os dados.

| Tabela | Campos principais | Observação |
| --- | --- | --- |
| `families` | id, name, timezone, currency, default\_payer\_share\_bps, created\_at | `default_payer_share_bps` em pontos-base: 5000 = quem pagou arca com 50% |
| `members` | id, family\_id, user\_id (auth.users), display\_name, color, role | Máximo de 2 por família (trigger ou constraint) |
| `invites` | id, family\_id, email, token, expires\_at, accepted\_at | Convite do segundo responsável |
| `children` | id, family\_id, name, birth\_date | No MVP, 1 filho; a tabela já permite vários |
| `custody_rules` | id, family\_id, starts\_on, first\_member\_id, handover\_weekday, handover\_time, valid\_from, valid\_to | Nova versão ao mudar a regra, sem apagar a anterior |
| `custody_overrides` | id, family\_id, starts\_at, ends\_at, member\_id, reason, created\_by | Exceção que prevalece sobre a regra |
| `expenses` | id, family\_id, paid\_by, amount\_cents, spent\_on, description, category, payer\_share\_bps, receipt\_path, status, created\_by, deleted\_at | `status`: pending, confirmed, disputed |
| `settlements` | id, family\_id, from\_member, to\_member, amount\_cents, settled\_on, note | Acerto de contas entre os dois |
| `expense_audit` | id, expense\_id, family\_id, changed\_by, changed\_at, action, old\_data (jsonb), new\_data (jsonb) | Preenchida por trigger, sem UPDATE ou DELETE |

**Relações**

- `families` 1—N `members`, `children`, `custody_rules`, `custody_overrides`, `expenses`, `settlements`, `invites`
- `expenses` 1—N `expense_audit`
- `expenses.paid_by`, `custody_*.member_id` e `settlements.*_member` apontam para `members`

**RLS (padrão para todas as tabelas)**

```sql
create function is_family_member(fid uuid) returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from members
    where family_id = fid and user_id = auth.uid()
  );
$$;

create policy "family members only" on expenses
  for all using (is_family_member(family_id))
  with check (is_family_member(family_id));
```

Exceções: `expense_audit` permite apenas `select` e `insert` (via trigger); `invites` é lido por token em uma função própria, pois o convidado ainda não é membro.

## Regras de negócio

Duas regras concentram o risco: quem tem a guarda em determinado instante e quanto cada um deve ao outro. Ambas precisam de testes unitários antes de qualquer tela.

**Guarda: quem está com a criança**

1. A troca acontece em `handover_weekday` às `handover_time`, no fuso da família.
2. A primeira semana começa em `starts_on` (primeira troca) com `first_member_id`.
3. O índice da semana é o número de períodos de 7 dias completos desde essa primeira troca; índice par = `first_member_id`, ímpar = o outro responsável.
4. Se o instante cai dentro de uma exceção (`custody_overrides`), vale o responsável da exceção; havendo sobreposição, vale a criada por último.
5. Ao mudar a regra, cria-se uma nova linha com `valid_from`; as semanas passadas continuam seguindo a regra antiga.

```latex
n = \lfloor (t - t_0) / 7\,\text{dias} \rfloor, \quad \text{responsável} = \begin{cases} \text{primeiro} & n \text{ par} \\ \text{outro} & n \text{ ímpar} \end{cases}
```

**Despesas: quanto cada um deve**

1. A quota do pagador é `amount_cents × payer_share_bps / 10000`, arredondada ao centavo; o outro responsável fica com o restante, para a soma fechar exatamente.
2. O que o outro deve em cada despesa é `amount_cents` menos a quota do pagador.
3. Saldo = soma do que A deve a B nas despesas pagas por B, menos o que B deve a A nas pagas por A, menos os acertos de A para B, mais os de B para A.
4. Despesa contestada fica fora do saldo principal e aparece em uma linha separada, "em disputa".
5. Editar uma despesa já confirmada devolve o status para `pending`.

**Exemplo de saldo**

| Despesa | Quem pagou | Valor | Quota do pagador | Quem deve | Valor devido |
| --- | --- | --- | --- | --- | --- |
| Material escolar | Ana | 100,00 € | 50% | Bruno | 50,00 € |
| Dentista | Bruno | 80,00 € | 30% | Ana | 56,00 € |
| **Saldo** |  |  |  | **Ana deve a Bruno** | **6,00 €** |

## Backlog por sprint

São 4 sprints de 1 semana e 25 tarefas (premissa: um desenvolvedor, ritmo parcial; se for de 2 semanas, o escopo cabe em 8). Tamanhos: P = até meio dia, M = 1 dia, G = 2 dias ou mais. Uma tarefa só está pronta com teste passando e RLS conferida.

### Sprint 1 — Fundação

Meta: os dois responsáveis entram, formam a família e instalam o app com dados isolados.

| ID | Tarefa | Req. | Critério de aceite | Tam. |
| --- | --- | --- | --- | --- |
| T-01 | Projeto Next.js + Supabase, variáveis de ambiente e deploy na Vercel | — | URL pública abre a home | P |
| T-02 | Login por magic link | RF-01 | Entrar e sair; sessão persiste ao reabrir | M |
| T-03 | Criar família, nome de exibição e cor | RF-02, RF-03 | Usuário novo cai no onboarding e termina com família criada | M |
| T-04 | Convite do outro responsável por link | RF-02 | Convidado entra pelo link e vira membro; terceiro membro é bloqueado | M |
| T-05 | Schema inicial, RLS e testes de isolamento | RNF-01 | Usuário de outra família não lê nem escreve nenhuma linha | G |
| T-06 | PWA base: manifest, ícones e service worker | RF-16 | Instalável no Android e no iOS (Adicionar à Tela de Início) | M |

### Sprint 2 — Guarda

Meta: abrir o app e saber com quem a criança está hoje e nas próximas semanas.

| ID | Tarefa | Req. | Critério de aceite | Tam. |
| --- | --- | --- | --- | --- |
| T-07 | Função `getCustodyHolder(instante)` com testes | RNF-09 | Cobre troca no domingo às 18h, virada de ano, horário de verão e mudança de regra | G |
| T-08 | Tela de configuração da regra de guarda | RF-04 | Salvar regra gera nova versão; a anterior é preservada | M |
| T-09 | Home "com quem está hoje" e próxima troca | RF-05 | Mostra responsável, cor e contagem até a troca | M |
| T-10 | Calendário mensal com semanas coloridas | RF-06 | Mês inteiro correto, com a troca marcada no dia certo | G |
| T-11 | Exceções pontuais (trocar dias, férias, feriados) | RF-07 | Exceção sobrepõe a regra e aparece no calendário com o motivo | M |
| T-12 | Calendário legível offline | RF-16 | Em modo avião, abre o mês já visto | M |

### Sprint 3 — Despesas

Meta: registrar, revisar e rastrear despesas com comprovante.

| ID | Tarefa | Req. | Critério de aceite | Tam. |
| --- | --- | --- | --- | --- |
| T-13 | Formulário de despesa com percentual por despesa e padrão da família | RF-08, RF-09 | Valor em centavos; percentual padrão vem preenchido e é editável | G |
| T-14 | Upload de comprovante com compressão no cliente | RNF-06, RNF-08 | Foto vira até \~300 KB; só membros acessam, por URL assinada | M |
| T-15 | Lista de despesas com filtros | RF-10 | Filtra por mês, categoria e quem pagou; total do filtro visível | M |
| T-16 | Confirmar ou contestar despesa | RF-11 | Só o outro responsável decide; contestar exige comentário | M |
| T-17 | Trigger de auditoria e tela de histórico | RF-12, RNF-03 | Toda alteração gera registro; a tabela não aceita update nem delete | G |
| T-18 | Editar e excluir (lógico) despesa | RF-17 | Excluída some da lista, mas permanece na auditoria | M |

### Sprint 4 — Saldo e lançamento

Meta: saldo correto entre os dois e o app pronto para uso real.

| ID | Tarefa | Req. | Critério de aceite | Tam. |
| --- | --- | --- | --- | --- |
| T-19 | Função de saldo com testes | RF-13, RNF-09 | Bate com o exemplo da seção de regras e fecha ao centavo | G |
| T-20 | Tela de saldo com linha "em disputa" | RF-13 | Mostra quem deve a quem, por período | M |
| T-21 | Registrar acerto de contas | RF-14 | Acerto abate o saldo e aparece no histórico | M |
| T-22 | Exportar despesas do mês em CSV | RF-15 | Arquivo abre no Excel com acentos corretos | P |
| T-23 | Cron de ping para o Supabase não pausar | RNF-06 | Execução semanal confirmada nos logs | P |
| T-24 | QA end-to-end em Android e iOS | RNF-05, RNF-07 | Fluxo completo sem erro nos dois sistemas; home abaixo de 2 s em 4G | G |
| T-25 | Uso real pelos dois por 2 semanas (após o Sprint 4) | — | Lista de ajustes priorizada para a próxima versão | M |

## Riscos e decisões em aberto

O maior risco técnico é o horário da troca (fuso e horário de verão); o maior risco de produto é a contestação de despesas, que o app registra mas não arbitra.

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Projeto grátis do Supabase pausa por inatividade | App fora do ar sem aviso | Cron semanal de ping (T-23) e alerta no primeiro uso após pausa |
| Troca de guarda errada por fuso ou horário de verão | Responsável errado na home | Cálculo no fuso da família e testes de virada de horário (T-07) |
| iOS limita PWA fora da tela inicial (armazenamento e push) | Dados offline e avisos perdidos | Orientar a instalação no onboarding; push fica pós-MVP |
| Dados de criança e financeiros sob RGPD | Exposição indevida | Região da UE ao criar o projeto, RLS em tudo, bucket privado |
| Estouro do Storage de 1 GB | Upload de comprovantes falha | Compressão no cliente e limite de tamanho por foto |
| Disputa de despesa sem desfecho | Saldo travado | Linha "em disputa" separada; resolução fica entre os dois |

**Decisões em aberto**

- Moeda padrão da família: EUR ou BRL? O MVP assume EUR, configurável.
- Despesa contestada entra no saldo? O MVP assume que não.
- Quem edita uma despesa já confirmada? O MVP assume que só quem a criou, voltando a `pending`.
- Categorias: lista fixa inicial (saúde, escola, alimentação, vestuário, lazer, transporte, outros) ou livre?
- Idioma: o app nasce em português; vale prever tradução (i18n) desde o início?
- Nome e identidade visual do app.
