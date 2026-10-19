const { loadDatabase, isLeadDuplicate } = require('./database');

/**
 * Geocodifica uma cidade/bairro para coordenadas via OpenStreetMap (gratuito)
 */
async function geocodeLocation(locationText) {
  if (!locationText) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationText)}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'MapLeads-Prospector/3.0 (https://github.com/nlldesign/Mapleads)',
        'Accept-Language': 'pt-BR,pt;q=0.9'
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        displayName: data[0].display_name
      };
    }
  } catch (err) {
    console.warn('Geocoding falhou (usará busca nominal):', err.message);
  }
  return null;
}

/**
 * Calcula distância em KM entre duas coordenadas (Fórmula de Haversine)
 */
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 6371; // Raio da Terra em km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

/**
 * Normaliza número de telefone para formato WhatsApp (DDI + DDD + Número)
 */
function formatWhatsAppNumber(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;

  // Remove zero inicial de operadora/DDD se houver (ex: 01933250025 -> 1933250025)
  const cleanDigits = digits.startsWith('0') && digits.length >= 11 ? digits.slice(1) : digits;

  if (cleanDigits.length === 10 || cleanDigits.length === 11) {
    return `55${cleanDigits}`;
  }
  if (cleanDigits.startsWith('55') && (cleanDigits.length === 12 || cleanDigits.length === 13)) {
    return cleanDigits;
  }
  return cleanDigits;
}

/**
 * Gera pontos de dor e argumentos específicos para abordagem por LIGAÇÃO (Cold Calling)
 */
function generateColdCallPoints(lead, location) {
  const points = [];
  const nomeEmpresa = lead.name || 'a empresa';
  const regiao = location || 'sua região';

  if (lead.isWithoutWebsite) {
    points.push({
      tipo: 'Sem Website',
      impacto: 'Alto (Perda de vendas)',
      argumento: `A ${nomeEmpresa} não possui um site cadastrado no perfil do Google. Mais de 70% das pessoas que pesquisam pelo celular desistem se não encontram fotos, catálogo ou tabela de serviços em um site próprio.`
    });
  } else {
    points.push({
      tipo: 'Website Presente',
      impacto: 'Médio',
      argumento: `A empresa possui link no perfil, mas podemos auditar se a página é rápida no celular e se possui botão direto de agendamento/venda.`
    });
  }

  if (lead.reviewsCount === 0) {
    points.push({
      tipo: 'Zero Avaliações',
      impacto: 'Crítico',
      argumento: `A empresa está com 0 avaliações no Google. Para o algoritmo e para o cliente local, a empresa parece inativa ou recém-aberta, fazendo o cliente escolher outro concorrente em segundos.`
    });
  } else if (lead.reviewsCount <= 10) {
    points.push({
      tipo: 'Pouquíssimas Avaliações',
      impacto: 'Alto',
      argumento: `Contam com apenas ${lead.reviewsCount} avaliações. Concorrentes diretos em ${regiao} normalmente contam com 50 a 200 avaliações, o que joga a ${nomeEmpresa} para o final da lista.`
    });
  } else if (lead.reviewsCount <= 30) {
    points.push({
      tipo: 'Avaliações Baixas',
      impacto: 'Médio',
      argumento: `Com ${lead.reviewsCount} avaliações, qualquer avaliação negativa derruba a média e afasta novos clientes. Falta um fluxo automatizado para pedir avaliações aos clientes satisfeitos.`
    });
  }

  if (lead.rating && lead.rating !== 'S/N' && lead.rating < 4.2) {
    points.push({
      tipo: 'Nota Abaixo do Ideal',
      impacto: 'Crítico',
      argumento: `A nota média está em ${lead.rating}⭐. Clientes evitam ligar para estabelecimentos com nota inferior a 4.5 quando há outras opções perto.`
    });
  }

  points.push({
    tipo: 'Visibilidade Local no Raio',
    impacto: 'Alto',
    argumento: `Quem pesquisa "${lead.category}" na região está comprando de concorrentes que aparecem no Top 3 do Google Maps.`
  });

  return points;
}

/**
 * Gera um roteiro completo de ligação (Cold Call Script) passo a passo
 */
