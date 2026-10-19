const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { loadDatabase, isLeadDuplicate } = require('./database');

function getBrowserPath() {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Geocodifica uma cidade/bairro para coordenadas via OpenStreetMap (gratuito)
 */
async function geocodeLocation(locationText) {
  if (!locationText) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationText)}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MapLeads-Prospector/2.0' }
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
 * Converte raio em KM para nível de Zoom do Google Maps
 */
function getZoomForRadius(radiusKm) {
  const km = parseFloat(radiusKm) || 5;
  if (km <= 1) return 15;
  if (km <= 2) return 14;
  if (km <= 5) return 13;
  if (km <= 10) return 12;
  if (km <= 20) return 11;
  return 10; // 50km
}

/**
 * Normaliza número de telefone para formato WhatsApp (DDI + DDD + Número)
 */
function formatWhatsAppNumber(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }
  return digits;
}

/**
 * Gera pontos de dor e argumentos específicos para abordagem por LIGAÇÃO (Cold Calling)
 */
function generateColdCallPoints(lead, location) {
  const points = [];
  const nomeEmpresa = lead.name || 'a empresa';
  const regiao = location || 'sua região';

  // Ponto 1: Presença de Website
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

  // Ponto 2: Avaliações e Prova Social
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
  } else if (lead.reviewsCount <= 25) {
    points.push({
      tipo: 'Avaliações Baixas',
      impacto: 'Médio',
      argumento: `Com ${lead.reviewsCount} avaliações, qualquer avaliação de 1 estrela derruba a média e afasta novos clientes. Falta um fluxo automatizado para pedir avaliações aos clientes satisfeitos.`
    });
  }

  // Ponto 3: Nota / Reputação
  if (lead.rating && lead.rating < 4.2) {
    points.push({
      tipo: 'Nota Abaixo do Ideal',
      impacto: 'Crítico',
      argumento: `A nota média está em ${lead.rating}⭐. Clientes evitam ligar para estabelecimentos com nota inferior a 4.5 quando há outras opções perto.`
    });
  }

  // Ponto 4: Posicionamento no Raio de Busca
  points.push({
    tipo: 'Visibilidade Local no Raio',
    impacto: 'Alto',
    argumento: `Quem pesquisa "${lead.category}" num raio de até 5km está comprando de concorrentes que aparecem no Top 3 do Google Maps.`
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
  } else if (lead.rating && lead.rating < 4.2) {
    motivos.push(`a nota atual está em ${lead.rating} estrelas`);
  }

  const motivoTexto = motivos.length > 0 
    ? motivos.join(' e ') 
    : 'analisei o posicionamento digital de vocês na região';

  return `Olá! Tudo bem? Encontrei a ${nomeEmpresa} no Google Maps. Estava pesquisando negócios do seu segmento na região e ${motivoTexto}. Nós ajudamos empresas locais a se destacarem e atraírem mais clientes pelo Google todos os meses. Teria 5 minutinhos essa semana para conversarmos sobre como alavancar a presença digital da ${nomeEmpresa}?`;
}

/**
 * Busca leads no Google Maps com suporte a Raio (KM) e Coordenadas / Região
 */
