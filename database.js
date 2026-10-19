const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const DATA_DIR = process.env.VERCEL ? path.join('/tmp', 'data') : path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'leads_database.json');

// Garante que o diretório data existe
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (_) {}

function loadDatabase() {
  if (!fs.existsSync(DB_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Erro ao ler banco de dados de leads:', err);
    return [];
  }
}

function saveDatabase(leads) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(leads, null, 2), 'utf-8');
  } catch (err) {
    console.error('Erro ao salvar banco de dados de leads:', err);
  }
}

/**
 * Normaliza texto para comparação sem acento e minúsculas
 */
function normalizeStr(str) {
  if (!str) return '';
  return str
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Normaliza telefone para apenas dígitos
 */
function normalizeDigits(phone) {
  if (!phone) return '';
  return phone.toString().replace(/\D/g, '');
}

/**
 * Normaliza URL do Google Maps para ID único de lugar (/place/Nome/...)
 */
function normalizeMapsUrl(url) {
  if (!url) return '';
  try {
    const match = url.match(/\/place\/([^\/\?]+)/);
    if (match) return match[1].toLowerCase();
  } catch (_) {}
  return url.toLowerCase().trim();
}

/**
 * Verifica se um lead já existe no banco de dados
 */
function isLeadDuplicate(lead, existingLeads) {
  const normName = normalizeStr(lead.name);
  const normPhone = normalizeDigits(lead.phone);
  const normMaps = normalizeMapsUrl(lead.mapsUrl);

  for (const existing of existingLeads) {
    // 1. Verifica por URL do Google Maps
    if (normMaps && existing.normMaps && normMaps === existing.normMaps) {
      return true;
    }
    // 2. Verifica por Telefone (se tiver pelo menos 8 dígitos)
    if (normPhone && normPhone.length >= 8 && existing.normPhone && normPhone === existing.normPhone) {
      return true;
    }
    // 3. Verifica por Nome Exato
    if (normName && existing.normName && normName === existing.normName) {
      return true;
    }
  }

  return false;
}

/**
 * Importa leads a partir de um arquivo buffer (CSV ou XLSX)
 */
function importSpreadsheet(buffer, originalFilename) {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const rows = xlsx.utils.sheet_to_json(worksheet, { defval: '' });

  const currentDb = loadDatabase();
  const existingSet = new Set();
  currentDb.forEach(l => {
    if (l.normMaps) existingSet.add(l.normMaps);
    if (l.normPhone) existingSet.add(l.normPhone);
    if (l.normName) existingSet.add(l.normName);
  });

  let importedCount = 0;
  let skippedDuplicates = 0;

  for (const row of rows) {
    // Procura colunas de forma flexível (case-insensitive)
    const keys = Object.keys(row);
    const getVal = (...names) => {
      for (const name of names) {
        const foundKey = keys.find(k => normalizeStr(k).includes(normalizeStr(name)));
        if (foundKey && row[foundKey]) return row[foundKey].toString().trim();
      }
      return '';
    };

    const name = getVal('nome da loja', 'nome', 'empresa', 'loja', 'estabelecimento', 'name');
    const phone = getVal('telefone', 'whatsapp', 'celular', 'contato', 'phone');
    const mapsUrl = getVal('link da loja', 'link maps', 'maps', 'url', 'google maps');
    const category = getVal('categoria', 'ramo', 'segmento', 'nicho');
    const address = getVal('endereco', 'endereço', 'localizacao', 'cidade');
    const websiteUrl = getVal('website', 'site');

    if (!name && !mapsUrl && !phone) continue;

    const normName = normalizeStr(name);
    const normPhone = normalizeDigits(phone);
    const normMaps = normalizeMapsUrl(mapsUrl);

    // Checa se já existe
    const isDup = 
      (normMaps && existingSet.has(normMaps)) ||
      (normPhone && normPhone.length >= 8 && existingSet.has(normPhone)) ||
      (normName && existingSet.has(normName));

    if (isDup) {
      skippedDuplicates++;
      continue;
    }

    const leadEntry = {
      name: name || 'Loja Importada',
      phone: phone || '',
      mapsUrl: mapsUrl || '',
      category: category || '',
      address: address || '',
      websiteUrl: websiteUrl || '',
      normName,
      normPhone,
      normMaps,
      importedAt: new Date().toISOString(),
      source: originalFilename || 'Planilha Manual'
    };

    currentDb.push(leadEntry);
    if (normMaps) existingSet.add(normMaps);
    if (normPhone) existingSet.add(normPhone);
    if (normName) existingSet.add(normName);
    importedCount++;
  }

  saveDatabase(currentDb);

  return {
    totalDatabase: currentDb.length,
    importedCount,
    skippedDuplicates
  };
}

/**
 * Adiciona novos leads minerados ao banco de dados para evitar repetição futura
 */
function addLeadsToDatabase(leads) {
  const currentDb = loadDatabase();
  let added = 0;

  for (const lead of leads) {
    if (!isLeadDuplicate(lead, currentDb)) {
      currentDb.push({
        ...lead,
        normName: normalizeStr(lead.name),
        normPhone: normalizeDigits(lead.phone),
        normMaps: normalizeMapsUrl(lead.mapsUrl),
        discoveredAt: new Date().toISOString()
      });
      added++;
    }
  }

  saveDatabase(currentDb);
  return { total: currentDb.length, added };
}

/**
 * Lê uma planilha de buscas em lote (para prospecção em massa)
 */
function parseBatchSearchSpreadsheet(buffer) {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const rows = xlsx.utils.sheet_to_json(worksheet, { defval: '' });

  const searches = [];
  for (const row of rows) {
    const keys = Object.keys(row);
    const getVal = (...names) => {
      for (const name of names) {
        const foundKey = keys.find(k => normalizeStr(k).includes(normalizeStr(name)));
        if (foundKey && row[foundKey]) return row[foundKey].toString().trim();
      }
      return '';
    };

    const query = getVal('nicho', 'segmento', 'termo', 'busca', 'query');
    const location = getVal('regiao', 'região', 'cidade', 'bairro', 'location');
    const radiusKm = parseFloat(getVal('raio', 'raio km', 'radius')) || 5;
    const maxResults = parseInt(getVal('maximo', 'quantidade', 'max', 'limite'), 10) || 15;

    if (query) {
      searches.push({ query, location, radiusKm, maxResults });
    }
  }

  return searches;
}

module.exports = {
  loadDatabase,
  saveDatabase,
  isLeadDuplicate,
  importSpreadsheet,
  addLeadsToDatabase,
  parseBatchSearchSpreadsheet,
  normalizeStr,
  normalizeDigits,
  normalizeMapsUrl
};