function generateColdCallScript(lead, location) {
  const nome = lead.name || 'sua empresa';
  const categoria = lead.category || 'prestador de serviços';
  const regiao = location || 'região';

  let pontoForteDor = '';
  if (lead.isWithoutWebsite) {
    pontoForteDor = `notei que a ficha de vocês ainda não tem um site oficial vinculado, o que faz os clientes que buscam no celular pularem para o próximo concorrente`;
  } else if (lead.reviewsCount < 10) {
    pontoForteDor = `vocês têm um excelente potencial em ${regiao}, mas estão com apenas ${lead.reviewsCount || 0} avaliações no Google, enquanto concorrentes do mesmo bairro têm mais de 50`;
  } else {
    pontoForteDor = `vocês não estão aparecendo entre os 3 primeiros colocados quando moradores da região pesquisam por ${categoria}`;
  }

  return {
    passo1_secretaria: `“Olá, bom dia! Por gentileza, quem é o responsável pela captação de clientes e presença digital da ${nome}? É o proprietário ou o gerente?”`,
    passo2_gancho: `“Olá [Nome do Decisor], tudo bem? Meu nome é [Seu Nome]. O motivo da minha ligação é bem rápido: eu estava analisando os perfis de ${categoria} aqui em ${regiao} no Google Maps e percebi que ${pontoForteDor}.”`,
    passo3_pergunta_impacto: `“Vocês têm sentido que o volume de clientes novos chegando pela internet todo mês poderia ser bem maior?”`,
    passo4_proposta: `“Nós desenvolvemos um plano prático para posicionar a ${nome} no topo das buscas do Google na região, gerando ligações diárias de pessoas prontas para comprar. Não tem custo nenhum essa análise inicial.”`,
    passo5_fechamento_cta: `“Eu posso te apresentar esse raio-x de 10 minutinhos em uma videochamada rápida ou passar aí: fica melhor para você nesta quinta às 15h ou na sexta às 10h?”`,
    objecoes: [
      {
        objecao: '“Não tenho tempo agora.”',
        resposta: '“Com certeza, imagino a correria! Por isso mesmo a ligação é de 30 segundos. Só me confirma se quinta às 15h é um horário mais tranquilo para conversarmos 5 minutos?”'
      },
      {
        objecao: '“Já temos quem cuida disso / agência.”',
        resposta: '“Excelente! Mas como sua empresa ainda está com esse ponto crítico no Google, vale a pena ver nosso comparativo com os concorrentes do bairro como uma segunda opinião gratuita.”'
      },
      {
        objecao: '“Manda uma proposta pelo WhatsApp.”',
        resposta: '“Com certeza! Já tenho o seu número aqui. Só preciso de 5 minutos antes para entender a meta de vocês e mandar algo sob medida. Quinta às 15h fica bom?”'
      }
    ]
  };
}

/**
 * Gera mensagem rápida de WhatsApp para follow-up ou primeiro contato
 */
function generatePitch(lead, location) {
  const nomeEmpresa = lead.name || 'sua empresa';
  const motivos = [];

  if (lead.isWithoutWebsite) {
    motivos.push('notei que vocês ainda não possuem um site oficial vinculado ao perfil');
  }
  if (lead.reviewsCount < 10) {
    motivos.push(`vi que contam com apenas ${lead.reviewsCount || 0} avaliações no Google`);
  } else if (lead.rating && lead.rating !== 'S/N' && lead.rating < 4.2) {
    motivos.push(`a nota atual está em ${lead.rating} estrelas`);
  }

  const motivoTexto = motivos.length > 0
    ? motivos.join(' e ')
    : 'analisei o posicionamento digital de vocês na região';

  return `Olá! Tudo bem? Encontrei a ${nomeEmpresa} no Google Maps. Estava pesquisando negócios do seu segmento na região e ${motivoTexto}. Nós ajudamos empresas locais a se destacarem e atraírem mais clientes pelo Google todos os meses. Teria 5 minutinhos essa semana para conversarmos sobre como alavancar a presença digital da ${nomeEmpresa}?`;
}

/**
 * Busca uma página de resultados direto da API JSON do Google Maps (Ultra rápido e compatível com Vercel Serverless)
 */