async function scrapeGoogleMaps(query, options = {}) {
  const {
    location = '',
    lat = null,
    lng = null,
    radiusKm = 5,
    maxResults = 25,
    maxReviews = 20,
    onlyWithoutWebsite = false,
    checkDuplicates = true,
    existingLeads = null,
    onProgress = () => {}
  } = options;

  const currentDb = existingLeads || (checkDuplicates ? loadDatabase() : []);
  let duplicatesSkipped = 0;

  const chromePath = getBrowserPath();
  if (!chromePath) {
    throw new Error('Nenhum navegador (Chrome ou Edge) foi encontrado no sistema.');
  }

  onProgress({ status: 'iniciando', message: 'Iniciando navegador com alta performance...' });

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--lang=pt-BR,pt'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );

    // Determina se temos coordenadas (GPS ou geocodificação da região)
    let searchLat = lat ? parseFloat(lat) : null;
    let searchLng = lng ? parseFloat(lng) : null;
    const zoomLevel = getZoomForRadius(radiusKm);

    if ((!searchLat || !searchLng) && location) {
      onProgress({ status: 'geocodificando', message: `Localizando coordenadas de "${location}" para aplicar raio de ${radiusKm}km...` });
      const geo = await geocodeLocation(location);
      if (geo) {
        searchLat = geo.lat;
        searchLng = geo.lng;
      }
    }

    let searchUrl = '';
    if (searchLat && searchLng) {
      searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}/@${searchLat},${searchLng},${zoomLevel}z`;
      onProgress({ 
        status: 'navegando', 
        message: `Buscando "${query}" no raio de ${radiusKm}km (@${searchLat.toFixed(3)}, ${searchLng.toFixed(3)})...` 
      });
    } else {
      const fullSearch = location ? `${query} em ${location}` : query;
      searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(fullSearch)}`;
      onProgress({ status: 'navegando', message: `Acessando Google Maps para "${fullSearch}"...` });
    }

    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 35000 });

    // Aceita cookies caso popup apareça
    try {
      const consentBtn = await page.$('form[action*="consent"] button');
      if (consentBtn) {
        await consentBtn.click();
        await page.waitForNavigation({ waitUntil: 'networkidle2' });
      }
    } catch (_) {}

    // Aguarda container de feed
    try {
      await page.waitForSelector('div[role="feed"]', { timeout: 12000 });
    } catch (_) {
      // Se não encontrou o feed direto, verifica se caiu em um local único
      const isSinglePlace = await page.$('h1.fontHeadlineLarge');
      if (isSinglePlace) {
        onProgress({ status: 'sucesso', message: 'Um único local retornado.' });
      }
    }

    onProgress({ status: 'rolando', message: `Minerando estabelecimentos no raio de ${radiusKm}km...` });

    // Rola o feed para carregar estabelecimentos
    const scrollFeed = async () => {
      return await page.evaluate(async (maxTarget) => {
        const feed = document.querySelector('div[role="feed"]');
        if (!feed) return 0;

        let lastCount = 0;
        let retries = 0;

        while (retries < 6) {
          const links = feed.querySelectorAll('a[href*="/maps/place/"]');
          if (links.length >= maxTarget) break;

          feed.scrollBy(0, 1600);
          await new Promise((r) => setTimeout(r, 1100));

          const currentCount = feed.querySelectorAll('a[href*="/maps/place/"]').length;
          if (currentCount === lastCount) {
            retries++;
            feed.scrollBy(0, -350);
            await new Promise((r) => setTimeout(r, 400));
            feed.scrollBy(0, 1600);
          } else {
            retries = 0;
            lastCount = currentCount;
          }
        }
        return feed.querySelectorAll('a[href*="/maps/place/"]').length;
      }, maxResults + 10);
    };

    await scrollFeed();

    onProgress({ status: 'extraindo', message: 'Extraindo fichas, contatos e analisando presenças...' });

    // Extrai dados brutos dos cards
    const rawPlaces = await page.evaluate(() => {
      const results = [];
      const placeLinks = document.querySelectorAll('a[href*="/maps/place/"]');
      const seen = new Set();

      placeLinks.forEach((link) => {
        const href = link.href;
        if (seen.has(href)) return;
        seen.add(href);

        const card = link.closest('div[role="article"]') || link.parentElement?.parentElement || link;
        const text = card.innerText || '';
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

        const aria = link.getAttribute('aria-label') || '';
        const name = aria || lines[0] || 'Sem Nome';

        // Tenta achar links de website ou botões
        const websiteLink = card.querySelector('a[data-value="Website"], a[href^="http"]:not([href*="google.com"])');
        const websiteUrl = websiteLink ? websiteLink.href : null;

        results.push({
          name,
          mapsUrl: href,
          lines,
          websiteUrl
        });
      });

      return results;
    });

    onProgress({ status: 'filtrando', message: `Encontradas ${rawPlaces.length} empresas. Gerando dossiês e pontos de ligação...` });

    const processedLeads = [];

    for (const item of rawPlaces) {
      const fullText = item.lines.join(' | ');

      // Rating e Reviews
      let rating = null;
      let reviewsCount = 0;

      const ratingMatch = fullText.match(/(\d[,\.]\d)\s*\(([\d\.]+)\)/);
      if (ratingMatch) {
        rating = parseFloat(ratingMatch[1].replace(',', '.'));
        reviewsCount = parseInt(ratingMatch[2].replace('.', ''), 10);
      } else {
        const soloRating = fullText.match(/(\d[,\.]\d)/);
        if (soloRating && parseFloat(soloRating[1].replace(',', '.')) <= 5.0) {
          rating = parseFloat(soloRating[1].replace(',', '.'));
        }
      }

      // Telefone
      let phone = null;
      const phoneMatch = fullText.match(/(?:\(?\d{2}\)?\s*)?(?:9\d{4}|\d{4})[-.\s]?\d{4}/);
      if (phoneMatch) {
        phone = phoneMatch[0].trim();
      }

      // Categoria e Endereço aproximado
      let category = query || 'Empresa Local';
      let address = '';

      for (const line of item.lines) {
        if (line.includes('·')) {
          const parts = line.split('·').map(p => p.trim());
          if (parts[0] && !parts[0].match(/^\d[,\.]\d/)) {
            category = parts[0];
          }
          if (parts[1]) {
            address = parts[1];
          }
        } else if (line.match(/(Rua|Av\.|Avenida|Alameda|Praça|Travessa|Rodovia|Estrada)/i)) {
          address = line;
        }
      }

      const hasWebsite = Boolean(item.websiteUrl || fullText.toLowerCase().includes('site'));
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
      } else if (reviewsCount <= maxReviews) {
        leadTemperature = 'Frio';
        flaws.push(`Poucas avaliações (${reviewsCount})`);
      }

      if (isWithoutWebsite) {
        flaws.push('Sem website cadastrado');
      }

      if (rating && rating < 4.2) {
        flaws.push(`Nota baixa (${rating}⭐)`);
      }

      if (reviewsCount > 50 && hasWebsite) {
        leadTemperature = 'Quente';
      }

      const whatsappNumber = formatWhatsAppNumber(phone);
      const leadObj = {
        name: item.name,
        category,
        address: address || 'Endereço disponível na ficha do Maps',
        phone: phone || 'Não informado',
        whatsapp: whatsappNumber,
        rating: rating || 'S/N',
        reviewsCount: reviewsCount,
        hasWebsite: !isWithoutWebsite,
        isWithoutWebsite,
        websiteUrl: item.websiteUrl || null,
        mapsUrl: item.mapsUrl,
        temperature: leadTemperature,
        flaws,
        pitch: '',
        coldCallPoints: [],
        coldCallScript: null
      };

      // Gera os pontos e scripts de ligação comercial
      leadObj.coldCallPoints = generateColdCallPoints(leadObj, location);
      leadObj.coldCallScript = generateColdCallScript(leadObj, location);
      leadObj.pitch = generatePitch(leadObj, location);

      // Aplica filtros especificados pelo usuário
      if (onlyWithoutWebsite && !isWithoutWebsite) {
        continue;
      }
      if (maxReviews !== null && reviewsCount > maxReviews) {
        continue;
      }

      // Anti-repetição / Contexto de exclusão
      if (checkDuplicates && currentDb && currentDb.length > 0) {
        if (isLeadDuplicate(leadObj, currentDb)) {
          duplicatesSkipped++;
          continue;
        }
      }

      processedLeads.push(leadObj);

      if (processedLeads.length >= maxResults) {
        break;
      }
    }

    onProgress({
      status: 'concluido',
      message: `Concluído! ${processedLeads.length} leads novos qualificados (${duplicatesSkipped} locais repetidos ignorados).`
    });

    return {
      leads: processedLeads,
      duplicatesSkipped,
      totalAnalyzed: rawPlaces.length
    };
  } finally {
    await browser.close();
  }
}

module.exports = {
  scrapeGoogleMaps,
  geocodeLocation,
  generateColdCallPoints,
  generateColdCallScript,
  generatePitch
};
