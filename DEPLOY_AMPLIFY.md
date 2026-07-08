# 🚀 Deploy no AWS Amplify + EC2 (Backend)

Guia completo para colocar o Creatools no ar usando **AWS Amplify** para o frontend e **EC2** para o backend + banco de dados.

---

## 📐 Arquitetura final

```
┌──────────────────────────────────────────────┐
│  Usuário no navegador                        │
│  https://seu-dominio.com                     │
└─────────────────┬────────────────────────────┘
                  │
       ┌──────────┴──────────┐
       ▼                     ▼
┌──────────────┐    ┌────────────────────┐
│  AWS Amplify │    │  AWS EC2           │
│  (frontend)  │───▶│  api.seu-dom.com   │
│  React build │    │  FastAPI + Node    │
│  + CDN CloudF│    │  + PostgreSQL      │
└──────────────┘    └────────────────────┘
```

- **Frontend**: React estático hospedado no Amplify (com CDN global e HTTPS grátis)
- **Backend**: EC2 rodando o `install.sh` (backend + banco de dados)

---

## 🧾 Pré-requisitos

- Conta AWS ativa
- Domínio próprio (opcional mas recomendado)
- Repositório GitHub com o código já commitado (`APPFINALV3`)
- Chave da API tik.tools
- (Opcional) Chave EMERGENT_LLM_KEY para features de IA

---

## 🪜 Passo 1 — Provisionar o Backend em EC2

O backend precisa estar rodando **antes** de você configurar o Amplify (para saber a URL).

### 1.1 Criar EC2

