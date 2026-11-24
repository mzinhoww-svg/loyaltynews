# Trecho da fonte: Blueprint v2.0, seção 4 "Mídia kit dinâmico e monetização" (tag v2.0)
- Origem: `git show v2.0:spec-v2.0/Loyalty_News_Blueprint_v2_0.md`, linhas 301–402 (até antes de "Inventário, regras e cálculo de receita").
- sha256 do arquivo inteiro na tag: `6048d7d65c6ac949c0b9045dc428ac9c34833d46c903dc7f0c8b2051615e19fe` (93975 bytes). A tag v2.0 é anotada e assinada pela raiz (check_r0 R0-04).
- Contagem das linhas de oferta por subseção (sem cabeçalho e separador de tabela): Banners 8; The Loyal 6; Conteúdo patrocinado 6; Redes e canais 4; Entrevistas 4; Loyalty Talks 4; Eventos 7; Cobertura de eventos 4; Impulsionamento 4. **Total: 47.** "Pacotes e combinações" (8) não entra, porque são combinações dos formatos acima.

---

## 4. Mídia kit dinâmico e monetização
Estrutura de oito blocos da versão mais recente consultada: (1) cobertura (CMS, contagem de matérias, editorias e eventos); (2) audiência por canal, realtime + histórico; (3) decisores (perfil-alvo; evidência de perfil quando mensurada); (4) tese B2B de mídia especializada; (5) especificações e mapa de posições; (6) catálogo com nove famílias, sete pacotes e customização; (7) etapas de contratação; (8) formulário CRM. Header com chamada comercial, métricas e CTA; rodapé próprio.

**Métricas:** GA4 Realtime API `runRealtimeReport`: usuários ativos nos 30 minutos anteriores, atualização sugerida a cada 60–120s (limites e atraso de coleta). GA4 `runReport`: sessões, usuários ativos/totalUsers conforme definição escolhida, visualizações, engajamento, dados consolidados 30 dias, atualização horária a diária conforme disponibilidade. Não chamar janela histórica de tempo real. CMS SQL: matérias publicadas e acervo, distinta por id, 30 e 90 dias, eventos futuros. The Loyal por ESP: assinantes confirmados, envios, entregas, cliques, descadastros; abertura é estimativa e sujeita a privacidade. LinkedIn / Instagram: APIs com permissões ou importação manual auditada e rotulada, WhatsApp conforme dados reais disponíveis. Não somar pessoas únicas entre canais: apresentar contatos por canal e, se somar, rotular entregas/contatos não deduplicados; evitar inferir cargo. Sem conector, mostrar `— / não disponível` e data de atualização, nunca zero falso. Guardar `source, metric, value, period_start, period_end, fetched_at, status, methodology_version`; armazenar última coleta válida com marca de desatualização. Sem expor segredo no navegador. 

**Catálogo:** preços de referência em BRL, proposta inicial, ajustáveis no admin. Consulta mostrou versões diferentes do mídia kit: versão recente com matéria publicitária R$3.500 e 47 produtos, anterior com R$2.500 e pacotes R$4/6/9 mil. Adota-se R$3.500 avulso e R$4/6/9 mil nos pacotes como âncoras propostas (não afirmar que esses preços de pacote permanecem publicados na versão mais recente). Combos sem preço público confirmado ficam sob proposta. Valores e capacidades não garantem audiência ou faturamento.

### Banners
| Produto | Referência R$ | Escopo |
|---|---:|---|
| Banner topo | 3.000/mês | 1280 × 150; 4 cotas; mínimo 3 meses |
| Retângulo sidebar | 1.750/mês | 336 × 280; 3 posições; 10 cotas por posição |
| Banner rodapé | 1.250/mês | 1280 × 200; 6 cotas; mínimo 30 dias |
| Banner dentro do artigo | 2.000/mês | No corpo da matéria |
| Banner entre seções da home | 2.250/mês | Faixa intereditorias |
| Patrocínio Loyalty Market Data | 2.500/mês | Indicadores e ticker |
| Banner na agenda | 1.000/mês | Página da agenda |
| Takeover do portal | 5.000/dia | Exclusividade de inventário por dia |