async function fetchGoogleMapsPage(searchQuery, lat, lng, radiusKm, offset = 0) {
  // Calcula a altitude/escala da câmera com base no raio em km
  const distanceMeters = Math.max((parseFloat(radiusKm) || 5) * 1800, 2000);
  const centerLat = lat || -23.5505;
  const centerLng = lng || -46.6333;

  const pb = `!4m12!1m3!1d${distanceMeters}!2d${centerLng}!3d${centerLat}!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!7i20!8i${offset}!10b1`;
  const url = `https://www.google.com/search?tbm=map&authuser=0&hl=pt-BR&gl=br&pb=${encodeURIComponent(pb)}&q=${encodeURIComponent(searchQuery)}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
    }
  });

  if (!res.ok) {
    throw new Error(`Falha ao consultar Google Maps (HTTP ${res.status})`);
  }

  const text = await res.text();
  const cleanJson = text.replace(/^\)\]\}'\s*/, '');
  const data = JSON.parse(cleanJson);

  // Coordenadas reais retornadas pelo Google caso não tivéssemos lat/lng iniciais
  let detectedCenter = null;
  if (data && data[0] && Array.isArray(data[0][0]) && Array.isArray(data[0][0][0])) {
    const coordsArr = data[0][0][0];
    if (typeof coordsArr[2] === 'number' && typeof coordsArr[1] === 'number') {
      detectedCenter = { lat: coordsArr[2], lng: coordsArr[1] };
    }
  }

  const rawItems = (data && data[0] && Array.isArray(data[0][1])) ? data[0][1] : [];
  const places = [];

  for (const entry of rawItems) {
    if (!entry || !Array.isArray(entry[14])) continue;
    const p = entry[14];

    const name = p[11];
    if (!name) continue;

    const categories = Array.isArray(p[13]) ? p[13] : [];
    const category = categories[0] || 'Estabelecimento Local';

    const address = p[39] || (Array.isArray(p[2]) ? p[2].join(', ') : 'Endereço no Maps');
    const rating = (p[4] && typeof p[4][7] === 'number') ? p[4][7] : null;
    const reviewsCount = (p[4] && typeof p[4][8] === 'number') ? p[4][8] : 0;

    const websiteUrl = (p[7] && p[7][0]) ? p[7][0] : null;
    const phone = (p[178] && p[178][0] && p[178][0][0]) ? p[178][0][0] : null;
    const placeId = p[78] || null;

    const itemLat = (p[9] && typeof p[9][2] === 'number') ? p[9][2] : null;
    const itemLng = (p[9] && typeof p[9][3] === 'number') ? p[9][3] : null;

    const mapsUrl = placeId
      ? `https://www.google.com/maps/place/?q=place_id:${placeId}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + ' ' + address)}`;

    places.push({
      name,
      category,
      address,
      rating,
      reviewsCount,
      websiteUrl,
      phone,
      placeId,
      lat: itemLat,
      lng: itemLng,
      mapsUrl
    });
  }

  return { places, detectedCenter };
}

/**
 * Busca leads no Google Maps com suporte a Raio (KM), Coordenadas e Paginação Profunda
 */