1. Acesse [console.aws.amazon.com/ec2](https://console.aws.amazon.com/ec2)
2. **Launch Instance** → nome: `creatools-backend`
3. **AMI**: Ubuntu Server 22.04 LTS
4. **Type**: t3.small (2vCPU / 2GB) mínimo — recomendado t3.medium
5. **Key pair**: crie e baixe o `.pem`
6. **Storage**: 20GB gp3
7. **Security Group** — crie um novo com estas regras:

| Type | Port | Source | Descrição |
|---|---|---|---|
| SSH | 22 | Meu IP | Acesso SSH |
| HTTP | 80 | 0.0.0.0/0 | HTTP (para Certbot) |
| HTTPS | 443 | 0.0.0.0/0 | HTTPS |

8. **Launch instance** e anote o **IP público (IPv4)**

### 1.2 Instalar o backend + DB

SSH na EC2 e rode:

```bash
ssh -i sua-chave.pem ubuntu@<ip-publico>
sudo su -

# ⚠️ Primeiro certifique-se que o "Save to GitHub" foi feito no Emergent
curl -fsSL https://raw.githubusercontent.com/leopivas/APPFINALV3/main/install.sh | bash
```

Aguarde ~5-10 min. Ao final, guarde as **credenciais do banco** que aparecem.

### 1.3 Apontar subdomínio para a EC2

No seu registrador de DNS, crie um registro **A**:

```
Nome: api            (vai virar api.seu-dominio.com)
Tipo: A
Valor: <ip-publico-da-ec2>
TTL: 300
```

### 1.4 HTTPS grátis no backend

Aguarde 5-15 min pela propagação DNS, depois **na EC2**:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.seu-dominio.com
```

Agora o backend está acessível em: **`https://api.seu-dominio.com`** ✅

### 1.5 Habilitar CORS no backend (importante!)

Como o frontend está em outro domínio (Amplify), o backend precisa aceitar requisições cross-origin. **Edite** `/opt/creatools/backend/server.py` para ajustar CORS:

```bash
# Ver a config atual do CORS
sudo grep -A5 "CORSMiddleware\|allow_origins" /opt/creatools/backend/server.py
```

Se precisar restringir os origins, você pode adicionar no `.env`:

```bash
sudo nano /opt/creatools/backend/.env
# Adicione:
CORS_ALLOWED_ORIGINS=https://seu-app.amplifyapp.com,https://seu-dominio.com
```

E reinicie:
```bash
sudo supervisorctl restart creatools-backend
```

---

## 🪜 Passo 2 — Configurar o AWS Amplify

### 2.1 Criar novo app no Amplify

1. Acesse [console.aws.amazon.com/amplify](https://console.aws.amazon.com/amplify)
2. **New app** → **Host web app**
3. Escolha **GitHub** (autorize se pedir)
4. Selecione o repositório: **`leopivas/APPFINALV3`**
5. Selecione a branch: **`main`** (ou a que você usa)

### 2.2 Configurar o Monorepo (parte crucial!)

Na tela de configuração do build:

- ✅ **Marque a caixa** "My app is a monorepo"
- No campo que aparece, coloque:
  ```
  (deixe em branco — o amplify.yml na raiz cuida disso)
  ```

  **OU**, se o Amplify exigir preencher, coloque:
  ```
  .
  ```
  (ponto = raiz do repositório)

### 2.3 Build settings

- **App name**: `creatools-frontend`
- **Environment**: `production`
- Amplify vai detectar automaticamente o arquivo **`amplify.yml`** na raiz do seu repositório (já criei ele)
- Clique em **"Edit"** só se quiser conferir — o conteúdo já vem correto

### 2.4 Variáveis de ambiente

Ainda na tela de setup do Amplify, ou depois em **App settings → Environment variables**, adicione:

| Variável | Valor | Descrição |
|---|---|---|
| `REACT_APP_BACKEND_URL` | `https://api.seu-dominio.com` | URL do backend na EC2 (sem barra final) |
| `NODE_VERSION` | `20` | Versão do Node para build |
| `_LIVE_UPDATES` | `[{"pkg":"@aws-amplify/cli","type":"npm","version":"latest"}]` | (opcional, deixa o Amplify sempre atualizado) |

> ⚠️ **CRÍTICO**: se `REACT_APP_BACKEND_URL` estiver errada, o frontend não conecta. **Use o mesmo protocolo** (https se o backend está em https).

### 2.5 Salvar e fazer deploy

Clique em **Save and deploy**. O Amplify vai:
1. Clonar o repo
2. Rodar `pnpm install` (5-10 min na primeira vez)
3. Rodar o build do Vite (`pnpm run build`)
4. Publicar os arquivos estáticos no CDN
5. Gerar uma URL: `https://main.d1234abc.amplifyapp.com`

---

## 🪜 Passo 3 — Configurar domínio customizado (opcional)

### 3.1 No Amplify Console

1. **Domain management** → **Add domain**
2. Digite `seu-dominio.com`
3. Configure:
   - Root domain (`seu-dominio.com`) → **main branch**
   - Subdomain www (`www.seu-dominio.com`) → **main branch** (redireciona pro root)
4. Amplify vai gerar registros DNS para você adicionar

### 3.2 No seu registrador de DNS

Adicione os registros que o Amplify pediu (geralmente):

```
Tipo: CNAME
Nome: www
Valor: main.d1234abc.amplifyapp.com

Tipo: ANAME/ALIAS/A
Nome: @
Valor: (o que Amplify indicar)
```

E o registro de validação SSL (Amplify vai te dar um `_acme-challenge` para adicionar).

Aguarde alguns minutos e o Amplify vai emitir certificado SSL automaticamente. ✅

---

## 🪜 Passo 4 — Completar o wizard do backend

Como o backend está em `api.seu-dominio.com`, acesse:

```
https://api.seu-dominio.com/installer
```

E complete o wizard (chave tik.tools + admin + IA + etc.).

**Depois disso, acesse seu frontend:**

```
https://seu-dominio.com
```

E faça login! 🎉

---

## 🔁 Fluxo de atualizações (após deploy)

### Frontend (mudanças no React)

1. Faça as alterações aqui no Emergent
2. Clique em **"Save to GitHub"** no chat → push para `main`
3. Amplify detecta automaticamente e **faz o build + deploy sozinho** (5-10 min)

### Backend (mudanças no FastAPI/Node)

1. Faça as alterações aqui no Emergent
2. Clique em **"Save to GitHub"** no chat → push para `main`
3. Na EC2:
```bash
ssh -i sua-chave.pem ubuntu@<ip-ec2>
sudo su -
cd /opt/creatools
git pull
cd tiks && pnpm install
cd artifacts/api-server && pnpm run build
supervisorctl restart creatools-backend
```

Ou automatize com um **webhook GitHub → EC2** (avançado).

---

## 💰 Custo estimado

| Recurso | Custo mensal |
|---|---|
| **Amplify** (frontend): 1000 build minutes + 15 GB served | ~$1-5 |
| **EC2 t3.small** (backend + DB) | ~$15 |
| **EBS 20 GB** | ~$2 |
| **Data transfer** (100 GB out) | ~$9 |
| **Route 53** hospedagem DNS (opcional) | ~$0.50 |
| **Total** | **~$27/mês** |

> 💡 Amplify tem **camada gratuita generosa**: 1000 min de build/mês + 15 GB servidos/mês + 5 GB armazenamento.

---

## 🐛 Troubleshooting

### ❌ Build do Amplify falha com "pnpm: command not found"

Verifique se o `amplify.yml` está na **raiz do repo** e se o passo `npm install -g pnpm@9.15.9` está lá.

### ❌ Frontend carrega mas mostra "Network Error" ao fazer login

Provavelmente:
1. `REACT_APP_BACKEND_URL` está errada nas variáveis do Amplify
2. Backend não está com CORS liberado para o domínio do Amplify
3. Backend não está com HTTPS (mixed content bloqueia)

Verifique no console do navegador (F12 → Network) qual URL está sendo chamada e qual o erro.

### ❌ Build muito lento (>15 min)

Primeira build é lenta (todo o pnpm install). Builds seguintes usam cache e são <5min.

Se continuar lento:
- Confira que `cache.paths` no `amplify.yml` inclui `tiks/node_modules/**/*`
- Considere usar `pnpm install --frozen-lockfile --prefer-offline`

### ❌ Rotas do React dão 404 no refresh (ex: /dashboard)

React SPA precisa que todas as rotas caiam no `index.html`. No Amplify Console:

1. **Rewrites and redirects** → **Add rule**
2. Source: `</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json)$)([^.]+$)/>`
3. Target: `/index.html`
4. Type: `200 (Rewrite)`

Salve. Agora refresh em `/dashboard` funciona.

---

## 🎯 Resumo em bullet points

- ✅ **Não** existe suporte no Amplify para backend Python/Node — só frontend estático
- ✅ Você precisa de **EC2 (ou App Runner) separado** para o backend
- ✅ O arquivo **`amplify.yml`** na raiz do repo configura o build do monorepo pnpm
- ✅ **Não** marque "monorepo directory" no Amplify Console (o amplify.yml já cuida disso)
- ✅ Variável **`REACT_APP_BACKEND_URL`** deve apontar para o backend (com HTTPS)
- ✅ Backend precisa ter **CORS habilitado** para o domínio do Amplify
- ✅ Push no GitHub = auto-deploy no Amplify (frontend). Backend precisa `git pull` manual.

---

## 📞 Alternativas se Amplify não convencer

- **Vercel**: mesma coisa (só frontend), UI mais amigável
- **Netlify**: mesma coisa (só frontend), plano free generoso
- **EC2 sozinho**: `install.sh` já hospeda **tudo** (backend + frontend + nginx) — **mais simples**
- **Deploy Emergent**: 1 clique, sem AWS — **mais simples ainda**

Se você quer só simplicidade, use o **EC2 sozinho com `install.sh`** que já criei — ele já serve o frontend via nginx. Amplify é overkill neste caso.