### The Loyal
| Produto | Referência R$ | Escopo |
|---|---:|---|
| Banner topo da newsletter | 1.750/mês | Todas as edições contratadas |
| Banner meio | 1.250/mês | Todas as edições contratadas |
| Banner rodapé | 900/mês | Todas as edições contratadas |
| Bloco patrocinado | 900 | Por inserção |
| Edição dedicada | 3.000 | Por edição |
| Patrocínio boletim de indicadores | 2.000/mês | Boletim de mercado |

### Conteúdo patrocinado
| Produto | Referência R$ | Escopo |
|---|---:|---|
| Matéria publicitária | 3.500 | Por matéria, produção e amplificação |
| Série de matérias | 9.500 | Escopo a contratar |
| Matéria com retargeting | 4.500 | Consentimento e requisitos LGPD |
| Artigo de opinião assinado | 2.000 | Autor real; revisão editorial |
| Página especial patrocinada | a partir de 6.000/mês | Hub temático |
| Estudo ou e-book | a partir de 10.000 | Escopo e leads autorizados |

### Redes e canais
| Produto | Referência R$ | Escopo |
|---|---:|---|
| Post LinkedIn | 1.500 | Por post |
| Carrossel Instagram | 1.500 | Por carrossel |
| Envio WhatsApp | 600 | Canal de distribuição |
| Nota na newsletter | 500 | Por edição |

### Entrevistas
| Produto | Referência R$ | Escopo |
|---|---:|---|
| Entrevista escrita | 3.000 | Portal |
| Entrevista em vídeo | 6.500 | Portal e redes |
| Perfil de empresa | 4.500 | Reportagem de perfil |
| Série trimestral | 12.000 | Uma por trimestre; escopo a contratar |

### Loyalty Talks
| Produto | Referência R$ | Escopo |
|---|---:|---|
| Patrocínio de episódio | 3.000 | Abertura e encerramento |
| Convidado no podcast | 5.000 | Participação identificada |
| Temporada patrocinada | 16.000 | Escopo a contratar |
| Cortes de podcast | 1.500 | Três cortes |

### Eventos
| Produto | Referência R$ | Escopo |
|---|---:|---|
| Divulgação na agenda | 500 | Evento patrocinado |
| Destaque agenda home | 1.000 | Destaque contratado |
| Cota master | a partir de 30.000 | Evento próprio |
| Cota ouro | a partir de 15.000 | Evento próprio |
| Cota prata | a partir de 7.500 | Evento próprio |
| Webinar ou live | a partir de 7.500 | Produção e divulgação |
| Café ou mesa-redonda | a partir de 12.000 | Encontro presencial |

### Cobertura de eventos
| Produto | Referência R$ | Escopo |
|---|---:|---|
| Matéria de cobertura | 3.500 | Vinculada ao evento |
| Cobertura completa | a partir de 9.000 | Foto, vídeo e entrevistas |
| Cobertura ao vivo | a partir de 3.000 | Redes |
| Mediação | a partir de 3.500 | Profissional real |

### Impulsionamento
| Produto | Referência R$ | Escopo |
|---|---:|---|
| LinkedIn | verba + 20% | Gestão de mídia |
| Instagram | verba + 20% | Gestão de mídia |
| Retargeting | verba + 20% | Mediante consentimento |
| E-mail marketing dedicado | 2.500/mês | Base opt-in; sem cessão da lista |

### Pacotes e combinações
| Pacote | Preço referência proposto | Entregas |
|---|---:|---|
| Presença no mercado | R$4.000/mês | sidebar + rodapé + LinkedIn |
| Construir reputação | R$6.000/mês | topo + sidebar + matéria mensal + LinkedIn/Instagram |
| Liderar uma editoria | R$9.000/mês | topo + sidebar + rodapé + matéria mensal + entrevista trimestral + redes |
| Lançamento de programa | Sob proposta | matéria + entrevista + bloco newsletter + impulsionamento |
| Evento completo | Sob proposta | agenda + banner + cobertura completa e matéria |
| Autoridade | Sob proposta | podcast + entrevista vídeo + opinião assinada |
| Presença anual | Sob proposta | topo + newsletter + 4 matérias; contrato 12m |
| Customizado | Sob proposta | proposta com escopo, prazo, custo e inventário |

