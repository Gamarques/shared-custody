# TODO de bugs

Lista de defeitos encontrados. Regras: `~/.hermes/skills/software-development/bug-todo-fix-cycle`.
Registrar aqui assim que um erro aparecer; consertar só quando for pedido; cada conserto é avaliado
pelo Jev contra os critérios de aceitação (nota >= 3.0 de 0..4).

## Open

## Done

### TODO-001: Botões e links abaixo de 44px de altura no celular
- Found: 2026-10-16 by `npm run qa:visual` (aviso touch), 390px
- Evidence: `a.topbar-brand` 28px (todas as telas); `a.btn`/`button.btn` 32px em /despesas (Confirmar, Contestar, ações da linha), /saldo (Ver mês, Ver intervalo, Histórico, Despesas, Voltar), /excecoes (Remover, presets Troca de dias/Férias/Feriado), home ("Calendário"); links "Despesas" 23px em /despesas/nova, editar e histórico; "Ir para o início" 18px em /login
- Expected: todo botão/link/campo visível >= 44px de altura (ou área de toque equivalente) em 390px sem quebrar o layout em 1280px.
- Acceptance: `npm run qa:visual` sem nenhum aviso `touch`; `npm test` e `npm run build` passam; capturas conferidas em 390 e 1280.
- Severity: medium
- Status: done (Jev 3.42, 2026-10-17)

### TODO-002: CSS antigo possivelmente sem uso em globals.css
- Found: 2026-10-16 by agente da rodada de redesign (relato)
- Evidence: regras `.handover`, `.reason`, `.swatch`, `.legend`, `.presets`, `.link-button`, `.month-nav` podem não ser mais usadas
- Expected: remover só o que não tem nenhum uso em `src/`; nada visual muda.
- Acceptance: `grep` confirma zero usos de cada seletor removido; `npm run qa:visual` e `npm test` seguem verdes, capturas iguais.
- Severity: low
- Status: done (Jev 3.67, 2026-10-17)

### TODO-003: Mock de next/font/google em mobile.test.ts não revisado
- Found: 2026-10-16 ao rodar a suíte (alteração feita por um agente em `src/lib/pwa/mobile.test.ts`)
- Evidence: o teste ganhou `vi.mock("next/font/google", ...)`; não confirmei se é necessário nem se enfraquece o teste
- Expected: confirmar que o mock é o mínimo necessário e que o teste ainda verifica o que dizia verificar (T-24).
- Acceptance: sem o mock o teste falha pelo motivo documentado; com ele continua cobrindo as mesmas asserções.
- Severity: low
- Status: done (Jev 3.91, 2026-10-17) - mock confirmed necessary and minimal (without it: "Geist is not a function" at layout.tsx:13); no code change

### TODO-004: Telas e estados nunca vistos em navegador
- Found: 2026-10-16 relatos dos agentes de redesign
- Evidence: `/onboarding` redireciona para a home no modo demo; não vistos: link gerado em /convidar, formulário de aceitar convite, estados vazios, erro de carga, hover/foco, confirmação de exclusão de despesa
- Expected: cada tela/estado capturado e revisado em 390 e 1280 px; defeitos novos viram TODOs.
- Acceptance: lista de capturas em `.next-perf/visual-qa/` (ou novo modo demo sem família para /onboarding) e relato de cada uma.
- Severity: low
- Status: done (Jev 3.72, 2026-10-17) - `DEMO_VARIANT=no-family|solo|empty|error`, `npm run qa:states` (52 capturas em .next-perf/visual-qa/states/); defeitos novos: TODO-006..012

### TODO-005: Security Advisor aponta funções sem search_path fixo em shared_custody
- Found: 2026-10-17 pelo Security Advisor após o `db push` no schema `shared_custody`
- Evidence: `function_search_path_mutable` em `custody_overrides_defaults`, `expenses_insert_defaults`, `receipt_family_id`, `expenses_guard_decision`, `expense_audit_insert_guard` (entre outras); também `auth_rls_initplan` na policy `member updates self` (members) e 13 FKs sem índice (INFO)
- Expected: funções com `set search_path = shared_custody` (ou `''`); policy usando `(select auth.uid())`; índices nas FKs usadas em joins/deletes cascata.
- Acceptance: nova migration; Security Advisor sem WARN em shared_custody; `npm test` (PGlite) e `npm run build` passam.
- Severity: low
- Status: done (Jev 3.98, 2026-10-17) - migration `20261017000100_advisor_hardening.sql` aplicada no remoto; Advisor sem WARN em shared_custody; teste `src/test/db-hygiene.sql.test.ts`

### TODO-006: Ícone errado em "Copiar link" e link truncado sem indicação em /convidar
- Found: 2026-10-17 by `npm run qa:states` (agente da TODO-004) e revisão de capturas
- Evidence: `.next-perf/visual-qa/states/convidar-link-generated-390.png` (visto por mim): "Copiar link" usa o ícone de setas trocadas (o mesmo de "Regra de guarda"); em 390 o link fica cortado no input sem sinal de que continua
- Expected: ícone de copiar (ou sem ícone) no botão; link legível/selecionável (campo com fade/ellipsis claro ou em linha própria)
- Acceptance: captura em 390 e 1280 conferida; `npm test` e `npm run build` passam
- Severity: low
- Status: done (Jev 3.18, 2026-10-17) - icone copy, link em textarea que quebra linha (rows=3 + field-sizing), botao largura total em 390

