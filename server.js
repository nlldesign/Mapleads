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
  parseBatchSearchSpreadsheet
} = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do Multer (Upload em memória para processamento rápido)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // Até 15MB
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// ROTAS DE STATUS E GESTÃO DO BANCO DE LEADS
// ==========================================

// Retorna estatísticas do banco de contexto anti-repetição
app.get('/api/database/status', (req, res) => {
  const db = loadDatabase();
  return res.json({
    totalLeads: db.length,
    lastUpdated: db.length > 0 ? (db[db.length - 1].importedAt || db[db.length - 1].discoveredAt) : null
  });
});

// Limpa o banco de leads salvos
app.post('/api/database/clear', (req, res) => {
  saveDatabase([]);
  return res.json({ success: true, message: 'Banco de leads limpo com sucesso.', totalLeads: 0 });
});

// Salva leads da busca atual no banco para evitar repetição futura
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
    return res.json({
      success: true,
      filename: req.file.originalname,
      importedCount: result.importedCount,
      skippedDuplicates: result.skippedDuplicates,
      totalDatabase: result.totalDatabase
    });
  } catch (error) {
    console.error('Erro ao importar planilha de exclusão:', error);
    return res.status(500).json({ error: 'Erro ao processar planilha: ' + error.message });
  }
});

// Download consolidado de toda a base em formato Excel (.xlsx) ou CSV
app.get('/api/database/download-all', (req, res) => {
  const format = req.query.format || 'xlsx';
  const db = loadDatabase();

  if (db.length === 0) {
    return res.status(404).send('Nenhum lead encontrado na base para exportar.');
  }

  const exportRows = db.map(l => ({
    'Nome da Loja': l.name || '',
    'Categoria': l.category || '',
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
    'Data de Registro': l.discoveredAt || l.importedAt || ''
  }));

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

  // Formato XLSX nativo com estilo de tabela
  const worksheet = xlsx.utils.json_to_sheet(exportRows);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Leads Qualificados');

  const excelBuffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="mapleads_base_consolidada_${Date.now()}.xlsx"`);
  return res.send(excelBuffer);
});

// ==========================================
// ROTAS DE BUSCA E STREAMING DE RESULTADOS
// ==========================================

// Rota de busca individual com streaming de eventos (Server-Sent Events)
app.get('/api/search/stream', async (req, res) => {
  const query = req.query.q;
  const location = req.query.location || '';
  const lat = req.query.lat || null;
  const lng = req.query.lng || null;
  const radiusKm = parseFloat(req.query.radiusKm || '5');
  const maxResults = parseInt(req.query.maxResults || '25', 10);
  const maxReviews = req.query.maxReviews ? parseInt(req.query.maxReviews, 10) : 20;
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
      message: `Iniciando prospecção para "${query}" num raio de ${radiusKm}km...` 
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

    // Salva automaticamente os novos leads encontrados no banco para context futuro
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

// Upload de planilha para Busca em Lote (Batch Searches)
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

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Sistema MapLeads - Leads Frios com Contexto Anti-Duplicatas`);
  console.log(`👉 Acesse no navegador: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
