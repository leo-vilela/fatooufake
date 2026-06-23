# Fato ou Fake - Checagem de Fatos em Tempo Real

Uma extensão para o Google Chrome desenvolvida para realizar a checagem de fatos em tempo real durante debates ao vivo, pronunciamentos, entrevistas, coletivas de imprensa e eventos políticos no Brasil!

<img width="400" height="225" alt="Fato ou Fake Extension Screenshot" src="https://github.com/user-attachments/assets/a0a8fba9-c28f-473c-866d-84951a9b548e" />

A extensão captura o áudio da aba ativa do navegador, transcreve a fala, identifica declarações factuais à medida que são feitas e fornece vereditos instantâneos baseados em evidências usando análise de Inteligência Artificial e busca na web. Enquanto os artigos de checagem tradicionais costumam sair horas ou dias após os debates, o **Fato ou Fake** permite avaliar as afirmações em tempo real.

---

## 👥 Créditos e Origem do Projeto

Este projeto é um fork/clone localizado e aprimorado do repositório original [intruth-factcheck](https://github.com/rpanigrahi222/intruth-factcheck) desenvolvido por **[rpanigrahi222](https://github.com/rpanigrahi222)**.

### Ajustes e Melhorias para o Contexto Brasileiro (PT-BR):
- **Tradução Completa da Interface**: Toda a interface do usuário (pop-up, botões de ação, mensagens de carregamento e painéis flutuantes) foi traduzida para o português do Brasil.
- **Localização dos Vereditos**: Adaptação dos termos de classificação de veracidade (ex: *TRUE* &rarr; *VERDADEIRO*, *FALSE* &rarr; *FALSO*, *MISLEADING* &rarr; *ENGANOSO*, etc.).
- **Motores de Busca Focados no Brasil**: Otimização do fluxo de pesquisa na web para priorizar as maiores agências e portais de checagem do Brasil, incluindo:
  - **G1 Fato ou Fake**
  - **Agência Lupa**
  - **Aos Fatos**
  - **Estadão Verifica**
  - **Boatos.org**
- **Filtros de Imparcialidade e Spam**: Adaptação da lista de bloqueio de domínios para ignorar propagandas de partidos políticos brasileiros e redes sociais amplamente difundidas no cenário nacional (como Kwai e TikTok).
- **Prompt da IA Customizado**: Reformulação completa das instruções do Service Worker em português (`EVALUATE_PROMPT`), focando nas nuances e gírias da retórica política do Brasil.
- **Exportação de Relatórios**: O modelo de exportação de sessões em PDF/HTML foi adaptado para gerar relatórios detalhados inteiramente em português.
- **Detecção de Oradores**: Ajuste na Expressão Regular de identificação de oradores no título do YouTube para suportar conectores em português (ex: *"e"*, *"vs"*, *"versus"*, *"contra"*).

---

## 🚀 Funcionalidades

- **Detecção de Declarações ao Vivo**: Monitora continuamente a fala na aba ativa e extrai afirmações passíveis de checagem em tempo real.
- **Avaliação de Fatos com IA**: Analisa a veracidade das afirmações utilizando modelos de linguagem (Claude/Anthropic) e buscas na web para classificar como:
  * **VERDADEIRO**
  * **MAJORITARIAMENTE VERDADEIRO**
  * **ENGANOSO**
  * **FALSO**
  * **NÃO VERIFICÁVEL**
- **Atribuição de Orador**: Identifica e atribui as falas a cada orador participante quando detectados no título da transmissão ou vídeo.
- **Análise Léxica e de Ritmo**: Analisa a velocidade da fala e o uso de palavras evasivas e termos emocionais com base na linguística do português brasileiro.
- **Traga Sua Própria Chave (BYOK)**: Segurança e controle de custos usando sua própria chave de API da Anthropic.
- **Exportação de Relatórios**: Baixe o histórico completo da sessão em um arquivo PDF ou HTML bem formatado.

---

## 🛠️ Como Usar o Fato ou Fake:

1. Abra um vídeo, transmissão ao vivo, debate ou pronunciamento (no YouTube, por exemplo).
2. Abra a extensão no navegador, configure sua chave de API nas opções.
3. Atribua os nomes dos oradores e clique em **Iniciar Checagem**.
4. O áudio da aba será capturado e transcrito automaticamente em segundo plano.
5. As declarações factuais serão extraídas, validadas contra fontes confiáveis de checagem brasileiras e os vereditos aparecerão instantaneamente na tela!

---

## ⚖️ O que é Passível de Checagem?

A extensão foca em checar declarações factuais específicas, tais como:
* Dados estatísticos e numéricos.
* Eventos históricos ou datas específicas.
* Ações governamentais, leis e políticas públicas.
* Afirmações científicas, médicas ou de registros públicos.

*Exemplos:*
* *"A inflação atingiu o pico de 9,1% em 2022."*
* *"O projeto de lei foi aprovado no Senado em 2021."*
* *"A taxa de desemprego atual está abaixo de 5%."*

**NÃO são checados:**
* Opiniões e julgamentos de valor subjetivos.
* Previsões ou promessas de campanha para o futuro.
* Perguntas retóricas ou descrições emocionais.

*Exemplos:*
* *"Essa política vai destruir a nossa economia."*
* *"Eu tenho o melhor plano de governo."*
* *"Se meu oponente vencer, o desastre será inevitável."*

---

## 🔒 Privacidade e Permissões

- **Chaves de API**: Suas chaves de API da Anthropic e Serper são salvas localmente no armazenamento do seu próprio navegador (`chrome.storage`). Nenhum dado de autenticação é enviado a servidores externos além das APIs oficiais configuradas.
- **Permissões Utilizadas**:
  * `tabCapture`: Captura o áudio da aba ativa para fins exclusivos de transcrição ao vivo da fala.
  * `activeTab`: Permite a interação visual da extensão com a aba aberta atual.
  * `scripting`: Injeta o painel lateral de exibição dos vereditos diretamente na página do vídeo.
  * `storage`: Guarda localmente as chaves de API e preferências do usuário.
  * `offscreen`: Executa o processamento do áudio e transcrição em background sem interrupções.

---

## ⚠️ Limitações e Avisos

A checagem automatizada por IA é uma ferramenta auxiliar e inerentemente imperfeita. Os vereditos podem ocasionalmente conter imprecisões ou basear-se em informações desatualizadas. Sempre avalie as fontes originais recomendadas e realize pesquisas independentes antes de tirar conclusões definitivas. A extensão serve como um recurso informativo e não como uma autoridade absoluta de verdade.

### Requisitos mínimos:
- Chrome Manifest V3.
- Chave de API própria (Anthropic/Claude).
- Navegador moderno baseado em Chromium (Google Chrome, Microsoft Edge, Brave, etc.).

## 📄 Licença

Este projeto está sob a licença MIT. Consulte o arquivo `LICENSE` para obter mais detalhes.