### TODO-007: Confirmação de exclusão de despesa desalinhada em 390
- Found: 2026-10-17 by `npm run qa:states` (agente da TODO-004) e revisão de capturas
- Evidence: `states/despesas-delete-confirm-390.png` (visto por mim): painel "Excluir esta despesa?" flutua à direita dos ícones de ação, deixando vazio grande e ícones soltos à esquerda
- Expected: painel alinhado à linha, na largura do card em 390, sem deixar os ícones soltos
- Acceptance: captura da confirmação em 390 sem vazio/desalinhamento; `npm run qa:states` sem falhas; `npm test` passa
- Severity: medium
- Status: done (Jev 3.14, 2026-10-17) - confirmacao virou <dialog> modal centralizado (390 e 1280); corrigida cor dos botoes herdada de .actions

### TODO-008: Confirmação de exclusão sobrepõe a linha seguinte em 1280
- Found: 2026-10-17 by `npm run qa:states` (agente da TODO-004) e revisão de capturas
- Evidence: `states/despesas-delete-confirm-1280.png` (relato do agente; confirmado por mim): popover cobre Estado/Valor de "Dentista" e parte de "Contestar" da linha acima
- Expected: confirmação não cobre conteúdo de outras linhas
- Acceptance: captura 1280 da confirmação sem sobreposição de conteúdo
- Severity: low
- Status: done (Jev 3.14, 2026-10-17) - resolvida junto com a 007 (modal nao cobre linhas)

### TODO-009: Link "Definir a regra de guarda" com 18px de altura em /calendario vazio (390)
- Found: 2026-10-17 by `npm run qa:states` (agente da TODO-004) e revisão de capturas
- Evidence: aviso touch do `npm run qa:states` em `empty-calendario-390`
- Expected: alvo de toque >= 44px
- Acceptance: `npm run qa:states` sem aviso touch; `npm run qa:visual` segue sem avisos
- Severity: medium
- Status: done (Jev 3.42, 2026-10-17) - corrigida (avaliada em conjunto com 009-012); capturas empty-* conferidas em 390 e 1280

### TODO-010: Texto truncado em cards: "Nenhuma contest…" (390, /despesas vazio) e "Definir a regra de gu…" (sidebar 1280, home vazia)
- Found: 2026-10-17 by `npm run qa:states` (agente da TODO-004) e revisão de capturas
- Evidence: `states/empty-despesas-390.png`, `states/empty-home-1280.png` (relato do agente; confirmado por mim)
- Expected: texto completo (quebra de linha) ou rótulo mais curto, sem corte
- Acceptance: capturas conferidas sem texto cortado em 390 e 1280
- Severity: low
- Status: done (Jev 3.42, 2026-10-17) - corrigida (avaliada em conjunto com 009-012); capturas empty-* conferidas em 390 e 1280

### TODO-011: "Todos os meses" em /despesas parece texto solto, sem aparência de link/botão
- Found: 2026-10-17 by `npm run qa:states` (agente da TODO-004) e revisão de capturas
- Evidence: `states/empty-despesas-390.png` (relato do agente; confirmado por mim)
- Expected: ação reconhecível como clicável (btn secundário/link) e alvo >= 44px
- Acceptance: captura 390 conferida; sem aviso touch
- Severity: low
- Status: done (Jev 3.42, 2026-10-17) - corrigida (avaliada em conjunto com 009-012); capturas empty-* conferidas em 390 e 1280

### TODO-012: Links "Despesas" e "Voltar" no rodapé de /saldo pequenos e sem destaque
- Found: 2026-10-17 by `npm run qa:states` (agente da TODO-004) e revisão de capturas
- Evidence: `saldo-390.png` (visto por mim): texto pequeno solto no fim da página
- Expected: links do rodapé com aparência de ação e alvo >= 44px, ou removidos se redundantes com a barra inferior
- Acceptance: captura 390 conferida; sem aviso touch; `npm test` passa
- Severity: low
- Status: done (Jev 3.42, 2026-10-17) - corrigida (avaliada em conjunto com 009-012); capturas empty-* conferidas em 390 e 1280

### TODO-013: Cron keepalive falha em produção: RPC chamada no schema public (PGRST202)
- Found: 2026-11-03 no primeiro deploy Vercel (`vercel crons run /api/cron/keepalive`)
- Evidence: log de produção `supabase_keepalive` com `ok:false, status:404, code PGRST202` "Could not find the function public.keepalive_ping". `src/lib/keepalive/keepalive.ts` faz `POST /rest/v1/rpc/keepalive_ping` sem o header `Content-Profile: shared_custody`, mas a migration cria `shared_custody.keepalive_ping()` (os clientes Supabase usam `db.schema = DB_SCHEMA`)
- Expected: o ping chega a `shared_custody.keepalive_ping()` e o log mostra `ok:true` com a hora da BD
- Acceptance: teste unitário cobre o header de schema; após redeploy, `vercel crons run /api/cron/keepalive` gera `supabase_keepalive` com `ok:true`; `npm test` passa
- Severity: high (sem ping o projeto Supabase gratuito pausa ao fim de ~7 dias, RNF-06)
- Status: done (Jev 3.68, 2026-11-03) - headers `Content-Profile`/`Accept-Profile` = `DB_SCHEMA` + teste; em produção o cron deu `ok:true` depois da TODO-014

