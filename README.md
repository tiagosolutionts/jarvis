# Jarvis — seu assistente de voz com IA, dentro do seu Vault

Um Jarvis pessoal que **conversa por voz em português**, enxerga a sua pasta de trabalho (o "Vault") e age nela: lê e cria notas, abre planilhas, imagens e sites, executa skills, cuida das tarefas e guarda memórias. Funciona no Mac e no Windows, sem instalar nada além do Node.js.

## O que ele faz
- **Voz nos dois sentidos**: fale com ele (microfone ou palavra de ativação "Jarvis") e ouça a resposta. Voz grátis do navegador ou, se quiser algo mais realista, ElevenLabs/OpenAI.
- **Vault sem limites**: mostra tudo — `.md`, `.json`, `.env`, `.csv`, imagens, vídeos, HTML, scripts. Pré-visualiza e edita no painel da direita.
- **Pedir ajuste**: abra um arquivo (ex.: um carrossel HTML) e peça a correção ali mesmo.
- **Arsenal**: skills (`.jarvis/skills/*/SKILL.md`), comandos rápidos (`/missao-do-dia`, `/carrossel`, `/revisar`), scripts e servidores MCP listados.
- **Memória e tarefas**: "Jarvis, lembra que…" grava em `.jarvis/memoria.md`; tarefas ficam em `Tarefas.md` (compatível com Obsidian).
- **Terminal (opcional)**: com permissão, roda scripts, `claude -p "…"` (Claude Code), Codex, git etc.
- **Personalizável**: nome, como te chama, personalidade, voz, modelo e chaves — tudo em Configurações.

## Instalação (5 minutos)
1. Instale o **Node.js 18+**: https://nodejs.org (versão LTS).
2. Descompacte esta pasta onde quiser.
3. Inicie:
   - **Mac**: clique duas vezes em `iniciar.command` (na primeira vez: botão direito → Abrir).
   - **Windows**: clique duas vezes em `iniciar.bat`.
   - Ou no terminal: `node server.js`
4. Abra **http://localhost:3333** no **Chrome ou Edge** (necessários para o reconhecimento de voz).
5. Em **Configurações**, cole sua chave:
   - Anthropic (Claude): https://console.anthropic.com → modelo sugerido `claude-sonnet-4-5`
   - ou OpenAI: https://platform.openai.com → modelo sugerido `gpt-4.1`
   - ou qualquer API compatível com OpenAI (OpenRouter, Ollama local em `http://localhost:11434/v1`).
6. Em **Pasta do Vault**, aponte para a sua pasta real (pode ser o seu vault do Obsidian).

## Como usar
- Toque no microfone (ou **Ctrl+Espaço**) e fale. Ele responde em voz.
- Marque **escuta contínua** e diga: "Jarvis, qual a missão do dia?"
- **Esc** interrompe a fala.
- Digite `/` + nome de um comando rápido.

## Personalizando
| Quero… | Faça |
|---|---|
| Regras permanentes | Edite `.jarvis/instrucoes.md` |
| Nova habilidade | Crie `.jarvis/skills/<nome>/SKILL.md` com `description:` no cabeçalho |
| Novo comando rápido | Crie `.jarvis/commands/<nome>.md` com o prompt |
| Listar MCPs | Edite `.mcp.json` na raiz do Vault (mesmo formato do Claude Code) |
| Voz mais natural | Configurações → Voz → ElevenLabs (chave + Voice ID) |

## Segurança
- Roda só em `127.0.0.1` (não fica exposto na rede).
- O Jarvis só acessa arquivos **dentro do Vault**.
- Execução de comandos vem **desligada**; ligue apenas se confiar no uso.
- As chaves ficam em `jarvis.config.json`, no seu computador. Não compartilhe esse arquivo.

## Limitações honestas
- O reconhecimento de voz usa o recurso do Chrome/Edge (o áudio passa pelo serviço de voz do navegador). Safari tem suporte parcial; Firefox não tem.
- Os servidores MCP são listados no Arsenal para referência; para usá-los de fato, peça ao Jarvis para delegar ao Claude Code (`claude -p`) com o terminal habilitado.
- O histórico da conversa fica na memória do servidor e é zerado ao reiniciar; o que precisa durar vai para a memória ou para notas.
