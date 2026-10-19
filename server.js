const express = require('express');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const { scrapeGoogleMaps } = require('./scraper');
const {
  loadDatabase,
  saveDatabase,
  importSpreadsheet,
  addLeadsToDatabase,
  parseBatchSearchSpreadsheet,
  isLeadDuplicate
} = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do Multer (Upload em memória)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// ROTAS DE STATUS E GESTÃO DO BANCO DE LEADS
// ==========================================

app.get('/api/database/status', (req, res) => {
  const db = loadDatabase();
  return res.json({
    totalLeads: db.length,
    lastUpdated: db.length > 0 ? (db[db.length - 1].importedAt || db[db.length - 1].discoveredAt) : null
  });
});

app.post('/api/database/clear', (req, res) => {
  saveDatabase([]);
  return res.json({ success: true, message: 'Memória limpa com sucesso.', totalLeads: 0 });
});

app.post('/api/database/save-current', (req, res) => {
  const { leads } = req.body;
  if (!Array.isArray(leads) || leads.length === 0) {
    return res.status(400).json({ error: 'Nenhum lead fornecido.' });
  }
  const result = addLeadsToDatabase(leads);
  return res.json({ success: true, ...result });
});

// Upload de planilha com leads para usar como contexto de exclusão (anti-repetição)
app.post('/api/database/upload-exclusion', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  }

  try {
    const result = importSpreadsheet(req.file.buffer, req.file.originalname);
    const allLeads = loadDatabase();
    return res.json({
      success: true,
      filename: req.file.originalname,
      importedCount: result.importedCount,
      skippedDuplicates: result.skippedDuplicates,
      totalDatabase: result.totalDatabase,
      leads: allLeads
    });
  } catch (error) {
    console.error('Erro ao importar planilha de exclusão:', error);
    return res.status(500).json({ error: 'Erro ao processar planilha: ' + error.message });
  }
});

function formatLeadsForExport(leadsList) {
  return leadsList.map(l => ({
    'Nome da Loja': l.name || '',
    'Categoria': l.category || '',
    'Distância (km)': l.distanceKm !== undefined && l.distanceKm !== null ? `${l.distanceKm} km` : '',
    'Nota': l.rating || '',
    'Qtd Avaliações': l.reviewsCount !== undefined ? l.reviewsCount : '',
    'Temperatura': l.temperature || '',
    'Telefone': l.phone || '',
    'WhatsApp': l.whatsapp || '',
    'Tem Website': l.hasWebsite ? 'Sim' : 'Não',
    'Website': l.websiteUrl || '',
    'Ficha no Google Maps': l.mapsUrl || '',
    'Endereço': l.address || '',
    'Principais Pontos Fracos': Array.isArray(l.flaws) ? l.flaws.join(' | ') : (l.flaws || ''),
    'Script Gancho de Ligacao': l.coldCallScript?.passo2_gancho || '',
    'Mensagem WhatsApp': l.pitch || '',
    'Data de Registro': l.discoveredAt || l.importedAt || new Date().toISOString().slice(0, 10)
  }));
}

// Exportação via POST (garante funcionamento 100% mesmo em ambiente Serverless da Vercel)
app.post('/api/database/export', (req, res) => {
  const clientLeads = Array.isArray(req.body.leads) ? req.body.leads : [];
  const serverLeads = loadDatabase();

  // Combina leads do cliente e do servidor sem duplicar
  const combined = [...serverLeads];
  for (const cl of clientLeads) {
    if (!isLeadDuplicate(cl, combined)) {
      combined.push(cl);
    }
  }

  if (combined.length === 0) {
    return res.status(404).json({ error: 'Nenhuma loja encontrada para exportar.' });
  }

  const exportRows = formatLeadsForExport(combined);
  const worksheet = xlsx.utils.json_to_sheet(exportRows);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Leads Qualificados');

  const excelBuffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="mapleads_lista_clientes_${Date.now()}.xlsx"`);
  return res.send(excelBuffer);
});

// Download consolidado via GET
app.get('/api/database/download-all', (req, res) => {
  const format = req.query.format || 'xlsx';
  const db = loadDatabase();

  if (db.length === 0) {
    return res.status(404).send('Nenhuma loja salva na memória ainda. Faça uma busca primeiro!');
  }

  const exportRows = formatLeadsForExport(db);

  if (format === 'csv') {
    const headers = Object.keys(exportRows[0]);
    const csvLines = [headers.join(';')];
    exportRows.forEach(row => {
      const line = headers.map(h => `"${(row[h] || '').toString().replace(/"/g, '""')}"`).join(';');
      csvLines.push(line);
    });
    const csvContent = '\uFEFF' + csvLines.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="mapleads_base_consolidada_${Date.now()}.csv"`);
    return res.send(csvContent);
  }

  const worksheet = xlsx.utils.json_to_sheet(exportRows);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Leads Qualificados');

  const excelBuffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="mapleads_base_consolidada_${Date.now()}.xlsx"`);
  return res.send(excelBuffer);
});