### TODO-014: Schema `shared_custody` não está exposto na API do Supabase (PGRST106)
- Found: 2026-11-03 ao disparar o cron em produção depois do fix da TODO-013
- Evidence: log `supabase_keepalive` com `status:406, code PGRST106` "Invalid schema: shared_custody", hint "Only the following schemas are exposed: public, graphql_public" (projeto `lmqamwidjbwquefpjxlr`). `docs/MANUAL-STEPS.md` dizia que o schema já estava em `pgrst.db_schemas`, mas `pg_roles.rolconfig` do `authenticator` não tinha essa chave. Afeta todas as chamadas da app, não só o cron (os clientes usam `db.schema = shared_custody`)
- Expected: `shared_custody` exposto ao PostgREST (`alter role authenticator set pgrst.db_schemas = 'public, graphql_public, shared_custody'; notify pgrst, 'reload config';`)
- Acceptance: `vercel crons run /api/cron/keepalive` gera `supabase_keepalive` com `ok:true`; uma chamada REST com `Content-Profile: shared_custody` deixa de devolver PGRST106; `docs/MANUAL-STEPS.md` corrigido
- Severity: high (app em produção não acede à BD)
- Status: done (Jev 3.85, 2026-11-03) - `pgrst.db_schemas` aplicado via MCP com OK do utilizador; REST e cron em produção com `ok:true`

### TODO-015: `npm run qa:visual` e `npm run build` param uma vez sim, outra não (aviso de segurança do Next.js)
- Found: 2026-11-03 ao rodar a QA visual da feature /admin
- Evidence: `next dev` (servidor demo da QA) e `next build` saem com `SecurityFatalError: Your version of Next.js is affected by a known security vulnerability` e "Retry the same command to continue"; na corrida seguinte continuam. Na QA isso aparece como FAIL em todas as rotas ("This site can't be reached", touch `a "Checking the proxy and the fir"`). Next instalado: 16.4.0
- Expected: atualizar o Next.js para uma versão sem o aviso (decisão do dono; não foi feito aqui) ou, até lá, a QA repetir o arranque do servidor quando ele sai logo após o `Ready`
- Acceptance: duas corridas seguidas de `npm run qa:visual` e de `npm run build` passam sem repetir comandos; `npm test` passa
- Severity: medium (resultados de QA/CI falsos)
- Status: done (Jev 3.90, 2026-11-03) - Next.js 16.4.0 -> 16.4.5 (npm audit: 0 vulnerabilidades); build e qa:visual passam 2x seguidas sem aviso

### TODO-016: QA visual reescreve `tsconfig.json`
- Found: 2026-11-03 depois de `npm run qa:visual`
- Evidence: o servidor demo da QA usa `distDir` `.next-perf/visual-qa-dev` e o Next acrescenta `.next-perf/visual-qa-dev/types/**/*.ts` e `.next-perf/visual-qa-dev/dev/types/**/*.ts` ao `include` do `tsconfig.json`, deixando a árvore suja a cada corrida
- Expected: correr a QA não altera ficheiros versionados (por exemplo, incluir essas entradas uma vez no `tsconfig.json` ou usar um tsconfig próprio para a QA)
- Acceptance: `git status` limpo depois de `npm run qa:visual`; `npm run typecheck` e `npm run build` passam
- Severity: low
- Status: open

### TODO-017: QA visual nunca hidrata as páginas (capturas só com o HTML do servidor)
- Found: 2026-11-04 ao conferir o aviso de sucesso (toast) nas capturas de `/despesas?ok=despesa-atualizada`
- Evidence: `tools/visual-qa.mjs` abria `http://127.0.0.1:3190`; o `next dev` registra "Blocked cross-origin request to Next.js dev resource /_next/hmr from \"127.0.0.1\"" e nenhum elemento ganha as chaves `__react*` (sem hidratação, nenhum efeito de Client Component corre). Pelo mesmo endereço com `localhost` a página hidrata e o toast aparece. `tools/qa-states.mjs` já usava `localhost` por esse motivo
- Expected: a QA visual carrega as páginas por `localhost`, para as capturas e o check `console` refletirem a app hidratada
- Acceptance: `npm run qa:visual` passa; a captura `despesas-ok-despesa-atualizada-390.png` mostra o toast "Despesa atualizada."
- Severity: medium (capturas e checks da QA visual não cobriam nada que dependa de JavaScript no cliente)
- Status: fixed in working tree (2026-11-04, feature de confirmação visual) - `BASE` passou a `http://localhost:<porta>`; aguarda avaliação
