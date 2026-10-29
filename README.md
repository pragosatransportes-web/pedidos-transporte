# Pedidos de Transporte CPSA

Plataforma de pedidos de transporte, frota e planeamento do Departamento de Logística (Construções Pragosa).

- **Página:** GitHub Pages (este repositório, pasta raiz).
- **Dados e login:** Supabase (base de dados Postgres, login por email e palavra-passe).
- **Acesso:** só emails @pragosa.pt; só entra quem tiver o email registado em *Utilizadores*, ou estiver na tabela `app_admins`. As regras estão no servidor (Row Level Security), não na página.

## Instalação (uma vez)

1. Supabase › **SQL Editor** › colar `instalar.sql` (entregue à parte, com os dados; o `schema.sql` deste repositório é só a estrutura) › **Run**.
2. Supabase › **Authentication › URL Configuration** › *Site URL* = endereço do GitHub Pages.
3. GitHub › **Settings › Pages** › *Deploy from a branch* › `main` / `(root)`.
4. Primeiro acesso: abrir a página › “Primeiro acesso: criar palavra-passe” › confirmar o email.

## Ficheiros

| Ficheiro | O que é |
|---|---|
| `index.html` | A plataforma |
| `planeamento.html`, `catalogo.js`, `pm-regras.js`, `taco.js` | Auxílio ao planeamento de máquinas e tempos de viagens |
| `supa.js` | Ligação ao Supabase e ecrã de entrada |
| `config.js` | Endereço e chave pública (*anon*) do projeto Supabase |
| `schema.sql` | Estrutura e regras de acesso (sem dados). Os dados nunca vão para este repositório público. |

A chave *anon* é pública por natureza; a proteção dos dados está nas regras do servidor. Nunca colocar aqui a chave *service_role*.