// ==========================================
// ROTAS DE BUSCA (JSON DIRETO + STREAMING SSE)
// ==========================================

// Rota de busca rápida JSON/POST (Ideal para Vercel Serverless e Mobile)
app.post('/api/search', async (req, res) => {
  const {
    query,
    location = '',
    lat = null,
    lng = null,
    radiusKm = 5,
    maxResults = 25,
    maxReviews = 30,
    onlyWithoutWebsite = false,
    checkDuplicates = true,
    clientKnownLeads = []
  } = req.body;

  if (!query) {
    return res.status(400).json({ error: 'Informe o tipo de negócio que deseja buscar.' });
  }

  try {
    const serverDb = loadDatabase();
    const combinedExisting = [...serverDb, ...(Array.isArray(clientKnownLeads) ? clientKnownLeads : [])];

    const result = await scrapeGoogleMaps(query, {
      location,
      lat,
      lng,
      radiusKm: parseFloat(radiusKm || '5'),
      maxResults: parseInt(maxResults || '25', 10),
      maxReviews: maxReviews ? parseInt(maxReviews, 10) : 30,
      onlyWithoutWebsite: Boolean(onlyWithoutWebsite),
      checkDuplicates: Boolean(checkDuplicates),
      existingLeads: combinedExisting
    });

    const leads = result.leads || [];
    if (leads.length > 0) {
      addLeadsToDatabase(leads);
    }

    return res.json({
      success: true,
      count: leads.length,
      duplicatesSkipped: result.duplicatesSkipped || 0,
      totalAnalyzed: result.totalAnalyzed || 0,
      leads,
      totalDatabase: loadDatabase().length
    });
  } catch (error) {
    console.error('Erro na busca:', error);
    return res.status(500).json({ error: error.message || 'Erro durante a busca no Google Maps.' });
  }
});

// Rota de busca via GET / Streaming (SSE)
app.get('/api/search/stream', async (req, res) => {
  const query = req.query.q;
  const location = req.query.location || '';
  const lat = req.query.lat || null;
  const lng = req.query.lng || null;
  const radiusKm = parseFloat(req.query.radiusKm || '5');
  const maxResults = parseInt(req.query.maxResults || '25', 10);
  const maxReviews = req.query.maxReviews ? parseInt(req.query.maxReviews, 10) : 30;
  const onlyWithoutWebsite = req.query.onlyWithoutWebsite === 'true';
  const checkDuplicates = req.query.checkDuplicates !== 'false';

  if (!query) {
    return res.status(400).json({ error: 'Termo de busca é obrigatório.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    sendEvent('progress', {
      status: 'iniciando',
      message: `Iniciando busca para "${query}" num raio de ${radiusKm}km...`
    });

    const result = await scrapeGoogleMaps(query, {
      location,
      lat,
      lng,
      radiusKm,
      maxResults,
      maxReviews,
      onlyWithoutWebsite,
      checkDuplicates,
      onProgress: (prog) => {
        sendEvent('progress', prog);
      }
    });

    const leads = result.leads || [];
    const duplicatesSkipped = result.duplicatesSkipped || 0;

    if (leads.length > 0) {
      addLeadsToDatabase(leads);
    }

    sendEvent('result', {
      success: true,
      count: leads.length,
      duplicatesSkipped,
      leads,
      totalDatabase: loadDatabase().length
    });
    res.end();
  } catch (error) {
    console.error('Erro na prospecção:', error);
    sendEvent('error', { message: error.message || 'Erro durante a extração.' });
    res.end();
  }
});

// Upload de planilha para Busca em Lote
app.post('/api/batch-search', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Envie um arquivo CSV ou Excel com as buscas.' });
  }

  try {
    const searches = parseBatchSearchSpreadsheet(req.file.buffer);
    if (searches.length === 0) {
      return res.status(400).json({ error: 'Nenhuma linha válida de busca encontrada na planilha.' });
    }

    return res.json({
      success: true,
      totalSearches: searches.length,
      searches
    });
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao ler planilha: ' + error.message });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Sistema MapLeads - Leads Frios com Contexto Anti-Duplicatas`);
    console.log(`👉 Acesse no navegador: http://localhost:${PORT}`);
    console.log(`======================================================\n`);
  });
}

module.exports = app;
