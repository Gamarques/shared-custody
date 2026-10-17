# QA visual (layout em Chrome real)

Rode depois de **qualquer mudança de UI** (feature nova, redesign, CSS global) em vez de conferir
página por página:

```bash
npm run qa:visual                          # sobe o modo demo numa porta própria, verifica, desliga
npm run qa:visual -- --url http://localhost:3000   # usa um servidor já em execução (modo demo)
npm run qa:visual -- --only /saldo,/despesas --widths 390,1280
```

Precisa de Chrome ou Edge (ou `CHROME_PATH`). Sem dependências: fala com o Chrome por CDP usando o
WebSocket do Node (`tools/visual-qa.mjs`). Código de saída 1 se algum check falhar.

## O que é verificado sozinho (cada rota x 390 / 768 / 1280 px)

| Check | Falha quando |
| --- | --- |
| overflow | a página é mais larga que a viewport, ou um elemento sai pela direita (fora de áreas com scroll próprio) |
| shell | >= 1024px sem sidebar; < 1024px sem barra de abas inferior; ou o fim do conteúdo fica atrás da barra |
| h1 | não há exatamente um `<h1>` |
| console | `console.error`, exceção não tratada ou resposta HTTP >= 400 do próprio app |
| empty | página em branco ou overlay de erro do Next |
| touch (aviso) | em 390px, botão/link/campo visível com menos de 40px de altura |

Rotas: `/`, `/calendario`, `/guarda`, `/excecoes`, `/despesas`, `/despesas/nova`, `/saldo`,
`/convidar`, `/login`, `/convite/<token>` e, descobertas na lista, `/despesas/<id>/editar` e
`/historico`. **Rota nova = acrescentar em `ROUTES` no script.** `/login`, `/convite` e `/onboarding`
não têm shell, e o script já espera isso.

Capturas em `.next-perf/visual-qa/<rota>-<largura>.png` (ignorado pelo git). O script só pega o
mecânico: **abra as imagens** e confira alinhamento, simetria, hierarquia e cortes.

## Checklist manual (o que o script não vê)

- [ ] Simetria: colunas e cards alinhados, mesmos espaçamentos e raios entre telas.
- [ ] Home, calendário, despesas e saldo em 390 e 1280 px, olhando a imagem.
- [ ] Estados: vazio, erro de carga, hover/foco (teclado), botão desabilitado, confirmação de exclusão.
- [ ] `/onboarding` (no modo demo redireciona para a home: precisa de uma família sem dados) e o link gerado em `/convidar`.
- [ ] Contraste das cores novas e navegação só por teclado (skip link, foco visível na sidebar e nas abas).
- [ ] iOS real: safe-area do menu inferior (o emulador não prova isso).
- [ ] Dados reais (com Supabase), não só os fictícios do demo.

## Antes de dar por pronto

```bash
npm run typecheck && npm test && npm run build && npm run qa:visual
git checkout -- tsconfig.json    # o next dev pode acrescentar linhas de .next-*/types
```

## Armadilhas já encontradas

- `chrome --headless --window-size=390` **corta em ~500px de largura** e parece bug de layout. Use CDP
  com `Emulation.setDeviceMetricsOverride` (o script já faz).
- O Next recusa um segundo `next dev` no mesmo diretório. Use `NEXT_DIST_DIR=.next-perf/<nome>` (o script faz).
  Isso pode alterar `tsconfig.json`: reverta.
- O "N" do Next dev e a barra de abas aparecem no meio de capturas de página inteira: artefato, não bug.
- Testes que casam markup por regex (`<strong>` etc.) quebram quando a tag ganha `className`.
