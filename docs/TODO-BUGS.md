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

### TODO-018: Open redirect no `next` do login com caracteres de controlo (`/%09/evil.com`)
- Found: 2026-11-04 na revisão de segurança (`docs/security-review.md`, item 3)
- Evidence: `safeNextPath` (`src/lib/auth/paths.ts`) só recusava `//` e `\`. `searchParams.get("next")` devolve `/\t/evil.com` para `/%09/evil.com`; o parser de URL apaga tab/CR/LF, então `new URL("/\t/evil.com", origin)` = `https://evil.com/`. Afeta `/auth/callback` (depois do magic link), o login por palavra-passe (`window.location.assign`) e o `emailRedirectTo`. Com o código antigo, 3 casos do novo teste falham (`%09`, `%0a`, `%0d%0a`)
- Expected: só caminhos relativos da mesma origem; nunca redirecionar para outro site
- Acceptance: testes de `paths.test.ts` e `auth-routes.test.ts` com variantes absolutas, `//`, `/\`, codificadas e com caracteres de controlo; `npm test` passa
- Severity: medium
- Status: done (2026-11-04) - `safeNextPath` recusa caracteres de controlo/espaço, `\`, `//`, mais de 2048 chars e confere que o destino resolve para a mesma origem; 11 casos novos no callback e 21 em `safeNextPath`

### TODO-019: Matcher do proxy saltava páginas cujo caminho termina em `.png`/`.svg`/... (ex.: `/convite/x.png`)
- Found: 2026-11-04 na revisão de segurança (item 4)
- Evidence: o matcher excluía `.*\.(svg|png|jpg|jpeg|gif|webp|ico)$` e prefixos sem âncora (`sw.js` também excluía `/sw.jsx`). `unstable_doesMiddlewareMatch` deu `false` para `/convite/abc.png` e `/despesas/x.png`. A página do convite verifica o utilizador sozinha (sem fuga de dados), mas o proxy deixava de proteger/renovar a sessão nesses caminhos
- Expected: o proxy corre em todas as rotas de página; só ficam de fora `_next/static/`, `_next/image`, `public/icons/` e os ficheiros exatos `favicon.ico`, `manifest.webmanifest`, `sw.js`, `offline.html`
- Acceptance: `src/test/security-config.test.ts` (matcher real do Next) cobre os dois lados; `npm run qa:visual` sem falhas
- Severity: low
- Status: done (2026-11-04) - matcher em `src/proxy.ts` com exclusões exatas

### TODO-020: Sem cabeçalhos de segurança (CSP, HSTS, nosniff, frame-ancestors...) e com `X-Powered-By`
- Found: 2026-11-04 na revisão de segurança (item 5)
- Evidence: `next.config.ts` não definia `headers()`; respostas sem CSP/X-Frame-Options (clickjacking possível) e com `X-Powered-By: Next.js`
- Expected: CSP mínima (self + projeto Supabase https/wss, imagens data:/blob:), HSTS, nosniff, Referrer-Policy, X-Frame-Options DENY + `frame-ancestors 'none'`, Permissions-Policy sem câmara (o upload não usa `capture`), sem `X-Powered-By`, sem source maps no browser
- Acceptance: testes em `src/test/security-config.test.ts`; `npm run build`; `npm run qa:visual` 0 falhas; nenhuma violação de CSP no Chrome em 14 ecrãs (build de produção com dados demo)
- Severity: medium
- Status: done (2026-11-04) - `headers()`, `poweredByHeader: false`, `productionBrowserSourceMaps: false` em `next.config.ts`

