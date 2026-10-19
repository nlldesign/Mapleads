# 🎯 MapLeads - Caçador de Leads Frios no Google Maps com Contexto e Anti-Repetição

Sistema completo em **Node.js + Puppeteer + Interface Web Moderna** para prospecção de negócios locais no **Google Maps**, com **controle de duplicatas via planilha de contexto**, **busca em lote (múltiplas cidades/nichos)**, **roteiro de ligação telefônica (Cold Calling)** e **exportação consolidada em Excel (.xlsx) e CSV**.

---

## ⚡ Principais Recursos do Sistema

### 1. 📤 Subir Planilha de Contexto (Anti-Repetição)
- Suba qualquer planilha (`.xlsx`, `.xls` ou `.csv`) com lojas ou contatos que você já prospectou.
- O sistema indexa os nomes, telefones e links do Google Maps em um **banco local de exclusão** (`data/leads_database.json`).
- Nas próximas buscas, **nenhuma loja repetida será exibida ou minerada**, garantindo que você nunca perca tempo ligando duas vezes para o mesmo local.

### 2. 📥 Baixar Todos de Uma Vez (Exportação Consolidada)
- Baixe a base completa de leads em **Excel nativo (.xlsx)** ou **CSV (UTF-8 com BOM)** com 1 clique.
- A planilha exportada já inclui:
  - Nome da Loja, Categoria e Endereço;
  - Nota e Quantidade de Avaliações;
  - Status do Website (Sim/Não e Link);
  - Telefone e Link direto para WhatsApp;
  - Link direto para a Ficha no Google Maps;
  - Principais Pontos Fracos Identificados;
  - Roteiro Falado e Gancho para a Ligação Telefônica.

### 3. ⚡ Prospecção em Lote (Múltiplas Cidades / Nichos)
- Na aba **"Prospecção em Lote"**, você pode enviar uma planilha com dezenas de buscas (ex: *Dentistas em Campinas, Mecânicas em Sorocaba, Pet Shops em Piracicaba*).
- O sistema executa cada busca em fila, filtra os leads frios no raio definido, ignora duplicatas e consolida todos os resultados para você baixar de uma só vez.
- Há um botão para baixar o modelo de exemplo (`modelo_buscas_em_lote.csv`).

### 4. 📞 Roteiro de Ligação (Cold Calling) Integrado
- Dossiê completo para cada empresa:
  - *Passo 1: Passar pela recepção/secretária*;
  - *Passo 2: Gancho inicial de 10 segundos*;
  - *Passo 3: Pergunta de diagnóstico*;
  - *Passo 4: Proposta de valor*;
  - *Passo 5: Fechamento com a Técnica da Alternativa*;
  - *Respostas prontas para objeções no telefone*.

---

## 🚀 Como Iniciar

1. No terminal do projeto, execute:
```bash
npm start
```
*(ou `node server.js`)*

2. Acesse no navegador:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 📂 Arquivos do Projeto

- [`database.js`](file:///c:/Users/Lucas/Documents/antigravity/agitated-bose/database.js): Módulo de importação de planilhas (`xlsx`), normalização e verificação de duplicatas;
- [`scraper.js`](file:///c:/Users/Lucas/Documents/antigravity/agitated-bose/scraper.js): Motor de extração Puppeteer integrado ao Google Chrome e verificação anti-repetição;
- [`server.js`](file:///c:/Users/Lucas/Documents/antigravity/agitated-bose/server.js): Servidor Express com upload via `multer`, rotas de download consolidado (`.xlsx`/`.csv`) e streaming de progresso;
- [`public/index.html`](file:///c:/Users/Lucas/Documents/antigravity/agitated-bose/public/index.html): Dashboard responsivo com abas de busca por raio e lote, upload de contexto e modal de ligação telefônica;
- [`data/leads_database.json`](file:///c:/Users/Lucas/Documents/antigravity/agitated-bose/data/leads_database.json): Base de dados local persistente para contexto de exclusão;
- [`Dockerfile`](file:///c:/Users/Lucas/Documents/antigravity/agitated-bose/Dockerfile): Configuração para deploy em nuvem com Chromium pré-instalado;
- [`render.yaml`](file:///c:/Users/Lucas/Documents/antigravity/agitated-bose/render.yaml): Arquivo para deploy grátis em 1 clique no Render.com.

---

## ☁️ Como Fazer o Deploy Online (Grátis)

Como este projeto utiliza **Node.js + Puppeteer (Navegador Chrome headless)** para minerar o Google Maps, ele não pode rodar apenas no GitHub Pages (que só aceita sites estáticos sem servidor).

Ele já está 100% configurado com **Docker** para rodar em qualquer serviço gratuito de nuvem:

### Opção 1: Deploy Grátis no Render.com (Recomendado)
1. Crie uma conta gratuita em [render.com](https://render.com);
2. Conecte sua conta do GitHub e selecione o repositório **nlldesign/Mapleads**;
3. Escolha a opção **Web Service** usando o **Dockerfile** (o Render detectará o arquivo `render.yaml` automaticamente);
4. Clique em **Deploy** e pronto! Sua aplicação estará online com link próprio (`.onrender.com`).

### Opção 2: Deploy no Railway.app
1. Acesse [railway.app](https://railway.app);
2. Clique em **New Project** > **Deploy from GitHub repo** > selecione **Mapleads**;
3. O Railway compilará o `Dockerfile` com o Chromium automaticamente.

### Opção 3: Rodar com Docker localmente
```bash
docker-compose up --build
```
Acesse `http://localhost:3000`.
