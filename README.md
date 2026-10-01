# Gerador de Pedidos e Propostas Comerciais (Sedna Sport Fishing)

Servidor web e sistema de gerenciamento de propostas e pedidos comerciais para embarcações, com arquitetura pronta para geração de PDF de alta fidelidade.

---

## 🚀 Como Executar o Sistema

Você pode iniciar o servidor de duas maneiras:

1. **Dois cliques no arquivo:**
   Execute o arquivo [`iniciar_servidor.bat`](file:///c:/Users/Tiago/Downloads/Gerador%20de%20pedido/iniciar_servidor.bat). Ele iniciará o servidor na porta configurada (padrão: 443 para HTTPS / Cloudflare Tunnel).

2. **Via terminal:**
   ```bash
   node server.js
   # ou
   npm start
   ```

Acesse no seu navegador: **[http://localhost:443](http://localhost:443)** (ou via HTTPS pelo seu domínio configurado no Cloudflare)

---

## 📋 Estrutura de Dados Configurada (Etapa 1)

O sistema foi configurado respeitando exatamente o modelo do arquivo de exemplo `CC320  - MODELO PROPOSTA COMERCIAL.pdf`:

1. **Identificação do Modelo & Proposta:**
   - **Modelos por Seleção (Checkboxes/Cards com Fotos):** Escolha rápida entre os modelos cadastrados (`CC 320`, `CAT 370`, `CAT 420`, `XF 320`, `CAT 370 CAB`, `CAT 420 CAB`).
   - **Vinculação de Fotos por Modelo:** Cada modelo possui miniatura visual e ícone de câmera `📷`. Clicando no ícone ou na foto, abre-se o modal para enviar uma foto do computador (PNG, JPG, WEBP) ou link de imagem pela web. A foto fica salva no servidor e vinculada ao modelo.
   - **Exibição da Foto no Documento:** Quando o modelo selecionado possui uma foto vinculada, ela é renderizada na capa da proposta comercial e no cabeçalho.
   - **Linha / Subtítulo:** Alternador rápido de 1 clique entre **Sportfishing** e **Yachts**.
   - **Geração Automática de Proposta & Sistema de Revisões (REV1, REV2, ...):**
     - O sistema gera automaticamente o número da proposta (ex: `PROP-2026-001`).
     - Controle de revisões integrado com botão `+ Nova Revisão (REV+1)`. Ao criar uma nova revisão, a versão anterior é arquivada intacta no histórico (`PROP-2026-001_REV1.json`, `PROP-2026-001_REV2.json`, etc.).
     - Botão `Novo Pedido` para avançar a sequência geral de orçamentos.
   - **Cliente:** Campo de texto limpo e direto para digitação do nome do cliente ou empresa.

2. **Características Técnicas:**
   - Suporte a **nome**, **valor** e **unidades personalizadas** (ângulos `º`, litros `L`, metros `m`, quilos `kg`, potência `HP`, unidades, etc.)
   - Organização em 3 colunas idêntica ao layout da proposta original
   - Permite adicionar, editar, reordenar ou remover características dinamicamente

3. **Itens de Série (7 Categorias Exatas):**
   - `SISTEMAS ELÉTRICOS E ELETRÔNICOS`
   - `SISTEMAS DE FUNDEIO E AMARRAÇÃO`
   - `NAVEGAÇÃO E SEGURANÇA`
   - `PESCARIA E ISCAS`
   - `CONFORTO E ACABAMENTO`
   - `SISTEMAS HIDRÁULICOS`
   - `SISTEMAS DE COMBUSTÍVEL E MOTOR`
   - Interface rápida para adicionar novos itens teclando Enter, remover ou criar categorias adicionais.

4. **Preço e Motorização:**
   - Campo para motorização (ex: `2X Mercury 300 HP Gasolina`)
   - Campo para preço total (ex: `R$ 1.300.000,00`)

5. **Forma de Pagamento:**
   - Condições flexíveis (ex: `30% sinal`, `Saldo até entrega da embarcação`)

6. **Prazo de Entrega:**
   - Prazo estimado em dias ou texto (ex: `90 dias`)

7. **Contato e Validade do Orçamento:**
   - Contato: Nome do consultor, telefone/WhatsApp, e-mail comercial
   - Validade: Cláusulas de validade (ex: `7 dias, salvo venda prévia`) e local de entrega (`Joinville-SC`)

8. **Recursos de Gestão:**
   - **Salvar / Salvar Como:** Grava propostas no servidor (`data/proposals/`)
   - **Restaurar Padrão CC 320:** Restaura os dados padrão de fábrica com 1 clique
   - **Pré-visualização do Documento:** Renderiza as 2 páginas da proposta comercial em tempo real
   - **Exportação / Inspeção JSON:** Disponível para validação técnica

---

## 🔜 Próxima Etapa (Etapa 2)

- Configuração do gerador de PDF de saída (renderização com Puppeteer ou Chromium headless para exportação de arquivo PDF idêntico ou superior ao original com suporte a download direto).