### TODO-021: Modo demo sem trava para produção
- Found: 2026-11-04 na revisão de segurança (item 3)
- Evidence: só `DEMO_MODE`/`NEXT_PUBLIC_DEMO_MODE` decidiam. Se alguém os definisse na Vercel (Production), toda a app passava a usar o cliente falso, sempre autenticado como "Ana", admin, e `/api/demo` aceitava leituras/escritas de qualquer pessoa
- Expected: o modo demo nunca corre no deploy de produção
- Acceptance: build de produção com `DEMO_MODE=1` falha; em runtime as fábricas Supabase lançam erro e `/api/demo` e `/api/demo/receipt` devolvem 404 quando `VERCEL_ENV=production`; testes em `src/lib/supabase/demo-guard.test.ts` e `src/app/api/demo/route.test.ts`
- Severity: medium
- Status: done (2026-11-04) - `src/lib/supabase/demo-guard.ts`; `next.config.ts` lança erro no build com `VERCEL_ENV=production`; verificado com `VERCEL_ENV=production DEMO_MODE=1 next build` (sai com erro)

### TODO-022: Cron keepalive devolvia ao chamador o corpo de erro do Supabase
- Found: 2026-11-04 na revisão de segurança (item 3)
- Evidence: com o segredo certo, uma falha devolvia `{ ok:false, status, error: <até 500 chars do corpo PostgREST> }` e "supabase not configured"
- Expected: o chamador recebe só `{ ok:false }`; o detalhe fica nos logs da Vercel
- Acceptance: `src/app/api/cron/keepalive/route.test.ts` (502/500 com corpo `{ ok:false }`, 401 sem detalhe para variações do segredo, modo demo não abre a rota)
- Severity: low
- Status: done (2026-11-04)

### TODO-023: CSP com `'unsafe-inline'` em `script-src` (sem nonce)
- Found: 2026-11-04 na revisão de segurança (item 5)
- Evidence: o Next.js injeta scripts inline de hidratação; sem nonce, `script-src` precisa de `'unsafe-inline'`. A CSP atual já bloqueia scripts de outros domínios, `fetch` para fora do Supabase, frames, `<object>`, `<base>` e `form-action` externo, mas um XSS com script inline não seria bloqueado
- Expected: CSP com nonce gerado no `src/proxy.ts` (todas as páginas já são dinâmicas) e `'strict-dynamic'`, mantendo as páginas guardadas offline pelo service worker a funcionar
- Acceptance: nenhum `'unsafe-inline'` em `script-src` em produção; zero violações de CSP nos 14 ecrãs; teste offline do T-12 continua a passar
- Severity: low (o React escapa tudo e não há `dangerouslySetInnerHTML` no código)
- Status: open

### TODO-024: Páginas autenticadas dependem só do proxy para mandar anónimos para /login
- Found: 2026-11-04 na revisão de segurança (item 4)
- Evidence: `/calendario`, `/guarda`, `/excecoes`, `/despesas`, `/despesas/nova`, `/despesas/[id]/*`, `/saldo`, `/convidar` fazem `getUser()` e usam `""` como id quando não há sessão; não redirecionam. Não há fuga: o RLS devolve zero linhas para `anon` e a página mostra o estado vazio. `/`, `/admin`, `/convite/[token]` e `/despesas/exportar` já verificam
- Expected: defesa em profundidade: `if (!user) redirect("/login?next=...")` em cada página autenticada (ficheiros fora do âmbito desta revisão)
- Acceptance: teste por página com cliente sem sessão espera redirect para `/login`
- Severity: low
- Status: open

### TODO-025: Membros podem reescrever `created_at`/`updated_at` por UPDATE direto
- Found: 2026-11-04 na revisão de segurança (item 6)
- Evidence: as políticas de UPDATE em `expenses`, `families`, `members` e `children` não fixam os timestamps. Em `expenses`, `updated_at` mudado sozinho não gera linha de auditoria (o trigger ignora `updated_at`). Só afeta a própria família
- Expected: nova migration com trigger BEFORE UPDATE que mantém `created_at` (e define `updated_at` pelo relógio do servidor), mais teste PGlite
- Acceptance: teste PGlite mostra que `update ... set created_at = '2000-01-01'` não muda o valor; migration aplicada no projeto pelo dono
- Severity: low
- Status: open