async function scrapeGoogleMaps(query, options = {}) {
  const {
    location = '',
    lat = null,
    lng = null,
    radiusKm = 5,
    maxResults = 25,
    maxReviews = 30,
    onlyWithoutWebsite = false,
    checkDuplicates = true,
    existingLeads = null,
    onProgress = () => {}
  } = options;

  const currentDb = existingLeads || (checkDuplicates ? loadDatabase() : []);
  let duplicatesSkipped = 0;

  let searchLat = lat ? parseFloat(lat) : null;
  let searchLng = lng ? parseFloat(lng) : null;

  if ((!searchLat || !searchLng) && location) {
    onProgress({
      status: 'geocodificando',
      message: `Localizando coordenadas de "${location}" para raio de ${radiusKm}km...`
    });
    const geo = await geocodeLocation(location);
    if (geo) {
      searchLat = geo.lat;
      searchLng = geo.lng;
    }
  }

  const fullQuery = location && !lat ? `${query} em ${location}` : query;

  onProgress({
    status: 'navegando',
    message: `Buscando "${fullQuery}" no Google Maps (raio de ${radiusKm}km)...`
  });

  const allRawPlaces = [];
  const seenKeys = new Set();

  // Busca até 4 páginas (80 estabelecimentos da região) para garantir bastante opções de leads frios
  const maxPages = 4;
  for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
    const offset = pageIdx * 20;
    if (pageIdx > 0) {
      onProgress({
        status: 'rolando',
        message: `Analisando mais lojas na região (página ${pageIdx + 1}, ${allRawPlaces.length} encontradas)...`
      });
    }

    try {
      const { places, detectedCenter } = await fetchGoogleMapsPage(
        fullQuery,
        searchLat,
        searchLng,
        radiusKm,
        offset
      );

      if (!searchLat && detectedCenter) {
        searchLat = detectedCenter.lat;
        searchLng = detectedCenter.lng;
      }

      if (!places || places.length === 0) break;

      let newInPage = 0;
      for (const p of places) {
        const key = p.placeId || `${p.name}_${p.phone || ''}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          allRawPlaces.push(p);
          newInPage++;
        }
      }

      if (newInPage === 0 || places.length < 10) break;
    } catch (err) {
      if (pageIdx === 0) throw err;
      break;
    }
  }

  onProgress({
    status: 'filtrando',
    message: `Analisando ${allRawPlaces.length} lojas e gerando roteiros de abordagem...`
  });

  const candidates = [];

  for (const item of allRawPlaces) {
    // Calcula distância em KM se tivermos centro definido
    let distanceKm = null;
    if (searchLat && searchLng && item.lat && item.lng) {
      distanceKm = calculateDistanceKm(searchLat, searchLng, item.lat, item.lng);
      // Se informou raio e a loja está muito fora do raio (tolerância de 1.5x), pula
      if (radiusKm && distanceKm > radiusKm * 1.5) {
        continue;
      }
    }

    const reviewsCount = item.reviewsCount || 0;
    const rating = item.rating;
    const hasWebsite = Boolean(item.websiteUrl);
    const isWithoutWebsite = !hasWebsite;

    // Classificação do Lead
    let leadTemperature = 'Morno';
    const flaws = [];

    if (reviewsCount === 0) {
      leadTemperature = 'Gelo Total';
      flaws.push('0 avaliações no Google');
    } else if (reviewsCount <= 10) {
      leadTemperature = 'Muito Frio';
      flaws.push(`Apenas ${reviewsCount} avaliações`);
    } else if (reviewsCount <= 30) {
      leadTemperature = 'Frio';
      flaws.push(`Poucas avaliações (${reviewsCount})`);
    }

    if (isWithoutWebsite) {
      flaws.push('Sem website cadastrado');
    }

    if (rating && rating < 4.2) {
      flaws.push(`Nota baixa (${rating}⭐)`);
    }

    if (distanceKm !== null) {
      flaws.push(`📍 A ${distanceKm} km`);
    }

    if (reviewsCount > 50 && hasWebsite) {
      leadTemperature = 'Quente';
    }

    const whatsappNumber = formatWhatsAppNumber(item.phone);
    const leadObj = {
      name: item.name,
      category: item.category,
      address: item.address,
      distanceKm,
      phone: item.phone || 'Não informado',
      whatsapp: whatsappNumber,
      rating: rating || 'S/N',
      reviewsCount,
      hasWebsite,
      isWithoutWebsite,
      websiteUrl: item.websiteUrl || null,
      mapsUrl: item.mapsUrl,
      temperature: leadTemperature,
      flaws,
      pitch: '',
      coldCallPoints: [],
      coldCallScript: null
    };

    leadObj.coldCallPoints = generateColdCallPoints(leadObj, location);
    leadObj.coldCallScript = generateColdCallScript(leadObj, location);
    leadObj.pitch = generatePitch(leadObj, location);

    // Aplica filtro de "apenas sem site"
    if (onlyWithoutWebsite && !isWithoutWebsite) {
      continue;
    }

    // Anti-repetição / Contexto de exclusão
    if (checkDuplicates && currentDb && currentDb.length > 0) {
      if (isLeadDuplicate(leadObj, currentDb)) {
        duplicatesSkipped++;
        continue;
      }
    }

    candidates.push(leadObj);
  }

  // Filtra pelo máximo de avaliações, mas se ficar muito vazio, prioriza os que têm menos avaliações ou não têm site
  let filtered = candidates.filter(c => maxReviews === null || c.reviewsCount <= maxReviews || c.isWithoutWebsite);
  if (filtered.length === 0 && candidates.length > 0) {
    // Ordena pelos mais frios (sem site primeiro, depois menor número de avaliações)
    filtered = [...candidates].sort((a, b) => {
      if (a.isWithoutWebsite !== b.isWithoutWebsite) return a.isWithoutWebsite ? -1 : 1;
      return a.reviewsCount - b.reviewsCount;
    });
  } else {
    // Ordena os resultados qualificados colocando os mais frios (sem site / menos notas) no topo!
    filtered.sort((a, b) => {
      if (a.isWithoutWebsite !== b.isWithoutWebsite) return a.isWithoutWebsite ? -1 : 1;
      return a.reviewsCount - b.reviewsCount;
    });
  }

  const finalLeads = filtered.slice(0, maxResults);

  onProgress({
    status: 'concluido',
    message: `Concluído! ${finalLeads.length} lojas encontradas (${duplicatesSkipped} repetidas ignoradas).`
  });

  return {
    leads: finalLeads,
    duplicatesSkipped,
    totalAnalyzed: allRawPlaces.length
  };
}

module.exports = {
  scrapeGoogleMaps,
  geocodeLocation,
  generateColdCallPoints,
  generateColdCallScript,
  generatePitch
};
