// ================================
// Unified ERP - Code.gs
// ================================

function _getSupabaseConfig_() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SUPABASE_URL');
  const key = props.getProperty('SUPABASE_SERVICE_KEY');

  if (!url || !key) {
    throw new Error('Supabase configuration missing');
  }
  return { url, key };
}
function _supabaseFetch_(path, method, payload, queryParams, extraHeaders) {
  const { url, key } = _getSupabaseConfig_();

  let fullUrl = url + path;

  if (queryParams && typeof queryParams === 'object') {
    const qs = Object.keys(queryParams)
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
      .join('&');
    if (qs) fullUrl += '?' + qs;
  }

  const options = {
    method: method || 'get',
    muteHttpExceptions: true,
    contentType: 'application/json',
headers: {
  'apikey': key,
  'Authorization': 'Bearer ' + key,
  'Prefer': 'return=representation'
}
  };

  if (extraHeaders && typeof extraHeaders === 'object') {
    options.headers = Object.assign({}, options.headers, extraHeaders);
  }

  if (payload) {
    options.payload = JSON.stringify(payload);
  }

  let res;
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = UrlFetchApp.fetch(fullUrl, options);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      const msg = String(err && err.message || '');
      const transient =
        msg.indexOf('Address unavailable') !== -1 ||
        msg.indexOf('Timed out') !== -1 ||
        msg.indexOf('Exception: Service invoked too many times') !== -1;
      if (!transient || attempt === 2) {
        throw err;
      }
      Utilities.sleep(400 * (attempt + 1));
    }
  }
  if (!res && lastErr) throw lastErr;
  const code = res.getResponseCode();
  const text = res.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error(`Supabase error ${code}: ${text}`);
  }

  return text ? JSON.parse(text) : null;
}

function supabaseSelect(table, opts) {
  const q = {};
  if (opts?.select) q.select = opts.select;
  if (opts?.filters) {
    Object.keys(opts.filters).forEach(k => q[k] = opts.filters[k]);
  }
  if (opts?.order) q.order = opts.order;
  if (opts?.limit) q.limit = opts.limit;
  if (opts?.offset || opts?.offset === 0) q.offset = opts.offset;

  return _supabaseFetch_(
    `/rest/v1/${table}`,
    'get',
    null,
    q
  );
}

function _supabaseRelationMissing_(err, relationName) {
  const msg = String((err && err.message) || err || '').toLowerCase();
  const rel = String(relationName || '').toLowerCase();
  return msg.indexOf(rel) !== -1 && (
    msg.indexOf('does not exist') !== -1 ||
    msg.indexOf('could not find') !== -1 ||
    msg.indexOf('schema cache') !== -1
  );
}

function _supabaseSelectAll_(table, opts, pageSize, maxRows) {
  const size = Math.min(1000, Math.max(1, Number(pageSize || 1000) || 1000));
  const cap = Math.max(size, Number(maxRows || 50000) || 50000);
  const base = Object.assign({}, opts || {});
  delete base.limit;
  delete base.offset;
  const out = [];
  let offset = 0;
  while (offset < cap) {
    const rows = supabaseSelect(table, Object.assign({}, base, {
      limit: Math.min(size, cap - offset),
      offset: offset
    })) || [];
    if (!rows.length) break;
    out.push.apply(out, rows);
    if (rows.length < size) break;
    offset += rows.length;
  }
  return out;
}

function _selectArtworkJobsFromView_(viewName, opts) {
  const query = opts || {};
  const optionalColumns = ['teeth', 'stock_qty_to_bill', 'division', 'job_reference', 'expected_delivery', 'job_priority', 'product_remarks', 'prepress_remarks'];
  const viewPattern = String(viewName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stripSelectColumn = function(select, column) {
    return String(select || '')
      .replace(new RegExp(',' + column + '\\b', 'g'), '')
      .replace(new RegExp('\\b' + column + ',', 'g'), '')
      .replace(',,', ',')
      .replace(/^,|,$/g, '');
  };
  try {
    return supabaseSelect(viewName, query) || [];
  } catch (e) {
    const msg = String((e && e.message) || e || '');
    const select = String(query.select || '');
    const missingColumn = optionalColumns.find(function(col) {
      return new RegExp(viewPattern + '\\.' + col, 'i').test(msg) && /does not exist/i.test(msg);
    });
    if (!missingColumn || !select) throw e;

    let fallbackSelect = stripSelectColumn(select, missingColumn);
    const missingColumns = {};
    missingColumns[missingColumn] = true;

    while (true) {
      try {
        const rows = supabaseSelect(viewName, Object.assign({}, query, {
          select: fallbackSelect
        })) || [];
        return rows.map(function(row) {
          Object.keys(missingColumns).forEach(function(col) {
            row[col] = col === 'stock_qty_to_bill' ? 0 : null;
          });
          return row;
        });
      } catch (inner) {
        const innerMsg = String((inner && inner.message) || inner || '');
        const nextMissing = optionalColumns.find(function(col) {
          return !missingColumns[col] && new RegExp(viewPattern + '\\.' + col, 'i').test(innerMsg) && /does not exist/i.test(innerMsg);
        });
        if (!nextMissing) throw inner;
        missingColumns[nextMissing] = true;
        fallbackSelect = stripSelectColumn(fallbackSelect, nextMissing);
      }
    }
  }
}

function selectArtworkJobsView_(opts) {
  return _selectArtworkJobsFromView_('v_artwork_jobs', opts);
}

function selectArtworkJobsActiveView_(opts) {
  try {
    return _selectArtworkJobsFromView_('v_artwork_jobs_active', opts);
  } catch (err) {
    if (!_supabaseRelationMissing_(err, 'v_artwork_jobs_active')) throw err;
    return _excludeClosedSalesOrderLines_(selectArtworkJobsView_(opts), 'so_number', 'line_no');
  }
}

function supabaseInsert(table, payload) {
  return _supabaseFetch_(
    `/rest/v1/${table}`,
    'post',
    payload
  );
}

function supabaseInsertMinimal(table, payload) {
  return _supabaseFetch_(
    `/rest/v1/${table}`,
    'post',
    payload,
    null,
    { Prefer: 'return=minimal' }
  );
}

function supabaseBulkInsert(table, rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  return _supabaseFetch_(
    `/rest/v1/${table}`,
    'post',
    rows
  );
}

function supabaseBulkInsertMinimal(table, rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  return _supabaseFetch_(
    `/rest/v1/${table}`,
    'post',
    rows,
    null,
    { Prefer: 'return=minimal' }
  );
}

function supabaseUpsert(table, payload, options) {
  let path = `/rest/v1/${table}`;
  const headers = {
    'Prefer': 'return=representation,resolution=merge-duplicates'
  };

  if (options && options.onConflict) {
    path += `?on_conflict=${encodeURIComponent(options.onConflict)}`;
  }

  return _supabaseFetch_(
    path,
    'post',
    payload,
    null,
    headers
  );
}


function supabaseRpc(fn, params) {
  return _supabaseFetch_(
    `/rest/v1/rpc/${fn}`,
    'post',
    params
  );
}

function supabaseUpdate(table, filters, data) {
  const params = {};
  Object.keys(filters).forEach(k => {
    params[k] = filters[k];
  });

  return _supabaseFetch_(
    `/rest/v1/${table}`,
    'patch',
    data,
    params
  );
}

function supabaseUpdateMinimal(table, filters, data) {
  const params = {};
  Object.keys(filters).forEach(k => {
    params[k] = filters[k];
  });

  return _supabaseFetch_(
    `/rest/v1/${table}`,
    'patch',
    data,
    params,
    { Prefer: 'return=minimal' }
  );
}

function supabaseDelete(table, filters) {
  const params = {};
  Object.keys(filters).forEach(k => {
    params[k] = filters[k];
  });

  return _supabaseFetch_(
    `/rest/v1/${table}`,
    'delete',
    null,
    params
  );
}

function supabaseDeleteMinimal(table, filters) {
  const params = {};
  Object.keys(filters).forEach(k => {
    params[k] = filters[k];
  });

  return _supabaseFetch_(
    `/rest/v1/${table}`,
    'delete',
    null,
    params,
    { Prefer: 'return=minimal' }
  );
}

function supabaseBulkInsertMinimal(table, rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  return _supabaseFetch_(
    `/rest/v1/${table}`,
    'post',
    rows,
    null,
    { 'Prefer': 'return=minimal' }
  );
}

function supabaseInsertMinimal(table, payload) {
  return _supabaseFetch_(
    `/rest/v1/${table}`,
    'post',
    payload,
    null,
    { 'Prefer': 'return=minimal' }
  );
}

function supabaseUpsertMinimal(table, payload, options) {
  let path = `/rest/v1/${table}`;
  const headers = {
    'Prefer': 'return=minimal,resolution=merge-duplicates'
  };

  if (options && options.onConflict) {
    path += `?on_conflict=${encodeURIComponent(options.onConflict)}`;
  }

  return _supabaseFetch_(
    path,
    'post',
    payload,
    null,
    headers
  );
}

function supabaseUpdateMinimal(table, filters, data) {
  const params = {};
  Object.keys(filters).forEach(k => {
    params[k] = filters[k];
  });

  return _supabaseFetch_(
    `/rest/v1/${table}`,
    'patch',
    data,
    params,
    { 'Prefer': 'return=minimal' }
  );
}

function _supabaseInFilter_(values) {
  const list = (values || [])
    .filter(v => v !== null && typeof v !== 'undefined' && String(v) !== '')
    .map(function(v) {
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      return '"' + String(v)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"') + '"';
    });
  return 'in.(' + list.join(',') + ')';
}

function _supabaseChunkValuesByFilterLength_(values, maxFilterLength, maxItemsPerChunk) {
  const list = (values || []).filter(function(v) {
    return v !== null && typeof v !== 'undefined' && String(v) !== '';
  });
  if (!list.length) return [];

  const chunks = [];
  const maxLen = Math.max(300, Number(maxFilterLength || 1200));
  const maxItems = Math.max(1, Number(maxItemsPerChunk || 40));
  let current = [];

  list.forEach(function(value) {
    const candidate = current.concat([value]);
    const candidateFilter = _supabaseInFilter_(candidate);
    if (current.length && (candidate.length > maxItems || candidateFilter.length > maxLen)) {
      chunks.push(current.slice());
      current = [value];
      return;
    }
    current = candidate;
  });

  if (current.length) chunks.push(current);
  return chunks;
}

function _supabaseSelectByKeyInBatches_(table, select, key, values, order, chunkSize) {
  const list = (values || []).filter(v => v !== null && typeof v !== 'undefined' && String(v) !== '');
  if (!list.length) return [];

  const out = [];
  const chunks = _supabaseChunkValuesByFilterLength_(list, 1200, Number(chunkSize || 40));
  chunks.forEach(function(chunk) {
    const filters = {};
    filters[key] = _supabaseInFilter_(chunk);
    const rows = _supabaseSelectAll_(table, {
      select: select || undefined,
      filters: filters,
      order: order || undefined
    }, 1000, 50000) || [];
    out.push.apply(out, rows);
  });
  return out;
}

const APP_SECRET_KEY = 'AJangra';
const SPREADSHEET_ID = '1voKg25EsXIYWquE78E3MtNSCTLiNssM6-HaWi1O_ngk';
const EXTERNAL_SO_DB_ID = '1voKg25EsXIYWquE78E3MtNSCTLiNssM6-HaWi1O_ngk';
const MASTER_DB_ID = '1kJpXEhwjhf74PutuvkoVF5WlMdl0v3P7orTbJ6SenHs';

/* Sheet name constants */
const SH = {
  DB_TEMPLATE: 'DB_SalesOrders',
  ITEMS: 'DB_Items',
  USERS: 'Users',
  MASTERS: 'Master',
  CLIENTS: 'Master_Client'
};

/* Company defaults */
const COMPANY_STATE = 'Haryana';

const M_PREFIX_TRADING_ITEMS = [
  { itemCode: 'MTR001', itemName: 'Ball Pen', category: 'Ball Pen', hsnGroup: 'BALL PEN', gstPct: 18, unit: 'Pcs' },
  { itemCode: 'MTR002', itemName: 'Banner', category: 'Banner', hsnGroup: 'BANNER', gstPct: 18, unit: 'Pcs' },
  { itemCode: 'MTR003', itemName: 'Cap', category: 'Cap', hsnGroup: 'CAP', gstPct: 18, unit: 'Pcs' },
  { itemCode: 'MTR004', itemName: 'Card Holder', category: 'Card Holder', hsnGroup: 'CARD HOLDER', gstPct: 18, unit: 'Pcs' },
  { itemCode: 'MTR005', itemName: 'Cello Tape', category: 'Cello Tape', hsnGroup: 'CELLO TAPE', gstPct: 18, unit: 'Pcs' },
  { itemCode: 'MTR006', itemName: 'Cup', category: 'Cup', hsnGroup: 'CUP', gstPct: 18, unit: 'Pcs' },
  { itemCode: 'MTR007', itemName: 'Diary', category: 'Diary', hsnGroup: 'DIARY', gstPct: 18, unit: 'Pcs' },
  { itemCode: 'MTR008', itemName: 'Flag', category: 'Flag', hsnGroup: 'FLAG', gstPct: 0, unit: 'Pcs' },
  { itemCode: 'MTR009', itemName: 'Flexo Plate', category: 'Flexo Plate', hsnGroup: 'FLEXO PLATE', gstPct: 18, unit: 'Pcs' },
  { itemCode: 'MTR010', itemName: 'Folder', category: 'Folder', hsnGroup: 'FOLDER', gstPct: 18, unit: 'Pcs' },
  { itemCode: 'MTR011', itemName: 'Garbage Bag', category: 'Garbage Bag', hsnGroup: 'GARBAGE BAG', gstPct: 18, unit: 'Pcs' },
  { itemCode: 'MTR012', itemName: 'Gift Box', category: 'Gift Box', hsnGroup: 'GIFT BOX', gstPct: 18, unit: 'Pcs' },
  { itemCode: 'MTR013', itemName: 'Key Chain', category: 'Key Chain', hsnGroup: 'KEY CHAIN', gstPct: 18, unit: 'Pcs' },
  { itemCode: 'MTR014', itemName: 'Key CutOut', category: 'Key CutOut', hsnGroup: 'KEY CUTOUT', gstPct: 18, unit: 'Pcs' },
  { itemCode: 'MTR015', itemName: 'Pen Holder', category: 'Pen Holder', hsnGroup: 'PEN HOLDER', gstPct: 18, unit: 'Pcs' },
  { itemCode: 'MTR016', itemName: 'Stamp', category: 'Stamp', hsnGroup: 'STAMP', gstPct: 18, unit: 'Pcs' },
  { itemCode: 'MTR017', itemName: 'Standy', category: 'Standy', hsnGroup: 'STANDY', gstPct: 18, unit: 'Pcs' },
  { itemCode: 'MTR018', itemName: 'T Shirt', category: 'T Shirt', hsnGroup: 'T SHIRT', gstPct: 5, unit: 'Pcs' },
  { itemCode: 'MTR019', itemName: 'Table Matt', category: 'Table Matt', hsnGroup: 'TABLE MATT', gstPct: 18, unit: 'Pcs' },
  { itemCode: 'MTR020', itemName: 'Designing Charges', category: 'Designing Charges', hsnGroup: 'DESIGNING CHARGES', gstPct: 18, unit: 'Pcs' }
];

const SL_PREFIX_COMMON_ITEMS = [
  { itemCode: 'SLC001', itemName: 'Flexo Printing Plate', category: 'Flexo Printing Plate', hsnGroup: 'FLEXO PRINTING PLATE', gstPct: 18, unit: 'Pcs' },
  { itemCode: 'SLC002', itemName: 'Offset Printing Plate', category: 'Offset Printing Plate', hsnGroup: 'OFFSET PRINTING PLATE', gstPct: 18, unit: 'Pcs' },
  { itemCode: 'SLC003', itemName: 'Die', category: 'Die', hsnGroup: 'DIE', gstPct: 18, unit: 'Pcs' }
];

function _soSpecialServiceItemKeys_() {
  const items = getSLCommonCatalog_();
  return {
    itemCodes: new Set(items.map(function(item){ return String(item.itemCode || '').trim().toUpperCase(); }).filter(Boolean)),
    categories: new Set(items.map(function(item){ return String(item.category || '').trim().toUpperCase(); }).filter(Boolean)),
    hsnGroups: new Set(items.map(function(item){ return String(item.hsnGroup || '').trim().toUpperCase(); }).filter(Boolean)),
    itemNames: new Set(items.map(function(item){ return String(item.itemName || '').trim().toUpperCase(); }).filter(Boolean))
  };
}

function _isSalesServiceOnlyItem_(row) {
  const keys = _soSpecialServiceItemKeys_();
  const itemCode = String(row?.product_code || row?.item_code || row?.itemCode || '').trim().toUpperCase();
  const category = String(row?.category || '').trim().toUpperCase();
  const hsnGroup = String(row?.hsn_group || row?.hsnGroup || '').trim().toUpperCase();
  const itemName = String(row?.product_name || row?.item_name || row?.itemName || '').trim().toUpperCase();
  return keys.itemCodes.has(itemCode) ||
    keys.categories.has(category) ||
    keys.hsnGroups.has(hsnGroup) ||
    keys.itemNames.has(itemName);
}

function _filterSalesServiceOnlyItems_(rows) {
  return (Array.isArray(rows) ? rows : []).filter(function(row) {
    return !_isSalesServiceOnlyItem_(row);
  });
}

function _isFlexoWorkOrderItem_(row) {
  const text = [
    row?.product_type,
    row?.productType,
    row?.category,
    row?.department_category
  ].join(' ').toUpperCase();
  return text.indexOf('FLEXO') !== -1;
}

function _excludeFlexoWorkOrderItems_(rows) {
  return (Array.isArray(rows) ? rows : []).filter(function(row) {
    return !_isFlexoWorkOrderItem_(row);
  });
}

function getMTradingCatalog_() {
  return M_PREFIX_TRADING_ITEMS.map(item => Object.assign({
    defaultRate: 0,
    clientCode: '',
    clientName: '',
    active: true,
    isVirtual: true
  }, item));
}

function getSLCommonCatalog_() {
  return SL_PREFIX_COMMON_ITEMS.map(item => Object.assign({
    defaultRate: 0,
    clientCode: '',
    clientName: '',
    active: true,
    isVirtual: true
  }, item));
}

function augmentSalesOrderMasters_(masters) {
  const out = masters || {};
  const tradingItems = getMTradingCatalog_();
  const slCommonItems = getSLCommonCatalog_();
  const categories = new Set(out.categories || []);
  const hsnGroups = new Set(out.hsnGroups || []);
  const units = new Set(out.units || []);
  const hsnToGst = {};

  Object.keys(out.hsnToGst || {}).forEach(function(key) {
    const normalized = String(key || '').trim();
    if (!normalized) return;
    hsnToGst[normalized] = out.hsnToGst[key];
    hsnToGst[normalized.toUpperCase()] = out.hsnToGst[key];
  });

  tradingItems.concat(slCommonItems).forEach(item => {
    const category = String(item.category || '').trim();
    const hsnGroup = String(item.hsnGroup || '').trim();
    categories.add(category);
    hsnGroups.add(hsnGroup);
    units.add(item.unit || 'Pcs');
    if (hsnGroup) {
      hsnToGst[hsnGroup] = item.gstPct;
      hsnToGst[hsnGroup.toUpperCase()] = item.gstPct;
    }
  });

  out.categories = Array.from(categories);
  out.hsnGroups = Array.from(hsnGroups);
  out.units = Array.from(units);
  out.hsnToGst = hsnToGst;
  out.mPrefixItems = tradingItems;
  out.slCommonItems = slCommonItems;

  return out;
}

/* ===== DEFAULT MASTERS & WO defaults ===== */
const DEFAULT_MASTERS = {
  orderPrefixes: ['M', 'SL'],
  salesReps: ['Manisha','Sikesh','Sarvesh','Prachi','Sneha','Manshi','Priyanka','Nikky'],
  salesTypes: [
    'Regular B2B','SEZ Supplies with Payment','SEZ Supplies without Payment','Deemed Exp',
    'Intra State Supplies attracting GST','Export Sales','B2C','Exempted From GST'
  ],
  categories: [
    'Automotive Sticker','Barcode','Book - Hardcase','Brochures','Calenders','Cards','Carry Bags','Carton',
    'Catalogues','Caution Sticker','Corrugated Box','Dangler','Envelopes','Folders','IT Sticker','Labels','Labels - Clockwise','Labels - Anti Clockwise','Labels - Sheet Form',
    'Leaflet','Letter Head','Posters','Stickers','Visiting Card','Warranty Card'
  ],
  hsnGroups: [
    'CORRUGATED BOX','LEAFLET','BOOK','T SHIRT','CAP','STICKER','WARRANTY CARD','KEY RING','ENVELOPE','LETTER HEAD',
    'NOTEPADS','FOLDER','VISITING CARD','CALENDAR','POSTER','CATALOGUE','DANGLER','PAPER BAGS','ROLL UP STANDEE'
  ],
  hsnToGst: {
    'CORRUGATED BOX': 5,'LEAFLET': 5,'BOOK': 5,'T SHIRT': 5,'CAP': 5,
    'STICKER': 18,'WARRANTY CARD': 18,'ENVELOPE': 18,'LETTER HEAD': 18,'NOTEPADS': 18,
    'FOLDER': 18,'VISITING CARD': 18,'CALENDAR': 18,'POSTER': 18,'CATALOGUE': 18,
    'DANGLER': 18,'PAPER BAGS': 18,'ROLL UP STANDEE': 18
  },
  units: ['Pcs','Kgs','Meter'],
  rateTypes: ['Unit','Per Unit','Unit Cost','1000 Unit','100 Unit','Per 1000','Per 100','TOTAL'],
  currencies: ['INR','USD'],
  jobTypes: ['New','Old','Old-Revised','Repeat','Reprint'],
  jobRefs: ['Approved Dummy','Approved Ferrow','Approved Shade Card','As per Old Sample','Customer Sample','Existing Printed Sample','Shade Card'],
  jobPrios: ['Normal','Low','Medium','High'],
  companyState: COMPANY_STATE,

  // WO masters
  paperSizes: [
    { name: '23x36 in', w:36, h:23 },
    { name: '25x36 in', w:36, h:25 },
    { name: '28x40 in', w:40, h:28 },
    { name: '20x30 in', w:30, h:20 }
  ],
  stocks: ['','Art Paper','Art Card','Maplitho','PP Synthetic Gumming Sheet','Greyback Duplex','Whiteback Duplex','FBB','SBS','Semi Kraft','Vergin Kraft','SBS','Chromozinc'],
  gsmList: [60,70,80,90,100,130,170,200,230,250,300,350,400,450],
  upsOptions: [1,2,4,6,8,9,12,16,18,24,32],
  departments: ['Printing','Lamination','Coating','Die Cutting','Rotary Cutting','Stitching','Side Pasting','Packing','QC','Embossing','Window Pasting','Corrugation Sheet Pasting','2 Ply Making','Cutting Pre','Cutting Post','Inspection/Slitting','Flexo Printing','Flexo Die Cutting Offline'],
  machines: ['Heidelberg SM74','CD102','UV 2 Color Machine','RS4 Printing','Canon Digital Printing','Lamination 01','Lamination 02','Lamination 03','Lamination 04','Die Cutting 01','Die Cutting 02','Die Cutting 03','2 Ply Making Machine','Flute Laminator','Manual Sheet Pasting','Markany Flexo E5','Rhyguan','Manual Die Cutting 04','Manual Die Cutting 05','Automatic Die Cutting','Stitching Manual 01','Stitching Manual 02','Auto Stitching','Folder Gluer','Manual Pasting','Manual Window Pasting','Auto Window Pasting','Packing Machine','Manual Packing','Manual Cutting Pre','Auto Cutting Pre','QC'],
  machinesByDept: {
    'Printing': ['','Heidelberg SM74', 'CD102', 'UV 2 Color Machine', 'RS4 Printing', 'Canon Digital Printing'],
    'Lamination': ['','Lamination 01', 'Lamination 02', 'Lamination 03', 'Lamination 04'],
    'Coating': ['','UV 2 Color Machine'],
    'Die Cutting': ['','Die Cutting 01','Die Cutting 02','Die Cutting 03','Manual Die Cutting 04','Manual Die Cutting 05','Automatic Die Cutting'],
    'Rotary Cutting': ['','Manual Rotary Cutting','Auto Rotary Cutting'],
    'Stitching': ['','Stitching Manual 01','Stitching Manual 02','Auto Stitching'],
    'Side Pasting': ['','Folder Gluer','Manual Pasting'],
    'Packing': ['','Packing Machine','Manual Packing'],
    'Embossing': ['','Die Cutting','Manual Embossing'],
    'Window Pasting':['','Manual Window Pasting','Auto Window Pasting'],
    'QC': ['','QC'],
    'Corrugation Sheet Pasting':['','Flute Laminator','Manual Sheet Pasting'],
    '2 Ply Making':['','2 Ply Making Machine'],
    'Cutting Pre': ['','Manual Cutting Pre','Auto Cutting Pre'],
    'Inspection/Slitting':['','Rhyguan'],
    'Flexo Printing':['','Markany Flexo E5'],
    'Flexo Die Cutting Offline':['','Automatic Die Cutting']
  },
  grainOptions: ['With Grain','Across Grain','NA'],
  printStyles: ['Single Side','Front-Back','Work - Turn', 'Work - Tumble','No Print'],
  coatingOptions: ['None','Aqueous','UV','Drip Off'],
  fluteOptions: ['B','E'],
  materials: ['Art Paper 130 GSM','Maplitho 70 GSM','Kraft 180 GSM','BOPP 18µ','Adhesive','Board 300 GSM','Glue'],
  flexoLabelTypes: ['Front','Back','Top','Bottom','Neck','Flat Label','Single','Set'],
  flexoWindingDirections: ['Clock Wise','Anti Clock Wise','Sheet Form'],
  flexoFinishedFormats: ['Sheet Form','Roll Form','Fan Fold','Cut Label','Pcs','Unit'],
  flexoDieTypes: ['Rotary Die','Flatbed Die','None'],
  flexoRoutingOptions: ['Flexo Printing','Flexo Printing+Lamination','Flexo Printing+Die Cutting','Flexo Printing+Lamination+Die Cutting','Flexo Die Cutting Offline','Inspection/Slitting','Flexo Die Sheeting','Packing','Online Gold Foil','Online Silver Foil'],
  flexoCylinderMaster: [
    { teeth:64, teethInch:8, teethMm:203.2, noOfCylinder:8 },
    { teeth:69, teethInch:8.625, teethMm:219.075, noOfCylinder:8 },
    { teeth:74, teethInch:9.25, teethMm:234.95, noOfCylinder:8 },
    { teeth:80, teethInch:10, teethMm:254, noOfCylinder:8 },
    { teeth:85, teethInch:10.625, teethMm:269.875, noOfCylinder:8 },
    { teeth:89, teethInch:11.125, teethMm:282.575, noOfCylinder:8 },
    { teeth:96, teethInch:12, teethMm:304.8, noOfCylinder:8 },
    { teeth:102, teethInch:12.75, teethMm:323.85, noOfCylinder:8 },
    { teeth:109, teethInch:13.625, teethMm:346.075, noOfCylinder:8 },
    { teeth:114, teethInch:14.25, teethMm:361.95, noOfCylinder:8 },
    { teeth:118, teethInch:14.75, teethMm:374.65, noOfCylinder:6 },
    { teeth:131, teethInch:16.375, teethMm:415.925, noOfCylinder:6 },
    { teeth:146, teethInch:18.25, teethMm:463.55, noOfCylinder:8 },
    { teeth:170, teethInch:21.25, teethMm:539.75, noOfCylinder:8 }
  ]
};

const PAGE_MODULE_MAP = {
  'order':'SALES_ORDER_ENTRY',
  'salesorderapproval':'SALES_ORDER_APPROVAL',
  'artwork':'ARTWORK',
  'masters':'MASTERS',
  'plates':'PURCHASE',
  'purchase':'PURCHASE',
  'itemmaster':'ITEMMASTER',
  'wow':'WOW',
  'flexowo':'WOW',
  'inventory':'INVENTORY',
  'packing':'PACKING',
  'dispatch':'DISPATCH',
  'production':'PRODUCTION',
  'billing':'BILLING',
  'printinvoice':'BILLING',
  'printchallan':'BILLING',
  'planning':'REPORTS',
  'reports':'REPORTS',
  'costing':'COSTING',
  'menu': 'MENU',
  'masteradmin':'MASTERADMIN'
};

/* Master overrides key */
const MASTER_OVERRIDES_KEY = 'MASTER_OVERRIDES_JSON';

// Extra logical sheet name for costing requests
const COSTING_REQ_SHEET = 'CostingRequests';


/* =========================
   Utilities: Properties / Cache / Merge masters
   ========================= */
function _readMasterOverrides_() {
  const raw = PropertiesService.getScriptProperties().getProperty(MASTER_OVERRIDES_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch(e) { return {}; }
}
function _mergeMasters_(defaults, overrides) {
  const out = JSON.parse(JSON.stringify(defaults || {}));
  Object.keys(overrides || {}).forEach(k => {
    const o = overrides[k];
    if (Array.isArray(o)) out[k] = o.slice();
    else if (o && typeof o === 'object') out[k] = Object.assign({}, out[k] || {}, o);
    else out[k] = o;
  });
  return out;
}
function getUnifiedMasters() {
  const overrides = _readMasterOverrides_();
  const merged = augmentSalesOrderMasters_(_mergeMasters_(DEFAULT_MASTERS, overrides));

  // 🔹 SAFE dynamic clients injection
  try {
    merged.clients = getClients(); // ✅ FIXED
  } catch (e) {
    Logger.log('Client master load failed: ' + e.message);
    merged.clients = [];
  }

  return merged;
}

function getMastersSecure(token) {
  const user = getSessionUser(token);
  if (!user) {
    throw new Error('Unauthorized');
  }
  return getMasters();
}

function getMasters() {
  const masters = getUnifiedMasters();

  try {
    const clients = supabaseSelect('clients', {
      filters: { active: 'eq.true' },
      order: 'client_name.asc'
    }) || [];

    masters.clients = clients.map(c => ({
      code: c.client_code,
      name: c.client_name,
      state: c.state || '',
      gstin: c.gstin || '',
      creditDays: c.credit_days || 0,
      category: c.category || '',
      panNo: c.pan_no || '',
      paymentTerms: c.payment_terms || '',
      billToAddress: _clientComposeAddress_(c.bill_to_address, c.bill_to_city, c.bill_to_state, c.bill_to_pincode),
      shipToAddress: _clientComposeAddress_(c.ship_to_address, c.ship_to_city, c.ship_to_state, c.ship_to_pincode)
    }));
  } catch(e){
    Logger.log('Clients load failed: ' + e.message);
    masters.clients = [];
  }

  try {
    const items = supabaseSelect('items', {
      filters: { active: 'eq.true' },
      order: 'item_name.asc'
    }) || [];

    masters.items = items.map(i => ({
      code: i.item_code,
      name: i.item_name,
      category: i.category || '',
      hsnGroup: i.hsn_group || '',
      unit: i.unit || '',
      rate: i.default_rate || 0,
      gstPct: i.gst_pct || 0,
      description: i.description || ''
    }));
    masters.hsnToGst = Object.assign({}, masters.hsnToGst || {});
    items.forEach(function(i) {
      const hsn = String(i.hsn_group || '').trim();
      const gst = Number(i.gst_pct || 0);
      if (!hsn) return;
      masters.hsnToGst[hsn] = gst;
      masters.hsnToGst[hsn.toUpperCase()] = gst;
    });
  } catch(e){
    Logger.log('Items load failed: ' + e.message);
    masters.items = [];
  }

  return masters;
}

function getWOMasters() {
  try {
    const cache = CacheService.getScriptCache();
    const cacheKey = 'WO_MASTERS_v7';
    const cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const masters = getUnifiedMasters();
    const payload = JSON.parse(JSON.stringify(masters));

    payload.departments = (payload.departments || []).filter(function(dept) {
      return String(dept || '').trim().toUpperCase() !== 'DIGITAL';
    });
    payload.machines = Array.from(new Set([].concat(payload.machines || [], ['Canon Digital Printing'])));
    payload.machinesByDept = Object.assign({}, payload.machinesByDept || {});
    delete payload.machinesByDept.Digital;
    payload.machinesByDept.Printing = Array.from(new Set([].concat(
      payload.machinesByDept.Printing || [''],
      ['Canon Digital Printing']
    )));

    try {
      const invRows = (supabaseSelect('inv_items', {
        select: 'item_code,item_name,category,department,active',
        filters: { active: 'eq.true' },
        order: 'item_name.asc',
        limit: 2000
      }) || []);

      const offsetDigitalItems = [];
      const corrugationItems = [];
      const seenOffsetDigital = {};
      const seenCorrugation = {};

      invRows.forEach(function(row) {
        const itemName = String(row.item_name || '').trim();
        const itemCode = String(row.item_code || '').trim();
        const category = String(row.category || '').trim();
        const department = String(row.department || '').trim();
        if (!itemName) return;

        const item = { itemCode: itemCode, itemName: itemName, category: category, department: department };
        const deptUpper = department.toUpperCase();

        if (deptUpper === 'OFFSET' || deptUpper === 'DIGITAL') {
          if (!seenOffsetDigital[itemName]) {
            seenOffsetDigital[itemName] = true;
            offsetDigitalItems.push(item);
          }
        }

        if (deptUpper.indexOf('CORRUGATION') !== -1) {
          if (!seenCorrugation[itemName]) {
            seenCorrugation[itemName] = true;
            corrugationItems.push(item);
          }
        }
      });

      payload.offsetDigitalItems = offsetDigitalItems;
      payload.corrugationItems = corrugationItems;
    } catch (e) {
      Logger.log('WO inv_items load failed: ' + e.message);
      payload.offsetDigitalItems = [];
      payload.corrugationItems = [];
    }

    try { cache.put(cacheKey, JSON.stringify(payload), 600); } catch (e) {}

    // 🔒 HARD GUARANTEE — never return null
    return payload;
  } catch (e) {
    console.error('getWOMasters failed', e);

    // 🔥 CRITICAL: return EMPTY STRUCTURE, not null
    return {
      orderPrefixes: [],
      salesReps: [],
      salesTypes: [],
      categories: [],
      hsnGroups: [],
      hsnToGst: {},
      units: [],
      rateTypes: [],
      currencies: [],
      jobTypes: [],
      jobRefs: [],
      jobPrios: [],
      clients: [],
      companyState: COMPANY_STATE,

      paperSizes: [],
      stocks: [],
      gsmList: [],
      upsOptions: [],
      departments: [],
      machines: [],
      machinesByDept: {},
      grainOptions: [],
      printStyles: [],
      coatingOptions: [],
      fluteOptions: [],
      materials: []
    };
  }
}

function getFlexoWOMasters() {
  const masters = getWOMasters();
  return {
    salesReps: masters.salesReps || [],
    stocks: masters.stocks || [],
    flexoFilmItems: getFlexoFilmRollItems_(),
    gsmList: masters.gsmList || [],
    jobTypes: masters.jobTypes || [],
    jobPrios: masters.jobPrios || [],
    grainOptions: ['With Grain', 'Across Grain'],
    flexoLabelTypes: masters.flexoLabelTypes || [],
    flexoWindingDirections: masters.flexoWindingDirections || [],
    flexoFinishedFormats: masters.flexoFinishedFormats || [],
    flexoDieTypes: masters.flexoDieTypes || [],
    flexoRoutingOptions: masters.flexoRoutingOptions || [],
    flexoCylinderMaster: masters.flexoCylinderMaster || []
  };
}

function getFlexoFilmRollItems_() {
  const target = 'FLEXO L.S. FILM (ROLL)';
  const itemsByName = {};

  (supabaseSelect('inv_items', {
    select: 'item_code,item_name,category,active',
    filters: { active: 'eq.true' },
    order: 'item_name.asc',
    limit: 1000
  }) || []).forEach(function(row) {
    const category = String(row.category || '').trim().toUpperCase();
    if (category !== target && category.indexOf('FLEXO L.S. FILM') === -1) return;
    const name = String(row.item_name || '').trim();
    if (name && !itemsByName[name]) {
      itemsByName[name] = {
        itemCode: String(row.item_code || '').trim(),
        itemName: name
      };
    }
  });

  (supabaseSelect('items', {
    select: 'item_code,item_name,category,active',
    filters: { active: 'eq.true' },
    order: 'item_name.asc',
    limit: 1000
  }) || []).forEach(function(row) {
    const category = String(row.category || '').trim().toUpperCase();
    if (category !== target && category.indexOf('FLEXO L.S. FILM') === -1) return;
    const name = String(row.item_name || '').trim();
    if (name && !itemsByName[name]) {
      itemsByName[name] = {
        itemCode: String(row.item_code || '').trim(),
        itemName: name
      };
    }
  });

  return Object.keys(itemsByName).sort().map(function(name) {
    return itemsByName[name];
  });
}

function _woCategoryMatchesAny_(value, targets) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return false;
  return (targets || []).some(function(target) {
    const token = String(target || '').trim().toUpperCase();
    return token && (raw === token || raw.indexOf(token) !== -1);
  });
}

function getFlexoArtworkApprovalData(soNo, lineNo, artworkNo) {
  const artNo = String(artworkNo || '').trim();
  const soNumber = String(soNo || '').trim();
  const soLine = String(lineNo || '').trim();

  if (!artNo && !(soNumber && soLine)) {
    throw new Error('Artwork lookup requires artwork number or SO + line number.');
  }

  const filters = artNo
    ? { artwork_no: 'eq.' + artNo }
    : { so_number: 'eq.' + soNumber, line_no: 'eq.' + soLine };

  const row = (selectArtworkJobsView_({
    select: 'so_number,line_no,artwork_no,product_type,sheet_length,sheet_width,sheet_ups,printing_colors,across_ups,along_ups,total_ups,across_width,teeth,across_gap_mm,along_gap_mm,status,approved_at',
    filters: filters,
    order: 'approved_at.desc',
    limit: 1
  }) || [])[0];

  if (!row) {
    return {
      found: false,
      warning: 'Artwork Approval data not found for the selected flexo job.'
    };
  }

  const warnings = [];
  if (String(row.product_type || '').trim().toUpperCase() !== 'FLEXO') {
    warnings.push('Selected artwork is not marked as Flexo in Artwork Approval.');
  }
  if (String(row.status || '').trim().toUpperCase() !== 'APPROVED') {
    warnings.push('Artwork is not approved yet. Approved flexo data may be incomplete.');
  }
  [
    ['Across Width', row.across_width],
    ['Teeth', row.teeth],
    ['Across Gap', row.across_gap_mm],
    ['Along Gap', row.along_gap_mm],
    ['Across UPS', row.across_ups],
    ['Along UPS', row.along_ups],
    ['Total UPS', row.total_ups]
  ].forEach(function(entry) {
    if (entry[1] === '' || entry[1] === null || typeof entry[1] === 'undefined') {
      warnings.push(entry[0] + ' is blank in Artwork Approval.');
    }
  });

  return {
    found: true,
    so: row.so_number || '',
    lineNo: row.line_no || '',
    artworkNo: row.artwork_no || '',
    productType: row.product_type || '',
    status: row.status || '',
    approvedAt: row.approved_at || null,
    printingColors: row.printing_colors || '',
    sheetUps: row.sheet_ups === null || typeof row.sheet_ups === 'undefined' ? '' : Number(row.sheet_ups),
    acrossWidth: row.across_width === null || typeof row.across_width === 'undefined' ? '' : Number(row.across_width),
    teeth: row.teeth === null || typeof row.teeth === 'undefined' ? '' : Number(row.teeth),
    acrossGapMm: row.across_gap_mm === null || typeof row.across_gap_mm === 'undefined' ? '' : Number(row.across_gap_mm),
    alongGapMm: row.along_gap_mm === null || typeof row.along_gap_mm === 'undefined' ? '' : Number(row.along_gap_mm),
    acrossUps: row.across_ups === null || typeof row.across_ups === 'undefined' ? '' : Number(row.across_ups),
    alongUps: row.along_ups === null || typeof row.along_ups === 'undefined' ? '' : Number(row.along_ups),
    totalUps: row.total_ups === null || typeof row.total_ups === 'undefined' ? '' : Number(row.total_ups),
    alongWidth: row.sheet_length === null || typeof row.sheet_length === 'undefined' ? '' : Number(row.sheet_length),
    warning: warnings.join(' ')
  };
}

function getClients() {
  try {
    const rows = _clientSelectRows_({
      filters: { active: 'eq.true' }, // ✅ FIX
      order: 'client_name.asc',
      limit: 1000
    });

    if (!rows || !rows.length) return [];

    return rows.map(c => ({
      // REQUIRED by OrderForm
      code: c.client_code,
      name: c.client_name,
      state: c.state || '',

      // OPTIONAL (safe extensions)
      gstin: c.gstin || '',
      creditDays: Number(c.credit_days || 0),
      category: c.category || '',
      panNo: c.pan_no || '',
      paymentTerms: c.payment_terms || '',
      billToAddress: _clientComposeAddress_(c.bill_to_address, c.bill_to_city, c.bill_to_state, c.bill_to_pincode),
      shipToAddress: _clientComposeAddress_(c.ship_to_address, c.ship_to_city, c.ship_to_state, c.ship_to_pincode)
    }));

  } catch (e) {
    Logger.log('[getClients] Supabase load failed: ' + e.message);
    return [];
  }
}

function _clientComposeAddress_(address, city, state, pincode) {
  return [address || '', city || '', state || '', pincode || ''].filter(Boolean).join(', ');
}

function _clientColumnMissing_(msg, columnName) {
  const text = String(msg || '').toLowerCase();
  const pattern = 'clients.' + String(columnName || '').toLowerCase();
  return text.indexOf(pattern) !== -1 && text.indexOf('does not exist') !== -1;
}

function _clientNormalizeRow_(row) {
  const billToAddress = String(row.bill_to_address || row.address || '').trim();
  const billToCity = String(row.bill_to_city || row.city || '').trim();
  const billToState = String(row.bill_to_state || row.state || '').trim();
  const billToPincode = String(row.bill_to_pincode || row.pincode || '').trim();
  const shipToAddress = String(row.ship_to_address || billToAddress).trim();
  const shipToCity = String(row.ship_to_city || billToCity).trim();
  const shipToState = String(row.ship_to_state || billToState).trim();
  const shipToPincode = String(row.ship_to_pincode || billToPincode).trim();

  return {
    id: row.id,
    client_code: row.client_code || '',
    client_name: row.client_name || '',
    state: row.state || billToState || shipToState || '',
    gstin: row.gstin || '',
    credit_days: Number(row.credit_days || 0),
    category: row.category || '',
    active: row.active !== false,
    pan_no: row.pan_no || '',
    payment_terms: row.payment_terms || '',
    bill_to_address: billToAddress,
    bill_to_city: billToCity,
    bill_to_state: billToState,
    bill_to_pincode: billToPincode,
    ship_to_address: shipToAddress,
    ship_to_city: shipToCity,
    ship_to_state: shipToState,
    ship_to_pincode: shipToPincode,
    address: billToAddress,
    city: billToCity,
    pincode: billToPincode
  };
}

function _clientSelectRows_(opts) {
  const query = opts || {};
  try {
    return (supabaseSelect('clients', Object.assign({}, query, {
      select: 'id,client_code,client_name,state,gstin,credit_days,category,active,pan_no,payment_terms,bill_to_address,bill_to_city,bill_to_state,bill_to_pincode,ship_to_address,ship_to_city,ship_to_state,ship_to_pincode'
    })) || []).map(_clientNormalizeRow_);
  } catch (err) {
    const msg = String((err && err.message) || '');
    const missingNewColumns =
      _clientColumnMissing_(msg, 'pan_no') ||
      _clientColumnMissing_(msg, 'payment_terms') ||
      _clientColumnMissing_(msg, 'bill_to_address') ||
      _clientColumnMissing_(msg, 'bill_to_city') ||
      _clientColumnMissing_(msg, 'bill_to_state') ||
      _clientColumnMissing_(msg, 'bill_to_pincode') ||
      _clientColumnMissing_(msg, 'ship_to_address') ||
      _clientColumnMissing_(msg, 'ship_to_city') ||
      _clientColumnMissing_(msg, 'ship_to_state') ||
      _clientColumnMissing_(msg, 'ship_to_pincode');
    if (!missingNewColumns) throw err;

    try {
      return (supabaseSelect('clients', Object.assign({}, query, {
        select: 'id,client_code,client_name,state,gstin,credit_days,category,active,address,city,pincode'
      })) || []).map(_clientNormalizeRow_);
    } catch (legacyErr) {
      const legacyMsg = String((legacyErr && legacyErr.message) || '');
      const missingLegacyAddress =
        _clientColumnMissing_(legacyMsg, 'address') ||
        _clientColumnMissing_(legacyMsg, 'city') ||
        _clientColumnMissing_(legacyMsg, 'pincode');
      if (!missingLegacyAddress) throw legacyErr;
      return (supabaseSelect('clients', Object.assign({}, query, {
        select: 'id,client_code,client_name,state,gstin,credit_days,category,active'
      })) || []).map(_clientNormalizeRow_);
    }
  }
}

function _clientNextCode_() {
  const rows = _clientSelectRows_({
    order: 'client_code.asc',
    limit: 2000
  }) || [];
  const max = rows.reduce(function(acc, row) {
    const num = Number(String(row.client_code || '').replace(/[^0-9]/g, ''));
    return Math.max(acc, num || 0);
  }, 0);
  return 'C' + String(max + 1).padStart(5, '0');
}

function _clientNormalizePayload_(payload, existing) {
  const src = payload || {};
  const gstin = String(src.gstin || '').trim().toUpperCase();
  const derivedPan = gstin.length >= 12 ? gstin.slice(2, 12) : '';
  const panNo = String(src.panNo || derivedPan || '').trim().toUpperCase();
  const clientCode = String(existing?.client_code || src.clientCode || '').trim().toUpperCase();

  return {
    id: String(existing?.id || src.id || Utilities.getUuid()).trim(),
    clientCode: clientCode,
    clientName: String(src.clientName || '').trim(),
    state: String(src.state || '').trim(),
    gstin: gstin,
    panNo: panNo,
    creditDays: Math.max(0, Number(src.creditDays || 0) || 0),
    category: String(src.category || '').trim(),
    paymentTerms: String(src.paymentTerms || '').trim(),
    active: src.active === false ? false : true
  };
}

function _clientPartyNormalizeRow_(row) {
  return {
    id: row.id,
    client_id: row.client_id,
    client_code: row.client_code || '',
    party_name: row.party_name || '',
    address_type: row.address_type || '',
    label: row.label || '',
    address_line1: row.address_line1 || '',
    address_line2: row.address_line2 || '',
    city: row.city || '',
    state: row.state || '',
    pincode: row.pincode || '',
    gstin: row.gstin || '',
    pan_no: row.pan_no || '',
    payment_terms: row.payment_terms || '',
    contact_person: row.contact_person || '',
    contact_phone: row.contact_phone || '',
    is_default: row.is_default === true,
    active: row.active !== false
  };
}

function _clientPartySelectRows_(opts) {
  return (supabaseSelect('client_parties', Object.assign({
    select: 'id,client_id,client_code,party_name,address_type,label,address_line1,address_line2,city,state,pincode,gstin,pan_no,payment_terms,contact_person,contact_phone,is_default,active',
    order: 'client_code.asc,address_type.asc,label.asc,party_name.asc',
    limit: 5000
  }, opts || {})) || []).map(_clientPartyNormalizeRow_);
}

function _clientPartySelectRowsByClientIds_(clientIds, order) {
  const ids = [...new Set((clientIds || []).map(function(id){ return String(id || '').trim(); }).filter(Boolean))];
  if (!ids.length) return [];
  return (_supabaseSelectByKeyInBatches_(
    'client_parties',
    'id,client_id,client_code,party_name,address_type,label,address_line1,address_line2,city,state,pincode,gstin,pan_no,payment_terms,contact_person,contact_phone,is_default,active',
    'client_id',
    ids,
    order || 'client_id.asc,address_type.asc,is_default.desc,label.asc,party_name.asc',
    25
  ) || []).map(_clientPartyNormalizeRow_);
}

function _mastersParsePartyJson_(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  return [];
}

function _mastersPartyPayloadFromView_(party) {
  const row = party || {};
  return {
    id: row.id || '',
    partyName: row.party_name || row.partyName || '',
    addressType: row.address_type || row.addressType || '',
    label: row.label || '',
    addressLine1: row.address_line1 || row.addressLine1 || '',
    addressLine2: row.address_line2 || row.addressLine2 || '',
    city: row.city || '',
    state: row.state || '',
    pincode: row.pincode || '',
    gstin: row.gstin || '',
    panNo: row.pan_no || row.panNo || '',
    paymentTerms: row.payment_terms || row.paymentTerms || '',
    contactPerson: row.contact_person || row.contactPerson || '',
    contactPhone: row.contact_phone || row.contactPhone || '',
    isDefault: row.is_default === true || row.isDefault === true,
    active: row.active !== false
  };
}

function _mastersClientPayloadFromView_(row) {
  const src = row || {};
  return {
    id: src.id,
    clientCode: src.client_code || '',
    clientName: src.client_name || '',
    state: src.state || '',
    gstin: src.gstin || '',
    panNo: src.pan_no || '',
    creditDays: Number(src.credit_days || 0),
    category: src.category || '',
    paymentTerms: src.payment_terms || '',
    active: src.active !== false,
    billToCount: Number(src.bill_to_count || 0),
    shipToCount: Number(src.ship_to_count || 0),
    parties: _mastersParsePartyJson_(src.parties).map(_mastersPartyPayloadFromView_)
  };
}

function _mastersGetBootstrapFromView_() {
  const rows = supabaseSelect('v_client_master_register', {
    order: 'client_name.asc',
    limit: 3000
  }) || [];
  return rows.map(_mastersClientPayloadFromView_);
}

function _requireMastersWriteAccess_(token, preferredAction) {
  const user = getSessionUser(token);
  if (!user) throw new Error('Unauthorized');
  if (String(user.role || '').toUpperCase() === 'ADMIN') return user;
  if (_userHasPermission_(user, 'MASTERS', preferredAction || 'can_edit')) return user;
  if (_userHasPermission_(user, 'MASTERS', 'can_edit')) return user;
  if (_userHasPermission_(user, 'MASTERS', 'can_create')) return user;
  // Compatibility for roles created before Masters write flags were assigned.
  if (_userHasPermission_(user, 'MASTERS', 'can_view')) return user;
  throw new Error('Unauthorized');
}

function _clientNormalizePartyPayloadRows_(clientRecord, payload) {
  const rows = Array.isArray(payload && payload.parties) ? payload.parties : [];
  const normalized = rows.map(function(row) {
    const src = row || {};
    const gstin = String(src.gstin || '').trim().toUpperCase();
    const derivedPan = gstin.length >= 12 ? gstin.slice(2, 12) : '';
    const panNo = String(src.panNo || derivedPan || '').trim().toUpperCase();
    return {
      id: String(src.id || Utilities.getUuid()).trim(),
      client_id: clientRecord.id,
      client_code: clientRecord.clientCode,
      party_name: String(src.partyName || '').trim(),
      address_type: String(src.addressType || '').trim().toUpperCase(),
      label: String(src.label || '').trim(),
      address_line1: String(src.addressLine1 || '').trim(),
      address_line2: String(src.addressLine2 || '').trim(),
      city: String(src.city || '').trim(),
      state: String(src.state || '').trim(),
      pincode: String(src.pincode || '').trim(),
      gstin: gstin,
      pan_no: panNo,
      payment_terms: String(src.paymentTerms || '').trim(),
      contact_person: String(src.contactPerson || '').trim(),
      contact_phone: String(src.contactPhone || '').trim(),
      is_default: src.isDefault === true,
      active: src.active === false ? false : true
    };
  }).filter(function(row) {
    return row.party_name || row.address_line1 || row.city || row.state || row.pincode || row.gstin || row.label;
  });

  if (!normalized.length) {
    throw new Error('At least one Bill To or Ship To row is required.');
  }

  normalized.forEach(function(row, idx) {
    if (!row.party_name) throw new Error('Party name is required in address row ' + (idx + 1) + '.');
    if (!['BILL_TO', 'SHIP_TO'].includes(row.address_type)) {
      throw new Error('Address type must be BILL_TO or SHIP_TO in row ' + (idx + 1) + '.');
    }
    if (!row.address_line1) throw new Error('Address line 1 is required in row ' + (idx + 1) + '.');
    if (!row.state) throw new Error('State is required in row ' + (idx + 1) + '.');
  });

  const billDefaults = normalized.filter(function(row){ return row.address_type === 'BILL_TO' && row.is_default; }).length;
  const shipDefaults = normalized.filter(function(row){ return row.address_type === 'SHIP_TO' && row.is_default; }).length;
  if (!normalized.some(function(row){ return row.address_type === 'BILL_TO'; })) throw new Error('At least one BILL_TO row is required.');
  if (!normalized.some(function(row){ return row.address_type === 'SHIP_TO'; })) throw new Error('At least one SHIP_TO row is required.');
  if (billDefaults > 1) throw new Error('Only one default BILL_TO row is allowed.');
  if (shipDefaults > 1) throw new Error('Only one default SHIP_TO row is allowed.');

  if (billDefaults === 0) {
    const firstBill = normalized.find(function(row){ return row.address_type === 'BILL_TO'; });
    if (firstBill) firstBill.is_default = true;
  }
  if (shipDefaults === 0) {
    const firstShip = normalized.find(function(row){ return row.address_type === 'SHIP_TO'; });
    if (firstShip) firstShip.is_default = true;
  }

  return normalized;
}

function mastersGetBootstrap(token) {
  _requireModuleAccess_(token, 'MASTERS', 'can_view');
  try {
    return {
      ok: true,
      source: 'view',
      clients: _mastersGetBootstrapFromView_()
    };
  } catch (viewErr) {
    Logger.log('mastersGetBootstrap view fallback: ' + ((viewErr && viewErr.message) || viewErr));
  }

  const clients = _clientSelectRows_({
    order: 'client_name.asc',
    limit: 2000
  }) || [];
  const clientIds = clients.map(function(row){ return row.id; }).filter(Boolean);
  const partyMap = {};
  if (clientIds.length) {
    try {
      (_clientPartySelectRowsByClientIds_(clientIds, 'client_id.asc,address_type.asc,is_default.desc,label.asc,party_name.asc') || []).forEach(function(row) {
        const key = String(row.client_id || '');
        if (!partyMap[key]) partyMap[key] = [];
        partyMap[key].push(row);
      });
    } catch (err) {
      Logger.log('mastersGetBootstrap client_parties load failed: ' + ((err && err.message) || err));
    }
  }
  return {
    ok: true,
    source: 'fallback',
    clients: clients.map(function(row) {
      const parties = partyMap[String(row.id || '')] || [];
      return {
        id: row.id,
        clientCode: row.client_code || '',
        clientName: row.client_name || '',
        state: row.state || '',
        gstin: row.gstin || '',
        panNo: row.pan_no || '',
        creditDays: Number(row.credit_days || 0),
        category: row.category || '',
        paymentTerms: row.payment_terms || '',
        active: row.active !== false,
        parties: parties.map(function(party) {
          return {
            id: party.id,
            partyName: party.party_name || '',
            addressType: party.address_type || '',
            label: party.label || '',
            addressLine1: party.address_line1 || '',
            addressLine2: party.address_line2 || '',
            city: party.city || '',
            state: party.state || '',
            pincode: party.pincode || '',
            gstin: party.gstin || '',
            panNo: party.pan_no || '',
            paymentTerms: party.payment_terms || '',
            contactPerson: party.contact_person || '',
            contactPhone: party.contact_phone || '',
            isDefault: party.is_default === true,
            active: party.active !== false
          };
        })
      };
    })
  };
}

function mastersSaveClient(payload, token) {
  if (!payload) throw new Error('Client payload is required.');

  const existing = String(payload.id || '').trim()
    ? (_clientSelectRows_({
        filters: { id: 'eq.' + String(payload.id).trim() },
        limit: 1
      }) || [])[0]
    : null;
  _requireMastersWriteAccess_(token, existing ? 'can_edit' : 'can_create');
  const record = _clientNormalizePayload_(payload, existing);

  if (!record.clientCode) throw new Error('Client code is required.');
  if (!record.clientName) throw new Error('Client name is required.');
  if (!existing) {
    const duplicate = (_clientSelectRows_({
      filters: { client_code: 'eq.' + record.clientCode },
      limit: 1
    }) || [])[0];
    if (duplicate) throw new Error('Client code already exists: ' + record.clientCode);
  }
  const partyRows = _clientNormalizePartyPayloadRows_(record, payload);

  const dbRow = {
    id: record.id,
    client_code: record.clientCode,
    client_name: record.clientName,
    state: record.state || null,
    gstin: record.gstin || null,
    credit_days: record.creditDays,
    category: record.category || null,
    active: record.active,
    pan_no: record.panNo || null,
    payment_terms: record.paymentTerms || null
  };

  if (existing && existing.id) {
    supabaseUpdate('clients', { id: 'eq.' + existing.id }, dbRow);
    supabaseDelete('client_parties', { client_id: 'eq.' + existing.id });
  } else {
    supabaseInsert('clients', dbRow);
  }

  supabaseBulkInsert('client_parties', partyRows.map(function(row) {
    return {
      id: row.id,
      client_id: row.client_id,
      client_code: row.client_code,
      party_name: row.party_name,
      address_type: row.address_type,
      label: row.label || null,
      address_line1: row.address_line1,
      address_line2: row.address_line2 || null,
      city: row.city || null,
      state: row.state,
      pincode: row.pincode || null,
      gstin: row.gstin || null,
      pan_no: row.pan_no || null,
      payment_terms: row.payment_terms || null,
      contact_person: row.contact_person || null,
      contact_phone: row.contact_phone || null,
      is_default: row.is_default === true,
      active: row.active !== false
    };
  }));

  return { ok: true };
}

function mastersToggleClientStatus(clientId, active, token) {
  _requireMastersWriteAccess_(token, 'can_edit');
  const id = String(clientId || '').trim();
  if (!id) throw new Error('Client id is required.');
  supabaseUpdate('clients', { id: 'eq.' + id }, { active: active === true });
  return { ok: true };
}

/******************************************************
 * PLATES & DIES — BACKEND (SINGLE DB: DB_SalesOrders)
 * PowerForge ERP
 ******************************************************/

/**
 * Helper: derive procurement status
 */
/**
 * READ — Plates & Dies jobs
 * Only SO lines where Plate OR Die = NEW
 */
function _purchaseIsArtworkToolingNew_(value) {
  const status = String(value || '').trim().toUpperCase();
  if (!status) return false;
  return status === 'NEW' ||
    status === 'YES' ||
    status === 'REQUIRED' ||
    status === 'SELECTED' ||
    /\bNEW\b/.test(status);
}

function getPlateDieJobs(opts = {}) {

  const arts = _supabaseSelectAll_('artworks', {
    select: `
      id,
      so_id,
      line_no,
      artwork_no,
      sheet_ups,
      plate_status,
      die_status,
      plate_size,
      plate_count,
      has_hybrid_plate,
      hybrid_plate_size,
      hybrid_plate_count,
      die_count
    `,
    order: 'id.asc'
  }, 1000, 50000);

  if (!arts || !arts.length) return [];

  const filtered = arts.filter(a => {
    return _purchaseIsArtworkToolingNew_(a.plate_status) || _purchaseIsArtworkToolingNew_(a.die_status);
  });

  if (!filtered.length) return [];

  const soIds = [...new Set(filtered.map(a => a.so_id))];

// 2️⃣ Fetch sales orders
const soMap = {};
const clientCodes = new Set();

_supabaseSelectByKeyInBatches_('sales_orders', 'id,so_number,client_code,so_date', 'id', soIds, null, 40).forEach(so => {
  soMap[so.id] = so;
  if (so.client_code) clientCodes.add(so.client_code);
});

// 3️⃣ Fetch client names
const clientMap = {};

if (clientCodes.size) {
  _supabaseSelectByKeyInBatches_('clients', 'client_code,client_name', 'client_code', [...clientCodes], null, 40).forEach(c => {
    clientMap[c.client_code] = c.client_name;
  });
}
  const lineMap = {};
  _supabaseSelectByKeyInBatches_('sales_order_lines', 'so_id,line_no,product_name,qty,unit', 'so_id', soIds, null, 40).forEach(l => {
    lineMap[l.so_id + '||' + l.line_no] = l;
  });

  const woMap = {};
  const soNumbers = Object.keys(soMap)
    .map(id => soMap[id]?.so_number)
    .filter(Boolean);

  if (soNumbers.length) {
    _supabaseSelectByKeyInBatches_('work_order_jobs', 'wo_id,so_number,line_no', 'so_number', soNumbers, null, 40).forEach(wj => {
      const key = String(wj.so_number || '') + '||' + String(wj.line_no || '');
      if (!woMap[key]) woMap[key] = [];
      if (wj.wo_id) woMap[key].push(wj.wo_id);
    });

    const woIds = [...new Set(Object.values(woMap).flat().filter(Boolean))];
    const woNoById = {};

    if (woIds.length) {
      _supabaseSelectByKeyInBatches_('work_orders', 'id,wo_number', 'id', woIds, null, 40).forEach(wo => {
        woNoById[wo.id] = wo.wo_number;
      });
    }

    Object.keys(woMap).forEach(key => {
      woMap[key] = [...new Set((woMap[key] || []).map(id => woNoById[id]).filter(Boolean))];
    });
  }

  const artworkKeys = {};
  filtered.forEach(a => {
    const fallbackKey = String(a.so_id || '') + '||' + String(a.line_no || '');
    artworkKeys[fallbackKey] = String(a.artwork_no || '').trim() || fallbackKey;
  });

  const procMap = {};
  const artworkKeyValues = [...new Set(Object.values(artworkKeys).filter(Boolean))];
  if (artworkKeyValues.length) {
    try {
      _supabaseSelectByKeyInBatches_('purchase_artwork_procurement', '*', 'artwork_key', artworkKeyValues, null, 40).forEach(p => {
        procMap[p.artwork_key + '||' + p.type] = p;
      });
    } catch (e) {
      Logger.log('purchase_artwork_procurement lookup failed: ' + e.message);
    }
  }

  const poHeaderMap = {};
  _purchaseListPOHeaders_().forEach(h => {
    if (h.poNo) poHeaderMap[h.poNo] = h;
  });
  const receiptByLine = {};
  _purchaseListPOReceipts_().forEach(r => {
    if (!r.poLineId) return;
    receiptByLine[r.poLineId] = (receiptByLine[r.poLineId] || 0) + Number(r.qty || 0);
  });
  const poAgg = {};
  _purchaseListPOLines_()
    .filter(line => line.sourceType === 'ARTWORK_PLATE' || line.sourceType === 'ARTWORK_DIE')
    .forEach(line => {
      const type = line.sourceType === 'ARTWORK_DIE' ? 'DIE' : 'PLATE';
      const key = String(line.sourceRef || '').trim();
      if (!key) return;
      const aggKey = key + '||' + type;
      if (!poAgg[aggKey]) {
        poAgg[aggKey] = {
          orderedQty: 0,
          receivedQty: 0,
          pendingQty: 0,
          poRefs: [],
          vendors: [],
          latestRate: 0
        };
      }
      const bucket = poAgg[aggKey];
      const receivedQty = Number(receiptByLine[line.id] || 0);
      const orderedQty = Number(line.qty || 0);
      const pendingQty = Math.max(0, orderedQty - receivedQty);
      bucket.orderedQty += orderedQty;
      bucket.receivedQty += receivedQty;
      bucket.pendingQty += pendingQty;
      bucket.latestRate = Number(line.rate || 0) || bucket.latestRate;
      if (line.poNo && bucket.poRefs.indexOf(line.poNo) === -1) bucket.poRefs.push(line.poNo);
      const vendorName = poHeaderMap[line.poNo]?.vendorName || '';
      if (vendorName && bucket.vendors.indexOf(vendorName) === -1) bucket.vendors.push(vendorName);
    });

  const grouped = {};
  filtered.forEach(a => {
    const so = soMap[a.so_id] || {};
    const ln = lineMap[a.so_id + '||' + a.line_no] || {};
    const fallbackKey = String(a.so_id || '') + '||' + String(a.line_no || '');
    const artworkKey = artworkKeys[fallbackKey];
    const plate = procMap[artworkKey + '||PLATE'] || {};
    const die = procMap[artworkKey + '||DIE'] || {};
    const plateAgg = poAgg[artworkKey + '||PLATE'] || {};
    const dieAgg = poAgg[artworkKey + '||DIE'] || {};
    const key = artworkKey;

    if (!grouped[key]) {
      grouped[key] = {
        id: key,
        artworkKey: key,
        artworkNo: String(a.artwork_no || '').trim() || 'UNASSIGNED',
        so: [],
        soDate: so.so_date || '',
        lineNo: [],
        woNos: [],
        client: [],
        productName: [],
        qty: 0,
        unit: ln.unit || '',
        artworkUps: Number(a.sheet_ups || 0) || 1,
        memberRefs: [],
        plateStatusRaw: a.plate_status,
        dieStatusRaw: a.die_status,
        plateIsNew: false,
        dieIsNew: false,
        plateVendor: plateAgg.vendors?.length > 1 ? 'Multiple' : (plateAgg.vendors?.[0] || plate.vendor || ''),
        plateOrderedOn: plate.ordered_on || '',
        plateReceivedOn: plate.received_on || '',
        plateChallanNo: plate.challan_no || '',
        plateSize: plate.plate_size || a.plate_size || '',
        plateCount: plate.plate_count ?? plate.count ?? a.plate_count ?? '',
        hybridPlateCount: plate.hybrid_plate_count ?? a.hybrid_plate_count ?? '',
        hybridPlateSize: plate.hybrid_plate_size || a.hybrid_plate_size || '',
        plateCost: plateAgg.latestRate ?? plate.cost ?? '',
        plateOrderedQty: Number(plateAgg.orderedQty || 0),
        plateReceivedQty: Number(plateAgg.receivedQty || 0),
        platePendingQty: Number(plateAgg.pendingQty || 0),
        platePORefs: plateAgg.poRefs || [],
        statusPlate: _purchaseArtworkPOStatus_(plateAgg.orderedQty || 0, plateAgg.receivedQty || 0),
        dieVendor: dieAgg.vendors?.length > 1 ? 'Multiple' : (dieAgg.vendors?.[0] || die.vendor || ''),
        dieOrderedOn: die.ordered_on || '',
        dieReceivedOn: die.received_on || '',
        dieChallanNo: die.challan_no || '',
        dieCount: die.die_count ?? die.count ?? a.die_count ?? '',
        dieCost: dieAgg.latestRate ?? die.cost ?? '',
        dieOrderedQty: Number(dieAgg.orderedQty || 0),
        dieReceivedQty: Number(dieAgg.receivedQty || 0),
        diePendingQty: Number(dieAgg.pendingQty || 0),
        diePORefs: dieAgg.poRefs || [],
        statusDie: _purchaseArtworkPOStatus_(dieAgg.orderedQty || 0, dieAgg.receivedQty || 0)
      };
    }

    const row = grouped[key];
    const rowPlateNew = _purchaseIsArtworkToolingNew_(a.plate_status);
    const rowDieNew = _purchaseIsArtworkToolingNew_(a.die_status);
    row.plateIsNew = row.plateIsNew || rowPlateNew;
    row.dieIsNew = row.dieIsNew || rowDieNew;
    if (rowPlateNew) row.plateStatusRaw = a.plate_status || row.plateStatusRaw;
    if (rowDieNew) row.dieStatusRaw = a.die_status || row.dieStatusRaw;
    if (rowPlateNew) {
      if (!String(row.plateSize || '').trim() && String(a.plate_size || '').trim()) row.plateSize = a.plate_size;
      if (!(Number(row.plateCount || 0) > 0) && Number(a.plate_count || 0) > 0) row.plateCount = a.plate_count;
      if (!(Number(row.hybridPlateCount || 0) > 0) && Number(a.hybrid_plate_count || 0) > 0) row.hybridPlateCount = a.hybrid_plate_count;
      if (!String(row.hybridPlateSize || '').trim() && String(a.hybrid_plate_size || '').trim()) row.hybridPlateSize = a.hybrid_plate_size;
    }
    if (rowDieNew && !(Number(row.dieCount || 0) > 0) && Number(a.die_count || 0) > 0) row.dieCount = a.die_count;
    if (so.so_number && row.so.indexOf(so.so_number) === -1) row.so.push(so.so_number);
    if (String(a.line_no || '') && row.lineNo.indexOf(String(a.line_no || '')) === -1) row.lineNo.push(String(a.line_no || ''));
    (woMap[(so.so_number || '') + '||' + a.line_no] || []).forEach(woNo => { if (woNo && row.woNos.indexOf(woNo) === -1) row.woNos.push(woNo); });
    const clientName = clientMap[so.client_code] || so.client_code || '';
    if (clientName && row.client.indexOf(clientName) === -1) row.client.push(clientName);
    if (ln.product_name && row.productName.indexOf(ln.product_name) === -1) row.productName.push(ln.product_name);
    row.qty += Number(ln.qty || 0);
    row.memberRefs.push({
      soId: a.so_id,
      soNo: so.so_number || '',
      lineNo: a.line_no,
      artworkNo: a.artwork_no || '',
      sheetUps: Number(a.sheet_ups || 0) || 1
    });
  });

  return Object.keys(grouped).map(key => {
    const row = grouped[key];
    row.soList = row.so.slice();
    row.lineList = row.lineNo.slice();
    row.woList = row.woNos.slice();
    row.clientList = row.client.slice();
    row.productList = row.productName.slice();
    row.soCount = row.so.length;
    row.so = row.so.join(', ');
    row.lineNo = row.lineNo.join(', ');
    row.woNos = row.woNos.join(', ');
    row.client = row.client.join(', ');
    row.productName = row.productName.join(' / ');
    return row;
  }).filter(row => {
    if (!opts || !Object.keys(opts).length) return true;
    if (opts.pendingOnly) {
      const plateStatus = String(row.statusPlate || '').toUpperCase();
      const dieStatus = String(row.statusDie || '').toUpperCase();
      const platePending = (row.plateIsNew === true || _purchaseIsArtworkToolingNew_(row.plateStatusRaw)) && plateStatus !== 'RECEIVED' && plateStatus !== 'NA';
      const diePending = (row.dieIsNew === true || _purchaseIsArtworkToolingNew_(row.dieStatusRaw)) && dieStatus !== 'RECEIVED' && dieStatus !== 'NA';
      if (String(opts.type || '').toUpperCase() === 'PLATE') return platePending;
      if (String(opts.type || '').toUpperCase() === 'DIE') return diePending;
      return platePending || diePending;
    }
    const rowDate = row.soDate ? new Date(row.soDate) : null;
    if (opts.fromDate && rowDate && rowDate < new Date(opts.fromDate + 'T00:00:00')) return false;
    if (opts.toDate && rowDate && rowDate > new Date(opts.toDate + 'T23:59:59')) return false;
    return true;
  });
}

/**
 * JSON wrapper for frontend
 */
function getPlateDieJobsJson() {
  return JSON.stringify(getPlateDieJobs());
}

/**
 * SAVE — Plate & Die procurement details (bulk)
 * rows: [{ id, plateVendor, platePO, ... , dieCost, updatedBy }]
 */
function savePlateDieBulk(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    return { ok: true, updated: 0 };
  }

  let updated = 0;

  rows.forEach(p => {
    const artworkKey = String(p.artworkKey || p.id || '').trim();
    if (!artworkKey) return;
    const artworkNo = String(p.artworkNo || '').trim() || null;

    const upsertRow = function(type, payload) {
      const hasAnyValue = [
        payload.vendor,
        payload.ordered_on,
        payload.received_on,
        payload.challan_no,
        payload.count,
        payload.cost,
        payload.plate_size,
        payload.plate_count,
        payload.hybrid_plate_count,
        payload.hybrid_plate_size,
        payload.die_count
      ].some(v => !(v === '' || v === null || typeof v === 'undefined'));

      if (!hasAnyValue) return false;

      let existing = null;
      try {
        existing = supabaseSelect('purchase_artwork_procurement', {
          filters: {
            artwork_key: 'eq.' + artworkKey,
            type: 'eq.' + type
          },
          limit: 1
        })[0];
      } catch (e) {
        throw new Error('Run purchase_module_updates_20260317.sql in Supabase before saving artwork-wise plate/die entries.');
      }

      const finalPayload = {
        artwork_key: artworkKey,
        artwork_no: artworkNo,
        type: type,
        vendor: payload.vendor || '',
        ordered_on: payload.ordered_on || null,
        received_on: payload.received_on || null,
        challan_no: payload.challan_no || '',
        count: payload.count === '' ? null : (payload.count ?? null),
        cost: payload.cost === '' ? null : (payload.cost ?? null),
        plate_size: payload.plate_size || null,
        plate_count: payload.plate_count === '' ? null : (payload.plate_count ?? null),
        hybrid_plate_count: payload.hybrid_plate_count === '' ? null : (payload.hybrid_plate_count ?? null),
        hybrid_plate_size: payload.hybrid_plate_size || null,
        die_count: payload.die_count === '' ? null : (payload.die_count ?? null),
        status: 'ACTIVE',
        updated_at: new Date().toISOString()
      };

      try {
        if (existing?.id) {
          supabaseUpdate(
            'purchase_artwork_procurement',
            { id: 'eq.' + existing.id },
            finalPayload
          );
        } else {
          finalPayload.created_at = new Date().toISOString();
          supabaseInsert('purchase_artwork_procurement', finalPayload);
        }
      } catch (e) {
        throw new Error('Run purchase_plate_die_po_schema.sql in Supabase before saving the updated plate and die planning fields.');
      }
      return true;
    };

    if (upsertRow('PLATE', {
      vendor: p.plateVendor,
      ordered_on: p.plateOrderedOn,
      received_on: p.plateReceivedOn,
      challan_no: p.plateChallanNo,
      count: p.plateCount,
      cost: p.plateCost,
      plate_size: p.plateSize,
      plate_count: p.plateCount,
      hybrid_plate_count: p.hybridPlateCount,
      hybrid_plate_size: p.hybridPlateSize
    })) {
      updated++;
    }

    if (upsertRow('DIE', {
      vendor: p.dieVendor,
      ordered_on: p.dieOrderedOn,
      received_on: p.dieReceivedOn,
      challan_no: p.dieChallanNo,
      count: p.dieCount,
      cost: p.dieCost,
      die_count: p.dieCount
    })) {
      updated++;
    }
  });

  PropertiesService.getScriptProperties().setProperty('PURCHASE_CACHE_VERSION', String(Date.now()));
  return { ok: true, updated };
}

/******************************************************
 * PURCHASE — BACKEND
 * Merges inventory PRs, vendor masters, PO lifecycle,
 * PO print payload, and plates/dies tracking.
 ******************************************************/
const PURCHASE_COMPANY = {
  name: 'DESIGN INDIA (POWERSTIK)',
  gstin: '06AAIFD5522C1ZW',
  address: 'Plot No.2184, Sector-38, Phase II, Industrial Estate, Rai, Sonipat, Haryana, 131029',
  landline: '+91-8860108094',
  email: 'powerstikacc@gmail.com',
  website: 'www.powerstik.net',
  state: 'Haryana',
  pan: 'AAIFD5522C',
  cin: '',
  receiverName: 'DESIGN INDIA',
  deliveryName: 'DESIGN INDIA'
};

function _purchaseListVendors_() {
  return (supabaseSelect('purchase_vendors', {
    order: 'vendor_name.asc'
  }) || []).map(v => ({
    id: v.id,
    vendorCode: v.vendor_code || '',
    vendorName: v.vendor_name || '',
    contactPerson: v.contact_person || '',
    email: v.email || '',
    phone: v.phone || '',
    gstin: v.gstin || '',
    address: v.address || '',
    city: v.city || '',
    state: v.state || '',
    category: v.category || '',
    notes: v.notes || '',
    isActive: v.is_active !== false,
    createdAt: v.created_at || '',
    updatedAt: v.updated_at || ''
  }));
}

function _purchaseListPOHeaders_() {
  return (supabaseSelect('purchase_orders', {
    order: 'order_date.desc,created_at.desc'
  }) || []).map(h => ({
    id: h.id,
    poNo: h.po_no,
    orderDate: h.order_date,
    vendorId: h.vendor_id,
    vendorName: h.vendor_name || '',
    vendorEmail: h.vendor_email || '',
    vendorPhone: h.vendor_phone || '',
    vendorAddress: h.vendor_address || '',
    paymentTerms: h.payment_terms || '',
    freightTerms: h.freight_terms || '',
    deliveryTerms: h.delivery_terms || '',
    notes: h.notes || '',
    freightValue: Number(h.freight_value || 0),
    status: h.status || 'OPEN',
    totalQty: Number(h.total_qty || 0),
    basicTotal: Number(h.basic_total || 0),
    taxTotal: Number(h.tax_total || 0),
    totalValue: Number(h.total_value || 0),
    createdBy: h.created_by || '',
    createdAt: h.created_at || '',
    updatedAt: h.updated_at || ''
  }));
}

function _purchaseListPOLines_() {
  return (supabaseSelect('purchase_order_lines', {
    order: 'po_no.asc,line_no.asc'
  }) || []).map(l => ({
    id: l.id,
    poId: l.po_id,
    poNo: l.po_no,
    lineNo: Number(l.line_no || 0),
    sourceType: l.source_type || '',
    sourceRef: l.source_ref || '',
    itemCode: l.item_code || '',
    itemName: l.item_name || '',
    qty: Number(l.qty || 0),
    rate: Number(l.rate || 0),
    taxPct: Number(l.tax_pct || 0),
    amount: Number(l.amount || 0),
    taxAmount: Number(l.tax_amount || 0),
    totalAmount: Number(l.total_amount || l.amount || 0),
    department: l.department || '',
    jobRef: l.job_ref || '',
    remarks: l.remarks || '',
    createdAt: l.created_at || ''
  }));
}

function _purchaseListPOReceipts_() {
  try {
    return (supabaseSelect('purchase_po_receipts', {
      order: 'receipt_date.desc,created_at.desc'
    }) || []).map(r => ({
      id: r.id,
      poId: r.po_id || '',
      poNo: r.po_no || '',
      poLineId: r.po_line_id || '',
      lineNo: Number(r.line_no || 0),
      sourceType: r.source_type || '',
      receiptDate: r.receipt_date || '',
      challanNo: r.challan_no || '',
      qty: Number(r.qty || 0),
      rate: Number(r.rate || 0),
      remarks: r.remarks || '',
      createdAt: r.created_at || ''
    }));
  } catch (e) {
    Logger.log('purchase_po_receipts lookup failed: ' + e.message);
    return [];
  }
}

function _purchaseArtworkPOStatus_(orderedQty, receivedQty) {
  const ordered = Number(orderedQty || 0);
  const received = Number(receivedQty || 0);
  const pending = Math.max(0, ordered - received);
  if (ordered <= 0) return 'PENDING';
  if (pending <= 0) return 'RECEIVED';
  if (received > 0) return 'PARTIAL';
  return 'ORDERED';
}

function _purchaseDerivePOStatus_(totalQty, receivedQty) {
  const ordered = Number(totalQty || 0);
  const received = Number(receivedQty || 0);
  const pending = Math.max(0, ordered - received);
  if (ordered <= 0) return 'OPEN';
  if (pending <= 0) return 'RECEIVED';
  if (received > 0) return 'PARTIAL';
  return 'OPEN';
}

function _purchaseIsPlateDieSource_(sourceType) {
  const normalized = String(sourceType || '').trim().toUpperCase();
  return normalized === 'ARTWORK_PLATE' ||
    normalized === 'ARTWORK_DIE' ||
    normalized === 'DIRECT_PLATE' ||
    normalized === 'DIRECT_DIE';
}

function _purchasePlateDieTypeFromSource_(sourceType) {
  const normalized = String(sourceType || '').trim().toUpperCase();
  if (normalized === 'ARTWORK_DIE' || normalized === 'DIRECT_DIE') return 'DIE';
  if (normalized === 'ARTWORK_PLATE' || normalized === 'DIRECT_PLATE') return 'PLATE';
  return '';
}

function _purchaseNormalizeDirectLine_(line, fallbackSourceType, lineNo, poNo, now) {
  const qty = Number(line.qty || 0);
  const rate = Number(line.rate || 0);
  const taxPct = Number(line.taxPct || 0);
  if (qty <= 0) throw new Error('Invalid PO qty for direct line ' + lineNo);
  if (rate <= 0) throw new Error('Invalid PO rate for direct line ' + lineNo);
  if (taxPct < 0) throw new Error('Invalid tax % for direct line ' + lineNo);
  const itemName = String(line.itemName || '').trim();
  if (!itemName) throw new Error('Item description is required for direct line ' + lineNo);
  const basicAmount = Number((qty * rate).toFixed(2));
  const taxAmount = Number((basicAmount * taxPct / 100).toFixed(2));
  const totalAmount = Number((basicAmount + taxAmount).toFixed(2));
  return {
    id: String(line.id || Utilities.getUuid()),
    poNo: poNo,
    lineNo: lineNo,
    sourceType: String(line.sourceType || fallbackSourceType || 'DIRECT').trim().toUpperCase(),
    sourceRef: String(line.sourceRef || '').trim(),
    itemCode: String(line.itemCode || '').trim(),
    itemName: itemName,
    qty: qty,
    rate: rate,
    taxPct: taxPct,
    amount: basicAmount,
    taxAmount: taxAmount,
    totalAmount: totalAmount,
    department: String(line.department || '').trim(),
    jobRef: String(line.jobRef || '').trim(),
    remarks: String(line.remarks || '').trim(),
    receivedQty: 0,
    pendingQty: qty,
    createdAt: now
  };
}

function _purchaseNextVendorCode_() {
  const rows = _purchaseListVendors_();
  const max = rows.reduce((m, v) => {
    const n = Number(String(v.vendorCode || '').replace(/[^0-9]/g, ''));
    return Math.max(m, n || 0);
  }, 0);
  return 'V' + String(max + 1).padStart(5, '0');
}

function _purchaseNextPoNo_() {
  const fy = _fyString_(new Date()).replace('-', '');
  const rows = _purchaseListPOHeaders_();
  const prefix = 'PO/' + fy + '/';
  const max = rows.reduce((m, row) => {
    const poNo = String(row.poNo || '');
    if (poNo.indexOf(prefix) !== 0) return m;
    const n = Number(poNo.slice(prefix.length));
    return Math.max(m, n || 0);
  }, 0);
  return prefix + String(max + 1).padStart(4, '0');
}

function _purchaseItemTaxPct_(item) {
  if (!item) return 0;
  const candidates = [
    item.gst_pct,
    item.gstPercent,
    item.gst_percent,
    item.gst,
    item.gst_rate,
    item.tax_pct,
    item.tax_percent
  ];
  for (let i = 0; i < candidates.length; i++) {
    const n = Number(candidates[i]);
    if (!isNaN(n)) return n;
  }
  return 0;
}

function _purchaseIsoDate_(value) {
  if (!value) return '';
  const dt = new Date(value);
  if (isNaN(dt)) return '';
  return Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function _purchaseNowIso_() {
  return new Date().toISOString();
}

function _purchaseNormalizeVendor_(payload, existing) {
  const now = _purchaseNowIso_();
  return {
    id: existing?.id || Utilities.getUuid(),
    vendorCode: String(existing?.vendorCode || _purchaseNextVendorCode_()).trim(),
    vendorName: String(payload.vendorName || '').trim(),
    contactPerson: String(payload.contactPerson || '').trim(),
    email: String(payload.email || '').trim(),
    phone: String(payload.phone || '').trim(),
    gstin: String(payload.gstin || '').trim(),
    address: String(payload.address || '').trim(),
    city: String(payload.city || '').trim(),
    state: String(payload.state || '').trim(),
    category: String(payload.category || '').trim(),
    notes: String(payload.notes || '').trim(),
    isActive: payload.isActive === false ? false : true,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
}

function purchaseListVendorsJSON() {
  return {
    ok: true,
    rows: _purchaseListVendors_()
      .slice()
      .sort((a, b) => String(a.vendorName || '').localeCompare(String(b.vendorName || '')))
  };
}

function purchaseSaveVendor(payload) {
  if (!payload) throw new Error('Vendor details are required');

  const required = [
    ['vendorName', 'Vendor name'],
    ['category', 'Vendor category'],
    ['contactPerson', 'Contact person'],
    ['email', 'Email'],
    ['phone', 'Phone'],
    ['address', 'Address'],
    ['city', 'City'],
    ['state', 'State']
  ];

  const missing = required
    .filter(pair => !String(payload[pair[0]] || '').trim())
    .map(pair => pair[1]);

  if (missing.length) {
    throw new Error('Missing required fields: ' + missing.join(', '));
  }

  const existing = _purchaseListVendors_().find(v => v.id === payload.id) || null;
  const record = _purchaseNormalizeVendor_(payload, existing);

  const dbRow = {
    id: record.id,
    vendor_code: record.vendorCode,
    vendor_name: record.vendorName,
    contact_person: record.contactPerson,
    email: record.email,
    phone: record.phone,
    gstin: record.gstin,
    address: record.address,
    city: record.city,
    state: record.state,
    category: record.category,
    notes: record.notes,
    is_active: record.isActive,
    created_at: record.createdAt,
    updated_at: record.updatedAt
  };

  if (existing?.id) {
    supabaseUpdate('purchase_vendors', { id: 'eq.' + existing.id }, dbRow);
  } else {
    supabaseInsert('purchase_vendors', dbRow);
  }
  PropertiesService.getScriptProperties().setProperty('PURCHASE_CACHE_VERSION', String(Date.now()));
  return { ok: true, vendor: record };
}

function purchaseSetVendorStatus(payload) {
  if (!payload || !payload.id) throw new Error('Vendor id is required');
  const existing = _purchaseListVendors_().find(v => v.id === String(payload.id || '').trim());
  if (!existing) throw new Error('Vendor not found');
  const isActive = payload.isActive === false ? false : true;
  supabaseUpdate('purchase_vendors', { id: 'eq.' + existing.id }, {
    is_active: isActive,
    updated_at: _purchaseNowIso_()
  });
  PropertiesService.getScriptProperties().setProperty('PURCHASE_CACHE_VERSION', String(Date.now()));
  return { ok: true, id: existing.id, isActive: isActive };
}

function purchaseListInventoryRequestsJSON(opts = {}) {
  const filters = {};

  if (opts.status) filters.status = 'eq.' + opts.status;
  if (!opts.pendingOnly && opts.fromDate && opts.toDate) {
    filters.and = `(created_at.gte.${opts.fromDate}T00:00:00,created_at.lte.${opts.toDate}T23:59:59)`;
  } else if (!opts.pendingOnly && opts.fromDate) {
    filters.created_at = `gte.${opts.fromDate}T00:00:00`;
  } else if (!opts.pendingOnly && opts.toDate) {
    filters.created_at = `lte.${opts.toDate}T23:59:59`;
  }

  const poLinesSorted = _purchaseListPOLines_()
    .slice()
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || Number(a.lineNo || 0) - Number(b.lineNo || 0));

  const rows = supabaseSelect('inv_purchase_requests', {
    select: `
      pr_no,
      created_at,
      item_code,
      item_name,
      requested_qty,
      received_qty,
      department,
      job_ref,
      remarks,
      status
    `,
    filters,
    order: 'created_at.desc'
  }) || [];

  const itemCodes = [...new Set(rows.map(r => r.item_code).filter(Boolean))];
  const itemTaxMap = {};
  if (itemCodes.length) {
    (_supabaseSelectByKeyInBatches_('inv_items', '*', 'item_code', itemCodes, null, 40) || []).forEach(item => {
      itemTaxMap[item.item_code] = _purchaseItemTaxPct_(item);
    });
  }

  const prReceiptMap = {};
  rows.forEach(r => {
    prReceiptMap[r.pr_no] = Number(r.received_qty || 0);
  });

  const poLineMap = {};
  poLinesSorted.forEach(line => {
    if (!line.sourceRef) return;
    const receiptPool = Number(prReceiptMap[line.sourceRef] || 0);
    const allocated = Math.min(Number(line.qty || 0), receiptPool);
    prReceiptMap[line.sourceRef] = Math.max(0, receiptPool - allocated);

    if (!poLineMap[line.sourceRef]) {
      poLineMap[line.sourceRef] = { orderedQty: 0, openPOQty: 0, refs: [], latestRate: 0 };
    }

    poLineMap[line.sourceRef].orderedQty += Number(line.qty || 0);
    poLineMap[line.sourceRef].openPOQty += Math.max(0, Number(line.qty || 0) - allocated);
    poLineMap[line.sourceRef].latestRate = Number(line.rate || 0) || poLineMap[line.sourceRef].latestRate;
    if (line.poNo && !poLineMap[line.sourceRef].refs.includes(line.poNo)) {
      poLineMap[line.sourceRef].refs.push(line.poNo);
    }
  });

  const normalized = rows.map(r => {
      const linked = poLineMap[r.pr_no] || { orderedQty: 0, openPOQty: 0, refs: [], latestRate: 0 };
      const requestedQty = Number(r.requested_qty || 0);
      const receivedQty = Number(r.received_qty || 0);
      const pendingReceiptQty = Math.max(0, requestedQty - receivedQty);
      const orderedQty = Number(linked.orderedQty || 0);
      const openPOQty = Number(linked.openPOQty || 0);
      return {
        prNo: r.pr_no,
        date: r.created_at,
        itemCode: r.item_code,
        itemName: r.item_name,
        requestedQty: requestedQty,
        receivedQty: receivedQty,
        pendingReceiptQty: pendingReceiptQty,
        orderedQty: orderedQty,
        openPOQty: openPOQty,
        poRate: Number(linked.latestRate || 0),
        taxPct: Number(itemTaxMap[r.item_code] || 0),
        availableToOrderQty: Math.max(0, pendingReceiptQty - openPOQty),
        department: r.department || '',
        jobRef: r.job_ref || '',
        remarks: r.remarks || '',
        status: r.status || 'OPEN',
        poRefs: linked.refs || []
      };
    });

  return {
    ok: true,
    rows: normalized.filter(r => opts.pendingOnly ? Number(r.availableToOrderQty || 0) > 0 : true)
  };
}

function purchaseListPOsJSON(opts = {}) {
  const headers = _purchaseListPOHeaders_();
  const linesAll = _purchaseListPOLines_();
  const vendors = {};
  _purchaseListVendors_().forEach(v => { vendors[v.id] = v; });
  const receiptRows = _purchaseListPOReceipts_();
  const receiptEntriesByLine = {};
  receiptRows.forEach(row => {
    const lineId = String(row.poLineId || '').trim();
    if (!lineId) return;
    if (!receiptEntriesByLine[lineId]) receiptEntriesByLine[lineId] = [];
    receiptEntriesByLine[lineId].push(row);
  });

  const prRows = supabaseSelect('inv_purchase_requests', {
    select: 'pr_no,received_qty',
    order: 'created_at.asc'
  }) || [];

  const receiptPool = {};
  prRows.forEach(r => {
    receiptPool[r.pr_no] = Number(r.received_qty || 0);
  });

  const rows = headers
    .slice()
    .sort((a, b) => String(b.orderDate || '').localeCompare(String(a.orderDate || '')))
    .map(header => {
      const lines = linesAll
        .filter(line => line.poNo === header.poNo)
        .sort((a, b) => Number(a.lineNo || 0) - Number(b.lineNo || 0));

      const normalizedLines = lines.map(line => {
        let derivedReceived = 0;
        if (line.sourceType === 'INVENTORY_PR') {
          const prNo = line.sourceRef;
          const pool = prNo ? Number(receiptPool[prNo] || 0) : 0;
          derivedReceived = prNo ? Math.min(Number(line.qty || 0), pool) : 0;
          if (prNo) receiptPool[prNo] = Math.max(0, pool - derivedReceived);
        } else {
          derivedReceived = (receiptEntriesByLine[line.id] || []).reduce((sum, row) => sum + Number(row.qty || 0), 0);
        }
        const pendingQty = Math.max(0, Number(line.qty || 0) - derivedReceived);
        return Object.assign({}, line, {
          receivedQty: derivedReceived,
          pendingQty: pendingQty,
          overReceivedQty: Math.max(0, derivedReceived - Number(line.qty || 0)),
          receiptEntries: (receiptEntriesByLine[line.id] || []).slice().sort((a, b) => String(b.receiptDate || '').localeCompare(String(a.receiptDate || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        });
      });

      const totalQty = normalizedLines.reduce((sum, line) => sum + Number(line.qty || 0), 0);
      const basicTotal = normalizedLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
      const taxTotal = normalizedLines.reduce((sum, line) => sum + Number(line.taxAmount || 0), 0);
      const freightValue = Number(header.freightValue || 0);
      const totalValue = normalizedLines.reduce((sum, line) => sum + Number(line.totalAmount || line.amount || 0), 0) + freightValue;
      const receivedQty = normalizedLines.reduce((sum, line) => sum + Number(line.receivedQty || 0), 0);
      const pendingQty = Math.max(0, totalQty - receivedQty);
      const liveStatus = _purchaseDerivePOStatus_(totalQty, receivedQty);
      const vendor = vendors[header.vendorId] || {};
      const isArtworkPO = normalizedLines.some(line => _purchaseIsPlateDieSource_(line.sourceType));
      const hasDieLines = normalizedLines.some(line => _purchasePlateDieTypeFromSource_(line.sourceType) === 'DIE');
      const hasPlateLines = normalizedLines.some(line => _purchasePlateDieTypeFromSource_(line.sourceType) === 'PLATE');
      const artworkType = hasDieLines
        ? (hasPlateLines ? 'MIXED' : 'DIE')
        : (isArtworkPO ? 'PLATE' : 'INVENTORY');

      return {
        poNo: header.poNo,
        orderDate: header.orderDate,
        vendorId: header.vendorId || '',
        vendorName: header.vendorName || vendor.vendorName || '',
        vendorGstin: vendor.gstin || '',
        status: liveStatus,
        storedStatus: header.status || 'OPEN',
        lineCount: lines.length,
        totalQty: totalQty,
        receivedQty: receivedQty,
        pendingQty: pendingQty,
        basicTotal: basicTotal,
        taxTotal: taxTotal,
        totalValue: totalValue,
        buyerName: header.createdBy || '',
        paymentTerms: header.paymentTerms || '',
        freightTerms: header.freightTerms || '',
        freightValue: freightValue,
        deliveryTerms: header.deliveryTerms || '',
        notes: header.notes || '',
        workflow: isArtworkPO ? 'ARTWORK_PROCUREMENT' : 'INVENTORY_PR',
        artworkType: artworkType,
        lines: normalizedLines
      };
    })
    .filter(row => {
      if (opts.pendingOnly) return Number(row.pendingQty || 0) > 0;
      const rowDate = row.orderDate ? new Date(row.orderDate) : null;
      if (opts.fromDate && rowDate && rowDate < new Date(opts.fromDate + 'T00:00:00')) return false;
      if (opts.toDate && rowDate && rowDate > new Date(opts.toDate + 'T23:59:59')) return false;
      return true;
    });

  return { ok: true, rows: rows };
}

function purchaseListPOsForPRJSON(prNo) {
  const refNo = String(prNo || '').trim();
  if (!refNo) {
    throw new Error('PR No is required');
  }

  const baseLines = (supabaseSelect('purchase_order_lines', {
    filters: { source_ref: 'eq.' + refNo },
    order: 'po_no.asc,line_no.asc'
  }) || []);

  if (!baseLines.length) {
    return { ok: true, rows: [] };
  }

  const poIds = [...new Set(baseLines.map(line => line.po_id).filter(Boolean))];
  const lines = (supabaseSelect('purchase_order_lines', {
    filters: { po_id: _supabaseInFilter_(poIds) },
    order: 'po_no.asc,line_no.asc'
  }) || []).map(l => ({
    id: l.id,
    poId: l.po_id,
    poNo: l.po_no,
    lineNo: Number(l.line_no || 0),
    sourceType: l.source_type || '',
    sourceRef: l.source_ref || '',
    itemCode: l.item_code || '',
    itemName: l.item_name || '',
    qty: Number(l.qty || 0),
    rate: Number(l.rate || 0),
    taxPct: Number(l.tax_pct || 0),
    amount: Number(l.amount || 0),
    taxAmount: Number(l.tax_amount || 0),
    totalAmount: Number(l.total_amount || l.amount || 0),
    department: l.department || '',
    jobRef: l.job_ref || '',
    remarks: l.remarks || '',
    createdAt: l.created_at || ''
  }));
  const headers = [];
  for (let i = 0; i < poIds.length; i += 10) {
    const chunk = poIds.slice(i, i + 10);
    headers.push.apply(headers, (supabaseSelect('purchase_orders', {
      filters: { id: 'in.(' + chunk.join(',') + ')' },
      order: 'order_date.desc,created_at.desc'
    }) || []).map(h => ({
      id: h.id,
      poNo: h.po_no,
      orderDate: h.order_date,
      vendorId: h.vendor_id,
      vendorName: h.vendor_name || '',
      paymentTerms: h.payment_terms || '',
      freightTerms: h.freight_terms || '',
      freightValue: Number(h.freight_value || 0),
      deliveryTerms: h.delivery_terms || '',
      notes: h.notes || '',
      status: h.status || 'OPEN',
      createdBy: h.created_by || ''
    })));
  }

  const vendorIds = [...new Set(headers.map(function(header) {
    return header.vendorId;
  }).filter(Boolean))];
  const vendorMap = {};
  for (let i = 0; i < vendorIds.length; i += 20) {
    const chunk = vendorIds.slice(i, i + 20);
    (supabaseSelect('purchase_vendors', {
      select: 'id,gstin',
      filters: { id: _supabaseInFilter_(chunk) }
    }) || []).forEach(function(vendor) {
      vendorMap[String(vendor.id || '')] = {
        gstin: String(vendor.gstin || '').trim()
      };
    });
  }

  const headerMap = {};
  headers.forEach(header => {
    if (header.id) {
      header.vendorGstin = vendorMap[String(header.vendorId || '')]?.gstin || '';
      headerMap[header.id] = header;
    }
  });

  const prRow = supabaseSelect('inv_purchase_requests', {
    select: 'pr_no,received_qty',
    filters: { pr_no: 'eq.' + refNo },
    limit: 1
  })[0] || {};
  let receiptPool = Number(prRow.received_qty || 0);

  const grouped = {};
  lines.forEach(line => {
    const header = headerMap[line.poId] || {};
    const poKey = line.poNo || header.poNo || '';
    if (!poKey) return;
    if (!grouped[poKey]) {
      grouped[poKey] = {
        poNo: poKey,
        orderDate: header.orderDate || '',
        vendorId: header.vendorId || '',
        vendorName: header.vendorName || '',
        vendorGstin: header.vendorGstin || '',
        status: header.status || 'OPEN',
        buyerName: header.createdBy || '',
        paymentTerms: header.paymentTerms || '',
        freightTerms: header.freightTerms || '',
        freightValue: Number(header.freightValue || 0),
        deliveryTerms: header.deliveryTerms || '',
        notes: header.notes || '',
        lines: []
      };
    }

    const derivedReceived = Math.min(Number(line.qty || 0), receiptPool);
    receiptPool = Math.max(0, receiptPool - derivedReceived);
    grouped[poKey].lines.push(Object.assign({}, line, {
      receivedQty: derivedReceived,
      pendingQty: Math.max(0, Number(line.qty || 0) - derivedReceived)
    }));
  });

  const rows = Object.keys(grouped)
    .map(poNo => {
      const row = grouped[poNo];
      const totalQty = row.lines.reduce((sum, line) => sum + Number(line.qty || 0), 0);
      const receivedQty = row.lines.reduce((sum, line) => sum + Number(line.receivedQty || 0), 0);
      const basicTotal = row.lines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
      const taxTotal = row.lines.reduce((sum, line) => sum + Number(line.taxAmount || 0), 0);
      const totalValue = row.lines.reduce((sum, line) => sum + Number(line.totalAmount || line.amount || 0), 0) + Number(row.freightValue || 0);
      const liveStatus = _purchaseDerivePOStatus_(totalQty, receivedQty);
      return Object.assign(row, {
        status: liveStatus,
        lineCount: row.lines.length,
        totalQty: totalQty,
        receivedQty: receivedQty,
        pendingQty: Math.max(0, totalQty - receivedQty),
        basicTotal: basicTotal,
        taxTotal: taxTotal,
        totalValue: totalValue
      });
    })
    .sort((a, b) => String(b.orderDate || '').localeCompare(String(a.orderDate || '')));

  return { ok: true, rows: rows };
}

function purchaseCreatePO(payload) {
  if (!payload || !payload.vendorId) {
    throw new Error('Vendor is required');
  }

  const selectedRows = Array.isArray(payload.lines) ? payload.lines : [];
  if (!selectedRows.length) {
    throw new Error('Add at least one PO line');
  }

  const vendor = _purchaseListVendors_().find(v => v.id === payload.vendorId);
  if (!vendor) throw new Error('Vendor not found');

  const prData = purchaseListInventoryRequestsJSON({ status: '' }).rows;
  const prMap = {};
  prData.forEach(row => { prMap[row.prNo] = row; });

  const poNo = _purchaseNextPoNo_();
  const now = _purchaseNowIso_();
  const freightValue = Math.max(0, Number(payload.freightValue || 0));

  const lines = selectedRows.map((line, idx) => {
    if (line && (line.prNo || String(line.sourceType || '').toUpperCase() === 'INVENTORY_PR')) {
      const prNo = String(line.prNo || line.sourceRef || '').trim();
      const pr = prMap[prNo];
      if (!pr) throw new Error('PR not found: ' + prNo);

      const qty = Number(line.qty || 0);
      const rate = Number(line.rate || 0);
      const taxPct = Number(line.taxPct || 0);

      if (qty <= 0) throw new Error('Invalid PO qty for ' + pr.prNo);
      if (rate <= 0) throw new Error('Invalid PO rate for ' + pr.prNo);
      if (taxPct < 0) throw new Error('Invalid tax % for ' + pr.prNo);

      const basicAmount = Number((qty * rate).toFixed(2));
      const taxAmount = Number((basicAmount * taxPct / 100).toFixed(2));
      const totalAmount = Number((basicAmount + taxAmount).toFixed(2));

      return {
        id: Utilities.getUuid(),
        poNo: poNo,
        lineNo: idx + 1,
        sourceType: 'INVENTORY_PR',
        sourceRef: pr.prNo,
        itemCode: pr.itemCode,
        itemName: pr.itemName,
        qty: qty,
        rate: rate,
        taxPct: taxPct,
        amount: basicAmount,
        taxAmount: taxAmount,
        totalAmount: totalAmount,
        department: pr.department || '',
        jobRef: pr.jobRef || '',
        remarks: String(line.remarks || pr.remarks || '').trim(),
        receivedQty: 0,
        pendingQty: qty,
        createdAt: now
      };
    }
    return _purchaseNormalizeDirectLine_(line, 'DIRECT', idx + 1, poNo, now);
  });

  const basicTotal = lines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const taxTotal = lines.reduce((sum, line) => sum + Number(line.taxAmount || 0), 0);
  const totalValue = lines.reduce((sum, line) => sum + Number(line.totalAmount || 0), 0) + freightValue;
  const totalQty = lines.reduce((sum, line) => sum + Number(line.qty || 0), 0);

  const headerId = Utilities.getUuid();

  try {
    supabaseInsert('purchase_orders', {
      id: headerId,
      po_no: poNo,
      order_date: payload.orderDate || _purchaseIsoDate_(new Date()),
      vendor_id: vendor.id,
      vendor_name: vendor.vendorName,
      vendor_email: vendor.email || '',
      vendor_phone: vendor.phone || '',
      vendor_address: vendor.address || '',
      payment_terms: String(payload.paymentTerms || '').trim(),
      freight_terms: String(payload.freightTerms || '').trim(),
      freight_value: freightValue,
      delivery_terms: String(payload.deliveryTerms || '').trim(),
      notes: String(payload.notes || '').trim(),
      status: 'OPEN',
      total_qty: totalQty,
      basic_total: basicTotal,
      tax_total: taxTotal,
      total_value: totalValue,
      created_by: String(payload.createdBy || '').trim(),
      created_at: now,
      updated_at: now
    });
  } catch (e) {
    throw new Error('Run purchase_freight_value_schema.sql in Supabase before creating freight-valued purchase orders.');
  }

  supabaseBulkInsert('purchase_order_lines', lines.map(line => ({
    id: line.id,
    po_id: headerId,
    po_no: line.poNo,
    line_no: line.lineNo,
    source_type: line.sourceType,
    source_ref: line.sourceRef,
    item_code: line.itemCode,
    item_name: line.itemName,
    qty: line.qty,
    rate: line.rate,
    tax_pct: line.taxPct,
    amount: line.amount,
    tax_amount: line.taxAmount,
    total_amount: line.totalAmount,
    department: line.department,
    job_ref: line.jobRef,
    remarks: line.remarks,
    created_at: line.createdAt
  })));

  PropertiesService.getScriptProperties().setProperty('PURCHASE_CACHE_VERSION', String(Date.now()));
  return { ok: true, poNo: poNo };
}

function purchaseCreateArtworkPO(payload) {
  if (!payload || !payload.vendorId) throw new Error('Vendor is required');
  const type = String(payload.type || '').trim().toUpperCase();
  if (type !== 'PLATE' && type !== 'DIE') throw new Error('Plate or die type is required');

  const selectedRows = Array.isArray(payload.lines) ? payload.lines : [];
  if (!selectedRows.length) throw new Error('Add at least one PO line');

  const vendor = _purchaseListVendors_().find(v => v.id === payload.vendorId);
  if (!vendor) throw new Error('Vendor not found');

  const artworkRows = {};
  getPlateDieJobs({ type: type }).forEach(row => {
    artworkRows[row.artworkKey] = row;
  });

  const poNo = _purchaseNextPoNo_();
  const now = _purchaseNowIso_();
  const headerId = Utilities.getUuid();
  const freightValue = Math.max(0, Number(payload.freightValue || 0));

  const lines = selectedRows.map((line, idx) => {
    const artworkKey = String(line.artworkKey || '').trim();
    if (artworkKey) {
      const base = artworkRows[artworkKey];
      if (!base) throw new Error('Artwork not found for release: ' + artworkKey);

      const qty = Number(line.qty || 0);
      const rate = Number(line.rate || 0);
      const taxPct = Number(line.taxPct || 0);
      if (qty <= 0) throw new Error('Invalid PO qty for artwork ' + (base.artworkNo || artworkKey));
      if (rate <= 0) throw new Error('Invalid PO rate for artwork ' + (base.artworkNo || artworkKey));
      if (taxPct < 0) throw new Error('Invalid tax % for artwork ' + (base.artworkNo || artworkKey));

      const basicAmount = Number((qty * rate).toFixed(2));
      const taxAmount = Number((basicAmount * taxPct / 100).toFixed(2));
      const totalAmount = Number((basicAmount + taxAmount).toFixed(2));
      const artworkLabel = String(base.artworkNo || artworkKey || '').trim();
      const itemName = type + ' - ' + (artworkLabel || 'Artwork');
      const refSummary = (base.memberRefs || []).map(r => [r.soNo, r.lineNo].filter(Boolean).join('/')).filter(Boolean).join(', ');

      return {
        id: Utilities.getUuid(),
        poNo: poNo,
        lineNo: idx + 1,
        sourceType: 'ARTWORK_' + type,
        sourceRef: artworkKey,
        itemCode: artworkLabel || artworkKey,
        itemName: itemName,
        qty: qty,
        rate: rate,
        taxPct: taxPct,
        amount: basicAmount,
        taxAmount: taxAmount,
        totalAmount: totalAmount,
        department: 'PREPRESS',
        jobRef: refSummary || artworkLabel,
        remarks: String(line.remarks || '').trim(),
        receivedQty: 0,
        pendingQty: qty,
        createdAt: now
      };
    }
    return _purchaseNormalizeDirectLine_(line, 'DIRECT_' + type, idx + 1, poNo, now);
  });

  const basicTotal = lines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const taxTotal = lines.reduce((sum, line) => sum + Number(line.taxAmount || 0), 0);
  const totalValue = lines.reduce((sum, line) => sum + Number(line.totalAmount || 0), 0) + freightValue;
  const totalQty = lines.reduce((sum, line) => sum + Number(line.qty || 0), 0);

  try {
    supabaseInsert('purchase_orders', {
      id: headerId,
      po_no: poNo,
      order_date: payload.orderDate || _purchaseIsoDate_(new Date()),
      vendor_id: vendor.id,
      vendor_name: vendor.vendorName,
      vendor_email: vendor.email || '',
      vendor_phone: vendor.phone || '',
      vendor_address: vendor.address || '',
      payment_terms: String(payload.paymentTerms || '').trim(),
      freight_terms: String(payload.freightTerms || '').trim(),
      freight_value: freightValue,
      delivery_terms: String(payload.deliveryTerms || '').trim(),
      notes: String(payload.notes || '').trim(),
      status: 'OPEN',
      total_qty: totalQty,
      basic_total: basicTotal,
      tax_total: taxTotal,
      total_value: totalValue,
      created_by: String(payload.createdBy || '').trim(),
      created_at: now,
      updated_at: now
    });
  } catch (e) {
    throw new Error('Run purchase_freight_value_schema.sql in Supabase before creating freight-valued purchase orders.');
  }

  supabaseBulkInsert('purchase_order_lines', lines.map(line => ({
    id: line.id,
    po_id: headerId,
    po_no: line.poNo,
    line_no: line.lineNo,
    source_type: line.sourceType,
    source_ref: line.sourceRef,
    item_code: line.itemCode,
    item_name: line.itemName,
    qty: line.qty,
    rate: line.rate,
    tax_pct: line.taxPct,
    amount: line.amount,
    tax_amount: line.taxAmount,
    total_amount: line.totalAmount,
    department: line.department,
    job_ref: line.jobRef,
    remarks: line.remarks,
    created_at: line.createdAt
  })));

  PropertiesService.getScriptProperties().setProperty('PURCHASE_CACHE_VERSION', String(Date.now()));
  return { ok: true, poNo: poNo };
}

function purchaseUpdatePO(payload) {
  if (!payload || !payload.poNo) throw new Error('PO No is required');

  const header = _purchaseListPOHeaders_().find(row => row.poNo === String(payload.poNo || '').trim());
  if (!header) throw new Error('PO not found');

  const vendor = _purchaseListVendors_().find(v => v.id === payload.vendorId);
  if (!vendor) throw new Error('Vendor not found');

  const livePO = (purchaseListPOsJSON().rows || []).find(r => r.poNo === header.poNo) || { lines: [] };
  const existingLines = _purchaseListPOLines_()
    .filter(line => line.poNo === header.poNo)
    .sort((a, b) => Number(a.lineNo || 0) - Number(b.lineNo || 0));
  const existingLiveMap = {};
  (livePO.lines || []).forEach(line => { existingLiveMap[String(line.id)] = line; });
  const incomingList = Array.isArray(payload.lines) ? payload.lines.filter(Boolean) : [];
  const incomingMap = {};
  incomingList.forEach(line => {
    if (!line || !line.id) return;
    incomingMap[String(line.id)] = line;
  });

  let totalQty = 0;
  let basicTotal = 0;
  let taxTotal = 0;
  const freightValue = Math.max(0, Number(payload.freightValue || 0));
  const finalLines = [];

  existingLines.forEach(line => {
    const incoming = incomingMap[String(line.id)];
    const live = existingLiveMap[String(line.id)] || {};
    if (!incoming) {
      if (Number(live.receivedQty || 0) > 0) {
        throw new Error('Cannot delete line ' + line.lineNo + ' because receipts already exist.');
      }
      supabaseDelete('purchase_order_lines', { id: 'eq.' + line.id });
      return;
    }
    const sourceType = String(incoming.sourceType || line.sourceType || '').trim().toUpperCase() || 'DIRECT';
    const next = _purchaseNormalizeDirectLine_(Object.assign({}, line, incoming, { sourceType: sourceType }), sourceType, finalLines.length + 1, header.poNo, line.createdAt || _purchaseNowIso_());
    next.id = line.id;
    next.poId = header.id;
    finalLines.push(next);
  });

  incomingList.filter(line => !line.id || !existingLines.some(x => String(x.id) === String(line.id))).forEach(line => {
    const sourceType = String(line.sourceType || '').trim().toUpperCase() || 'DIRECT';
    const next = _purchaseNormalizeDirectLine_(line, sourceType, finalLines.length + 1, header.poNo, _purchaseNowIso_());
    next.poId = header.id;
    finalLines.push(next);
  });

  if (!finalLines.length) throw new Error('At least one PO line is required');

  finalLines.forEach((line, idx) => {
    line.lineNo = idx + 1;
    totalQty += line.qty;
    basicTotal += line.amount;
    taxTotal += line.taxAmount;
    if (existingLines.some(x => String(x.id) === String(line.id))) {
      supabaseUpdate('purchase_order_lines', { id: 'eq.' + line.id }, {
        line_no: line.lineNo,
        source_type: line.sourceType,
        source_ref: line.sourceRef,
        item_code: line.itemCode,
        item_name: line.itemName,
        qty: line.qty,
        rate: line.rate,
        tax_pct: line.taxPct,
        amount: line.amount,
        tax_amount: line.taxAmount,
        total_amount: line.totalAmount,
        department: line.department,
        job_ref: line.jobRef,
        remarks: line.remarks
      });
    } else {
      supabaseInsert('purchase_order_lines', {
        id: line.id,
        po_id: header.id,
        po_no: header.poNo,
        line_no: line.lineNo,
        source_type: line.sourceType,
        source_ref: line.sourceRef,
        item_code: line.itemCode,
        item_name: line.itemName,
        qty: line.qty,
        rate: line.rate,
        tax_pct: line.taxPct,
        amount: line.amount,
        tax_amount: line.taxAmount,
        total_amount: line.totalAmount,
        department: line.department,
        job_ref: line.jobRef,
        remarks: line.remarks,
        created_at: line.createdAt || _purchaseNowIso_()
      });
    }
  });

  try {
    supabaseUpdate('purchase_orders', { id: 'eq.' + header.id }, {
      vendor_id: vendor.id,
      vendor_name: vendor.vendorName,
      vendor_email: vendor.email || '',
      vendor_phone: vendor.phone || '',
      vendor_address: vendor.address || '',
      payment_terms: String(payload.paymentTerms || '').trim(),
      freight_terms: String(payload.freightTerms || '').trim(),
      freight_value: freightValue,
      delivery_terms: String(payload.deliveryTerms || '').trim(),
      notes: String(payload.notes || '').trim(),
      total_qty: Number(totalQty.toFixed(3)),
      basic_total: Number(basicTotal.toFixed(2)),
      tax_total: Number(taxTotal.toFixed(2)),
      total_value: Number((basicTotal + taxTotal + freightValue).toFixed(2)),
      updated_at: _purchaseNowIso_()
    });
  } catch (e) {
    throw new Error('Run purchase_freight_value_schema.sql in Supabase before updating freight-valued purchase orders.');
  }

  _purchaseUpdatePOStatus_(header.poNo);
  PropertiesService.getScriptProperties().setProperty('PURCHASE_CACHE_VERSION', String(Date.now()));
  return { ok: true, poNo: header.poNo };
}

function _purchaseUpdatePOStatus_(poNo) {
  const headers = _purchaseListPOHeaders_();
  const header = headers.find(row => row.poNo === poNo);
  if (!header) return;
  const rows = purchaseListPOsJSON().rows || [];
  const po = rows.find(r => r.poNo === poNo);
  if (!po) return;
  const lines = po.lines || [];
  const pendingQty = lines.reduce((sum, row) => sum + Math.max(0, Number(row.pendingQty || 0)), 0);
  const receivedQty = lines.reduce((sum, row) => sum + Number(row.receivedQty || 0), 0);
  const status = _purchaseDerivePOStatus_(pendingQty + receivedQty, receivedQty);
  supabaseUpdate('purchase_orders', { id: 'eq.' + header.id }, {
    status: status,
    updated_at: _purchaseNowIso_()
  });
}

function purchaseReceivePOLine(payload) {
  if (!payload || !payload.poNo || !payload.lineId) {
    throw new Error('PO line reference is required');
  }

  const qty = Number(payload.qty || 0);
  const rate = Number(payload.rate || 0);
  if (qty <= 0 || rate <= 0) throw new Error('Receive qty and rate are required');

  const line = _purchaseListPOLines_().find(row => row.poNo === payload.poNo && row.id === payload.lineId);
  if (!line) throw new Error('PO line not found');

  const poRows = purchaseListPOsJSON().rows || [];
  const po = poRows.find(r => r.poNo === payload.poNo);
  const liveLine = (po?.lines || []).find(r => r.id === payload.lineId) || line;
  const pendingQty = Number(liveLine.pendingQty ?? (Number(line.qty || 0) - Number(liveLine.receivedQty || 0)));
  if (!payload.allowOverReceipt && qty > pendingQty) {
    throw new Error('Receipt exceeds PO pending quantity');
  }

  invAppendLedger_({
    refType: 'PO-RECEIPT',
    refNo: payload.poNo,
    itemCode: line.itemCode,
    qtyIn: qty,
    rate: rate,
    location: payload.location || DEFAULT_LOCATION,
    department: line.department,
    remarks: 'PO Receipt ' + payload.poNo
  });

  refreshStockMV_();

  if (line.sourceType === 'INVENTORY_PR' && line.sourceRef) {
    const pr = supabaseSelect('inv_purchase_requests', {
      filters: { pr_no: 'eq.' + line.sourceRef },
      limit: 1
    })[0];

    if (pr) {
      const newReceived = Number(pr.received_qty || 0) + qty;
      const reqQty = Number(pr.requested_qty || 0);
      const newStatus = newReceived >= reqQty ? 'CLOSED' : 'OPEN';
      supabaseUpdate(
        'inv_purchase_requests',
        { pr_no: 'eq.' + line.sourceRef },
        { received_qty: newReceived, status: newStatus }
      );
    }
  }

  _purchaseUpdatePOStatus_(payload.poNo);
  PropertiesService.getScriptProperties().setProperty('PURCHASE_CACHE_VERSION', String(Date.now()));

  return { ok: true };
}

function purchaseReceiveArtworkPOLine(payload) {
  if (!payload || !payload.poNo || !payload.lineId) {
    throw new Error('PO line reference is required');
  }

  const qty = Number(payload.qty || 0);
  const rate = Number(payload.rate || 0);
  if (qty <= 0 || rate <= 0) throw new Error('Receive qty and rate are required');

  const line = _purchaseListPOLines_().find(row => row.poNo === payload.poNo && row.id === payload.lineId);
  if (!line) throw new Error('PO line not found');
  if (!_purchaseIsPlateDieSource_(line.sourceType)) {
    throw new Error('Receipts from this screen can only be posted for plate or die purchase order lines.');
  }

  const poRows = purchaseListPOsJSON().rows || [];
  const po = poRows.find(r => r.poNo === payload.poNo);
  const liveLine = (po?.lines || []).find(r => r.id === payload.lineId) || line;
  const pendingQty = Number(liveLine.pendingQty || 0);

  if (!payload.allowOverReceipt && qty > pendingQty) {
    throw new Error('Receipt exceeds PO pending quantity');
  }

  try {
    supabaseInsert('purchase_po_receipts', {
      id: Utilities.getUuid(),
      po_id: line.poId || null,
      po_no: payload.poNo,
      po_line_id: line.id,
      line_no: line.lineNo,
      source_type: line.sourceType,
      receipt_date: payload.receiptDate || _purchaseIsoDate_(new Date()),
      challan_no: String(payload.challanNo || '').trim(),
      qty: qty,
      rate: rate,
      remarks: String(payload.remarks || '').trim(),
      created_at: _purchaseNowIso_(),
      updated_at: _purchaseNowIso_()
    });
  } catch (e) {
    throw new Error('Run purchase_plate_die_po_schema.sql in Supabase before posting plate or die receipts.');
  }

  _purchaseUpdatePOStatus_(payload.poNo);
  PropertiesService.getScriptProperties().setProperty('PURCHASE_CACHE_VERSION', String(Date.now()));
  return { ok: true };
}

function purchaseReceiveArtworkPOBulk(payload) {
  if (!payload || !payload.poNo) {
    throw new Error('PO reference is required');
  }
  const inputLines = Array.isArray(payload.lines) ? payload.lines.filter(Boolean) : [];
  if (!inputLines.length) {
    throw new Error('Select at least one receipt line');
  }

  const baseLines = _purchaseListPOLines_().filter(function(row) {
    return row.poNo === String(payload.poNo || '').trim();
  });
  if (!baseLines.length) {
    throw new Error('PO lines not found');
  }

  const poRows = purchaseListPOsJSON().rows || [];
  const po = poRows.find(function(row) {
    return row.poNo === String(payload.poNo || '').trim();
  });
  if (!po) {
    throw new Error('PO not found');
  }

  const prepared = inputLines.map(function(entry, idx) {
    const lineId = String(entry.lineId || '').trim();
    const qty = Number(entry.qty || 0);
    const rate = Number(entry.rate || 0);
    if (!lineId) throw new Error('PO line reference is required for selected receipt row ' + (idx + 1));
    if (qty <= 0 || rate <= 0) throw new Error('Receive qty and rate are required for selected receipt row ' + (idx + 1));

    const line = baseLines.find(function(row) { return row.id === lineId; });
    if (!line) throw new Error('PO line not found for selected receipt row ' + (idx + 1));
    if (!_purchaseIsPlateDieSource_(line.sourceType)) {
      throw new Error('Bulk receipt is available only for plate or die purchase order lines.');
    }

    const liveLine = (po.lines || []).find(function(row) { return row.id === lineId; }) || line;
    const pendingQty = Number(liveLine.pendingQty || 0);
    if (!payload.allowOverReceipt && qty > pendingQty) {
      throw new Error('Receipt exceeds PO pending quantity for line ' + (line.lineNo || idx + 1));
    }

    return {
      id: Utilities.getUuid(),
      poId: line.poId || null,
      poNo: payload.poNo,
      poLineId: line.id,
      lineNo: line.lineNo,
      sourceType: line.sourceType,
      receiptDate: entry.receiptDate || payload.receiptDate || _purchaseIsoDate_(new Date()),
      challanNo: String(entry.challanNo || payload.challanNo || '').trim(),
      qty: qty,
      rate: rate,
      remarks: String(entry.remarks || '').trim(),
      createdAt: _purchaseNowIso_(),
      updatedAt: _purchaseNowIso_()
    };
  });

  try {
    supabaseBulkInsert('purchase_po_receipts', prepared.map(function(row) {
      return {
        id: row.id,
        po_id: row.poId,
        po_no: row.poNo,
        po_line_id: row.poLineId,
        line_no: row.lineNo,
        source_type: row.sourceType,
        receipt_date: row.receiptDate,
        challan_no: row.challanNo,
        qty: row.qty,
        rate: row.rate,
        remarks: row.remarks,
        created_at: row.createdAt,
        updated_at: row.updatedAt
      };
    }));
  } catch (e) {
    throw new Error('Run purchase_plate_die_po_schema.sql in Supabase before posting plate or die receipts.');
  }

  _purchaseUpdatePOStatus_(payload.poNo);
  PropertiesService.getScriptProperties().setProperty('PURCHASE_CACHE_VERSION', String(Date.now()));
  return {
    ok: true,
    poNo: payload.poNo,
    receiptIds: prepared.map(function(row) { return row.id; }),
    challanNo: String(payload.challanNo || '').trim(),
    receiptDate: payload.receiptDate || ''
  };
}

function purchaseGetPOPrintData(poNo) {
  if (!poNo) throw new Error('PO number is required');
  const header = _purchaseListPOHeaders_().find(row => row.poNo === poNo);
  if (!header) throw new Error('PO not found');

  const vendor = _purchaseListVendors_().find(v => v.id === header.vendorId) || {};
  const poRows = purchaseListPOsJSON().rows || [];
  const po = poRows.find(r => r.poNo === poNo) || {};
  const lines = (po.lines || [])
    .slice()
    .sort((a, b) => Number(a.lineNo || 0) - Number(b.lineNo || 0));

  const itemCodes = [...new Set(lines.map(l => l.itemCode).filter(Boolean))];
  const itemMap = {};
  if (itemCodes.length) {
    (_supabaseSelectByKeyInBatches_('inv_items', '*', 'item_code', itemCodes, null, 40) || []).forEach(item => {
      itemMap[item.item_code] = item;
    });
  }

  const intra = String(vendor.state || '').trim().toLowerCase() === String(PURCHASE_COMPANY.state || '').trim().toLowerCase();
  const freightValue = Number(header.freightValue || 0);
  let subtotal = 0, cgst = 0, sgst = 0, igst = 0, grandTotal = 0;

  const normalizedLines = lines.map(line => {
    const item = itemMap[line.itemCode] || {};
    const gstPct = Number(line.taxPct || 0);
    const basicAmount = Number(line.amount || 0);
    const cgstPct = intra ? gstPct / 2 : 0;
    const sgstPct = intra ? gstPct / 2 : 0;
    const igstPct = intra ? 0 : gstPct;
    const cgstAmt = +(basicAmount * cgstPct / 100).toFixed(2);
    const sgstAmt = +(basicAmount * sgstPct / 100).toFixed(2);
    const igstAmt = +(basicAmount * igstPct / 100).toFixed(2);
    const netAmount = +(basicAmount + cgstAmt + sgstAmt + igstAmt).toFixed(2);

    subtotal += basicAmount;
    cgst += cgstAmt;
    sgst += sgstAmt;
    igst += igstAmt;
    grandTotal += netAmount;

    return Object.assign({}, line, {
      hsnCode: item.hsn_group || (_purchaseIsPlateDieSource_(line.sourceType) ? '' : ''),
      stockUnit: _purchaseIsPlateDieSource_(line.sourceType)
        ? 'PCS'
        : (item.unit || item.uom || item.stock_unit || item.uom_name || ''),
      gstPct: gstPct,
      cgstPct: cgstPct,
      sgstPct: sgstPct,
      igstPct: igstPct,
      cgstAmt: cgstAmt,
      sgstAmt: sgstAmt,
      igstAmt: igstAmt,
      basicAmount: basicAmount,
      netAmount: netAmount
    });
  });

  return {
    ok: true,
    company: PURCHASE_COMPANY,
    header: {
      poNo: header.poNo,
      orderDate: header.orderDate,
      status: header.status,
      createdBy: header.createdBy || '',
      paymentTerms: header.paymentTerms || '',
      freightTerms: header.freightTerms || '',
      freightValue: freightValue,
      deliveryTerms: header.deliveryTerms || '',
      notes: header.notes || '',
      modeOfTransport: 'By Road'
    },
    vendor: vendor,
    receiver: {
      name: PURCHASE_COMPANY.receiverName,
      address: PURCHASE_COMPANY.address,
      email: PURCHASE_COMPANY.email,
      state: PURCHASE_COMPANY.state,
      gstin: PURCHASE_COMPANY.gstin,
      pan: PURCHASE_COMPANY.pan,
      cin: PURCHASE_COMPANY.cin,
      contactNo: PURCHASE_COMPANY.landline
    },
    delivery: {
      name: PURCHASE_COMPANY.deliveryName,
      address: PURCHASE_COMPANY.address,
      gstin: PURCHASE_COMPANY.gstin
    },
    lines: normalizedLines,
    totals: {
      qty: normalizedLines.reduce((sum, row) => sum + Number(row.qty || 0), 0),
      basicAmount: +subtotal.toFixed(2),
      cgstAmount: +cgst.toFixed(2),
      sgstAmount: +sgst.toFixed(2),
      igstAmount: +igst.toFixed(2),
      freightAmount: +freightValue.toFixed(2),
      value: +(grandTotal + freightValue).toFixed(2)
    },
    intrastate: intra
  };
}

function purchaseDashboardSummaryJSON(opts = {}) {
  const vendors = _purchaseListVendors_();
  const orders = purchaseListPOsJSON({}).rows || [];
  const openPOs = orders.filter(o => ['OPEN','PARTIAL'].includes(String(o.status || '').toUpperCase()));

  const prRows = supabaseSelect('inv_purchase_requests', {
    select: 'pr_no,requested_qty,received_qty,status,created_at',
    order: 'created_at.desc'
  }) || [];
  const poLinesSorted = _purchaseListPOLines_()
    .filter(line => line.sourceType === 'INVENTORY_PR')
    .slice()
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || Number(a.lineNo || 0) - Number(b.lineNo || 0));
  const prReceiptMap = {};
  prRows.forEach(r => { prReceiptMap[r.pr_no] = Number(r.received_qty || 0); });
  const poLineMap = {};
  poLinesSorted.forEach(line => {
    if (!line.sourceRef) return;
    const pool = Number(prReceiptMap[line.sourceRef] || 0);
    const allocated = Math.min(Number(line.qty || 0), pool);
    prReceiptMap[line.sourceRef] = Math.max(0, pool - allocated);
    if (!poLineMap[line.sourceRef]) poLineMap[line.sourceRef] = { openPOQty: 0 };
    poLineMap[line.sourceRef].openPOQty += Math.max(0, Number(line.qty || 0) - allocated);
  });
  let pendingReqCount = 0;
  let pendingReqQty = 0;
  prRows.forEach(r => {
    const requestedQty = Number(r.requested_qty || 0);
    const receivedQty = Number(r.received_qty || 0);
    const pendingReceiptQty = Math.max(0, requestedQty - receivedQty);
    const openPOQty = Number((poLineMap[r.pr_no] || {}).openPOQty || 0);
    const availableToOrderQty = Math.max(0, pendingReceiptQty - openPOQty);
    if (availableToOrderQty > 0) {
      pendingReqCount++;
      pendingReqQty += availableToOrderQty;
    }
  });

  const arts = _supabaseSelectAll_('artworks', {
    select: 'so_id,line_no,artwork_no,plate_status,die_status',
    order: 'id.asc'
  }, 1000, 50000) || [];
  const type = String(opts.type || 'PLATE').toUpperCase();
  const pdKeySet = {};
  arts.forEach(a => {
    const raw = type === 'DIE' ? a.die_status : a.plate_status;
    if (!_purchaseIsArtworkToolingNew_(raw)) return;
    const key = String(a.artwork_no || '').trim() || (String(a.so_id || '') + '||' + String(a.line_no || ''));
    if (key) pdKeySet[key] = true;
  });

  return {
    ok: true,
    metrics: {
      pendingReqCount: pendingReqCount,
      pendingReqQty: +pendingReqQty.toFixed(3),
      openPOCount: openPOs.length,
      openPOPendingQty: +openPOs.reduce((s, o) => s + Number(o.pendingQty || 0), 0).toFixed(3),
      totalPOValue: +orders.reduce((s, o) => s + Number(o.totalValue || 0), 0).toFixed(2),
      openPOValue: +openPOs.reduce((s, o) => s + Number(o.totalValue || 0), 0).toFixed(2),
      activeVendors: vendors.length,
      platePendingCount: Object.keys(pdKeySet).length
    },
    recentOrders: orders.slice(0, 8),
    pdType: type
  };
}

function purchaseBootstrapJSON(opts = {}) {
  const version = PropertiesService.getScriptProperties().getProperty('PURCHASE_CACHE_VERSION') || '0';
  const normalized = {
    requests: Object.assign({ status: '' }, opts.requests || {}),
    orders: opts.orders || {},
    plateDie: opts.plateDie || {},
    include: Object.assign({
      vendors: true,
      dashboard: true,
      requests: true,
      orders: true,
      plateDie: true
    }, opts.include || {})
  };
  const cacheKey = _cacheKeyHash_('PURCHASE_BOOTSTRAP', JSON.stringify({
    v: version,
    filters: normalized
  }));
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { cache.remove(cacheKey); }
  }

  const payload = { ok: true };
  if (normalized.include.vendors) payload.vendors = purchaseListVendorsJSON().rows;
  if (normalized.include.dashboard) payload.dashboard = purchaseDashboardSummaryJSON({ type: normalized.plateDie.type || 'PLATE' });
  if (normalized.include.requests) payload.requests = purchaseListInventoryRequestsJSON(normalized.requests).rows;
  if (normalized.include.orders) payload.orders = purchaseListPOsJSON(normalized.orders).rows;
  if (normalized.include.plateDie) payload.plateDieJobs = getPlateDieJobs(normalized.plateDie);
  try { cache.put(cacheKey, JSON.stringify(payload), 180); } catch (e) {}
  return payload;
}

/******************************************************
    Work Order Backend
 * PowerStik ERP
 ******************************************************/
function _fyString_(d) {
  const dt = d ? new Date(d) : new Date();
  const y = dt.getFullYear();
  const m = dt.getMonth() + 1;
  const fyStart = (m >= 4) ? y : (y - 1);
  const a = String(fyStart).slice(-2);
  const b = String(fyStart + 1).slice(-2);
  return a + '-' + b;
}

function _nextWOSeq_() {

  const seq = supabaseSelect('wo_sequence', {
    limit: 1
  })[0];

  if (!seq) {

    supabaseInsert('wo_sequence',{last_no:1});
    return 1;

  }

  const next = (seq.last_no || 0) + 1;

  supabaseUpdate(
    'wo_sequence',
    { id: 'eq.' + seq.id },
    { last_no: next }
  );

  return next;

}

function _formatWONo_(seq, d) {
  const fy = _fyString_(d);
  const num = ('00000' + seq).slice(-5);
  return 'J' + num + '/' + fy;
}

function _formatFlexoWONo_(seq, d) {
  const fy = _fyString_(d);
  const num = ('00000' + seq).slice(-5);
  return 'F' + num + '/' + fy;
}

function generateWorkOrderNumber() {
  const seq = _nextWOSeq_();
  return _formatWONo_(seq, new Date());
}

function generateFlexoWorkOrderNumber() {
  const seq = _nextWOSeq_();
  return _formatFlexoWONo_(seq, new Date());
}

function getNextWONumber() {
  return { woNo: generateWorkOrderNumber() };
}

function getNextFlexoWONumber() {
  return { woNo: generateFlexoWorkOrderNumber() };
}

function _isMissingInventoryReservationsTable_(err) {
  const msg = String(err && err.message || err || '');
  return msg.indexOf('inventory_reservations') !== -1 &&
    (msg.indexOf('PGRST205') !== -1 ||
     msg.indexOf('Could not find the table') !== -1 ||
     msg.indexOf('schema cache') !== -1);
}

function _deleteInventoryReservationsForWO_(woNo) {
  if (!woNo) return;
  try {
    supabaseDelete('inventory_reservations', {
      reference_type: 'eq.WORK_ORDER',
      reference_no: 'eq.' + woNo
    });
  } catch (err) {
    if (_isMissingInventoryReservationsTable_(err)) {
      Logger.log('inventory_reservations table missing; skipping WO reservation delete for ' + woNo);
      return;
    }
    throw err;
  }
}

function _insertInventoryReservationForWO_(woNo, materialRow) {
  if (!woNo || !materialRow?.item_id) return;
  try {
    supabaseInsertMinimal('inventory_reservations', {
      item_id: materialRow.item_id,
      reference_type: 'WORK_ORDER',
      reference_no: woNo,
      reserved_qty: materialRow.required_qty,
      uom: materialRow.uom,
      created_at: new Date().toISOString()
    });
  } catch (err) {
    if (_isMissingInventoryReservationsTable_(err)) {
      Logger.log('inventory_reservations table missing; skipping WO reservation insert for ' + woNo);
      return;
    }
    throw err;
  }
}

/* =========================
   List SO with status (WO wizard)
   ========================= */
function _excludeCancelledSalesOrdersByNumber_(rows, soKey) {
  const list = _excludeManualBillingSalesOrdersByNumber_(rows, soKey);
  if (!list.length) return list;

  const keyName = soKey || 'so_number';
  const soNumbers = [...new Set(
    list
      .map(function(row) { return String(row && row[keyName] || '').trim(); })
      .filter(Boolean)
  )];

  if (!soNumbers.length) return list;

  const salesOrders = _supabaseSelectByKeyInBatches_(
    'sales_orders',
    'so_number,status',
    'so_number',
    soNumbers
  ) || [];

  const allowed = {};
  salesOrders.forEach(function(row) {
    const soNo = String(row.so_number || '').trim();
    allowed[soNo] = String(row.status || '').toUpperCase() !== 'CANCELLED';
  });

  return list.filter(function(row) {
    const soNo = String(row && row[keyName] || '').trim();
    return soNo && allowed[soNo] !== false;
  });
}

function _excludeClosedSalesOrderLines_(rows, soKey, lineKey) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return list;

  const soName = soKey || 'so_number';
  const lineName = lineKey || 'line_no';
  const soNumbers = [...new Set(list.map(function(row) {
    return String(row && row[soName] || '').trim();
  }).filter(Boolean))];

  if (!soNumbers.length) return list;

  try {
    const soRows = _supabaseSelectByKeyInBatches_(
      'sales_orders',
      'id,so_number,status',
      'so_number',
      soNumbers,
      null,
      40
    ) || [];

    const soIdToNo = {};
    const cancelled = {};
    soRows.forEach(function(so) {
      const soNo = String(so.so_number || '').trim();
      const soId = String(so.id || '').trim();
      if (!soNo || !soId) return;
      soIdToNo[soId] = soNo;
      if (['CLOSED', 'CANCELLED'].indexOf(String(so.status || '').trim().toUpperCase()) !== -1) {
        cancelled[soNo] = true;
      }
    });

    const soIds = Object.keys(soIdToNo);
    if (!soIds.length) return list;

    const lineRows = _supabaseSelectByKeyInBatches_(
      'sales_order_lines',
      'so_id,line_no,status',
      'so_id',
      soIds,
      null,
      40
    ) || [];

    const blocked = {};
    lineRows.forEach(function(line) {
      const status = String(line.status || 'OPEN').trim().toUpperCase();
      if (status !== 'CLOSED' && status !== 'CANCELLED') return;
      const soNo = soIdToNo[String(line.so_id || '').trim()] || '';
      const lineNo = String(line.line_no || '').trim();
      if (soNo && lineNo) blocked[soNo + '||' + lineNo] = true;
    });

    return list.filter(function(row) {
      const soNo = String(row && row[soName] || '').trim();
      const lineNo = String(row && row[lineName] || '').trim();
      if (!soNo || !lineNo) return false;
      if (cancelled[soNo]) return false;
      return blocked[soNo + '||' + lineNo] !== true;
    });
  } catch (err) {
    const msg = String((err && err.message) || err || '');
    const missingStatus = msg.indexOf('sales_order_lines.status') !== -1 ||
      msg.indexOf('column sales_order_lines.status') !== -1 ||
      msg.indexOf('column "status" of relation "sales_order_lines" does not exist') !== -1;
    if (!missingStatus) throw err;
    Logger.log('sales_order_lines.status missing; closed-line filtering skipped until schema is applied.');
    return list;
  }
}

function _selectWorkOrderCandidateRows_(query) {
  try {
    return supabaseSelect('v_workorder_candidates_active', query) || [];
  } catch (err) {
    if (!_supabaseRelationMissing_(err, 'v_workorder_candidates_active')) throw err;
    return _excludeClosedSalesOrderLines_(supabaseSelect('v_workorder_candidates', query) || [], 'so_number', 'line_no');
  }
}

function _fetchWorkOrderCandidateRowsBySoNumbers_(soNumbers, select, order) {
  const list = [...new Set((soNumbers || []).map(function(soNo) {
    return String(soNo || '').trim();
  }).filter(Boolean))];
  if (!list.length) return [];

  try {
    return _supabaseSelectByKeyInBatches_(
      'v_workorder_candidates_active',
      select,
      'so_number',
      list,
      order,
      40
    ) || [];
  } catch (err) {
    if (!_supabaseRelationMissing_(err, 'v_workorder_candidates_active')) throw err;
    const rows = _supabaseSelectByKeyInBatches_(
      'v_workorder_candidates',
      select,
      'so_number',
      list,
      order,
      40
    ) || [];
    return _excludeClosedSalesOrderLines_(rows, 'so_number', 'line_no');
  }
}

function _isManualBillingSalesOrderRow_(row, soKey) {
  const keyName = soKey || 'so_number';
  const soNo = String(row && row[keyName] || '').trim().toUpperCase();
  const salesType = String(row && (row.sales_type || row.salesType) || '').trim().toUpperCase();
  const orderPrefix = String(row && (row.order_prefix || row.orderPrefix) || '').trim().toUpperCase();
  return orderPrefix === 'MB' || salesType === 'MANUAL_BILLING' || /^MB[\/-]/.test(soNo);
}

function _excludeManualBillingSalesOrdersByNumber_(rows, soKey) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return list;
  return list.filter(function(row) {
    return !_isManualBillingSalesOrderRow_(row, soKey);
  });
}

function _workOrderProductionQty_(orderQty, stockQtyToBill) {
  return Math.max(0, (Number(orderQty || 0) || 0) - (Number(stockQtyToBill || 0) || 0));
}

function _opsLoadArtworkStockClosureRows_() {
  let artRows = [];
  try {
    artRows = supabaseSelect('artworks', {
      select: 'id,so_id,line_no,artwork_no,product_type,status,stock_qty_to_bill,approved_at',
      filters: {
        stock_qty_to_bill: 'gt.0',
        status: 'eq.APPROVED'
      },
      limit: 5000
    }) || [];
  } catch (err) {
    Logger.log('Artwork stock closure rows unavailable: ' + (err && err.message ? err.message : err));
    return { rows: [], byComposite: {}, soNumbers: [] };
  }
  if (!artRows.length) return { rows: [], byComposite: {}, soNumbers: [] };

  const soIds = [...new Set(artRows.map(function(row) { return row.so_id; }).filter(Boolean))];
  const soRows = _supabaseSelectByKeyInBatches_(
    'sales_orders',
    'id,so_number,status',
    'id',
    soIds
  ) || [];
  const soMap = {};
  soRows.forEach(function(row) {
    if (String(row.status || '').toUpperCase() === 'CANCELLED') return;
    soMap[String(row.id || '')] = row;
  });

  const lineRows = _supabaseSelectByKeyInBatches_(
    'sales_order_lines',
    'id,so_id,line_no,product_code,product_name,category,qty,accounts_status,business_status,product_remarks,prepress_remarks,expected_delivery,final_delivery,division,quote_no,pm_code',
    'so_id',
    soIds
  ) || [];
  const lineMap = {};
  lineRows.forEach(function(row) {
    lineMap[String(row.so_id || '') + '||' + String(row.line_no || '')] = row;
  });

  const rows = [];
  const byComposite = {};
  artRows.forEach(function(art) {
    const so = soMap[String(art.so_id || '')];
    if (!so || !so.so_number) return;
    const line = lineMap[String(art.so_id || '') + '||' + String(art.line_no || '')] || {};
    const key = String(so.so_number || '') + '||' + String(art.line_no || '');
    const qty = Math.max(0, Number(art.stock_qty_to_bill || 0) || 0);
    if (!qty || key === '||') return;
    const row = {
      key: key,
      soNumber: String(so.so_number || ''),
      lineNo: String(art.line_no || ''),
      soId: art.so_id || '',
      soLineId: line.id || '',
      productCode: line.product_code || '',
      productName: line.product_name || '',
      category: line.category || '',
      orderQty: Number(line.qty || 0),
      stockClosedQty: qty,
      artworkNo: art.artwork_no || '',
      productType: art.product_type || '',
      approvedAt: art.approved_at || '',
      line: line
    };
    rows.push(row);
    byComposite[key] = row;
  });

  return {
    rows: rows,
    byComposite: byComposite,
    soNumbers: [...new Set(rows.map(function(row) { return row.soNumber; }).filter(Boolean))]
  };
}

function _artworkStockAllocationMapBySoLine_(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const soNumbers = [...new Set(list.map(function(row) {
    return String(row && (row.so_number || row.so) || '').trim();
  }).filter(Boolean))];
  if (!soNumbers.length) return {};

  const out = {};
  for (let i = 0; i < soNumbers.length; i += 40) {
    const chunk = soNumbers.slice(i, i + 40);
    (selectArtworkJobsView_({
      select: 'so_number,line_no,stock_qty_to_bill',
      filters: { so_number: _supabaseInFilter_(chunk) }
    }) || []).forEach(function(row) {
      const key = String(row.so_number || '') + '||' + String(row.line_no || '');
      if (key !== '||') out[key] = Number(row.stock_qty_to_bill || 0) || 0;
    });
  }
  return out;
}

function _applyArtworkStockAllocationToCandidateRows_(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return list;
  const allocationMap = _artworkStockAllocationMapBySoLine_(list);
  return list.map(function(row) {
    const key = String(row.so_number || row.so || '') + '||' + String(row.line_no || row.lineNo || '');
    if (Object.prototype.hasOwnProperty.call(allocationMap, key)) {
      row.stock_qty_to_bill = allocationMap[key];
    }
    return row;
  });
}

function _mapWOCandidateViewRow_(r) {
  const orderQty = Number(r.qty || 0) || 0;
  const stockQtyToBill = Math.max(0, Number(r.stock_qty_to_bill || 0) || 0);
  const qty = _workOrderProductionQty_(orderQty, stockQtyToBill);
  const processedQty = Number(r.processed_qty || 0) || 0;
  const viewRemaining = Number(r.remaining_qty != null ? r.remaining_qty : (qty - processedQty)) || 0;
  const remainingQty = stockQtyToBill > 0
    ? Math.max(0, qty - processedQty)
    : Math.max(0, viewRemaining);
  const canCreateWo = r.can_create_wo === true || String(r.can_create_wo || '').toLowerCase() === 'true';
  return {
    so: r.so_number || '',
    lineNo: String(r.line_no || ''),
    productCode: r.product_code || '',
    client: r.client_name || r.client_code || '',
    productName: r.product_name || '',
    artworkNo: r.artwork_no || '',
    qty: qty,
    orderQty: orderQty,
    stockQtyToBill: stockQtyToBill,
    remainingQty: remainingQty,
    processedQty: processedQty,
    unit: r.unit || '',
    category: r.category || '',
    productType: r.product_type || '',
    soDate: r.so_date || '',
    soTime: r.so_time || '',
    soDateTime: [r.so_date || '', r.so_time || ''].filter(Boolean).join(' '),
    salesRep: r.sales_rep || '',
    po_number: r.po_number || '',
    expected_delivery: r.expected_delivery || '',
    job_priority: r.job_priority || '',
    job_type: r.job_type || '',
    so_remarks: r.so_remarks || '',
    product_remarks: r.product_remarks || '',
    job_reference: r.job_reference || '',
    prepress_remark: r.prepress_remark || '',
    woList: r.wo_list || '',
    accountsStatus: String(r.accounts_status || '').trim().toUpperCase() || 'PENDING',
    businessStatus: String(r.business_status || '').trim().toUpperCase() || 'PENDING',
    artworkStatus: String(r.artwork_status || '').trim().toUpperCase() || 'NO_ART',
    approvalStage: r.approval_stage || 'Approved',
    canCreateWo: canCreateWo,
    artSheetLength: r.sheet_length == null ? '' : Number(r.sheet_length),
    artSheetWidth: r.sheet_width == null ? '' : Number(r.sheet_width),
    artSheetUps: r.sheet_ups == null ? '' : Number(r.sheet_ups),
    artPrintingColors: r.printing_colors || '',
    artAcrossUps: '',
    artAlongUps: '',
    artTotalUps: '',
    artAcrossWidth: '',
    artTeeth: '',
    artAcrossGapMm: '',
    artAlongGapMm: '',
    artStatus: r.artwork_status || '',
    artApprovedAt: r.artwork_approved_at || null
  };
}

function _listSOWithStatusFromCandidateView_(limit = 200, offset = 0) {
  const pageLimit = Math.max(1, Number(limit || 0) || 200);
  const pageOffset = Math.max(0, Number(offset || 0) || 0);
  const rawRows = _selectWorkOrderCandidateRows_({
    select: `
      so_number,
      so_date,
      so_time,
      sales_rep,
      client_code,
      client_name,
      line_no,
      product_code,
      product_name,
      category,
      qty,
      unit,
      po_number,
      expected_delivery,
      job_priority,
      job_type,
      so_remarks,
      product_remarks,
      prepress_remark,
      job_reference,
      accounts_status,
      business_status,
      artwork_no,
      product_type,
      sheet_length,
      sheet_width,
      sheet_ups,
      printing_colors,
      artwork_status,
      artwork_approved_at,
      processed_qty,
      remaining_qty,
      wo_list,
      approval_stage,
      can_create_wo
    `,
    order: 'so_number.desc,line_no.asc',
    limit: pageLimit,
    offset: pageOffset
  }) || [];
  const rows = _applyArtworkStockAllocationToCandidateRows_(_excludeManualBillingSalesOrdersByNumber_(rawRows, 'so_number'));

  const pending = [];
  const processed = [];

  rows.forEach(function(r) {
    const row = _mapWOCandidateViewRow_(r);
    if (_isFlexoWorkOrderItem_(row)) return;
    if (row.remainingQty > 0) pending.push(row);
    if (row.processedQty > 0) {
      processed.push(Object.assign({}, row, { qty: row.processedQty }));
    }
  });

  return {
    pending: pending,
    processed: processed,
    hasMore: rawRows.length >= pageLimit
  };
}

function _fetchWOCandidateRowsBySoNumbers_(soNumbers) {
  const list = [...new Set((soNumbers || []).map(function(soNo) {
    return String(soNo || '').trim();
  }).filter(Boolean))];
  if (!list.length) return [];
  const rows = _fetchWorkOrderCandidateRowsBySoNumbers_(
    list,
    `
      so_number,
      so_date,
      so_time,
      sales_rep,
      client_code,
      client_name,
      line_no,
      product_code,
      product_name,
      category,
      qty,
      unit,
      po_number,
      expected_delivery,
      job_priority,
      job_type,
      so_remarks,
      product_remarks,
      prepress_remark,
      job_reference,
      accounts_status,
      business_status,
      artwork_no,
      product_type,
      sheet_length,
      sheet_width,
      sheet_ups,
      printing_colors,
      artwork_status,
      artwork_approved_at,
      processed_qty,
      remaining_qty,
      wo_list,
      approval_stage,
      can_create_wo
    `,
    undefined
  ) || [];
  return _applyArtworkStockAllocationToCandidateRows_(rows);
}

function _listSOWithStatusLegacy_(limit = 200, offset = 0, seedCandidateMap) {
  const pageLimit = Math.max(1, Number(limit || 0) || 200);
  const pageOffset = Math.max(0, Number(offset || 0) || 0);
  const rawApprovalRows = supabaseSelect(
    'v_sales_order_lines_for_approval',
    {
      select: `
        so_number,
        so_date,
        so_created_at:created_at,
        line_no,
        sales_rep,
        client_name,
        product_name,
        category,
        qty,
        accounts_status,
        business_status
      `,
      order: 'so_number.desc,line_no.asc',
      limit: pageLimit,
      offset: pageOffset
    }
  ) || [];
  const approvalRows = _excludeFlexoWorkOrderItems_(_filterSalesServiceOnlyItems_(_excludeClosedSalesOrderLines_(_excludeCancelledSalesOrdersByNumber_(rawApprovalRows, 'so_number'), 'so_number', 'line_no')));

  const candidateMap = {};
  if (seedCandidateMap && typeof seedCandidateMap === 'object') {
    Object.keys(seedCandidateMap).forEach(function(key) {
      candidateMap[key] = seedCandidateMap[key];
    });
  } else {
    let candidateRows = [];
    try {
      candidateRows = _excludeFlexoWorkOrderItems_(_filterSalesServiceOnlyItems_(_excludeManualBillingSalesOrdersByNumber_(_selectWorkOrderCandidateRows_({
        order: 'so_number.desc,line_no.asc',
        limit: pageLimit,
        offset: pageOffset
      }) || [], 'so_number')));
    } catch (e) {
      Logger.log('Legacy WO queue candidate view unavailable: ' + e.message);
      candidateRows = [];
    }
    (candidateRows || []).forEach(function(row) {
      const key = String(row.so_number || '') + '||' + String(row.line_no || '');
      if (key !== '||') candidateMap[key] = row;
    });
  }

  const rows = approvalRows;

  if (!rows.length) {
    return {
      pending: [],
      processed: [],
      hasMore: rawApprovalRows.length >= pageLimit
    };
  }

  const soNumbers = [...new Set(rows.map(function(r) { return r.so_number; }).filter(Boolean))];

  const artworkMap = {};
  if (soNumbers.length) {
    for (let i = 0; i < soNumbers.length; i += 40) {
      const chunk = soNumbers.slice(i, i + 40);
      (selectArtworkJobsView_({
        select: 'so_number,line_no,so_date,so_time,sales_rep,category,product_type,artwork_no,sheet_length,sheet_width,sheet_ups,printing_colors,across_ups,along_ups,total_ups,across_width,teeth,across_gap_mm,along_gap_mm,stock_qty_to_bill,status,approved_at,accounts_status,business_status',
        filters: {
          so_number: _supabaseInFilter_(chunk)
        }
      }) || []).forEach(function(a) {
        const key = String(a.so_number || '') + '||' + String(a.line_no || '');
        artworkMap[key] = a;
      });
    }
  }

  const workOrderJobs = _supabaseSelectByKeyInBatches_(
    'work_order_jobs',
    'wo_id,so_number,line_no,qty',
    'so_number',
    soNumbers,
    undefined,
    40
  );

  const processedQtyMap = {};
  const woIds = [...new Set(workOrderJobs.map(function(j) { return j.wo_id; }).filter(Boolean))];

  const woNoMap = {};
  if (woIds.length) {
    _supabaseSelectByKeyInBatches_(
      'work_orders',
      'id,wo_number',
      'id',
      woIds,
      undefined,
      40
    ).forEach(function(w) {
      woNoMap[w.id] = w.wo_number || '';
    });
  }

  const woListMap = {};
  workOrderJobs.forEach(function(j) {
    const key = String(j.so_number || '') + '||' + String(j.line_no || '');
    processedQtyMap[key] = (processedQtyMap[key] || 0) + (Number(j.qty) || 0);
    const woNo = woNoMap[j.wo_id] || '';
    if (!woNo) return;
    if (!woListMap[key]) woListMap[key] = [];
    if (woListMap[key].indexOf(woNo) === -1) woListMap[key].push(woNo);
  });

  const pending = [];
  const processed = [];

  rows.forEach(function(r) {
    const key = String(r.so_number || '') + '||' + String(r.line_no || '');
    const candidate = candidateMap[key] || {};
    const art = artworkMap[key] || {};
    const orderQty = Number(r.so_qty || r.qty || candidate.so_qty || candidate.order_qty || candidate.qty) || 0;
    const stockQtyToBill = Math.max(0, Number(art.stock_qty_to_bill || candidate.stock_qty_to_bill || 0) || 0);
    const originalQty = _workOrderProductionQty_(orderQty, stockQtyToBill);
    const processedQty = Number(processedQtyMap[key] || 0);
    const remainingQty = Math.max(0, originalQty - processedQty);
    const accountsStatus = String(r.accounts_status || art.accounts_status || '').trim().toUpperCase() || 'PENDING';
    const businessStatus = String(r.business_status || art.business_status || '').trim().toUpperCase() || 'PENDING';
    const artworkStatus = String(art.status || r.status || r.artwork_status || candidate.artwork_status || (candidate ? 'APPROVED' : '')).trim().toUpperCase() || 'NO_ART';
    const rejectedStages = [];
    const pendingStages = [];

    if (accountsStatus === 'REJECTED') rejectedStages.push('Accounts');
    else if (accountsStatus !== 'APPROVED') pendingStages.push('Accounts');

    if (businessStatus === 'REJECTED') rejectedStages.push('Business');
    else if (businessStatus !== 'APPROVED') pendingStages.push('Business');

    if (artworkStatus === 'REJECTED') rejectedStages.push('Artwork');
    else if (artworkStatus !== 'APPROVED') pendingStages.push('Artwork');

    const canCreateWo = !rejectedStages.length && !pendingStages.length;
    const approvalStage = rejectedStages.length
      ? ('Rejected at ' + rejectedStages.join(' / '))
      : (pendingStages.length ? ('Pending at ' + pendingStages.join(' / ')) : 'Approved');

    const row = {
      so: r.so_number,
      lineNo: String(r.line_no),
      productCode: r.product_code || candidate.product_code || '',
      client: r.client_name || r.client_code || candidate.client_name || candidate.client_code || '',
      productName: r.product_name || candidate.product_name || '',
      artworkNo: art.artwork_no || r.artwork_no || '',
      qty: originalQty,
      orderQty: orderQty,
      stockQtyToBill: stockQtyToBill,
      remainingQty: remainingQty,
      processedQty: processedQty,
      unit: r.unit || candidate.unit || '',
      category: art.category || r.category || candidate.category || '',
      productType: art.product_type || r.product_type || candidate.product_type || '',
      soDate: r.so_date || candidate.so_date || '',
      soTime: art.so_time || r.so_time || candidate.so_time || '',
      soDateTime: [r.so_date || art.so_date || candidate.so_date || '', art.so_time || r.so_time || candidate.so_time || ''].filter(Boolean).join(' '),
      salesRep: art.sales_rep || r.sales_rep || candidate.sales_rep || '',
      po_number: r.po_number || candidate.po_number || '',
      expected_delivery: r.expected_delivery || candidate.expected_delivery || '',
      job_priority: r.job_priority || candidate.job_priority || '',
      job_type: r.job_type || candidate.job_type || '',
      so_remarks: r.so_remarks || candidate.so_remarks || '',
      product_remarks: r.product_remarks || candidate.product_remarks || '',
      job_reference: r.job_reference || candidate.job_reference || '',
      prepress_remark: r.prepress_remark || candidate.prepress_remark || candidate.prepress_remarks || '',
      woList: (woListMap[key] || []).join(', '),
      accountsStatus: accountsStatus,
      businessStatus: businessStatus,
      artworkStatus: artworkStatus,
      approvalStage: approvalStage,
      canCreateWo: canCreateWo
    };

    row.artSheetLength = art.sheet_length == null ? '' : Number(art.sheet_length);
    row.artSheetWidth = art.sheet_width == null ? '' : Number(art.sheet_width);
    row.artSheetUps = art.sheet_ups == null ? '' : Number(art.sheet_ups);
    row.artPrintingColors = art.printing_colors || '';
    row.artAcrossUps = art.across_ups == null ? '' : Number(art.across_ups);
    row.artAlongUps = art.along_ups == null ? '' : Number(art.along_ups);
    row.artTotalUps = art.total_ups == null ? '' : Number(art.total_ups);
    row.artAcrossWidth = art.across_width == null ? '' : Number(art.across_width);
    row.artTeeth = art.teeth == null ? '' : Number(art.teeth);
    row.artAcrossGapMm = art.across_gap_mm == null ? '' : Number(art.across_gap_mm);
    row.artAlongGapMm = art.along_gap_mm == null ? '' : Number(art.along_gap_mm);
    row.artStatus = art.status || '';
    row.artApprovedAt = art.approved_at || null;

    if (_isFlexoWorkOrderItem_(row)) return;
    if (row.remainingQty > 0) pending.push(row);
    if (row.processedQty > 0) {
      processed.push(Object.assign({}, row, { qty: row.processedQty }));
    }
  });

  return {
    pending: pending,
    processed: processed,
    hasMore: rawApprovalRows.length >= pageLimit
  };
}

function _listSOWithStatusHybrid_(limit = 200, offset = 0) {
  const pageLimit = Math.max(1, Number(limit || 0) || 200);
  const pageOffset = Math.max(0, Number(offset || 0) || 0);
  const rawApprovalRows = supabaseSelect(
    'v_sales_order_lines_for_approval',
    {
      select: `
        so_number,
        so_date,
        so_created_at:created_at,
        line_no,
        sales_rep,
        client_name,
        product_name,
        category,
        qty,
        accounts_status,
        business_status
      `,
      order: 'so_number.desc,line_no.asc',
      limit: pageLimit,
      offset: pageOffset
    }
  ) || [];
  const approvalRows = _excludeFlexoWorkOrderItems_(_filterSalesServiceOnlyItems_(_excludeClosedSalesOrderLines_(_excludeCancelledSalesOrdersByNumber_(rawApprovalRows, 'so_number'), 'so_number', 'line_no')));

  if (!approvalRows.length) {
    if (rawApprovalRows.length >= pageLimit) {
      return { pending: [], processed: [], hasMore: true };
    }
    return _listSOWithStatusFromCandidateView_(limit, offset);
  }

  const pageKeys = {};
  const soNumbers = [...new Set(approvalRows.map(function(r) {
    const key = String(r.so_number || '') + '||' + String(r.line_no || '');
    if (key !== '||') pageKeys[key] = true;
    return r.so_number;
  }).filter(Boolean))];

  const candidateMap = {};
  try {
    _fetchWOCandidateRowsBySoNumbers_(soNumbers).forEach(function(row) {
      const key = String(row.so_number || '') + '||' + String(row.line_no || '');
      if (pageKeys[key]) candidateMap[key] = row;
    });
  } catch (e) {
    Logger.log('WO candidate enrichment unavailable: ' + e.message);
  }

  const missing = approvalRows.filter(function(row) {
    const key = String(row.so_number || '') + '||' + String(row.line_no || '');
    return !candidateMap[key];
  });

  if (!missing.length) {
    const pending = [];
    const processed = [];
    approvalRows.forEach(function(baseRow) {
      const key = String(baseRow.so_number || '') + '||' + String(baseRow.line_no || '');
      const merged = Object.assign({}, candidateMap[key] || {});
      if (!merged.so_number) merged.so_number = baseRow.so_number || '';
      if (!merged.so_date) merged.so_date = baseRow.so_date || '';
      if (!merged.so_time) merged.so_time = baseRow.so_time || '';
      if (!merged.sales_rep) merged.sales_rep = baseRow.sales_rep || '';
      if (!merged.client_name) merged.client_name = baseRow.client_name || '';
      if (!merged.line_no) merged.line_no = baseRow.line_no || '';
      if (!merged.product_name) merged.product_name = baseRow.product_name || '';
      if (!merged.category) merged.category = baseRow.category || '';
      if (merged.qty == null || merged.qty === '') merged.qty = baseRow.qty || 0;
      if (!merged.accounts_status) merged.accounts_status = baseRow.accounts_status || '';
      if (!merged.business_status) merged.business_status = baseRow.business_status || '';

      const row = _mapWOCandidateViewRow_(merged);
      if (_isFlexoWorkOrderItem_(row)) return;
      if (row.remainingQty > 0) pending.push(row);
      if (row.processedQty > 0) processed.push(Object.assign({}, row, { qty: row.processedQty }));
    });
    return {
      pending: pending,
      processed: processed,
      hasMore: rawApprovalRows.length >= pageLimit
    };
  }

  return _listSOWithStatusLegacy_(limit, offset, candidateMap);
}

function listSOWithStatus(limit = 200, offset = 0) {
  try {
    return _listSOWithStatusHybrid_(limit, offset);
  } catch (e) {
    Logger.log('WO queue hybrid loader unavailable, falling back to legacy loader: ' + e.message);
    try {
      return _listSOWithStatusLegacy_(limit, offset);
    } catch (legacyErr) {
      Logger.log('WO queue legacy loader unavailable, falling back to candidate view: ' + legacyErr.message);
      return _listSOWithStatusFromCandidateView_(limit, offset);
    }
  }
}

function _flexoWOViewNumber_(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function _flexoWOViewOptionalNumber_(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? n : '';
}

function _flexoWOViewBool_(value) {
  if (value === true) return true;
  if (value === false) return false;
  return String(value || '').trim().toLowerCase() === 'true';
}

function _flexoWODateSortValue_(dateText, timeText, combinedText) {
  const candidates = [
    combinedText,
    [dateText, timeText].filter(Boolean).join('T'),
    [dateText, timeText].filter(Boolean).join(' '),
    dateText
  ];
  for (let i = 0; i < candidates.length; i++) {
    const raw = String(candidates[i] || '').trim();
    if (!raw) continue;
    const normalized = raw.indexOf(' ') !== -1 && raw.indexOf('T') === -1 ? raw.replace(' ', 'T') : raw;
    const ms = Date.parse(normalized);
    if (!isNaN(ms)) return ms;
  }
  return 0;
}

function _flexoWOPendingSort_(a, b) {
  const bTime = _flexoWODateSortValue_(b && b.soDate, b && b.soTime, b && b.soDateTime);
  const aTime = _flexoWODateSortValue_(a && a.soDate, a && a.soTime, a && a.soDateTime);
  if (bTime !== aTime) return bTime - aTime;
  return String(b && b.so || '').localeCompare(String(a && a.so || ''));
}

function _flexoWOProcessedSort_(a, b) {
  const bTime = _flexoWODateSortValue_(b && b.woDate, b && b.woTime, b && b.woDateTime);
  const aTime = _flexoWODateSortValue_(a && a.woDate, a && a.woTime, a && a.woDateTime);
  if (bTime !== aTime) return bTime - aTime;
  return String(b && (b.woNo || b.woList) || '').localeCompare(String(a && (a.woNo || a.woList) || ''));
}

function _flexoWOViewColumnMissing_(err) {
  const msg = String((err && err.message) || err || '').toLowerCase();
  return msg.indexOf('v_flexo_work_order_jobs.') !== -1 && msg.indexOf('does not exist') !== -1;
}

function _mapFlexoWOStatusViewRow_(r) {
  const orderQty = _flexoWOViewNumber_(r.order_qty == null ? r.qty : r.order_qty);
  const stockQtyToBill = Math.max(0, _flexoWOViewNumber_(r.stock_qty_to_bill));
  const originalQty = _flexoWOViewNumber_(r.qty == null ? _workOrderProductionQty_(orderQty, stockQtyToBill) : r.qty);
  const processedQty = Math.max(0, _flexoWOViewNumber_(r.processed_qty));
  const remainingQty = Math.max(0, _flexoWOViewNumber_(r.remaining_qty));
  const accountsStatus = String(r.accounts_status || '').trim().toUpperCase() || 'PENDING';
  const businessStatus = String(r.business_status || '').trim().toUpperCase() || 'PENDING';
  const artworkStatus = String(r.artwork_status || r.status || '').trim().toUpperCase() || 'NO_ART';

  return {
    so: r.so_number || '',
    lineNo: String(r.line_no || ''),
    jobCardNo: r.job_card_no || r.job_reference || '',
    division: r.division || '',
    classificationSource: r.classification_source || '',
    productCode: r.product_code || '',
    client: r.client_name || '',
    productName: r.product_name || '',
    artworkNo: r.artwork_no || '',
    qty: originalQty,
    orderQty: orderQty,
    stockQtyToBill: stockQtyToBill,
    remainingQty: remainingQty,
    processedQty: processedQty,
    unit: r.unit || '',
    category: r.category || '',
    productType: r.product_type || '',
    soDate: r.so_date || '',
    soTime: r.so_time || '',
    soDateTime: r.so_date_time || [r.so_date || '', r.so_time || ''].filter(Boolean).join(' '),
    salesRep: r.sales_rep || '',
    po_number: r.po_number || '',
    expected_delivery: r.expected_delivery || '',
    job_priority: r.job_priority || '',
    so_remarks: r.so_remarks || '',
    product_remarks: r.product_remarks || '',
    prepress_remark: r.prepress_remark || r.prepress_remarks || '',
    job_reference: r.job_reference || '',
    woList: r.wo_list || '',
    woNo: r.wo_no || '',
    woDate: r.wo_date || '',
    woTime: r.wo_time || '',
    woDateTime: r.wo_date_time || r.wo_date || '',
    lineStatus: r.line_status || '',
    isLineActive: r.is_line_active === false ? false : ['CLOSED','CANCELLED'].indexOf(String(r.line_status || '').trim().toUpperCase()) === -1,
    artSheetLength: _flexoWOViewOptionalNumber_(r.sheet_length),
    artSheetWidth: _flexoWOViewOptionalNumber_(r.sheet_width),
    artSheetUps: _flexoWOViewOptionalNumber_(r.sheet_ups),
    artPrintingColors: r.printing_colors || '',
    artAcrossUps: _flexoWOViewOptionalNumber_(r.across_ups),
    artAlongUps: _flexoWOViewOptionalNumber_(r.along_ups),
    artTotalUps: _flexoWOViewOptionalNumber_(r.total_ups),
    artAcrossWidth: _flexoWOViewOptionalNumber_(r.across_width),
    artAcrossGapMm: _flexoWOViewOptionalNumber_(r.across_gap_mm),
    artAlongGapMm: _flexoWOViewOptionalNumber_(r.along_gap_mm),
    artStatus: r.status || r.artwork_status || '',
    accountsStatus: accountsStatus,
    businessStatus: businessStatus,
    artworkStatus: artworkStatus,
    approvalStage: r.approval_stage || '',
    canCreateWo: _flexoWOViewBool_(r.can_create_wo),
    processedTeeth: r.processed_teeth == null ? '' : String(r.processed_teeth),
    processedUps: r.processed_ups == null ? '' : String(r.processed_ups),
    processedItemDetails: r.processed_item_details || '',
    artApprovedAt: r.approved_at || null,
    artTeeth: r.teeth == null ? '' : String(r.teeth)
  };
}

function _listFlexoWOStatusFromDedicatedView_(limit, offset) {
  const pageLimit = Math.min(1000, Math.max(Number(limit || 200), 1));
  const rows = supabaseSelect('v_flexo_work_order_jobs', {
    select: [
      'so_number','so_date','so_time','so_date_time','sales_rep','line_no','job_card_no',
      'division','classification_source','product_code','client_name','product_name','category',
      'product_type','qty','order_qty','stock_qty_to_bill','remaining_qty','processed_qty',
      'unit','artwork_no','sheet_length','sheet_width','sheet_ups','printing_colors',
      'across_ups','along_ups','total_ups','across_width','across_gap_mm','along_gap_mm',
      'teeth','status','artwork_status','approved_at','accounts_status','business_status',
      'can_create_wo','approval_stage','wo_list','wo_no','processed_teeth','processed_ups',
      'processed_item_details','po_number','expected_delivery','job_priority','so_remarks',
      'product_remarks','prepress_remark','prepress_remarks','job_reference','wo_date',
      'wo_time','wo_date_time','line_status','is_line_active'
    ].join(','),
    order: 'so_date.desc,so_number.desc,line_no.asc',
    limit: pageLimit,
    offset: offset || 0
  }) || [];

  const data = { pending: [], processed: [], hasMore: rows.length === pageLimit };
  rows.forEach(function(r) {
    const row = _mapFlexoWOStatusViewRow_(r);
    if (row.remainingQty > 0 && row.isLineActive !== false) data.pending.push(row);
    if (row.processedQty > 0) {
      data.processed.push(Object.assign({}, row, {
        qty: row.processedQty,
        woNo: row.woNo || String(row.woList || '').split(',')[0].trim()
      }));
    }
  });
  data.pending.sort(_flexoWOPendingSort_);
  data.processed.sort(_flexoWOProcessedSort_);
  return data;
}

function listFlexoWOStatus(limit = 200, offset = 0) {
  const cache = CacheService.getScriptCache();
  const artworkVersion = PropertiesService.getScriptProperties().getProperty('ARTWORK_WORKBENCH_VERSION') || '0';
  const cacheKey = 'FLEXO_WO_STATUS_' + artworkVersion + '_' + String(limit) + '_' + String(offset);
  try {
    const cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (e) {}

  try {
    const fastData = _listFlexoWOStatusFromDedicatedView_(limit, offset);
    try { cache.put(cacheKey, JSON.stringify(fastData), 45); } catch (cacheErr) {}
    return fastData;
  } catch (viewErr) {
    if (!_supabaseRelationMissing_(viewErr, 'v_flexo_work_order_jobs') && !_flexoWOViewColumnMissing_(viewErr)) throw viewErr;
    Logger.log('Flexo WO dedicated view unavailable; falling back to artwork job loader: ' + viewErr.message);
  }

  const queryLimit = Math.min(1000, Math.max(Number(limit || 200) * 3, 500));
  const artworkRows = _filterSalesServiceOnlyItems_(_excludeCancelledSalesOrdersByNumber_(selectArtworkJobsActiveView_({
    select: 'so_number,so_date,so_time,sales_rep,line_no,client_name,product_name,category,division,qty,unit,artwork_no,product_type,sheet_length,sheet_width,sheet_ups,printing_colors,across_ups,along_ups,total_ups,across_width,across_gap_mm,along_gap_mm,stock_qty_to_bill,status,approved_at,accounts_status,business_status',
    order: 'so_date.asc,so_number.asc,line_no.asc',
    limit: queryLimit,
    offset: offset
  }) || [], 'so_number'));

  if (!artworkRows.length) {
    const empty = { pending: [], processed: [], hasMore: false };
    try { cache.put(cacheKey, JSON.stringify(empty), 45); } catch (e) {}
    return empty;
  }

  const soNumbers = [...new Set(artworkRows.map(function(r) { return r.so_number; }).filter(Boolean))];
  const soIdToNo = {};
  const soNoToId = {};
  if (soNumbers.length) {
    _supabaseSelectByKeyInBatches_(
      'sales_orders',
      'id,so_number',
      'so_number',
      soNumbers
    ).forEach(function(so) {
      const soNo = String(so.so_number || '').trim();
      const soId = String(so.id || '').trim();
      if (!soNo || !soId) return;
      soIdToNo[soId] = soNo;
      soNoToId[soNo] = soId;
    });
  }

  const lineMetaMap = {};
  const soIds = Object.keys(soIdToNo);
  if (soIds.length) {
    _supabaseSelectByKeyInBatches_(
      'sales_order_lines',
      'so_id,line_no,job_reference,division,status',
      'so_id',
      soIds
    ).forEach(function(line) {
      const soNo = soIdToNo[String(line.so_id || '').trim()] || '';
      const lineNo = String(line.line_no || '').trim();
      if (!soNo || !lineNo) return;
      lineMetaMap[soNo + '||' + lineNo] = {
        jobReference: String(line.job_reference || '').trim(),
        division: String(line.division || '').trim(),
        status: String(line.status || 'OPEN').trim().toUpperCase()
      };
    });
  }

  const isFlexoType = function(value) {
    return String(_artworkNormalizeProductType_(value) || '').trim().toUpperCase() === 'FLEXO';
  };
  const keysSeen = {};
  const rows = artworkRows.filter(function(r) {
    const key = String(r.so_number || '') + '||' + String(r.line_no || '');
    if (!String(r.so_number || '').trim() || !String(r.line_no || '').trim()) return false;
    if (keysSeen[key]) return false;

    const division = String(r.division || '').trim() || ((lineMetaMap[key] && lineMetaMap[key].division) || '');
    const artworkType = _artworkNormalizeProductType_(r.product_type || '');
    const artworkAssigned = !!String(r.artwork_no || '').trim();
    const status = String(r.status || '').trim().toUpperCase();
    const artworkTypeHasKnownDivision = ['FLEXO','OFFSET','DIGITAL','CORRUGATION'].indexOf(String(artworkType || '').toUpperCase()) !== -1;

    // Flexo WO list source rule:
    // - once artwork has an explicit known product type, that product type is the source of truth
    // - before artwork classification/approval is finalized, SO division keeps the line visible in the correct WO module
    const include = artworkTypeHasKnownDivision
      ? isFlexoType(artworkType)
      : (isFlexoType(division) || (!artworkAssigned && isFlexoType(r.category)));
    if (!include) return false;

    keysSeen[key] = true;
    r._so_division = division;
    r._effective_product_type = artworkTypeHasKnownDivision ? artworkType : _artworkNormalizeProductType_(division || r.category || r.product_type || '');
    r._classification_source = artworkTypeHasKnownDivision ? 'Artwork Product Type' : 'Sales Order Division';
    return true;
  });

  const workOrderJobs = soNumbers.length
    ? _supabaseSelectByKeyInBatches_(
        'work_order_jobs',
        'wo_id,so_number,line_no,qty',
        'so_number',
        soNumbers,
        'so_number.asc,line_no.asc'
      )
    : [];

  const processedQtyMap = {};
  const woIds = [...new Set(workOrderJobs.map(function(j) { return j.wo_id; }).filter(Boolean))];
  const woNoMap = {};
  const woMetaMap = {};
  const firstWoIdByKey = {};

  if (woIds.length) {
    _supabaseSelectByKeyInBatches_(
      'work_orders',
      'id,wo_number,wo_date,snapshot_json',
      'id',
      woIds
    ).forEach(function(w) {
      const type = String(w?.snapshot_json?.jobDetails?.type || '').trim().toUpperCase();
      if (type && type !== 'FLEXO') return;
      woNoMap[w.id] = w.wo_number || '';
      const fx = (w && w.snapshot_json && w.snapshot_json.flexoDetails) || {};
      woMetaMap[w.id] = {
        teeth: fx.cylinderTeeth == null ? '' : String(fx.cylinderTeeth),
        ups: fx.totalUps == null ? '' : String(fx.totalUps),
        itemDetails: [String(fx.itemCode || '').trim(), String(fx.itemName || '').trim()].filter(Boolean).join(' - '),
        woDate: w.wo_date || ''
      };
    });
  }

  const woListMap = {};
  workOrderJobs.forEach(function(j) {
    const woNo = woNoMap[j.wo_id] || '';
    if (!woNo) return;
    const key = String(j.so_number || '') + '||' + String(j.line_no || '');
    processedQtyMap[key] = (processedQtyMap[key] || 0) + (Number(j.qty) || 0);
    if (!firstWoIdByKey[key]) firstWoIdByKey[key] = j.wo_id || '';
    if (!woListMap[key]) woListMap[key] = [];
    if (woListMap[key].indexOf(woNo) === -1) woListMap[key].push(woNo);
  });

  const data = { pending: [], processed: [], hasMore: artworkRows.length === queryLimit };
  rows.forEach(function(r) {
    const key = String(r.so_number || '') + '||' + String(r.line_no || '');
    const orderQty = Number(r.qty) || 0;
    const stockQtyToBill = Math.max(0, Number(r.stock_qty_to_bill || 0) || 0);
    const originalQty = _workOrderProductionQty_(orderQty, stockQtyToBill);
    const processedQty = Number(processedQtyMap[key] || 0);
    const lineStatus = ((lineMetaMap[key] && lineMetaMap[key].status) || 'OPEN').toUpperCase();
    const isLineActive = ['CLOSED','CANCELLED'].indexOf(lineStatus) === -1;
    const remainingQty = isLineActive ? Math.max(0, originalQty - processedQty) : 0;
    const accountsStatus = String(r.accounts_status || '').trim().toUpperCase() || 'PENDING';
    const businessStatus = String(r.business_status || '').trim().toUpperCase() || 'PENDING';
    const artworkStatus = String(r.status || '').trim().toUpperCase() || 'NO_ART';
    const rejectedStages = [];
    const pendingStages = [];

    if (accountsStatus === 'REJECTED') rejectedStages.push('Accounts');
    else if (accountsStatus !== 'APPROVED') pendingStages.push('Accounts');

    if (businessStatus === 'REJECTED') rejectedStages.push('Business');
    else if (businessStatus !== 'APPROVED') pendingStages.push('Business');

    if (artworkStatus === 'REJECTED') rejectedStages.push('Artwork');
    else if (artworkStatus !== 'APPROVED') pendingStages.push('Artwork');

    const canCreateWo = !rejectedStages.length && !pendingStages.length;
    const approvalStage = rejectedStages.length
      ? ('Rejected at ' + rejectedStages.join(' / '))
      : (pendingStages.length ? ('Pending at ' + pendingStages.join(' / ')) : 'Approved');
    const firstWoMeta = woMetaMap[firstWoIdByKey[key]] || {};

    const row = {
      so: r.so_number || '',
      lineNo: String(r.line_no || ''),
      jobCardNo: (lineMetaMap[key] && lineMetaMap[key].jobReference) || '',
      division: r._so_division || '',
      classificationSource: r._classification_source || '',
      productCode: '',
      client: r.client_name || '',
      productName: r.product_name || '',
      artworkNo: r.artwork_no || '',
      qty: originalQty,
      orderQty: orderQty,
      stockQtyToBill: stockQtyToBill,
      remainingQty: remainingQty,
      processedQty: processedQty,
      unit: r.unit || '',
      category: r.category || '',
      productType: r._effective_product_type || r.product_type || '',
      soDate: r.so_date || '',
      soTime: r.so_time || '',
      soDateTime: [r.so_date || '', r.so_time || ''].filter(Boolean).join(' '),
      salesRep: r.sales_rep || '',
      po_number: '',
      expected_delivery: '',
      job_priority: '',
      so_remarks: '',
      product_remarks: '',
      job_reference: '',
      woList: (woListMap[key] || []).join(', '),
      woDate: firstWoMeta.woDate || '',
      woTime: '',
      woDateTime: firstWoMeta.woDate || '',
      lineStatus: lineStatus,
      isLineActive: isLineActive,
      artSheetLength: r.sheet_length == null ? '' : Number(r.sheet_length),
      artSheetWidth: r.sheet_width == null ? '' : Number(r.sheet_width),
      artSheetUps: r.sheet_ups == null ? '' : Number(r.sheet_ups),
      artPrintingColors: r.printing_colors || '',
      artAcrossUps: r.across_ups == null ? '' : Number(r.across_ups),
      artAlongUps: r.along_ups == null ? '' : Number(r.along_ups),
      artTotalUps: r.total_ups == null ? '' : Number(r.total_ups),
      artAcrossWidth: r.across_width == null ? '' : Number(r.across_width),
      artAcrossGapMm: r.across_gap_mm == null ? '' : Number(r.across_gap_mm),
      artAlongGapMm: r.along_gap_mm == null ? '' : Number(r.along_gap_mm),
      artStatus: r.status || '',
      accountsStatus: accountsStatus,
      businessStatus: businessStatus,
      artworkStatus: artworkStatus,
      approvalStage: approvalStage,
      canCreateWo: canCreateWo,
      processedTeeth: firstWoMeta.teeth || '',
      processedUps: firstWoMeta.ups || '',
      processedItemDetails: firstWoMeta.itemDetails || '',
      artApprovedAt: r.approved_at || null,
      artTeeth: ''
    };

    if (row.remainingQty > 0 && row.isLineActive !== false) data.pending.push(row);
    if (row.processedQty > 0) {
      data.processed.push(Object.assign({}, row, {
        qty: row.processedQty,
        woNo: (woListMap[key] || [])[0] || ''
      }));
    }
  });
  data.pending.sort(_flexoWOPendingSort_);
  data.processed.sort(_flexoWOProcessedSort_);

  try { cache.put(cacheKey, JSON.stringify(data), 45); } catch (e) {}
  return data;
}

/* =========================
   Work Order: save/get/export
   ========================= */
function saveWorkOrder(payload, options) {

  if (!payload?.jobs?.length) {
    throw new Error('No jobs to save.');
  }
  const saveOpts = options || {};

  const now = new Date().toISOString();
  const user = Session.getActiveUser?.().getEmail?.() || 'user';
  const requestedWoNo = String(payload.woNo || '').trim();
  const woNo = requestedWoNo || generateWorkOrderNumber();

  /* =========================
     0️⃣ Check Duplicate WO
  ========================= */

  const existing = supabaseSelect('work_orders', {
    select: 'id,wo_number',
    filters: { wo_number: 'eq.' + woNo },
    limit: 1
  });

  const isUpdate = !!(requestedWoNo && existing.length);
  let wo = null;
  let previousSoNumbers = [];

  /* =========================
     1️⃣ Insert Header
  ========================= */

  if (isUpdate) {
    wo = existing[0];

    const existingJobs = supabaseSelect('work_order_jobs', {
      select: 'so_number',
      filters: { wo_id: 'eq.' + wo.id }
    }) || [];

    previousSoNumbers = [...new Set(existingJobs.map(j => j.so_number).filter(Boolean))];

    _deleteInventoryReservationsForWO_(woNo);
    supabaseDelete('work_order_routing', { wo_id: 'eq.' + wo.id });
    supabaseDelete('work_order_materials', { wo_id: 'eq.' + wo.id });
    supabaseDelete('work_order_jobs', { wo_id: 'eq.' + wo.id });

    supabaseUpdateMinimal('work_orders', { id: 'eq.' + wo.id }, {
      status: payload.status || 'Pending',
      snapshot_json: payload
    });
  } else {
    supabaseInsertMinimal('work_orders', {
      wo_number: woNo,
      wo_date: now,
      status: payload.status || 'Pending',
      created_by: user,
      snapshot_json: payload
    });

    wo = (supabaseSelect('work_orders', {
      select: 'id,wo_number',
      filters: { wo_number: 'eq.' + woNo },
      limit: 1
    }) || [])[0];

    if (!wo?.id) {
      throw new Error('Failed to insert work order header');
    }
  }

  /* =========================
     2️⃣ Insert Jobs
  ========================= */

  const jobRows = payload.jobs.map(j => ({
    wo_id: wo.id,
    so_number: j.so,
    line_no: j.lineNo,
    product_name: j.productName,
    qty: Number(j.qty) || 0,
    unit: j.unit || '',
    ups: Number(j.ups) || 0,
    group_ups: Number(payload.jobDetails?.ups || 0),
    category: j.category || '',
    sales_rep: j.salesRep || '',
    so_date: j.soDate || null,
    artwork_no: j.artworkNo || '',
    client_name: j.client || '',
    expected_delivery: j.expected_delivery || null,
    po_number: j.po_number || '',
    job_priority: j.job_priority || '',
    product_remarks: j.product_remarks || '',
    so_remarks: j.so_remarks || '',
    job_reference: j.job_reference || '',
    prepress_remark: j.prepress_remark || ''
  }));

  if (jobRows.length) {
    supabaseBulkInsertMinimal('work_order_jobs', jobRows);
  }

  /* =========================
     3️⃣ Insert Materials
  ========================= */

  const papers = payload.papers || [];
  const corrugation = payload.corrugation || [];
  const extraMaterials = payload.extraMaterials || [];
  const isFlexoWO = String(payload?.jobDetails?.type || '').trim().toUpperCase() === 'FLEXO';

  const materialRows = [];

  // 🔥 Batch fetch item master once
  const allLabels = [
    ...papers.map(p => p.stock || ''),
    ...corrugation.map(c => c.itemDetails || '')
  ].filter(Boolean);

  const uniqueLabels = [...new Set(allLabels)];
  let itemMap = {};

  if (uniqueLabels.length) {
    const items = supabaseSelect('inv_items', {
      filters: {
        item_name: 'in.(' + uniqueLabels.join(',') + ')'
      }
    }) || [];

    items.forEach(i => {
      itemMap[i.item_name] = i;
    });
  }

function pushMaterial(m, type) {

  const materialUom =
    type === 'CORRUGATION'
      ? (isFlexoWO ? 'RM' : 'KG')
      : 'SHEET';

  const requiredQty =
    type === 'CORRUGATION'
      ? Number(m.requiredQty || m.runningMeter || m.runningMeters || m.rm || m.weightKg || 0)
      : Number(m.requiredQty || 0);

  if (!requiredQty || requiredQty <= 0) return;

  const label =
    type === 'CORRUGATION'
      ? m.itemDetails || m.itemLabel || ''
      : m.itemLabel || '';

  const item = itemMap[label] || null;

    materialRows.push({
      wo_id: wo.id,

      required_qty: requiredQty,

      material_key: normalizeWOMaterialKey_(
        label,
        m.gsm || '',
        m.deckle || 0,
        m.cut_size || m.cutSize || 0,
        materialUom
      ),

      uom: materialUom,

      gsm: m.gsm || '',
      deckle: m.deckle || 0,
      cut_size: m.cut_size || m.cutSize || 0,
      sheets: m.sheets || 0,

    item_id: item?.id || null,
    item_code: item?.item_code || '',
    item_name: item?.item_name || label,

    material_type: type
  });

}

  papers.forEach(p => pushMaterial(p, 'PAPER'));
  corrugation.forEach(c => pushMaterial(c, 'CORRUGATION'));
  extraMaterials.forEach(function(m) {
    const requiredQty = Number(m.requiredQty || m.qtyPerUnit || 0);
    if (!requiredQty || requiredQty <= 0) return;

    const label = String(m.materialName || m.itemLabel || m.materialItemCode || '').trim();

    materialRows.push({
      wo_id: wo.id,
      required_qty: requiredQty,
      material_key: normalizeWOMaterialKey_(
        m.materialItemCode || label,
        m.gsm || '',
        0,
        0,
        m.uom || 'NOS'
      ),
      uom: m.uom || 'NOS',
      gsm: m.gsm || '',
      deckle: 0,
      cut_size: 0,
      sheets: 0,
      item_id: null,
      item_code: m.materialItemCode || '',
      item_name: label,
      material_type: m.materialType || 'RAW_MATERIAL'
    });
  });

  const mergedMaterialRows = [];
  const materialMap = {};

  materialRows.forEach(m => {
    const key = String(m.material_key || '');
    if (!key) return;

    if (!materialMap[key]) {
      materialMap[key] = Object.assign({}, m);
      mergedMaterialRows.push(materialMap[key]);
      return;
    }

    materialMap[key].required_qty =
      Number(materialMap[key].required_qty || 0) +
      Number(m.required_qty || 0);

    materialMap[key].sheets =
      Number(materialMap[key].sheets || 0) +
      Number(m.sheets || 0);
  });

  if (mergedMaterialRows.length) {
    supabaseBulkInsertMinimal('work_order_materials', mergedMaterialRows);
    mergedMaterialRows.forEach(m => _insertInventoryReservationForWO_(woNo, m));
  }

  /* =========================
     4️⃣ Insert Routing
  ========================= */

  const routingRows = [];
  const routing = payload.routing || [];

  routing.forEach((r, index) => {

    if (!r.dept) return;

    routingRows.push({
      wo_id: wo.id,
      so_number: '',   // combined WO
      line_no: '',
      process_name: r.operation || r.dept,
      sequence_no: index + 1,
      department: r.dept || '',
      planned_machine: r.machine || '',
      planned_qty: 0,
      completed_qty: 0,
      status: 'PENDING'
    });

  });

  if (routingRows.length) {
    supabaseBulkInsertMinimal('work_order_routing', routingRows);
  }

  const touchedSoNumbers = [
    ...new Set(
      payload.jobs.map(function(j) { return String(j.so || '').trim(); })
        .concat(previousSoNumbers.map(function(soNumber) { return String(soNumber || '').trim(); }))
        .filter(Boolean)
    )
  ];

  if (!saveOpts.skipSoStatusRefresh) {
    refreshWorkOrderStatuses(touchedSoNumbers);
  }


  return { ok: true, woNo, soNumbers: touchedSoNumbers };
}
function getWorkOrder(woNo) {

  const wo = supabaseSelect('work_orders', {
    select: `id, wo_number, status, snapshot_json`,
    filters: { wo_number: 'eq.' + woNo },
    limit: 1
  })[0];

  if (!wo) return null;

  const snap = wo.snapshot_json || {};
  const workOrderJobRows = supabaseSelect('work_order_jobs', {
    select: 'so_number,line_no,product_name,qty,unit,ups,group_ups,category,sales_rep,so_date,artwork_no,client_name,expected_delivery,po_number,job_priority,product_remarks,so_remarks,job_reference,prepress_remark',
    filters: { wo_id: 'eq.' + wo.id },
    order: 'line_no.asc'
  }) || [];

  const snapJobs = Array.isArray(snap.jobs) ? snap.jobs : [];
  const jobSourceRows = snapJobs.length ? snapJobs : workOrderJobRows;
  const jobDbMap = {};
  workOrderJobRows.forEach(function(row) {
    const key = String(row.so_number || '').trim() + '||' + String(row.line_no || '').trim();
    if (key !== '||' && !jobDbMap[key]) jobDbMap[key] = row;
  });

  const soNumbers = [...new Set(jobSourceRows.map(function(row) {
    return String(row.so || row.so_number || '').trim();
  }).filter(Boolean))];

  const soHeaders = soNumbers.length ? (supabaseSelect('sales_orders', {
    select: 'id,so_number,so_date,sales_rep,po_number',
    filters: { so_number: 'in.(' + soNumbers.join(',') + ')' }
  }) || []) : [];
  const soHeaderMap = {};
  const soIdToNo = {};
  soHeaders.forEach(function(row) {
    const soNo = String(row.so_number || '').trim();
    if (!soNo) return;
    soHeaderMap[soNo] = row;
    if (row.id != null) soIdToNo[String(row.id)] = soNo;
  });

  const soIds = Object.keys(soIdToNo);
  const soLineMap = {};
  if (soIds.length) {
    (supabaseSelect('sales_order_lines', {
      select: 'so_id,line_no,product_code,product_name,expected_delivery,job_priority,product_remarks,prepress_remarks,job_reference',
      filters: { so_id: 'in.(' + soIds.join(',') + ')' }
    }) || []).forEach(function(row) {
      const soNo = soIdToNo[String(row.so_id)] || '';
      const key = soNo + '||' + String(row.line_no || '').trim();
      if (key !== '||') soLineMap[key] = row;
    });
  }

  function pickMostCompleteText() {
    const values = Array.prototype.slice.call(arguments)
      .map(function(value) { return String(value || '').trim(); })
      .filter(Boolean);
    if (!values.length) return '';
    let picked = values[0];
    values.slice(1).forEach(function(candidate) {
      const pickedNorm = picked.replace(/\s+/g, ' ').trim().toUpperCase();
      const candidateNorm = candidate.replace(/\s+/g, ' ').trim().toUpperCase();
      if (!pickedNorm) {
        picked = candidate;
        return;
      }
      if (candidateNorm && candidateNorm.length > pickedNorm.length && candidateNorm.indexOf(pickedNorm) !== -1) {
        picked = candidate;
      }
    });
    return picked;
  }

  const jobsNormalized = jobSourceRows.map(function(row, index) {
    const soNo = String(row.so || row.so_number || '').trim();
    const lineNo = String(row.lineNo || row.line_no || '').trim();
    const key = soNo + '||' + lineNo;
    const dbRow = jobDbMap[key] || workOrderJobRows[index] || {};
    const soHeader = soHeaderMap[soNo] || {};
    const soLine = soLineMap[key] || {};

    return {
      so: soNo,
      lineNo: lineNo,
      productCode: row.productCode || row.product_code || soLine.product_code || '',
      salesRep: row.salesRep || row.sales_rep || dbRow.sales_rep || soHeader.sales_rep || '',
      soDate: row.soDate || row.so_date || dbRow.so_date || soHeader.so_date || '',
      client: row.client || row.client_name || dbRow.client_name || '',
      productName: pickMostCompleteText(row.productName, row.product_name, dbRow.product_name, soLine.product_name),
      qty: Number(row.qty || dbRow.qty || 0),
      unit: row.unit || dbRow.unit || '',
      ups: Number(row.ups || dbRow.ups || 0),
      coreSheets: Number(row.coreSheets || row.core_sheets || 0),
      sheetsWithWaste: Number(row.sheetsWithWaste || row.sheets_with_waste || 0),
      artworkNo: row.artworkNo || row.artwork_no || dbRow.artwork_no || '',
      po_number: row.po_number || dbRow.po_number || soHeader.po_number || '',
      expected_delivery: row.expected_delivery || dbRow.expected_delivery || soLine.expected_delivery || '',
      job_priority: row.job_priority || dbRow.job_priority || soLine.job_priority || '',
      so_remarks: row.so_remarks || dbRow.so_remarks || '',
      product_remarks: row.product_remarks || dbRow.product_remarks || soLine.product_remarks || '',
      job_reference: row.job_reference || dbRow.job_reference || soLine.job_reference || '',
      prepress_remark: row.prepress_remark || dbRow.prepress_remark || soLine.prepress_remarks || '',
      category: row.category || dbRow.category || '',
      groupUps: Number(row.groupUps || row.group_ups || dbRow.group_ups || 0)
    };
  });

  // ROUTING
  const routingRows = supabaseSelect('work_order_routing', {
    filters: { wo_id: 'eq.' + wo.id },
    order: 'sequence_no.asc'
  }) || [];

  const snapRouting = Array.isArray(snap.routing) ? snap.routing : [];
  const routingSourceRows = (snapRouting.length ? snapRouting : routingRows).map((r, index) => ({ row: r, index: index }));
  function getRoutingRouteInfo_(r, index) {
    const dbRow = routingRows[index] || {};
    const rawDept = r.dept || r.department || dbRow.department || '';
    const rawOperation = r.operation || r.process_name || dbRow.process_name || '';
    const isDigitalRoute = String((rawDept || '') + ' ' + (rawOperation || '')).trim().toUpperCase() === 'DIGITAL' ||
      String(rawDept || '').trim().toUpperCase() === 'DIGITAL' ||
      String(rawOperation || '').trim().toUpperCase() === 'DIGITAL';
    const isPrintingRoute = String(rawDept || '').trim().toUpperCase() === 'PRINTING' ||
      String(rawOperation || '').trim().toUpperCase() === 'PRINTING';
    return { dbRow: dbRow, rawDept: rawDept, rawOperation: rawOperation, isDigitalRoute: isDigitalRoute, isPrintingRoute: isPrintingRoute };
  }
  const hasDigitalRouting = routingSourceRows.some(function(item) {
    return getRoutingRouteInfo_(item.row, item.index).isDigitalRoute;
  });
  const hasPrintingRouting = routingSourceRows.some(function(item) {
    return getRoutingRouteInfo_(item.row, item.index).isPrintingRoute;
  });
  const routingNormalized = routingSourceRows.filter(function(item) {
    const info = getRoutingRouteInfo_(item.row, item.index);
    return !(hasDigitalRouting && hasPrintingRouting && info.isPrintingRoute && !info.isDigitalRoute);
  }).map(function(item) {
    const r = item.row;
    const info = getRoutingRouteInfo_(r, item.index);
    const machine = r.machine || r.planned_machine || info.dbRow.planned_machine || '';
    return {
      dept: info.isDigitalRoute ? 'Printing' : info.rawDept,
      machine: info.isDigitalRoute ? 'Canon Digital Printing' : machine,
      material: r.material || '',
      out: r.out || '',
      operation: info.isDigitalRoute ? 'Printing' : info.rawOperation,
      onlineProcesses: r.onlineProcesses || ''
    };
  });

  // PAPERS
  const papersNormalized = (snap.papers || []).map(p => {
    const hasSheetsManualFlag = Object.prototype.hasOwnProperty.call(p, 'sheetsManual') ||
      Object.prototype.hasOwnProperty.call(p, 'sheets_manual');
    const hasWasteManualFlag = Object.prototype.hasOwnProperty.call(p, 'wasteManual') ||
      Object.prototype.hasOwnProperty.call(p, 'waste_manual');
    return {
      stock: p.itemLabel || p.stock || '',
      gsm: p.gsm || '',
      deckle: p.deckle || 0,
      cutSize: p.cut_size || p.cutSize || 0,
      coreSheets: p.sheets || p.coreSheets || 0,
      wasteSheets: p.wasteSheets || p.waste_sheets || Math.max(Number(p.requiredQty || p.sheetsWithWaste || 0) - Number(p.sheets || p.coreSheets || 0), 0),
      sheetsWithWaste: p.requiredQty || p.sheetsWithWaste || 0,
      sheetsManual: hasSheetsManualFlag
        ? (p.sheetsManual === true || p.sheets_manual === true)
        : Number(p.sheets || p.coreSheets || 0) > 0,
      wasteManual: hasWasteManualFlag
        ? (p.wasteManual === true || p.waste_manual === true)
        : Number(p.wasteSheets || p.waste_sheets || 0) > 0
    };
  });

  // CORRUGATION
const corrugNormalized = (snap.corrugation || []).map((c, i) => ({
  plyNo: c.plyNo || (i + 1),
  hasFlute: !!String(c.flute || '').trim(),

  itemDetails:
      c.itemDetails ||
      c.item_name ||
      c.itemLabel ||
      '',

  flute: c.flute || '',
  gsm: c.gsm || '',

  deckle: c.deckle || 0,

  cutSize:
      c.cutSize ||
      c.cut_size ||
      0,

  weightKg:
      c.weightKg ||
      c.requiredQty ||
      0,

  sheets: c.sheets || 0
}));

  return {
    woNo: wo.wo_number,
    status: wo.status || 'Pending',
    jobs: jobsNormalized,
    jobDetails: snap.jobDetails || {},
    flexoDetails: snap.flexoDetails || {},
    bomReference: snap.bomReference || null,
    extraMaterials: snap.extraMaterials || [],
    artworkRef: snap.artworkRef || {},
    papers: papersNormalized,
    corrugation: corrugNormalized,
    routing: routingNormalized,
    wastage: snap.wastage || {}
  };
}

function printWorkOrder(woNo) {

  const wo = getWorkOrder(woNo);

  if (!wo) {
    throw new Error('Work Order not found: ' + woNo);
  }

  const html = HtmlService.createTemplateFromFile('PrintWO');
  html.wo = wo;

  return html.evaluate()
    .setTitle('Print WO')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getFlexoWorkOrder(woNo) {
  const wo = getWorkOrder(woNo);
  if (!wo) return null;
  const snap = wo.jobDetails?.type === 'Flexo' ? wo : null;
  return snap;
}

function printFlexoWorkOrder(woNo) {
  const wo = getFlexoWorkOrder(woNo);
  if (!wo) {
    throw new Error('Flexo Work Order not found: ' + woNo);
  }

  const html = HtmlService.createTemplateFromFile('PrintFlexoWO');
  html.wo = wo;

  return html.evaluate()
    .setTitle('Print Flexo WO')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function _canViewSalesOrderPrint_(token) {
  const user = getSessionUser(token);
  if (!user) return false;
  if (String(user.role || '').toUpperCase() === 'ADMIN') return true;
  return ['SALES_ORDER_ENTRY', 'SALES_ORDER_APPROVAL', 'BILLING'].some(function(moduleCode) {
    try {
      return !!checkPermission(token, moduleCode, 'can_view');
    } catch (err) {
      return false;
    }
  });
}

function _salesOrderPickClientParty_(parties, addressType, clientRow, header) {
  const type = String(addressType || '').trim().toUpperCase();
  const list = (Array.isArray(parties) ? parties : []).filter(function(row) {
    return String(row.address_type || '').trim().toUpperCase() === type && row.active !== false;
  });
  const pick = list.find(function(row){ return row.is_default === true; }) || list[0] || null;
  if (pick) {
    return {
      label: pick.label || (type === 'SHIP_TO' ? 'Ship To' : 'Bill To'),
      name: pick.party_name || clientRow?.client_name || header?.client_name || '',
      address: [pick.address_line1, pick.address_line2, pick.city, pick.state, pick.pincode].filter(Boolean).join(', '),
      gstin: pick.gstin || clientRow?.gstin || '',
      state: pick.state || clientRow?.state || '',
      contactPerson: pick.contact_person || '',
      contactPhone: pick.contact_phone || ''
    };
  }

  const useShip = type === 'SHIP_TO';
  return {
    label: useShip ? 'Ship To' : 'Bill To',
    name: clientRow?.client_name || header?.client_name || '',
    address: _clientComposeAddress_(
      useShip ? (clientRow?.ship_to_address || clientRow?.bill_to_address || '') : (clientRow?.bill_to_address || clientRow?.ship_to_address || ''),
      useShip ? (clientRow?.ship_to_city || clientRow?.bill_to_city || '') : (clientRow?.bill_to_city || clientRow?.ship_to_city || ''),
      useShip ? (clientRow?.ship_to_state || clientRow?.state || '') : (clientRow?.bill_to_state || clientRow?.state || ''),
      useShip ? (clientRow?.ship_to_pincode || clientRow?.bill_to_pincode || '') : (clientRow?.bill_to_pincode || clientRow?.ship_to_pincode || '')
    ),
    gstin: clientRow?.gstin || '',
    state: useShip ? (clientRow?.ship_to_state || clientRow?.state || '') : (clientRow?.bill_to_state || clientRow?.state || ''),
    contactPerson: '',
    contactPhone: ''
  };
}

function getSalesOrderPrintData(soNumber, token) {
  if (token && !_canViewSalesOrderPrint_(token)) {
    throw new Error('Unauthorized');
  }

  const payload = loadSalesOrder(soNumber);
  if (!payload || !payload.header) {
    throw new Error('Sales order not found: ' + soNumber);
  }

  const header = _salesOrderEnrichHeaderRow_(payload.header || {});
  const lines = enrichSalesOrderLines(payload.lines || []);

  const clientRow = (_clientSelectRows_({
    filters: { client_code: 'eq.' + String(header.client_code || '') },
    limit: 1
  }) || [])[0] || null;

  const clientParties = clientRow?.id ? _clientPartySelectRowsByClientIds_([clientRow.id]) : [];
  const billTo = _salesOrderPickClientParty_(clientParties, 'BILL_TO', clientRow, header);
  const shipTo = _salesOrderPickClientParty_(clientParties, 'SHIP_TO', clientRow, header);
  const companyState = String(PURCHASE_COMPANY.state || COMPANY_STATE || '').trim().toLowerCase();
  const partyState = String(clientRow?.state || header.client_state || '').trim().toLowerCase();
  const intraState = !!(companyState && partyState && companyState === partyState);

  const normalizedLines = lines.map(function(line, index) {
    const qty = Number(line.qty || 0);
    const rate = Number(line.rate || 0);
    const baseAmount = Number(line.amount != null ? line.amount : (qty * rate));
    const discPct = Number(line.disc_pct || 0);
    const discAmount = Number(line.disc_amount != null ? line.disc_amount : (baseAmount * discPct / 100));
    const taxableAmount = Number(
      line.net_amount != null
        ? line.net_amount
        : (baseAmount - discAmount)
    );
    const gstPct = Number(line.gst_pct || 0);
    const cgstPct = intraState ? gstPct / 2 : 0;
    const sgstPct = intraState ? gstPct / 2 : 0;
    const igstPct = intraState ? 0 : gstPct;
    const cgstAmt = Number(line.cgst != null ? line.cgst : (taxableAmount * cgstPct / 100));
    const sgstAmt = Number(line.sgst != null ? line.sgst : (taxableAmount * sgstPct / 100));
    const igstAmt = Number(line.igst != null ? line.igst : (taxableAmount * igstPct / 100));
    const totalAmount = Number(line.line_total != null ? line.line_total : (taxableAmount + cgstAmt + sgstAmt + igstAmt));

    return {
      srNo: index + 1,
      lineNo: Number(line.line_no || index + 1),
      category: line.category || '',
      productCode: line.product_code || '',
      productName: line.product_name || '',
      qty: qty,
      unit: line.unit || '',
      rateType: line.rate_type || '',
      rate: rate,
      amount: baseAmount,
      discPct: discPct,
      discAmount: discAmount,
      taxableAmount: taxableAmount,
      expectedDelivery: line.expected_delivery || '',
      finalDelivery: line.final_delivery || '',
      hsnGroup: line.hsn_group || '',
      gstPct: gstPct,
      cgstPct: cgstPct,
      sgstPct: sgstPct,
      igstPct: igstPct,
      cgstAmt: cgstAmt,
      sgstAmt: sgstAmt,
      igstAmt: igstAmt,
      gstAmount: cgstAmt + sgstAmt + igstAmt,
      totalAmount: totalAmount,
      productRemarks: line.product_remarks || '',
      prepressRemarks: line.prepress_remarks || '',
      jobReference: line.job_reference || '',
      jobPriority: line.job_priority || ''
    };
  });

  const subtotal = Number(header.subtotal != null ? header.subtotal : normalizedLines.reduce(function(sum, line){ return sum + line.amount; }, 0));
  const discountTotal = Number(header.discount_total != null ? header.discount_total : normalizedLines.reduce(function(sum, line){ return sum + line.discAmount; }, 0));
  const taxableTotal = normalizedLines.reduce(function(sum, line){ return sum + line.taxableAmount; }, 0);
  const cgstTotal = Number(header.cgst_total != null ? header.cgst_total : normalizedLines.reduce(function(sum, line){ return sum + line.cgstAmt; }, 0));
  const sgstTotal = Number(header.sgst_total != null ? header.sgst_total : normalizedLines.reduce(function(sum, line){ return sum + line.sgstAmt; }, 0));
  const igstTotal = Number(header.igst_total != null ? header.igst_total : normalizedLines.reduce(function(sum, line){ return sum + line.igstAmt; }, 0));
  const taxTotal = cgstTotal + sgstTotal + igstTotal;
  const grandTotal = Number(header.grand_total != null ? header.grand_total : (taxableTotal + taxTotal));

  return {
    company: {
      name: PURCHASE_COMPANY.name,
      gstin: PURCHASE_COMPANY.gstin,
      address: PURCHASE_COMPANY.address,
      phone: PURCHASE_COMPANY.landline,
      email: PURCHASE_COMPANY.email,
      website: PURCHASE_COMPANY.website,
      state: PURCHASE_COMPANY.state
    },
    order: {
      soNumber: header.so_number || '',
      orderDate: header.so_date || '',
      salesRep: header.sales_rep || '',
      poNumber: header.po_number || '',
      poDate: header.po_date || '',
      clientCode: header.client_code || '',
      clientName: clientRow?.client_name || header.client_name || '',
      salesType: header.sales_type || '',
      currency: header.currency || 'INR',
      status: header.status || '',
      modeOfTransport: header.mode_of_transport || '',
      transportPreference: header.transport_preference || '',
      transportPayment: header.transport_payment || '',
      billingRemarks: header.billing_remarks || '',
      remarks: header.remarks || '',
      createdBy: header.created_by || ''
    },
    customer: {
      code: clientRow?.client_code || header.client_code || '',
      name: clientRow?.client_name || header.client_name || '',
      gstin: clientRow?.gstin || '',
      state: clientRow?.state || header.client_state || '',
      billTo: billTo,
      shipTo: shipTo
    },
    lines: normalizedLines,
    totals: {
      subtotal: subtotal,
      discountTotal: discountTotal,
      taxableTotal: taxableTotal,
      cgstTotal: cgstTotal,
      sgstTotal: sgstTotal,
      igstTotal: igstTotal,
      taxTotal: taxTotal,
      grandTotal: grandTotal,
      amountInWords: amountInWords(grandTotal)
    },
    terms: [
      'This sales order print is a booking confirmation / proforma reference and not a tax invoice.',
      'Delivery dates are tentative and remain subject to artwork approval, material availability, and process clearance.',
      'Please review quantities, rates, GST, and dispatch instructions and inform us immediately if any discrepancy is found.'
    ],
    printedAt: new Date().toISOString()
  };
}

function printSalesOrder(soNumber, token) {
  const data = getSalesOrderPrintData(soNumber, token);
  const html = HtmlService.createTemplateFromFile('PrintSalesOrder');
  html.so = data;
  return html.evaluate()
    .setTitle('Sales Order Print')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function saveFlexoWorkOrder(payload) {
  if (!payload) throw new Error('Payload is required.');
  try {
    payload.jobDetails = payload.jobDetails || {};
    payload.jobDetails.type = 'Flexo';
    payload.status = payload.status || 'RELEASED';
    payload.woNo = String(payload.woNo || '').trim() || generateFlexoWorkOrderNumber();
    const result = saveWorkOrder(payload, { skipSoStatusRefresh: true });
    return result;
  } catch (err) {
    Logger.log('saveFlexoWorkOrder failed: ' + (err && err.stack ? err.stack : err));
    throw err;
  }
}

function deleteWorkOrder(woNo) {

  if (!woNo) {
    throw new Error('Work Order number is required.');
  }

  const wo = supabaseSelect('work_orders', {
    select: 'id,wo_number',
    filters: { wo_number: 'eq.' + woNo },
    limit: 1
  })[0];

  if (!wo) {
    throw new Error('Work Order not found: ' + woNo);
  }

  const jobs = supabaseSelect('work_order_jobs', {
    select: 'so_number',
    filters: { wo_id: 'eq.' + wo.id }
  }) || [];

  const soNumbers = [...new Set(jobs.map(j => j.so_number).filter(Boolean))];

  _deleteInventoryReservationsForWO_(woNo);
  supabaseDelete('work_order_routing', { wo_id: 'eq.' + wo.id });
  supabaseDelete('work_order_materials', { wo_id: 'eq.' + wo.id });
  supabaseDelete('work_order_jobs', { wo_id: 'eq.' + wo.id });
  supabaseDelete('work_orders', { id: 'eq.' + wo.id });

  soNumbers.forEach(soNumber => {
    const so = supabaseSelect('sales_orders', {
      select: 'id',
      filters: { so_number: 'eq.' + soNumber },
      limit: 1
    })[0];
    if (so?.id) updateSalesOrderStatus(so.id);
  });

  return { ok: true, woNo: woNo };
}

function saveAndExportWO(payload) {

  const saved = saveWorkOrder(payload);

  return {
    ok: true,
    woNo: saved.woNo
  };
}

/* =========================
   Items (master)
   ========================= */
function saveItem(item) {
  if (!item || !item.itemName) {
    throw new Error('Item name is required');
  }
  const hsnGroup = String(item.hsnGroup || '').trim();
  if (!hsnGroup) {
    throw new Error('HSN Group is required');
  }

  const row = {
    item_code: item.itemCode || generateItemCode_(),
    item_name: String(item.itemName || '').trim(),
    category: item.category || '',
    hsn_group: hsnGroup,
    unit: item.unit || '',
    default_rate: Number(item.defaultRate || 0),
    gst_pct: Number(item.gstPct || 0),
    client_code: item.clientCode || null,
    active: item.active !== false
  };

  const res = supabaseUpsert('items', row, { onConflict: 'item_code' });

  // ✅ SAFETY: Supabase may still return null
  const savedRow = Array.isArray(res) && res.length ? res[0] : row;

  return {
    ok: true,
    item: {
      itemCode: savedRow.item_code,
      itemName: savedRow.item_name,
      category: savedRow.category || '',
      hsnGroup: savedRow.hsn_group || '',
      unit: savedRow.unit || '',
      defaultRate: Number(savedRow.default_rate || 0),
      gstPct: Number(savedRow.gst_pct || 0),
      description: savedRow.description || '',
      clientCode: savedRow.client_code || '',
      clientName: savedRow.client_name || '',
      active: savedRow.active !== false
    }
  };
}

function getItems(params) {
  const p = params || {};
  const q = (p.q || '').toLowerCase();
  const orderPrefix = String(p.orderPrefix || '').trim().toUpperCase();

  if (orderPrefix === 'M') {
    return getMTradingCatalog_()
      .filter(i => {
        if (!q) return true;
        const hay = [
          i.itemCode,
          i.itemName,
          i.category,
          i.hsnGroup
        ].join(' ').toLowerCase();
        return hay.includes(q);
      })
      .slice(0, p.limit || 500);
  }

  const filters = { active: 'eq.true' };
  if (p.clientCode) {
    filters.client_code = 'eq.' + p.clientCode;
  }

  let rows = supabaseSelect('items', {
    select: 'item_code,item_name,category,hsn_group,unit,default_rate,gst_pct,description,client_code,client_name,active',
    filters,
    order: 'item_name.asc',
    limit: p.limit || 500
  }) || [];

  if (q) {
    rows = rows.filter(i => {
      const hay = (
        (i.item_code || '') + ' ' +
        (i.item_name || '') + ' ' +
        (i.category || '') + ' ' +
        (i.hsn_group || '')
      ).toLowerCase();
      return hay.includes(q);
    });
  }

  const savedItems = rows.map(i => ({
    itemCode: i.item_code,
    itemName: i.item_name,
    category: i.category || '',
    hsnGroup: i.hsn_group || '',
    unit: i.unit || '',
    defaultRate: Number(i.default_rate || 0),
    gstPct: Number(i.gst_pct || 0),
    description: i.description || '',
    clientCode: i.client_code || '',
    clientName: i.client_name || '',
    isVirtual: false,
    active: i.active
  }));

  if (orderPrefix !== 'SL') return savedItems;

  const slCommonItems = getSLCommonCatalog_().filter(i => {
    if (!q) return true;
    const hay = [
      i.itemCode,
      i.itemName,
      i.category,
      i.hsnGroup
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });

  const seen = new Set(savedItems.map(function(item) {
    return String(item.itemName || '').trim().toLowerCase();
  }));

  slCommonItems.forEach(function(item) {
    if (!seen.has(String(item.itemName || '').trim().toLowerCase())) {
      savedItems.push(item);
    }
  });

  return savedItems.slice(0, p.limit || 500);
}

function _requireModuleAccess_(token, moduleCode, action) {
  const user = getSessionUser(token);
  if (!user) throw new Error('Unauthorized');
  if (user.role === 'ADMIN') return user;
  if (!_userHasPermission_(user, moduleCode, action || 'can_view')) {
    throw new Error('Unauthorized');
  }
  return user;
}

function _safeJsonObject_(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function _normalizeBomMaterialRow_(row, index) {
  const src = row || {};
  const qtyPerUnit = Number(src.qtyPerUnit || src.qty_per_unit || 0);
  if (!qtyPerUnit || qtyPerUnit <= 0) return null;
  const extraJson = _safeJsonObject_(src.extraJson || src.extra_json);
  if (src.sizeUom != null && src.sizeUom !== '') extraJson.sizeUom = String(src.sizeUom).trim();
  if (src.corrugationLayer != null && src.corrugationLayer !== '') extraJson.corrugationLayer = String(src.corrugationLayer).trim();

  return {
    line_no: index + 1,
    material_type: String(src.materialType || src.material_type || 'RAW_MATERIAL').trim() || 'RAW_MATERIAL',
    material_group: String(src.materialGroup || src.material_group || '').trim() || null,
    material_item_code: String(src.materialItemCode || src.material_item_code || '').trim() || null,
    material_name: String(src.materialName || src.material_name || '').trim(),
    qty_per_unit: qtyPerUnit,
    uom: String(src.uom || 'NOS').trim() || 'NOS',
    wastage_pct: Number(src.wastagePct || src.wastage_pct || 0) || 0,
    gsm: src.gsm === '' || src.gsm == null ? null : Number(src.gsm),
    deckle_mm: src.deckleMm === '' || src.deckleMm == null ? null : Number(src.deckleMm),
    cut_size_mm: src.cutSizeMm === '' || src.cutSizeMm == null ? null : Number(src.cutSizeMm),
    flute: String(src.flute || '').trim() || null,
    ply_no: String(src.plyNo || src.ply_no || '').trim() || null,
    remarks: String(src.remarks || '').trim() || null,
    extra_json: extraJson
  };
}

function _normalizeBomRoutingRow_(row, index) {
  const src = row || {};
  const department = String(src.department || src.dept || '').trim();
  const operationName = String(src.operationName || src.operation_name || src.operation || department).trim();
  if (!department || !operationName) return null;

  return {
    sequence_no: index + 1,
    department: department,
    operation_name: operationName,
    machine_name: String(src.machineName || src.machine_name || src.machine || '').trim() || null,
    setup_time_min: Number(src.setupTimeMin || src.setup_time_min || 0) || 0,
    run_time_min: Number(src.runTimeMin || src.run_time_min || 0) || 0,
    standard_rate_qty_per_hour: src.standardRateQtyPerHour === '' || src.standardRateQtyPerHour == null
      ? null
      : Number(src.standardRateQtyPerHour || src.standard_rate_qty_per_hour),
    outsource: src.outsource === true,
    remarks: String(src.remarks || '').trim() || null,
    extra_json: _safeJsonObject_(src.extraJson || src.extra_json)
  };
}

function itemMasterListItems(params, token) {
  _requireModuleAccess_(token, 'ITEMMASTER', 'can_view');

  const p = params || {};
  const q = String(p.q || '').trim().toLowerCase();
  const version = PropertiesService.getScriptProperties().getProperty('ITEM_MASTER_CACHE_VERSION') || '0';
  const cacheKey = _cacheKeyHash_('ITEM_MASTER_LIST', JSON.stringify({
    v: version,
    q: q,
    limit: p.limit || 500
  }));
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { cache.remove(cacheKey); }
  }

  let rows = supabaseSelect('items', {
    select: 'item_code,item_name,category,product_category,unit,active,manufacturing_enabled,current_revision_no,item_lifecycle_status',
    order: 'item_name.asc',
    limit: p.limit || 500
  }) || [];

  if (q) {
    rows = rows.filter(function(row) {
      return [
        row.item_code,
        row.item_name,
        row.category,
        row.product_category,
        row.unit
      ].join(' ').toLowerCase().includes(q);
    });
  }

  const payload = rows.map(function(row) {
    return {
      itemCode: row.item_code,
      itemName: row.item_name,
      category: row.category || '',
      productCategory: row.product_category || '',
      unit: row.unit || '',
      active: row.active !== false,
      manufacturingEnabled: row.manufacturing_enabled === true,
      currentRevisionNo: row.current_revision_no || null,
      lifecycleStatus: row.item_lifecycle_status || (row.active === false ? 'INACTIVE' : 'ACTIVE')
    };
  });
  try { cache.put(cacheKey, JSON.stringify(payload), q ? 120 : 300); } catch (e) {}
  return payload;
}

function itemMasterGetReferenceData(token) {
  _requireModuleAccess_(token, 'ITEMMASTER', 'can_view');

  const version = PropertiesService.getScriptProperties().getProperty('ITEM_MASTER_CACHE_VERSION') || '0';
  const cacheKey = 'ITEM_MASTER_REFS_' + version;
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { cache.remove(cacheKey); }
  }

  const masters = getUnifiedMasters() || {};
  const flexoMasters = getFlexoWOMasters() || {};
  const payload = {
    categories: masters.categories || [],
    units: masters.units || [],
    jobTypes: masters.jobTypes || [],
    productCategories: ['Flat', 'Corrugated', 'Flexo'],
    grainOptions: masters.grainOptions || [],
    printStyles: masters.printStyles || [],
    coatingOptions: masters.coatingOptions || [],
    gsmList: masters.gsmList || [],
    stocks: masters.stocks || [],
    fluteOptions: masters.fluteOptions || [],
    departments: masters.departments || [],
    machinesByDept: masters.machinesByDept || {},
    routingMaterialTypes: ['RAW_MATERIAL', 'PAPER', 'BOARD', 'CORRUGATION', 'ADHESIVE', 'INK', 'FILM', 'OTHER'],
    uomOptions: ['NOS', 'PCS', 'SHEET', 'KG', 'GRAM', 'MTR', 'SQM'],
    flexoLabelTypes: flexoMasters.flexoLabelTypes || [],
    flexoWindingDirections: flexoMasters.flexoWindingDirections || [],
    flexoFinishedFormats: flexoMasters.flexoFinishedFormats || [],
    flexoDieTypes: flexoMasters.flexoDieTypes || [],
    flexoRoutingOptions: flexoMasters.flexoRoutingOptions || [],
    flexoCylinderMaster: (flexoMasters.flexoCylinderMaster || []).map(function(row) {
      return String(row && row.teeth != null ? row.teeth : '').trim();
    }).filter(Boolean),
    flexoFilmItems: (flexoMasters.flexoFilmItems || []).map(function(row) {
      return row && row.itemName ? row.itemName : '';
    }).filter(Boolean),
    processWastageTypes: ['%', 'RM']
  };
  try { cache.put(cacheKey, JSON.stringify(payload), 600); } catch (e) {}
  return payload;
}

function itemMasterGetItem(itemCode, token) {
  _requireModuleAccess_(token, 'ITEMMASTER', 'can_view');

  const code = String(itemCode || '').trim();
  if (!code) throw new Error('Item code is required');

  const item = (supabaseSelect('items', {
    filters: { item_code: 'eq.' + code },
    limit: 1
  }) || [])[0];

  if (!item) throw new Error('Item not found');

  const revisions = supabaseSelect('item_bom_revisions', {
    filters: { item_code: 'eq.' + code },
    order: 'revision_no.desc',
    limit: 100
  }) || [];

  const revisionIds = revisions.map(function(row){ return row.id; }).filter(Boolean);
  let materialRows = [];
  let routingRows = [];

  if (revisionIds.length) {
    materialRows = _supabaseSelectByKeyInBatches_(
      'item_bom_materials',
      undefined,
      'revision_id',
      revisionIds,
      'line_no.asc',
      25
    ) || [];

    routingRows = _supabaseSelectByKeyInBatches_(
      'item_bom_routing',
      undefined,
      'revision_id',
      revisionIds,
      'sequence_no.asc',
      25
    ) || [];
  }

  const materialsByRevision = {};
  materialRows.forEach(function(row) {
    const key = row.revision_id;
    if (!materialsByRevision[key]) materialsByRevision[key] = [];
    materialsByRevision[key].push({
      id: row.id,
      lineNo: row.line_no,
      materialType: row.material_type || 'RAW_MATERIAL',
      materialGroup: row.material_group || '',
      materialItemCode: row.material_item_code || '',
      materialName: row.material_name || '',
      qtyPerUnit: Number(row.qty_per_unit || 0),
      uom: row.uom || '',
      wastagePct: Number(row.wastage_pct || 0),
      gsm: row.gsm == null ? '' : Number(row.gsm),
      deckleMm: row.deckle_mm == null ? '' : Number(row.deckle_mm),
      cutSizeMm: row.cut_size_mm == null ? '' : Number(row.cut_size_mm),
      flute: row.flute || '',
      plyNo: row.ply_no || '',
      remarks: row.remarks || '',
      extraJson: row.extra_json || {}
    });
  });

  const routingByRevision = {};
  routingRows.forEach(function(row) {
    const key = row.revision_id;
    if (!routingByRevision[key]) routingByRevision[key] = [];
    routingByRevision[key].push({
      id: row.id,
      sequenceNo: row.sequence_no,
      department: row.department || '',
      operationName: row.operation_name || '',
      machineName: row.machine_name || '',
      setupTimeMin: Number(row.setup_time_min || 0),
      runTimeMin: Number(row.run_time_min || 0),
      standardRateQtyPerHour: row.standard_rate_qty_per_hour == null ? '' : Number(row.standard_rate_qty_per_hour),
      outsource: row.outsource === true,
      remarks: row.remarks || '',
      extraJson: row.extra_json || {}
    });
  });

  return {
    item: {
      itemCode: item.item_code,
      itemName: item.item_name,
      category: item.category || '',
      productCategory: item.product_category || '',
      unit: item.unit || '',
      description: item.description || '',
      active: item.active !== false,
      manufacturingEnabled: item.manufacturing_enabled === true,
      currentRevisionNo: item.current_revision_no || null,
      lifecycleStatus: item.item_lifecycle_status || (item.active === false ? 'INACTIVE' : 'ACTIVE'),
      itemMasterNotes: item.item_master_notes || ''
    },
    revisions: revisions.map(function(row) {
      return {
        id: row.id,
        revisionNo: row.revision_no,
        status: row.status || 'DRAFT',
        isCurrent: row.is_current === true,
        bomBasis: row.bom_basis || 'PER_UNIT',
        baseQuantity: Number(row.base_quantity || 1),
        outputQuantity: Number(row.output_quantity || 1),
        outputUom: row.output_uom || 'NOS',
        revisionReason: row.revision_reason || '',
        changeSummary: row.change_summary || '',
        itemInfo: row.item_info_json || {},
        effectiveFrom: row.effective_from || '',
        approvedAt: row.approved_at || '',
        approvedBy: row.approved_by || '',
        archivedAt: row.archived_at || '',
        archivedBy: row.archived_by || '',
        createdAt: row.created_at || '',
        createdBy: row.created_by || '',
        materials: materialsByRevision[row.id] || [],
        routing: routingByRevision[row.id] || []
      };
    })
  };
}

function itemMasterGetActiveBom(itemCode, token) {
  const user = getSessionUser(token);
  if (!user) throw new Error('Unauthorized');
  if (
    user.role !== 'ADMIN' &&
    !checkPermission(token, 'WOW', 'can_view') &&
    !checkPermission(token, 'ITEMMASTER', 'can_view')
  ) {
    throw new Error('Unauthorized');
  }

  const code = String(itemCode || '').trim();
  if (!code) throw new Error('Item code is required');

  const item = (supabaseSelect('items', {
    filters: { item_code: 'eq.' + code },
    limit: 1
  }) || [])[0];
  if (!item) throw new Error('Item not found');

  const revision = (supabaseSelect('item_bom_revisions', {
    filters: {
      item_code: 'eq.' + code,
      is_current: 'eq.true'
    },
    order: 'revision_no.desc',
    limit: 1
  }) || [])[0];

  if (!revision) return null;

  const materials = supabaseSelect('item_bom_materials', {
    filters: { revision_id: 'eq.' + revision.id },
    order: 'line_no.asc',
    limit: 500
  }) || [];

  const routing = supabaseSelect('item_bom_routing', {
    filters: { revision_id: 'eq.' + revision.id },
    order: 'sequence_no.asc',
    limit: 200
  }) || [];

  return {
    itemCode: item.item_code,
    itemName: item.item_name,
    unit: item.unit || '',
    revisionId: revision.id,
    revisionNo: revision.revision_no,
    baseQuantity: Number(revision.base_quantity || 1),
    outputQuantity: Number(revision.output_quantity || 1),
    outputUom: revision.output_uom || 'NOS',
    itemInfo: revision.item_info_json || {},
    materials: materials.map(function(row) {
      return {
        lineNo: row.line_no,
        materialType: row.material_type || 'RAW_MATERIAL',
        materialGroup: row.material_group || '',
        materialItemCode: row.material_item_code || '',
        materialName: row.material_name || '',
        qtyPerUnit: Number(row.qty_per_unit || 0),
        uom: row.uom || '',
        wastagePct: Number(row.wastage_pct || 0),
        gsm: row.gsm == null ? '' : Number(row.gsm),
        deckleMm: row.deckle_mm == null ? '' : Number(row.deckle_mm),
        cutSizeMm: row.cut_size_mm == null ? '' : Number(row.cut_size_mm),
        flute: row.flute || '',
        plyNo: row.ply_no || '',
        remarks: row.remarks || '',
        extraJson: row.extra_json || {}
      };
    }),
    routing: routing.map(function(row) {
      return {
        sequenceNo: row.sequence_no,
        department: row.department || '',
        operationName: row.operation_name || '',
        machineName: row.machine_name || '',
        setupTimeMin: Number(row.setup_time_min || 0),
        runTimeMin: Number(row.run_time_min || 0),
        standardRateQtyPerHour: row.standard_rate_qty_per_hour == null ? '' : Number(row.standard_rate_qty_per_hour),
        outsource: row.outsource === true,
        remarks: row.remarks || '',
        extraJson: row.extra_json || {}
      };
    })
  };
}

function itemMasterCreateRevision(payload, token) {
  const user = _requireModuleAccess_(token, 'ITEMMASTER', 'can_create');
  const itemCode = String(payload?.itemCode || '').trim();
  if (!itemCode) throw new Error('Item code is required');

  const revisionId = supabaseRpc('create_item_bom_revision', {
    p_item_code: itemCode,
    p_created_by: user.userId,
    p_revision_reason: String(payload?.revisionReason || '').trim() || null
  });
  PropertiesService.getScriptProperties().setProperty('ITEM_MASTER_CACHE_VERSION', String(Date.now()));

  return {
    ok: true,
    revisionId: Array.isArray(revisionId) ? revisionId[0] : revisionId
  };
}

function itemMasterSaveRevision(payload, token) {
  const user = _requireModuleAccess_(token, 'ITEMMASTER', 'can_edit');
  const revisionId = String(payload?.revisionId || '').trim();
  if (!revisionId) throw new Error('Revision id is required');

  const current = (supabaseSelect('item_bom_revisions', {
    filters: { id: 'eq.' + revisionId },
    limit: 1
  }) || [])[0];

  if (!current) throw new Error('Revision not found');
  if (String(current.status || '').toUpperCase() === 'ARCHIVED') {
    throw new Error('Archived revision cannot be edited');
  }

  const itemInfo = _safeJsonObject_(payload.itemInfo);
  const itemHeader = _safeJsonObject_(payload.itemHeader);
  const materials = (Array.isArray(payload.materials) ? payload.materials : [])
    .map(_normalizeBomMaterialRow_)
    .filter(Boolean);
  const routing = (Array.isArray(payload.routing) ? payload.routing : [])
    .map(_normalizeBomRoutingRow_)
    .filter(Boolean);

  supabaseUpdate('item_bom_revisions', {
    id: 'eq.' + revisionId
  }, {
    revision_reason: String(payload.revisionReason || '').trim() || null,
    change_summary: String(payload.changeSummary || '').trim() || null,
    output_uom: String(payload.outputUom || 'NOS').trim() || 'NOS',
    updated_by: user.userId,
    item_info_json: itemInfo
  });

  supabaseDelete('item_bom_materials', {
    revision_id: 'eq.' + revisionId
  });
  if (materials.length) {
    supabaseBulkInsert('item_bom_materials', materials.map(function(row) {
      row.revision_id = revisionId;
      row.created_by = user.userId;
      row.updated_by = user.userId;
      return row;
    }));
  }

  supabaseDelete('item_bom_routing', {
    revision_id: 'eq.' + revisionId
  });
  if (routing.length) {
    supabaseBulkInsert('item_bom_routing', routing.map(function(row) {
      row.revision_id = revisionId;
      row.created_by = user.userId;
      row.updated_by = user.userId;
      return row;
    }));
  }

  supabaseUpdate('items', {
    item_code: 'eq.' + current.item_code
  }, {
    item_name: String(itemHeader.itemName || '').trim() || undefined,
    category: String(itemHeader.category || '').trim() || '',
    product_category: String(itemHeader.productCategory || itemInfo.productCategory || itemInfo.type || '').trim() || undefined,
    wo_module: String(itemHeader.woModule || '').trim() || undefined,
    unit: String(itemHeader.unit || '').trim() || '',
    description: String(itemHeader.description || '').trim() || '',
    manufacturing_enabled: true,
    revision_controlled: true,
    bom_basis: 'PER_UNIT',
    item_master_notes: String(payload.itemMasterNotes || '').trim() || null
  });

  syncItemToInventory_(current.item_code, itemHeader, true);
  PropertiesService.getScriptProperties().setProperty('ITEM_MASTER_CACHE_VERSION', String(Date.now()));

  return { ok: true };
}

function itemMasterActivateRevision(revisionId, token) {
  const user = _requireModuleAccess_(token, 'ITEMMASTER', 'can_edit');
  const id = String(revisionId || '').trim();
  if (!id) throw new Error('Revision id is required');

  const res = supabaseRpc('activate_item_bom_revision', {
    p_revision_id: id,
    p_approved_by: user.userId
  });
  PropertiesService.getScriptProperties().setProperty('ITEM_MASTER_CACHE_VERSION', String(Date.now()));

  return {
    ok: true,
    revisionId: Array.isArray(res) ? res[0] : res
  };
}

function itemMasterToggleItem(itemCode, active, token) {
  _requireModuleAccess_(token, 'ITEMMASTER', 'can_edit');

  const code = String(itemCode || '').trim();
  if (!code) throw new Error('Item code is required');

  const isActive = active === true;
  supabaseUpdate('items', {
    item_code: 'eq.' + code
  }, {
    active: isActive,
    item_lifecycle_status: isActive ? 'ACTIVE' : 'INACTIVE'
  });

  syncItemToInventory_(code, {}, isActive);
  PropertiesService.getScriptProperties().setProperty('ITEM_MASTER_CACHE_VERSION', String(Date.now()));

  return { ok: true };
}

function _itemMasterRequireMergeAccess_(token) {
  const user = _requireModuleAccess_(token, 'ITEMMASTER', 'can_edit');
  if (String(user.role || '').toUpperCase() !== 'ADMIN') {
    throw new Error('Only ADMIN users can merge item codes.');
  }
  return user;
}

function _itemMasterGetExistingItemRow_(itemCode) {
  const code = String(itemCode || '').trim();
  if (!code) return null;
  return (supabaseSelect('items', {
    select: 'item_code,item_name,category,product_category,unit,active,item_lifecycle_status,current_revision_no,item_master_notes',
    filters: { item_code: 'eq.' + code },
    limit: 1
  }) || [])[0] || null;
}

function _itemMasterListRowsByProductCode_(table, code, select, limit) {
  return supabaseSelect(table, {
    select: select || 'id',
    filters: { product_code: 'eq.' + code },
    limit: limit || 5000
  }) || [];
}

function _itemMasterPatchSnapshotForMerge_(snapshot, sourceCode, targetCode) {
  const source = String(sourceCode || '').trim();
  const target = String(targetCode || '').trim();
  if (!source || !target) return null;

  const snap = _safeJsonObject_(snapshot);
  let changed = false;

  function replaceProductCodes(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(replaceProductCodes);
      return;
    }
    Object.keys(node).forEach(function(key) {
      const value = node[key];
      if ((key === 'productCode' || key === 'product_code') && String(value || '').trim() === source) {
        node[key] = target;
        changed = true;
        return;
      }
      if (value && typeof value === 'object') replaceProductCodes(value);
    });
  }

  replaceProductCodes(snap);

  if (snap.bomReference && String(snap.bomReference.itemCode || '').trim() === source) {
    snap.bomReference.itemCode = target;
    changed = true;
  }
  if (Array.isArray(snap.extraMaterials)) {
    snap.extraMaterials.forEach(function(row) {
      if (row && String(row.materialItemCode || '').trim() === source) {
        row.materialItemCode = target;
        changed = true;
      }
    });
  }

  return changed ? snap : null;
}

function itemMasterPreviewMerge(sourceItemCode, targetItemCode, token) {
  _itemMasterRequireMergeAccess_(token);
  const sourceCode = String(sourceItemCode || '').trim();
  const targetCode = String(targetItemCode || '').trim();
  if (!sourceCode || !targetCode) throw new Error('Source and target item codes are required.');
  if (sourceCode === targetCode) throw new Error('Source and target item codes must be different.');

  const sourceItem = _itemMasterGetExistingItemRow_(sourceCode);
  const targetItem = _itemMasterGetExistingItemRow_(targetCode);
  if (!sourceItem) throw new Error('Source item not found.');
  if (!targetItem) throw new Error('Target item not found.');

  const salesOrderLines = _itemMasterListRowsByProductCode_('sales_order_lines', sourceCode, 'id', 5000);
  const packingRows = _itemMasterListRowsByProductCode_('packing_records', sourceCode, 'id', 5000);
  const dispatchRows = _itemMasterListRowsByProductCode_('dispatch_records', sourceCode, 'id', 5000);
  const invoiceRows = _itemMasterListRowsByProductCode_('invoice_lines', sourceCode, 'id', 5000);
  const workOrders = supabaseSelect('work_orders', {
    select: 'id,wo_number,snapshot_json',
    order: 'wo_date.desc',
    limit: 5000
  }) || [];
  const affectedWorkOrders = workOrders.filter(function(row) {
    return !!_itemMasterPatchSnapshotForMerge_(row.snapshot_json || {}, sourceCode, targetCode);
  });

  return {
    ok: true,
    sourceItem: {
      itemCode: sourceItem.item_code || '',
      itemName: sourceItem.item_name || '',
      active: sourceItem.active !== false,
      revisionNo: sourceItem.current_revision_no || null
    },
    targetItem: {
      itemCode: targetItem.item_code || '',
      itemName: targetItem.item_name || '',
      active: targetItem.active !== false,
      revisionNo: targetItem.current_revision_no || null
    },
    impact: {
      salesOrderLines: salesOrderLines.length,
      workOrders: affectedWorkOrders.length,
      packingRecords: packingRows.length,
      dispatchRecords: dispatchRows.length,
      invoiceLines: invoiceRows.length,
      totalReferences: salesOrderLines.length + affectedWorkOrders.length + packingRows.length + dispatchRows.length + invoiceRows.length
    },
    warnings: [
      sourceItem.active === false ? 'Source item is already inactive.' : '',
      targetItem.active === false ? 'Target item is inactive. Activate it before using it as the merged master item.' : ''
    ].filter(Boolean)
  };
}

function itemMasterMergeItems(payload, token) {
  const user = _itemMasterRequireMergeAccess_(token);
  const sourceCode = String(payload?.sourceItemCode || '').trim();
  const targetCode = String(payload?.targetItemCode || '').trim();
  const reason = String(payload?.reason || '').trim();
  if (!sourceCode || !targetCode) throw new Error('Source and target item codes are required.');
  if (sourceCode === targetCode) throw new Error('Source and target item codes must be different.');
  if (!reason) throw new Error('Merge reason is required.');

  const preview = itemMasterPreviewMerge(sourceCode, targetCode, token);
  if (!preview?.targetItem?.active) {
    throw new Error('Target item must be active before merging.');
  }

  const salesOrderLines = _itemMasterListRowsByProductCode_('sales_order_lines', sourceCode, 'id', 5000);
  if (salesOrderLines.length) {
    supabaseUpsertMinimal('sales_order_lines', salesOrderLines.map(function(row) {
      return { id: row.id, product_code: targetCode };
    }), { onConflict: 'id' });
  }

  const packingRows = _itemMasterListRowsByProductCode_('packing_records', sourceCode, 'id', 5000);
  if (packingRows.length) {
    supabaseUpsertMinimal('packing_records', packingRows.map(function(row) {
      return { id: row.id, product_code: targetCode };
    }), { onConflict: 'id' });
  }

  const dispatchRows = _itemMasterListRowsByProductCode_('dispatch_records', sourceCode, 'id', 5000);
  if (dispatchRows.length) {
    supabaseUpsertMinimal('dispatch_records', dispatchRows.map(function(row) {
      return { id: row.id, product_code: targetCode };
    }), { onConflict: 'id' });
  }

  const invoiceRows = _itemMasterListRowsByProductCode_('invoice_lines', sourceCode, 'id', 5000);
  if (invoiceRows.length) {
    supabaseUpsertMinimal('invoice_lines', invoiceRows.map(function(row) {
      return { id: row.id, product_code: targetCode };
    }), { onConflict: 'id' });
  }

  const workOrders = supabaseSelect('work_orders', {
    select: 'id,wo_number,snapshot_json',
    order: 'wo_date.desc',
    limit: 5000
  }) || [];
  const workOrderUpdates = [];
  workOrders.forEach(function(row) {
    const nextSnapshot = _itemMasterPatchSnapshotForMerge_(row.snapshot_json || {}, sourceCode, targetCode);
    if (nextSnapshot) {
      workOrderUpdates.push({
        id: row.id,
        snapshot_json: nextSnapshot
      });
    }
  });
  if (workOrderUpdates.length) {
    supabaseUpsertMinimal('work_orders', workOrderUpdates, { onConflict: 'id' });
  }

  const sourceItem = _itemMasterGetExistingItemRow_(sourceCode);
  const targetItem = _itemMasterGetExistingItemRow_(targetCode);
  const mergedAt = new Date().toISOString();
  const mergeNote = 'Merged into ' + targetCode + ' on ' + mergedAt.slice(0, 10) + ' by ' + (user.userId || user.displayName || 'admin') + '. Reason: ' + reason;

  supabaseUpdate('items', {
    item_code: 'eq.' + sourceCode
  }, {
    active: false,
    item_lifecycle_status: 'OBSOLETE',
    merged_into_item_code: targetCode,
    merged_at: mergedAt,
    merged_by: user.userId,
    item_master_notes: ((sourceItem && sourceItem.item_master_notes) ? String(sourceItem.item_master_notes).trim() + '\n' : '') + mergeNote
  });

  try {
    supabaseInsertMinimal('item_code_merge_log', {
      source_item_code: sourceCode,
      source_item_name: sourceItem?.item_name || '',
      target_item_code: targetCode,
      target_item_name: targetItem?.item_name || '',
      reason: reason,
      merged_by: user.userId,
      merged_at: mergedAt,
      impact_json: preview.impact || {}
    });
  } catch (err) {}

  syncItemToInventory_(sourceCode, sourceItem || {}, false);
  syncItemToInventory_(targetCode, targetItem || {}, true);
  PropertiesService.getScriptProperties().setProperty('ITEM_MASTER_CACHE_VERSION', String(Date.now()));
  _opsBumpDatasetVersion_();
  _invBumpStockSnapshotVersion_();

  return {
    ok: true,
    sourceItemCode: sourceCode,
    targetItemCode: targetCode,
    mergedAt: mergedAt,
    impact: preview.impact || {}
  };
}

function generateItemCode_() {
  const prefix = 'ITM';

  // Lock / read sequence
  const seq = supabaseSelect('item_sequences', {
    filters: { prefix: 'eq.' + prefix },
    limit: 1
  })[0];

  let next = 1;

  if (seq) {
    next = (seq.last_no || 0) + 1;
    supabaseUpdate(
      'item_sequences',
      { prefix: 'eq.' + prefix },
      { last_no: next }
    );
  } else {
    supabaseInsert('item_sequences', {
      prefix,
      last_no: 1
    });
  }

  return prefix + String(next).padStart(5, '0');
}

/******************************************************
ERP System Session Management
 ******************************************************/

const ERP_SESSION_IDLE_TIMEOUT_SECONDS = 2 * 60 * 60;
const ERP_SESSION_IDLE_TIMEOUT_MS = ERP_SESSION_IDLE_TIMEOUT_SECONDS * 1000;
const ERP_SESSION_MAX_LIFE_SECONDS = 12 * 60 * 60;
const ERP_SESSION_MAX_LIFE_MS = ERP_SESSION_MAX_LIFE_SECONDS * 1000;
const ERP_SESSION_ACTIVITY_PERSIST_SECONDS = 10 * 60;
const ERP_SESSION_ACTIVITY_PERSIST_MS = ERP_SESSION_ACTIVITY_PERSIST_SECONDS * 1000;

// ---------- HELPER ----------
function _requireAdmin_(token){
  const admin = getSessionUser(token);
  if (!admin || String(admin.role).toUpperCase() !== 'ADMIN')
    throw new Error('Unauthorized');
  return admin;
}

function _hashPassword_(password) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(password || '')
  ).map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function _verifyPassword_(plainPassword, storedHash) {
  const input = String(plainPassword || '');
  const stored = String(storedHash || '');
  return _hashPassword_(input) === stored || input === stored;
}

function _assertPasswordPolicy_(password) {
  const value = String(password || '');
  if (value.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
}

function _invalidateUserSessions_(userId) {
  if (!userId) return;

  const rows = supabaseSelect('erp_sessions', {
    filters: { user_id: 'eq.' + userId },
    select: 'token',
    limit: 500
  }) || [];

  const cache = CacheService.getScriptCache();
  rows.forEach(function(row) {
    if (row && row.token) cache.remove(row.token);
  });

  supabaseDelete('erp_sessions', {
    user_id: 'eq.' + userId
  });
}

function _getUserByUserId_(userId) {
  const rows = supabaseSelect('users', {
    select: 'id,user_id,display_name,role_id,active,password_hash',
    filters: { user_id: 'eq.' + userId },
    limit: 1
  }) || [];
  return rows[0] || null;
}

function _getRoleById_(roleId) {
  const rows = supabaseSelect('roles', {
    select: 'id,role_code,role_name,active',
    filters: { id: 'eq.' + roleId },
    limit: 1
  }) || [];
  return rows[0] || null;
}

function _adminRolesCacheKey_() {
  return 'admin_roles_list_v1';
}

function _clearAdminRolesCache_() {
  CacheService.getScriptCache().remove(_adminRolesCacheKey_());
}

function _isSessionExpired_(session) {
  if (!session) return true;
  const now = Date.now();
  const issuedAt = Number(session.issuedAt || 0);
  const lastActivityAt = Number(session.lastActivityAt || session.lastSeenAt || session.issuedAt || 0);
  const maxExpiresAt = Number(session.maxExpiresAt || session.absoluteExpiresAt || (issuedAt ? issuedAt + ERP_SESSION_MAX_LIFE_MS : 0));

  if (!issuedAt || !lastActivityAt) return true;
  if (maxExpiresAt > 0 && now >= maxExpiresAt) return true;
  return (now - lastActivityAt) >= ERP_SESSION_IDLE_TIMEOUT_MS;
}

function _prepareActiveSession_(session, token, forcePersist) {
  if (!session || !token) return session;

  const now = Date.now();
  const issuedAt = Number(session.issuedAt || now);
  const maxExpiresAt = Number(session.maxExpiresAt || session.absoluteExpiresAt || (issuedAt + ERP_SESSION_MAX_LIFE_MS));
  const lastPersistedAt = Number(session.lastActivityPersistedAt || session.lastSeenPersistedAt || 0);

  session.issuedAt = issuedAt;
  session.lastActivityAt = now;
  session.maxExpiresAt = maxExpiresAt;
  session.idleTimeoutSeconds = ERP_SESSION_IDLE_TIMEOUT_SECONDS;
  session.maxLifeSeconds = ERP_SESSION_MAX_LIFE_SECONDS;
  delete session.expiresAt;

  const shouldPersist = forcePersist === true || !lastPersistedAt || (now - lastPersistedAt) >= ERP_SESSION_ACTIVITY_PERSIST_MS;
  if (shouldPersist) {
    session.lastActivityPersistedAt = now;
    try {
      supabaseUpdateMinimal('erp_sessions', {
        token: 'eq.' + token
      }, {
        payload: JSON.stringify(session)
      });
    } catch (e) {}
  }

  return session;
}

// ---------- LOGIN ----------
function loginAndGetToken(userId, password) {

  if (!userId || !password)
    return { ok:false, msg:'Missing credentials' };

  const rows = supabaseSelect('users', {
    select: 'id,user_id,display_name,role_id,password_hash,active',
    filters:{
      user_id:'eq.' + userId,
      active:'eq.true'
    },
    limit:1
  });

  if (!rows || !rows.length)
    return { ok:false, msg:'Invalid credentials' };

  const user = rows[0];

  // SHA-256 check
  const hash = _hashPassword_(password);

if (hash !== user.password_hash) {

  // fallback: check plain text
  if (password !== user.password_hash) {
    return { ok:false, msg:'Invalid credentials' };
  }

  // auto-upgrade to hash
  const newHash = _hashPassword_(password);

  supabaseUpdateMinimal(
    'users',
    { id: 'eq.' + user.id },
    { password_hash: newHash }
  );
}
  let role = null;

  if (user.role_id) {
    const roleRows = supabaseSelect('roles',{
      select:'id,role_code,active',
      filters:{ id:'eq.' + user.role_id, active:'eq.true' },
      limit:1
    });
    if (roleRows && roleRows.length)
      role = roleRows[0];
  }

  if (!role)
    return { ok:false, msg:'Role not assigned' };

  const permissions = supabaseSelect('role_permissions',{
    filters:{ role_id:'eq.' + role.id }
  }) || [];

  const token = Utilities.getUuid();
  const issuedAt = Date.now();
  const maxExpiresAt = issuedAt + ERP_SESSION_MAX_LIFE_MS;

  const sessionPayload = {
    userId: user.user_id,
    fullName: user.display_name || user.user_id,
    displayName: user.display_name || user.user_id,
    role: String(role.role_code).toUpperCase(),
    roleId: role.id,
    permissions: permissions,
    issuedAt: issuedAt,
    lastActivityAt: issuedAt,
    lastActivityPersistedAt: issuedAt,
    maxExpiresAt: maxExpiresAt,
    idleTimeoutSeconds: ERP_SESSION_IDLE_TIMEOUT_SECONDS,
    maxLifeSeconds: ERP_SESSION_MAX_LIFE_SECONDS
  };

supabaseInsertMinimal('erp_sessions', {
  token: token,
  user_id: user.user_id,
  payload: JSON.stringify(sessionPayload)
});

// Store in cache with sliding idle timeout.
const cache = CacheService.getScriptCache();
cache.put(token, JSON.stringify(sessionPayload), ERP_SESSION_IDLE_TIMEOUT_SECONDS);

  return { ok:true, token, user:sessionPayload };
}

function logout(token) {

  if (token) {
    CacheService.getScriptCache().remove(token);
    supabaseDelete('erp_sessions', {
      token: 'eq.' + token
    });
  }

  return { ok: true };
}

// ---------- SESSION ----------
function getSessionUser(token){

  if (!token) return null;

  const cache = CacheService.getScriptCache();
  let data = cache.get(token);

  // 1️⃣ Try cache first
  if (data) {
    try {
      const cachedSession = JSON.parse(data);
      if (_isSessionExpired_(cachedSession)) {
        cache.remove(token);
        try {
          supabaseDelete('erp_sessions', {
            token: 'eq.' + token
          });
        } catch (e) {}
        return null;
      }
      const activeSession = _prepareActiveSession_(cachedSession, token, false);
      cache.put(token, JSON.stringify(activeSession), ERP_SESSION_IDLE_TIMEOUT_SECONDS);
      return activeSession;
    } catch(e){
      return null;
    }
  }

  // 2️⃣ Fallback to Supabase
  const rows = supabaseSelect('erp_sessions', {
    select: 'payload',
    filters: { token: 'eq.' + token },
    limit: 1
  });

  if (!rows || !rows.length) return null;

  const row = rows[0];
  if (!row.payload) return null;

  try {
    const session = JSON.parse(row.payload);

    if (_isSessionExpired_(session)) {
      try {
        supabaseDelete('erp_sessions', {
          token: 'eq.' + token
        });
      } catch (e) {}
      return null;
    }

    const activeSession = _prepareActiveSession_(session, token, true);

    // Restore cache for next time.
    cache.put(token, JSON.stringify(activeSession), ERP_SESSION_IDLE_TIMEOUT_SECONDS);

    return activeSession;
  } catch(e){
    return null;
  }
}

function touchSession(token) {
  const user = getSessionUser(token);
  return {
    ok: !!user,
    user: user || null
  };
}
// ---------- PERMISSION ----------
function _userHasPermission_(user, moduleCode, action) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  const perm = (user.permissions || []).find(function(p) {
    return p && p.module_code === moduleCode;
  });
  if (!perm) return false;
  return !!perm[action];
}

function checkPermission(token, moduleCode, action){

  const user = getSessionUser(token);
  if (!user) throw new Error('Unauthorized');

  return _userHasPermission_(user, moduleCode, action);
}

// ================================
// ADMIN FUNCTIONS
// ================================

function adminCreateRole(payload, token){
  _requireAdmin_(token);

  const roleCode = String(payload.roleCode || '').trim().toUpperCase();
  if (!roleCode)
    throw new Error('Role code required');

  const existing = supabaseSelect('roles', {
    select: 'id',
    filters: { role_code: 'eq.' + roleCode },
    limit: 1
  }) || [];
  if (existing.length)
    throw new Error('Role already exists');

  const inserted = supabaseInsert('roles',{
    role_code: roleCode,
    role_name: payload.roleName || roleCode,
    active:true
  }) || [];

  _clearAdminRolesCache_();

  return { ok:true, role: inserted[0] || null };
}

function adminListRoles(token){
  _requireAdmin_(token);

  const cache = CacheService.getScriptCache();
  const cached = cache.get(_adminRolesCacheKey_());
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {}
  }

  const roles = supabaseSelect('roles',{
    select:'id,role_code,role_name,active',
    order:'role_code.asc'
  }) || [];

  cache.put(_adminRolesCacheKey_(), JSON.stringify(roles), 300);
  return roles;
}

function adminCreateUser(payload, token){
  _requireAdmin_(token);

  const userId = String(payload.userId || '').trim();
  const displayName = String(payload.displayName || payload.userId || '').trim();

  if (!userId || !payload.password || !payload.roleId)
    throw new Error('Missing required fields');

  _assertPasswordPolicy_(payload.password);
  if (_getUserByUserId_(userId))
    throw new Error('User already exists');
  const createRole = _getRoleById_(payload.roleId);
  if (!createRole)
    throw new Error('Invalid role');
  if (createRole.active === false)
    throw new Error('Cannot assign an inactive role');

  const hash = _hashPassword_(payload.password);

  supabaseInsertMinimal('users',{
    user_id:userId,
    password_hash:hash,
    display_name:displayName || userId,
    role_id:payload.roleId,
    active:true
  });

  return { ok:true };
}

function adminListUsers(token){
  _requireAdmin_(token);

  return supabaseSelect('users',{
    select:'id,user_id,display_name,role_id,active',
    order:'user_id.asc'
  }) || [];
}

function adminUpdateRole(payload, token){
  _requireAdmin_(token);

  const roleId = String(payload.roleId || '').trim();
  if (!roleId) throw new Error('Role required');

  const role = _getRoleById_(roleId);
  if (!role) throw new Error('Role not found');

  const nextCode = String(payload.roleCode || role.role_code || '').trim().toUpperCase();
  const nextName = String(payload.roleName || role.role_name || '').trim();
  const nextActive = payload.active === false ? false : true;

  if (!nextCode) throw new Error('Role code required');
  if (!nextName) throw new Error('Role name required');

  if (String(role.role_code).toUpperCase() === 'ADMIN') {
    if (nextActive === false) throw new Error('ADMIN role cannot be deactivated');
    if (nextCode !== 'ADMIN') throw new Error('ADMIN role code cannot be changed');
  }

  const duplicates = supabaseSelect('roles', {
    filters: { role_code: 'eq.' + nextCode },
    limit: 5
  }) || [];
  if (duplicates.some(function(item){ return item.id !== roleId; }))
    throw new Error('Role code already exists');

  supabaseUpdateMinimal('roles', {
    id: 'eq.' + roleId
  }, {
    role_code: nextCode,
    role_name: nextName,
    active: nextActive
  });

  _clearAdminRolesCache_();

  const affectedUsers = supabaseSelect('users', {
    filters: { role_id: 'eq.' + roleId },
    select: 'user_id',
    limit: 500
  }) || [];
  affectedUsers.forEach(function(item){
    _invalidateUserSessions_(item.user_id);
  });

  return { ok:true };
}

function adminUpdateUser(payload, token){
  const admin = _requireAdmin_(token);

  const userId = String(payload.userId || '').trim();
  if (!userId) throw new Error('User required');

  const user = _getUserByUserId_(userId);
  if (!user) throw new Error('User not found');

  const nextDisplayName = String(payload.displayName || user.display_name || user.user_id).trim();
  const nextRoleId = String(payload.roleId || user.role_id || '').trim();
  const nextActive = payload.active === false ? false : true;

  if (!nextRoleId) throw new Error('Role required');

  const role = _getRoleById_(nextRoleId);
  if (!role) throw new Error('Invalid role');
  if (role.active === false) throw new Error('Cannot assign an inactive role');

  if (admin.userId === userId && nextActive === false)
    throw new Error('You cannot deactivate your own account');

  supabaseUpdateMinimal('users', {
    id: 'eq.' + user.id
  }, {
    display_name: nextDisplayName || user.user_id,
    role_id: nextRoleId,
    active: nextActive
  });

  _invalidateUserSessions_(user.user_id);

  return { ok:true };
}

function adminResetUserPassword(payload, token){
  _requireAdmin_(token);

  const userId = String(payload.userId || '').trim();
  const newPassword = String(payload.newPassword || '').trim();
  if (!userId || !newPassword) throw new Error('User and password required');

  const user = _getUserByUserId_(userId);
  if (!user) throw new Error('User not found');

  _assertPasswordPolicy_(newPassword);

  supabaseUpdateMinimal('users', {
    id: 'eq.' + user.id
  }, {
    password_hash: _hashPassword_(newPassword)
  });

  _invalidateUserSessions_(user.user_id);

  return { ok:true };
}

function changeOwnPassword(currentPassword, newPassword, token){
  const sessionUser = getSessionUser(token);
  if (!sessionUser) throw new Error('Unauthorized');

  const user = _getUserByUserId_(sessionUser.userId);
  if (!user || user.active === false) throw new Error('User account not available');

  if (!_verifyPassword_(currentPassword, user.password_hash))
    throw new Error('Current password is incorrect');

  _assertPasswordPolicy_(newPassword);

  if (String(currentPassword || '') === String(newPassword || ''))
    throw new Error('New password must be different');

  supabaseUpdateMinimal('users', {
    id: 'eq.' + user.id
  }, {
    password_hash: _hashPassword_(newPassword)
  });

  _invalidateUserSessions_(user.user_id);

  return { ok:true };
}

function adminListPermissions(roleId, token){
  _requireAdmin_(token);

  if (!roleId) return [];

  // 🔹 Master Module List (define once centrally if possible)
const MODULES = [
    'SALES_ORDER_ENTRY',
    'SALES_ORDER_APPROVAL',
    'ARTWORK',
    'MASTERS',
    'PURCHASE',
  'PLATES',
  'ITEMMASTER',
  'WOW',
  'INVENTORY',
  'PACKING',
  'DISPATCH',
  'PRODUCTION',
  'BILLING',
  'REPORTS',
  'COSTING',
  'MASTERADMIN'
];

  const existing = supabaseSelect('role_permissions',{
    filters:{ role_id:'eq.' + roleId }
  }) || [];

  return MODULES.map(moduleCode => {

    const row = existing.find(r => r.module_code === moduleCode);

    return {
      module_code: moduleCode,
      can_view: row?.can_view || false,
      can_create: row?.can_create || false,
      can_edit: row?.can_edit || false,
      can_delete: row?.can_delete || false,
      can_approve_accounts: row?.can_approve_accounts || false,
      can_approve_business: row?.can_approve_business || false
    };
  });
}

function adminSaveRolePermissions(payload, token){
  _requireAdmin_(token);

  const roleId = payload.roleId;
  const matrix = payload.permissions || [];

  supabaseDeleteMinimal('role_permissions',{
    role_id:'eq.' + roleId
  });

  if (!matrix.length) return { ok:true };

  const rows = matrix.map(m => ({
    role_id:roleId,
    module_code:m.module_code,
    can_view:m.can_view,
    can_create:m.can_create,
    can_edit:m.can_edit,
    can_delete:m.can_delete,
    can_approve_accounts:m.can_approve_accounts,
    can_approve_business:m.can_approve_business
  }));

  supabaseBulkInsertMinimal('role_permissions', rows);

  return { ok:true };
}

/* =========================
   Sales Order: FY-sharded DB and idempotent save
   ========================= */

function _salesOrderParseCombinedRemarks_(remarks) {
  const text = String(remarks || '').trim();
  const values = {
    modeOfTransport: '',
    transportPreference: '',
    transportPayment: '',
    billingRemarks: ''
  };
  if (!text) return values;

  const labels = [
    ['modeOfTransport', 'Mode of Transport'],
    ['transportPreference', 'Transport Preference'],
    ['transportPayment', 'Transport Payment'],
    ['billingRemarks', 'Billing Remarks']
  ];

  labels.forEach(function(entry, index) {
    const key = entry[0];
    const label = entry[1];
    const next = labels[index + 1] ? labels[index + 1][1] : '';
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedNext = next ? next.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
    const tail = next ? '(?=\\s*\\|\\s*' + escapedNext + '\\s*:|$)' : '$';
    const match = text.match(new RegExp(escapedLabel + '\\s*:\\s*(.*?)' + tail, 'i'));
    if (match && match[1] != null) values[key] = String(match[1]).trim();
  });

  if (!values.billingRemarks && !values.modeOfTransport && !values.transportPreference && !values.transportPayment) {
    values.billingRemarks = text;
  }
  return values;
}

function _salesOrderBuildCombinedRemarks_(header) {
  const h = header || {};
  const parts = [];
  if (h.modeOfTransport) parts.push('Mode of Transport: ' + String(h.modeOfTransport).trim());
  if (h.transportPreference) parts.push('Transport Preference: ' + String(h.transportPreference).trim());
  if (h.transportPayment) parts.push('Transport Payment: ' + String(h.transportPayment).trim());
  if (h.billingRemarks) parts.push('Billing Remarks: ' + String(h.billingRemarks).trim());
  return parts.join(' | ');
}

function _salesOrderNormalizeHeader_(header) {
  const h = Object.assign({}, header || {});
  const parsed = _salesOrderParseCombinedRemarks_(h.soRemarks || h.remarks || '');
  h.modeOfTransport = String(h.modeOfTransport || h.mode_of_transport || parsed.modeOfTransport || '').trim();
  h.transportPreference = String(h.transportPreference || h.transport_preference || parsed.transportPreference || '').trim();
  h.transportPayment = String(h.transportPayment || h.transport_payment || parsed.transportPayment || '').trim();
  h.billingRemarks = String(h.billingRemarks || h.billing_remarks || parsed.billingRemarks || '').trim();
  h.soRemarks = _salesOrderBuildCombinedRemarks_(h);
  return h;
}

function _salesOrderEnrichHeaderRow_(row) {
  if (!row || typeof row !== 'object') return row;
  const parsed = _salesOrderParseCombinedRemarks_(row.remarks || '');
  if (!row.mode_of_transport) row.mode_of_transport = parsed.modeOfTransport || '';
  if (!row.transport_preference) row.transport_preference = parsed.transportPreference || '';
  if (!row.transport_payment) row.transport_payment = parsed.transportPayment || '';
  if (!row.billing_remarks) row.billing_remarks = parsed.billingRemarks || '';
  return row;
}

function _salesOrderMatchMissingColumn_(message, key) {
  const msg = String(message || '');
  return msg.indexOf('column "' + key + '" of relation "sales_orders" does not exist') !== -1 ||
    (msg.indexOf('sales_orders.' + key) !== -1 && msg.indexOf('does not exist') !== -1);
}

function _salesOrderInsertHeader_(payload) {
  let current = Object.assign({}, payload || {});
  const optionalKeys = ['mode_of_transport', 'transport_preference', 'transport_payment', 'billing_remarks'];
  while (true) {
    try {
      return supabaseInsert('sales_orders', current);
    } catch (err) {
      const missing = optionalKeys.find(function(key) {
        return Object.prototype.hasOwnProperty.call(current, key) && _salesOrderMatchMissingColumn_(err && err.message, key);
      });
      if (!missing) throw err;
      delete current[missing];
    }
  }
}

function _salesOrderUpdateHeader_(filters, payload) {
  let current = Object.assign({}, payload || {});
  const optionalKeys = ['mode_of_transport', 'transport_preference', 'transport_payment', 'billing_remarks'];
  while (true) {
    try {
      return supabaseUpdate('sales_orders', filters, current);
    } catch (err) {
      const missing = optionalKeys.find(function(key) {
        return Object.prototype.hasOwnProperty.call(current, key) && _salesOrderMatchMissingColumn_(err && err.message, key);
      });
      if (!missing) throw err;
      delete current[missing];
    }
  }
}

function _salesOrderSelectBillingHeaders_(filters, order) {
  try {
    return (supabaseSelect('sales_orders', {
      select: 'id,so_number,so_date,client_code,currency,po_number,po_date,remarks,sales_rep,status,mode_of_transport,transport_preference,transport_payment,billing_remarks',
      filters: filters,
      order: order
    }) || []).map(_salesOrderEnrichHeaderRow_);
  } catch (err) {
    const msg = String((err && err.message) || '');
    const missingNewCols =
      msg.indexOf('sales_orders.mode_of_transport') !== -1 ||
      msg.indexOf('sales_orders.transport_preference') !== -1 ||
      msg.indexOf('sales_orders.transport_payment') !== -1 ||
      msg.indexOf('sales_orders.billing_remarks') !== -1 ||
      msg.indexOf('relation "sales_orders"') !== -1 && msg.indexOf('does not exist') !== -1;
    if (!missingNewCols) throw err;
    return (supabaseSelect('sales_orders', {
      select: 'id,so_number,so_date,client_code,currency,po_number,po_date,remarks,sales_rep,status',
      filters: filters,
      order: order
    }) || []).map(_salesOrderEnrichHeaderRow_);
  }
}

function _salesOrderTodayIso_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Calcutta', 'yyyy-MM-dd');
}

function _salesOrderItemTaxMap_(lines) {
  const map = {};

  getMTradingCatalog_().concat(getSLCommonCatalog_()).forEach(function(item) {
    const code = String(item.itemCode || '').trim();
    if (!code) return;
    map[code.toUpperCase()] = {
      hsnGroup: String(item.hsnGroup || '').trim(),
      gstPct: Number(item.gstPct || 0)
    };
  });

  const productCodes = [...new Set((lines || []).map(function(line) {
    return String(line && (line.productCode || line.product_code) || '').trim();
  }).filter(Boolean))];

  if (!productCodes.length) return map;

  try {
    _supabaseSelectByKeyInBatches_(
      'items',
      'item_code,hsn_group,gst_pct',
      'item_code',
      productCodes,
      null,
      40
    ).forEach(function(item) {
      const code = String(item.item_code || '').trim();
      if (!code) return;
      map[code.toUpperCase()] = {
        hsnGroup: String(item.hsn_group || '').trim(),
        gstPct: Number(item.gst_pct || 0)
      };
    });
  } catch (err) {
    Logger.log('Sales order item HSN/GST lookup failed: ' + ((err && err.message) || err));
  }

  return map;
}

function _salesOrderLineHsnGroup_(line, itemTaxMap) {
  const taxMap = itemTaxMap || {};
  const productCode = String(line && (line.productCode || line.product_code) || '').trim();
  const itemInfo = productCode ? taxMap[productCode.toUpperCase()] : null;
  return String(
    (line && (line.hsnGroup || line.hsn_group)) ||
    (itemInfo && itemInfo.hsnGroup) ||
    ''
  ).trim();
}

function _salesOrderLineGstPct_(line, hsnGroup, itemTaxMap) {
  const taxMap = itemTaxMap || {};
  const productCode = String(line && (line.productCode || line.product_code) || '').trim();
  const itemInfo = productCode ? taxMap[productCode.toUpperCase()] : null;
  const lineGst = Number(line && (line.gstPercent || line.gst_pct) || 0);
  if (lineGst > 0) return lineGst;
  if (itemInfo && Number(itemInfo.gstPct || 0) > 0) return Number(itemInfo.gstPct || 0);

  const hsnKey = String(hsnGroup || '').trim();
  if (hsnKey) {
    const masters = augmentSalesOrderMasters_(getUnifiedMasters());
    const hsnToGst = masters.hsnToGst || {};
    const mapped = Number(hsnToGst[hsnKey] || hsnToGst[hsnKey.toUpperCase()] || 0);
    if (mapped > 0) return mapped;
  }

  return 0;
}

function generateSalesOrderNumber(prefix, orderDate) {
  const dt = orderDate ? new Date(orderDate) : new Date();
  const fy = getFinancialYear(dt);

  const res = supabaseRpc('generate_so_number', {
    p_prefix: prefix,
    p_fy: fy
  });

  // Supabase RPC sometimes returns array
  const row = Array.isArray(res) ? res[0] : res;

  if (!row || !row.so_number) {
    throw new Error('Failed to generate SO number');
  }

  return row.so_number;
}

function getFinancialYear(dt) {
  const y = dt.getFullYear();
  const m = dt.getMonth() + 1;
  const yy = n => String(n).slice(-2);
  return (m >= 4)
    ? `${yy(y)}_${yy(y + 1)}`
    : `${yy(y - 1)}_${yy(y)}`;
}

function saveOrderWithKey(payload, idemKey, apiKey, username) {

if (!payload?.header) throw new Error('Invalid payload');

const h = _salesOrderNormalizeHeader_(payload.header);
h.orderDate = _salesOrderTodayIso_();
const lines = payload.lines || [];
const createdBy = String(username || '').trim() || 'ERP User';
const itemTaxMap = _salesOrderItemTaxMap_(lines);

/* ========================
   VALIDATION
======================== */

if (!h.orderPrefix) throw new Error('Order Prefix required');
if (!h.clientCode) throw new Error('Client required');
if (!h.modeOfTransport) throw new Error('Mode of Transport required');
if (!h.transportPreference) throw new Error('Transport Preference required');
if (!h.transportPayment) throw new Error('Transport Payment required');
if (!h.billingRemarks) throw new Error('Billing Remarks required');
if (!lines.length) throw new Error('At least one line required');

lines.forEach((l,i)=>{
if(!l.productCode) throw new Error('Line '+(i+1)+' Product Code required');
if(!_salesOrderLineHsnGroup_(l, itemTaxMap)) throw new Error('Line '+(i+1)+' HSN Group required');
if(!l.qty || l.qty<=0) throw new Error('Line '+(i+1)+' Qty invalid');
if(!l.approvedRate || l.approvedRate<=0) throw new Error('Line '+(i+1)+' Rate invalid');
});


/* ========================
   IDEMPOTENCY LOCK
======================== */

try{

supabaseInsert('idempotency_keys',{
key: idemKey,
created_at: new Date().toISOString()
});

}catch(e){

const existing = supabaseSelect('idempotency_keys',{
filters:{ key:'eq.'+idemKey },
limit:1
})[0];

if(existing?.response) return existing.response;

throw e;
}


/* ========================
   GENERATE SO NUMBER
======================== */

const soNumber = generateSalesOrderNumber(h.orderPrefix,h.orderDate);

if(!soNumber) throw new Error('SO number generation failed');


/* ========================
   CALCULATE TOTALS
======================== */

let subtotal=0;
let discount=0;
let cgst=0;
let sgst=0;
let igst=0;
let grand=0;

const intra =
(h.clientState || '').toLowerCase() ===
(DEFAULT_MASTERS.companyState || COMPANY_STATE).toLowerCase();


const lineRows = lines.map((l,idx)=>{

const qty = Number(l.qty || 0);
const rate = Number(l.approvedRate || 0);
const discPct = Number(l.discPercent || 0);
const hsnGroup = _salesOrderLineHsnGroup_(l, itemTaxMap);
const gstPct = _salesOrderLineGstPct_(l, hsnGroup, itemTaxMap);

const amount = qty * rate;
const discAmt = amount * discPct / 100;

const net = amount - discAmt;

let cgstAmt=0;
let sgstAmt=0;
let igstAmt=0;

if(intra){

cgstAmt = net * (gstPct/2) / 100;
sgstAmt = net * (gstPct/2) / 100;

}else{

igstAmt = net * gstPct / 100;

}

const total = net + cgstAmt + sgstAmt + igstAmt;


/* accumulate totals */

subtotal += amount;
discount += discAmt;
cgst += cgstAmt;
sgst += sgstAmt;
igst += igstAmt;
grand += total;


return {

line_no: idx+1,

product_code:l.productCode,
product_name:l.productName,
category:l.category,
hsn_group:hsnGroup,

qty,
unit:l.unit,
rate,

disc_pct:discPct,
gst_pct:gstPct,

amount,
disc_amount:discAmt,

cgst:cgstAmt,
sgst:sgstAmt,
igst:igstAmt,

line_total:total,

job_type:l.jobType,
job_reference:l.jobReference,
job_priority:l.jobPriority,

product_remarks:l.productRemarks,

division:l.division,
quote_no:l.quoteNo,
pm_code:l.pmCode,

prepress_remarks:l.prepressRemarks,

expected_delivery:l.expectedDelivery || null,
final_delivery:l.finalDelivery || null

};

});


/* ========================
   INSERT HEADER
======================== */

const soRow = _salesOrderInsertHeader_(
{

so_number:soNumber,
so_date:h.orderDate,
order_prefix:h.orderPrefix,

client_code:h.clientCode,

currency:h.currency || 'INR',

sales_rep:h.salesRep || '',
sales_type:h.salesType || '',

po_number:h.poNumber || '',
po_date:h.poDate || null,

remarks:h.soRemarks || '',
mode_of_transport:h.modeOfTransport || null,
transport_preference:h.transportPreference || null,
transport_payment:h.transportPayment || null,
billing_remarks:h.billingRemarks || null,

status:'OPEN',

subtotal,
discount_total:discount,
cgst_total:cgst,
sgst_total:sgst,
igst_total:igst,
grand_total:grand,

created_by:createdBy

}
)[0];

if(!soRow?.id) throw new Error('Sales order creation failed');

const soId = soRow.id;


/* ========================
   INSERT LINES
======================== */

lineRows.forEach(r=>{
r.so_id = soId;
});

supabaseBulkInsert('sales_order_lines',lineRows);


/* ========================
   CREATE ARTWORK
======================== */

createArtworksFromSoLines(soId);


/* ========================
   RESPONSE
======================== */

const response = {

soNumber,
soId,
lineCount: lineRows.length,
grandTotal: grand

};


/* ========================
   SAVE IDEMPOTENT RESPONSE
======================== */

supabaseUpdate(
'idempotency_keys',
{ key:'eq.'+idemKey },
{ response }
);


return response;

}

function _salesOrderHasLinkedLineActivity_(soNumber, lineIds) {
  const ids = (lineIds || []).map(function(id) {
    return String(id || '').trim();
  }).filter(Boolean);

  if (!ids.length) return false;

  const lineFilter = { so_line_id: _supabaseInFilter_(ids) };
  const hasRows = function(table, filters) {
    return (supabaseSelect(table, {
      select: 'id',
      filters: filters,
      limit: 1
    }) || []).length > 0;
  };

  if (hasRows('packing_records', lineFilter)) return true;
  if (hasRows('dispatch_records', lineFilter)) return true;
  if (hasRows('invoice_lines', lineFilter)) return true;
  if (hasRows('fg_stock_adjustments', lineFilter)) return true;

  if (soNumber) {
    if ((supabaseSelect('work_order_jobs', {
      select: 'wo_id',
      filters: { so_number: 'eq.' + soNumber },
      limit: 1
    }) || []).length > 0) {
      return true;
    }
  }

  return false;
}

function updateSalesOrder(soId,payload){

if(!soId) throw new Error('SO id missing');

const header = _salesOrderNormalizeHeader_(payload.header);
const lines = payload.lines || [];
const itemTaxMap = _salesOrderItemTaxMap_(lines);

if (!header.modeOfTransport) throw new Error('Mode of Transport required');
if (!header.transportPreference) throw new Error('Transport Preference required');
if (!header.transportPayment) throw new Error('Transport Payment required');
if (!header.billingRemarks) throw new Error('Billing Remarks required');
if (!lines.length) throw new Error('At least one line required');

lines.forEach(function(l, i) {
  if (!l.productCode) throw new Error('Line ' + (i + 1) + ' Product Code required');
  if (!_salesOrderLineHsnGroup_(l, itemTaxMap)) throw new Error('Line ' + (i + 1) + ' HSN Group required');
  if (!l.qty || Number(l.qty) <= 0) throw new Error('Line ' + (i + 1) + ' Qty invalid');
  if (!l.approvedRate || Number(l.approvedRate) <= 0) throw new Error('Line ' + (i + 1) + ' Rate invalid');
});


/* ========================
   FETCH SO
======================== */

const so = supabaseSelect('sales_orders',{
filters:{ id:'eq.'+soId }
})[0];

if(!so) throw new Error('Sales Order not found');
header.orderDate = so.so_date || _salesOrderTodayIso_();

const approvalLines = supabaseSelect('sales_order_lines',{
select:'accounts_status,business_status',
filters:{ so_id:'eq.'+soId }
}) || [];
const approvalHold =
  String(so.accounts_approved || '').toUpperCase() === 'HOLD' ||
  String(so.business_approved || '').toUpperCase() === 'HOLD' ||
  approvalLines.some(function(line){
    return String(line.accounts_status || '').toUpperCase() === 'HOLD' ||
      String(line.business_status || '').toUpperCase() === 'HOLD';
  });

if(
  (so.accounts_approved==='APPROVED' || so.business_approved==='APPROVED') &&
  !approvalHold &&
  String(so.status || '').toUpperCase() !== 'HOLD'
){
throw new Error('Approved SO cannot be edited');
}


/* ========================
   CALCULATE TOTALS
======================== */

let subtotal=0;
let discount=0;
let cgst=0;
let sgst=0;
let igst=0;
let grand=0;

const intra =
(header.clientState || '').toLowerCase() ===
(DEFAULT_MASTERS.companyState || COMPANY_STATE).toLowerCase();

const existingLines = supabaseSelect('sales_order_lines',{
select:'id,line_no',
filters:{ so_id:'eq.'+soId },
order:'line_no.asc'
}) || [];

const existingLineById = {};
const existingLineByLineNo = {};
existingLines.forEach(function(row){
  const id = String(row.id || '').trim();
  const lineNo = String(row.line_no || '').trim();
  if (id) existingLineById[id] = row;
  if (lineNo) existingLineByLineNo[lineNo] = row;
});


const rows = lines.map((l,i)=>{

const qty = Number(l.qty || 0);
const rate = Number(l.approvedRate || 0);
const discPct = Number(l.discPercent || 0);
const hsnGroup = _salesOrderLineHsnGroup_(l, itemTaxMap);
const gstPct = _salesOrderLineGstPct_(l, hsnGroup, itemTaxMap);
const requestedLineId = String(l.lineId || l.id || '').trim();
const fallbackLine = existingLineByLineNo[String(i + 1)] || null;
const persistedLine = (requestedLineId && existingLineById[requestedLineId]) ? existingLineById[requestedLineId] : fallbackLine;

const amount = qty * rate;
const discAmt = amount * discPct / 100;

const net = amount - discAmt;

let cgstAmt=0;
let sgstAmt=0;
let igstAmt=0;

if(intra){

cgstAmt = net * (gstPct/2) / 100;
sgstAmt = net * (gstPct/2) / 100;

}else{

igstAmt = net * gstPct / 100;

}

const total = net + cgstAmt + sgstAmt + igstAmt;


/* accumulate totals */

subtotal += amount;
discount += discAmt;
cgst += cgstAmt;
sgst += sgstAmt;
igst += igstAmt;
grand += total;


return {

so_id:soId,
id: persistedLine && persistedLine.id ? persistedLine.id : undefined,
line_no:i+1,

product_code:l.productCode,
product_name:l.productName,
category:l.category,
hsn_group:hsnGroup,

qty,
unit:l.unit,
rate,

disc_pct:discPct,
gst_pct:gstPct,

amount,
disc_amount:discAmt,

cgst:cgstAmt,
sgst:sgstAmt,
igst:igstAmt,

line_total:total,

job_type:l.jobType,
job_reference:l.jobReference,
job_priority:l.jobPriority,

product_remarks:l.productRemarks,

division:l.division,
quote_no:l.quoteNo,
pm_code:l.pmCode,

prepress_remarks:l.prepressRemarks,

expected_delivery:l.expectedDelivery || null,
final_delivery:l.finalDelivery || null

};

});

const allExistingLinesMatched =
existingLines.length === rows.length &&
rows.every(function(row, idx){
  return String(row.id || '') === String((existingLines[idx] || {}).id || '');
});

if (!allExistingLinesMatched && _salesOrderHasLinkedLineActivity_(so.so_number, existingLines.map(function(row){ return row.id; }))) {
  throw new Error('This sales order already has linked production or billing records. Edit existing line values only; add/remove/reorder lines is blocked.');
}


/* ========================
   UPDATE HEADER
======================== */

_salesOrderUpdateHeader_(
{ id:'eq.'+soId },
{

so_date: header.orderDate || new Date().toISOString().slice(0,10),
order_prefix:header.orderPrefix,
client_code:header.clientCode,

currency:header.currency,

sales_rep:header.salesRep,
sales_type:header.salesType,

po_number:header.poNumber,
po_date: header.poDate || null,

remarks:header.soRemarks,
mode_of_transport:header.modeOfTransport || null,
transport_preference:header.transportPreference || null,
transport_payment:header.transportPayment || null,
billing_remarks:header.billingRemarks || null,

subtotal,
discount_total:discount,
cgst_total:cgst,
sgst_total:sgst,
igst_total:igst,
grand_total:grand

}
);


/* ========================
   UPDATE EXISTING LINES IN PLACE
======================== */

if (allExistingLinesMatched) {
  rows.forEach(function(row){
    const rowId = String(row.id || '').trim();
    if (!rowId) throw new Error('Sales order line id missing during update');
    const update = Object.assign({}, row);
    delete update.id;
    supabaseUpdateMinimal('sales_order_lines', { id:'eq.' + rowId }, update);
  });
} else {
  supabaseDelete('sales_order_lines',{
  so_id:'eq.'+soId
  });


  /* ========================
     DELETE OLD ARTWORK
  ======================== */

  supabaseDelete('artworks',{
  so_id:'eq.'+soId
  });


  /* ========================
     INSERT NEW LINES
  ======================== */

  supabaseBulkInsert('sales_order_lines',rows.map(function(row){
    const copy = Object.assign({}, row);
    delete copy.id;
    return copy;
  }));
}


/* ========================
   RECREATE ARTWORK
======================== */

createArtworksFromSoLines(soId);


return {

soNumber: so.so_number,
updated:true

};

}

/* =========================
   Sales Order LOAD (Supabase)
   ========================= */

function _salesOrderListViewNeedsFallback_(err) {
  const msg = String((err && err.message) || '').toLowerCase();
  return (
    (msg.indexOf('v_sales_orders_list_fast') !== -1 && msg.indexOf('does not exist') !== -1) ||
    (msg.indexOf('v_sales_orders_list_fast.') !== -1 && msg.indexOf('does not exist') !== -1)
  );
}

function _supabaseBulkInsertMinimalInChunks_(table, rows, maxRows, maxPayloadChars) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return [];

  const chunks = [];
  const rowLimit = Math.max(1, Number(maxRows || 50));
  const payloadLimit = Math.max(10000, Number(maxPayloadChars || 400000));
  let current = [];

  list.forEach(function(row) {
    const candidate = current.concat([row]);
    const candidateSize = JSON.stringify(candidate).length;
    if (current.length && (candidate.length > rowLimit || candidateSize > payloadLimit)) {
      chunks.push(current.slice());
      current = [row];
      return;
    }
    current = candidate;
  });
  if (current.length) chunks.push(current);

  const out = [];
  chunks.forEach(function(chunk) {
    const result = supabaseBulkInsertMinimal(table, chunk) || [];
    if (Array.isArray(result) && result.length) out.push.apply(out, result);
  });
  return out;
}

function _salesOrderResolvedApprovalStatus_(preferred, fallback) {
  const primary = String(preferred || '').trim().toUpperCase();
  const secondary = String(fallback || '').trim().toUpperCase();
  if (primary === 'REJECTED' || secondary === 'REJECTED') return 'REJECTED';
  if (primary === 'HOLD' || secondary === 'HOLD') return 'HOLD';
  return primary || secondary || 'PENDING';
}

function _salesOrderRollupApprovalStatus_(current, next) {
  const active = String(current || '').trim().toUpperCase() || 'APPROVED';
  const state = String(next || '').trim().toUpperCase() || 'PENDING';
  if (active === 'REJECTED' || state === 'REJECTED') return 'REJECTED';
  if (active === 'HOLD' || state === 'HOLD') return 'HOLD';
  if (state !== 'APPROVED') return 'PENDING';
  return active;
}

function _salesOrderLineDetailsViewNeedsFallback_(err) {
  const msg = String((err && err.message) || '').toLowerCase();
  return (
    (msg.indexOf('v_sales_order_line_details') !== -1 && msg.indexOf('does not exist') !== -1) ||
    (msg.indexOf('v_sales_order_line_details.') !== -1 && msg.indexOf('does not exist') !== -1)
  );
}

function _salesOrderApplyFallbackUiFields_(rows) {
  return (rows || []).map(function(src) {
    const row = _salesOrderEnrichHeaderRow_(Object.assign({}, src || {}));
    const headerStatus = String(row.status || '').trim().toUpperCase() || 'OPEN';
    const accountsStatus = String(row.accounts_status || row.accounts_approved || '').trim().toUpperCase() || 'PENDING';
    const businessStatus = String(row.business_status || row.business_approved || '').trim().toUpperCase() || 'PENDING';
    const isApprovalHold = accountsStatus === 'HOLD' || businessStatus === 'HOLD';

    row.status = headerStatus;
    row.accounts_status = accountsStatus;
    row.business_status = businessStatus;
    row.wo_status = String(row.wo_status || '').trim().toUpperCase() || 'PENDING';
    row.so_date_text = row.so_date ? String(row.so_date) : '';
    row.client_search_text = [row.client_code || '', row.client_name || ''].join(' ').trim();
    row.is_approval_hold = isApprovalHold;
    row.can_edit =
      headerStatus !== 'CANCELLED' &&
      headerStatus !== 'CLOSED' &&
      (headerStatus === 'HOLD' || isApprovalHold || (accountsStatus !== 'APPROVED' && businessStatus !== 'APPROVED'));
    row.can_hold = headerStatus !== 'CANCELLED' && headerStatus !== 'CLOSED';
    row.can_cancel = headerStatus !== 'CANCELLED' && headerStatus !== 'CLOSED';
    row.hold_target = headerStatus === 'HOLD' ? 'OPEN' : 'HOLD';
    row.hold_label = row.hold_target === 'OPEN' ? 'Reopen' : 'Hold';
    row.line_count = Number(row.line_count || 0);
    row.total_qty = Number(row.total_qty || 0);
    return row;
  });
}

function _salesOrderOverlayHeaderApprovalState_(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const ids = [...new Set(list.map(function(row) {
    return String(row && row.id || '').trim();
  }).filter(Boolean))];

  if (!ids.length) return list;

  const headerRows = _supabaseSelectByKeyInBatches_(
    'sales_orders',
    'id,status,accounts_approved,business_approved,wo_status',
    'id',
    ids,
    'id.asc',
    40
  ) || [];

  const headerMap = {};
  headerRows.forEach(function(row) {
    headerMap[String(row.id || '').trim()] = row || {};
  });

  return list.map(function(src) {
    const row = Object.assign({}, src || {});
    const header = headerMap[String(row.id || '').trim()] || {};
    const headerStatus = String(header.status || row.status || '').trim().toUpperCase() || 'OPEN';
    const headerAccounts = String(header.accounts_approved || '').trim().toUpperCase();
    const headerBusiness = String(header.business_approved || '').trim().toUpperCase();
    const accountsStatus = _salesOrderResolvedApprovalStatus_(row.accounts_status, headerAccounts);
    const businessStatus = _salesOrderResolvedApprovalStatus_(row.business_status, headerBusiness);
    const isApprovalHold = accountsStatus === 'HOLD' || businessStatus === 'HOLD';

    row.status = headerStatus;
    row.accounts_status = accountsStatus;
    row.business_status = businessStatus;
    row.wo_status = String(header.wo_status || row.wo_status || '').trim().toUpperCase() || 'PENDING';
    row.is_approval_hold = isApprovalHold;
    row.can_edit =
      headerStatus !== 'CANCELLED' &&
      headerStatus !== 'CLOSED' &&
      (headerStatus === 'HOLD' || isApprovalHold ||
       (accountsStatus !== 'APPROVED' && businessStatus !== 'APPROVED'));
    row.can_hold = headerStatus !== 'CANCELLED' && headerStatus !== 'CLOSED';
    row.can_cancel = headerStatus !== 'CANCELLED' && headerStatus !== 'CLOSED';
    row.hold_target = headerStatus === 'HOLD' ? 'OPEN' : 'HOLD';
    row.hold_label = row.hold_target === 'OPEN' ? 'Reopen' : 'Hold';
    return row;
  });
}

function _salesOrderDecorateLineDetails_(lineRows, soRows) {
  const lines = Array.isArray(lineRows) ? lineRows : [];
  const headers = Array.isArray(soRows) ? soRows : [];
  const soMap = {};

  headers.forEach(function(row) {
    soMap[String(row.id || row.so_id || '')] = row;
  });

  return lines.map(function(src) {
    const row = Object.assign({}, src || {});
    const soInfo = soMap[String(row.so_id || '')] || {};
    const soNumber = String(row.so_number || soInfo.so_number || '').trim();

    row.so_number = soNumber;
    row.so_date = row.so_date || soInfo.so_date || '';
    row.wo_status = String(row.wo_status || soInfo.wo_status || '').trim().toUpperCase() || 'PENDING';
    row.delivery_display = row.delivery_display || row.final_delivery || row.expected_delivery || '';
    row.remarks_display = row.remarks_display || [row.product_remarks, row.prepress_remarks].filter(Boolean).join(' | ');
    row.accounts_status = String(row.accounts_status || '').trim().toUpperCase() || 'PENDING';
    row.business_status = String(row.business_status || '').trim().toUpperCase() || 'PENDING';
    return row;
  });
}

function _salesOrderSelectLineDetails_(filters) {
  const query = {
    select: [
      'id',
      'so_id',
      'so_number',
      'so_date',
      'line_no',
      'product_code',
      'product_name',
      'category',
      'hsn_group',
      'qty',
      'unit',
      'rate',
      'gst_pct',
      'disc_pct',
      'amount',
      'disc_amount',
      'cgst',
      'sgst',
      'igst',
      'line_total',
      'job_type',
      'job_reference',
      'job_priority',
      'division',
      'quote_no',
      'pm_code',
      'expected_delivery',
      'final_delivery',
      'prepress_remarks',
      'product_remarks',
      'accounts_status',
      'business_status',
      'wo_status',
      'delivery_display',
      'remarks_display'
    ].join(','),
    filters: filters || {},
    order: 'so_id.asc,line_no.asc'
  };

  try {
    const rows = supabaseSelect('v_sales_order_line_details', query) || [];
    return _salesOrderDecorateLineDetails_(rows, []);
  } catch (err) {
    if (!_salesOrderLineDetailsViewNeedsFallback_(err)) throw err;
  }

  const rows = enrichSalesOrderLines(supabaseSelect('sales_order_lines', {
    filters: filters || {},
    order: 'so_id.asc,line_no.asc'
  }) || []);

  const soIds = [...new Set(rows.map(function(row) {
    return String(row.so_id || '').trim();
  }).filter(Boolean))];

  const soRows = soIds.length
    ? _supabaseSelectByKeyInBatches_(
        'sales_orders',
        'id,so_number,so_date,status,wo_status',
        'id',
        soIds,
        'id.asc',
        40
      )
    : [];

  return _salesOrderDecorateLineDetails_(rows, soRows);
}

/**
 * List Sales Orders (lightweight)
 * Used for menus, selectors, dashboards
 */
function listSalesOrders(options){

options = options || {};
const cache = CacheService.getScriptCache();
const cacheKey = _cacheKeyHash_('SO_LIST_V7', JSON.stringify({
  fromDate: options.fromDate || '',
  toDate: options.toDate || '',
  date: options.date || '',
  so: options.so || '',
  client: options.client || '',
  salesRep: options.salesRep || '',
  status: options.status || '',
  salesType: options.salesType || '',
  currency: options.currency || '',
  poNumber: options.poNumber || '',
  limit: options.limit || 250,
  offset: options.offset || 0
}));
const cached = cache.get(cacheKey);
if (cached) {
  try {
    return JSON.parse(cached);
  } catch (err) {
    cache.remove(cacheKey);
  }
}

const applyDateFilters = function(filters, richView) {
  if (options.fromDate && options.toDate) {
    filters.and = `(so_date.gte.${options.fromDate},so_date.lte.${options.toDate})`;
  }
  else if (options.fromDate) {
    filters.so_date = 'gte.' + options.fromDate;
  }
  else if (options.toDate) {
    filters.so_date = 'lte.' + options.toDate;
  }

  if (richView && options.date) {
    filters.so_date_text = 'ilike.*' + options.date + '*';
  }
};

const richQuery = {
  select: [
    'id',
    'so_number',
    'so_date',
    'so_date_text',
    'order_prefix',
    'client_code',
    'client_name',
    'client_search_text',
    'sales_rep',
    'po_number',
    'sales_type',
    'currency',
    'subtotal',
    'discount_total',
    'cgst_total',
    'sgst_total',
    'igst_total',
    'grand_total',
    'remarks',
    'mode_of_transport',
    'transport_preference',
    'transport_payment',
    'billing_remarks',
    'accounts_status',
    'business_status',
    'status',
    'wo_status',
    'line_count',
    'total_qty',
    'latest_delivery',
    'is_approval_hold',
    'can_edit',
    'can_hold',
    'can_cancel',
    'hold_target',
    'hold_label'
  ].join(','),
  order:'so_date.desc,so_number.desc',
  limit: options.limit || 250,
  offset: options.offset || 0,
  filters:{}
};

applyDateFilters(richQuery.filters, true);
if (options.so) richQuery.filters.so_number = 'ilike.*' + options.so + '*';
if (options.client) richQuery.filters.client_search_text = 'ilike.*' + options.client + '*';
if (options.salesRep) richQuery.filters.sales_rep = 'ilike.*' + options.salesRep + '*';
if (options.status) richQuery.filters.status = 'ilike.*' + options.status + '*';
if (options.salesType) richQuery.filters.sales_type = 'ilike.*' + options.salesType + '*';
if (options.currency) richQuery.filters.currency = 'ilike.*' + options.currency + '*';
if (options.poNumber) richQuery.filters.po_number = 'ilike.*' + options.poNumber + '*';

let rows;
let usedFastView = false;
try {
  rows = supabaseSelect('v_sales_orders_list_fast', richQuery) || [];
  usedFastView = true;
} catch (err) {
  if (!_salesOrderListViewNeedsFallback_(err)) throw err;

  const fallbackQuery = {
    select: [
      'id',
      'so_number',
      'so_date',
      'client_code',
      'client_name',
      'sales_rep',
      'po_number',
      'sales_type',
      'currency',
      'subtotal',
      'discount_total',
      'cgst_total',
      'sgst_total',
      'igst_total',
      'grand_total',
      'remarks',
      'accounts_status',
      'business_status',
      'status',
      'wo_status'
    ].join(','),
    order:'so_date.desc,so_number.desc',
    limit: options.limit || 250,
    offset: options.offset || 0,
    filters:{}
  };

  applyDateFilters(fallbackQuery.filters, false);
  if (options.so) fallbackQuery.filters.so_number = 'ilike.*' + options.so + '*';
  if (options.client) {
    fallbackQuery.filters.or =
      '(client_name.ilike.*' + options.client + '*,client_code.ilike.*' + options.client + '*)';
  }
  if (options.salesRep) fallbackQuery.filters.sales_rep = 'ilike.*' + options.salesRep + '*';
  if (options.status) fallbackQuery.filters.status = 'ilike.*' + options.status + '*';
  if (options.salesType) fallbackQuery.filters.sales_type = 'ilike.*' + options.salesType + '*';
  if (options.currency) fallbackQuery.filters.currency = 'ilike.*' + options.currency + '*';
  if (options.poNumber) fallbackQuery.filters.po_number = 'ilike.*' + options.poNumber + '*';

  rows = _salesOrderApplyFallbackUiFields_(supabaseSelect('sales_orders_list', fallbackQuery) || []);
  if (options.date) {
    rows = rows.filter(function(row) {
      return String(row.so_date_text || row.so_date || '').indexOf(options.date) !== -1;
    });
  }
}

  rows = _excludeManualBillingSalesOrdersByNumber_(rows, 'so_number');

  if(!rows.length) return [];

rows = _salesOrderOverlayHeaderApprovalState_(rows);

try { cache.put(cacheKey, JSON.stringify(rows), 30); } catch (e) {}

return rows;

}

function setSalesOrderLifecycleStatus(soNumber, nextStatus, token) {
  if (!soNumber) throw new Error('SO number required');

  const status = String(nextStatus || '').trim().toUpperCase();
  if (!['HOLD', 'OPEN', 'CLOSED', 'CANCELLED'].includes(status)) {
    throw new Error('Invalid sales order status');
  }

  if (token) {
    const allowed = checkPermission(token, 'SALES_ORDER_ENTRY', 'can_edit');
    if (!allowed) throw new Error('You do not have permission to update sales orders');
  }

  const so = supabaseSelect('sales_orders', {
    filters: { so_number: 'eq.' + soNumber },
    limit: 1
  })[0];

  if (!so) throw new Error('Sales order not found');
  if (String(so.status || '').toUpperCase() === 'CANCELLED') {
    throw new Error('Cancelled sales order cannot be updated');
  }

  supabaseUpdate('sales_orders', { so_number: 'eq.' + soNumber }, { status: status });
  return { ok: true, soNumber: soNumber, status: status };
}

function updateSalesOrderStatus(soId){

const lines = supabaseSelect('sales_order_lines',{
select:'accounts_status,business_status',
filters:{ so_id:'eq.'+soId }
});

let acc='APPROVED';
let bus='APPROVED';

lines.forEach(l=>{
acc = _salesOrderRollupApprovalStatus_(acc, l.accounts_status);
bus = _salesOrderRollupApprovalStatus_(bus, l.business_status);

});

const so = supabaseSelect('sales_orders',{
select:'so_number',
filters:{ id:'eq.'+soId }
})[0];

if(!so || !so.so_number) return;

const wo = supabaseSelect('work_order_jobs',{
select:'wo_id',
filters:{ so_number:'eq.'+so.so_number }
});

const woStatus = wo.length ? 'CREATED':'PENDING';

supabaseUpdate(
'sales_orders',
{ id:'eq.'+soId },
{
accounts_approved:acc,
business_approved:bus,
wo_status:woStatus
}
);

}

function refreshWorkOrderStatuses(soNumbers) {
  const list = [...new Set((soNumbers || []).map(function(soNo) {
    return String(soNo || '').trim();
  }).filter(Boolean))];
  if (!list.length) return { ok: true, updated: 0 };

  let updated = 0;
  list.forEach(function(soNumber) {
    const so = (supabaseSelect('sales_orders', {
      select: 'id',
      filters: { so_number: 'eq.' + soNumber },
      limit: 1
    }) || [])[0];

    if (!so?.id) return;
    updateSalesOrderStatus(so.id);
    updated += 1;
  });

  return { ok: true, updated: updated };
}


/**
 * Load Sales Order LINES by SO id
 */
function getSalesOrderLines(soId) {
  if (!soId) throw new Error('Missing soId');
  return _salesOrderSelectLineDetails_({ so_id: 'eq.' + soId });
}

function enrichSalesOrderLines(lines){
  const rows = Array.isArray(lines) ? lines : [];
  const missingCodes = [...new Set(
    rows
      .filter(l => !String(l?.hsn_group || '').trim() && String(l?.product_code || '').trim())
      .map(l => String(l.product_code).trim())
  )];

  if (!missingCodes.length) return rows;

  const itemRows = supabaseSelect('items', {
    select: 'item_code, hsn_group',
    filters: {
      item_code: 'in.(' + missingCodes.join(',') + ')'
    }
  }) || [];

  const itemHsnMap = {};
  itemRows.forEach(r => {
    itemHsnMap[String(r.item_code || '').trim()] = r.hsn_group || '';
  });

  return rows.map(l => {
    const productCode = String(l?.product_code || '').trim();
    const hsnGroup = String(l?.hsn_group || '').trim();
    if (hsnGroup || !productCode || !itemHsnMap[productCode]) return l;
    return Object.assign({}, l, { hsn_group: itemHsnMap[productCode] });
  });
}

function getSalesOrderLinesBatch(ids){

if(!ids || !ids.length) return [];

const lines = _salesOrderSelectLineDetails_({
so_id: _supabaseInFilter_(ids)
});

const map = {};

lines.forEach(l=>{

if(!map[l.so_id]) map[l.so_id] = [];

map[l.so_id].push(l);

});

return Object.keys(map).map(id=>({
so_id:id,
lines:map[id]
}));

}

/**
 * Load FULL Sales Order (header + lines)
 * This replaces all old sheet scans
 */
function loadSalesOrder(soNumber){

if(!soNumber) throw new Error('Missing soNumber');

/* --------------------------
   1️⃣ Load HEADER
--------------------------- */

const headerRows = supabaseSelect('sales_orders',{
filters:{ so_number:'eq.'+soNumber }
}) || [];

if(!headerRows.length) return null;

const header = _salesOrderEnrichHeaderRow_(headerRows[0]);

/* --------------------------
   2️⃣ Load LINES
--------------------------- */

const lines = _salesOrderSelectLineDetails_({
so_id:'eq.'+header.id
});

/* --------------------------
   3️⃣ Return combined
--------------------------- */

return {
header,
lines
};

}


/**
 * JSON wrapper for frontend calls
 */
function loadSalesOrderJson(soNumber) {
  return JSON.stringify(loadSalesOrder(soNumber));
}


/* =========================
   Costing Request – Corrugated Box (v1)
   ========================= */

/**
 * Ensure the CostingRequests sheet exists with a stable header.
 * This is separate from the older "Costings" sheet and is only for
 * capturing requests from Sales (no costing visible to them).
 */
function ensureCostingRequestSheet() {
  var headers = [
    'Costing_No',           // e.g. CST-CORR0001_24-25
    'Product_Type',         // Corrugated Box / Flexo Label / Offset / Digital
    'Status',               // Pending / In Review / Approved / Rejected
    'Customer_Name',
    'Job_Ref',              // Job ref / description
    'Job_Type',             // New / Repeat / etc.
    'Order_Qty_Pcs',
    'L_mm',
    'W_mm',
    'H_mm',
    'Sheet_Deckle_in',
    'Sheet_Cut_in',
    'UPS',
    'Flute_Type',
    'Ply_Spec_JSON',        // JSON string of plies (array)
    'Lamination',           // Yes/No or type text
    'Coating',              // Yes/No or type text
    'Requested_By',         // display name
    'Requested_By_UserId',  // ERP login id
    'Requested_At',
    'Raw_Spec_JSON',        // whole payload as JSON
    'Calc_Snapshot_JSON',   // internal auto-calc snapshot (for costing team)
    'Approved_Rate',        // numeric, optional (per unit / per 1000)
    'Approved_Unit',        // e.g. "Per 1000", "Per Unit"
    'Approved_By',
    'Approved_At',
    'Internal_Remarks'
  ];
  return _ensureSheet(COSTING_REQ_SHEET, headers);
}

/**
 * Simple sequence for costing numbers.
 * Uses same FY pattern as WO: CST-CORR0001_24-25
 */
function _nextCostingNo_(productType) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var pt = (productType || 'GEN').toString().toUpperCase();
    var props = PropertiesService.getScriptProperties();
    var key = 'COSTING_SEQ_' + pt;
    var cur = parseInt(props.getProperty(key) || '0', 10);
    if (!cur || isNaN(cur)) cur = 0;
    cur++;
    props.setProperty(key, String(cur));

    var fy = _fyString_(new Date()); // re-use existing FY helper
    var prefix = (pt === 'CORRUGATED BOX' || pt === 'CORR' || pt === 'CORRUGATED')
      ? 'CST-CORR'
      : 'CST';
    var num = ('0000' + cur).slice(-4);
    return prefix + num + '_' + fy;  // e.g. CST-CORR0001_24-25
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * Very light auto-calculation stub for Corrugated Box.
 * For now we just compute a few non-financial derived values and
 * store them as JSON for costing team (nothing is shown to Sales UI).
 *
 * Later we can replace this with the real costing engine.
 */
function autoCalculateCorrugatedCost(payload) {
  payload = payload || {};

  var orderQty = Number(payload.orderQtyPcs || payload.orderQty || 0) || 0;
  var ups = Number(
    (payload.sheet && payload.sheet.ups) ||
    payload.ups ||
    1
  ) || 1;

  if (ups <= 0) ups = 1;
  var theoreticalSheets = orderQty > 0 ? Math.ceil(orderQty / ups) : 0;

  var dims = payload.dims || {};
  var L = Number(dims.L_mm || dims.L || 0) || 0;
  var W = Number(dims.W_mm || dims.W || 0) || 0;
  var H = Number(dims.H_mm || dims.H || 0) || 0;

  // nothing financial here, just structure for costing team
  return {
    version: '0.1-draft',
    orderQtyPcs: orderQty,
    ups: ups,
    theoreticalSheets: theoreticalSheets,
    dims_mm: { L: L, W: W, H: H },
    fluteType: (payload.fluteType || '').toString(),
    plyCount: Array.isArray(payload.plySpec) ? payload.plySpec.length : 0,
    note: 'This is a non-financial placeholder. To be replaced with real costing logic.'
  };
}

/**
 * Save a Corrugated Box costing request from Sales.
 */
function saveCostingRequestCorrugated(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid costing payload.');
  }

  var productType = (payload.productType || 'Corrugated Box').toString();
  var customerName = (payload.customerName || '').toString().trim();
  var jobRef = (payload.jobRef || payload.description || '').toString().trim();
  var jobType = (payload.jobType || '').toString().trim();
  var orderQty = Number(payload.orderQtyPcs || payload.orderQty || 0) || 0;

  if (!customerName) throw new Error('Customer name is required.');
  if (!jobRef) throw new Error('Job reference / description is required.');
  if (!orderQty || orderQty <= 0) throw new Error('Order quantity (pcs) must be > 0.');

  var dims = payload.dims || {};
  var L = Number(dims.L_mm || dims.L || 0) || 0;
  var W = Number(dims.W_mm || dims.W || 0) || 0;
  var H = Number(dims.H_mm || dims.H || 0) || 0;

  if (!L || !W || !H) {
    throw new Error('Box dimensions L, W, H (mm) are required.');
  }

  var sheet = payload.sheet || {};
  var deckleIn = sheet.deckle_in || sheet.deckleIn || '';
  var cutIn    = sheet.cut_in || sheet.cutIn || '';
  var ups      = Number(sheet.ups || payload.ups || 0) || 0;

  var fluteType = (payload.fluteType || '').toString().trim();
  var plySpec = Array.isArray(payload.plySpec) ? payload.plySpec : [];

  var lamination = (payload.lamination || '').toString();
  var coating = (payload.coating || '').toString();

  // requested by (fallback to Session if not passed from front-end)
  var reqName = (payload.requestedByName || '').toString().trim();
  var reqUserId = (payload.requestedByUserId || '').toString().trim();
  if (!reqUserId) {
    try {
      var u = Session.getActiveUser().getEmail();
      if (u) {
        reqUserId = u;
        if (!reqName) reqName = u;
      }
    } catch (e) {}
  }

  var ssReq = ensureCostingRequestSheet();
  var costNo = _nextCostingNo_(productType);
  var now = new Date();

  var rawJson = JSON.stringify(payload);
  var calcSnapshot = JSON.stringify(autoCalculateCorrugatedCost(payload));

  var row = [
    costNo,
    productType,
    'Pending',            // initial status
    customerName,
    jobRef,
    jobType,
    orderQty,
    L,
    W,
    H,
    deckleIn,
    cutIn,
    ups,
    fluteType,
    JSON.stringify(plySpec),
    lamination,
    coating,
    reqName,
    reqUserId,
    now,
    rawJson,
    calcSnapshot,
    '',   // Approved_Rate
    '',   // Approved_Unit
    '',   // Approved_By
    '',   // Approved_At
    ''    // Internal_Remarks
  ];

  ssReq.appendRow(row);

  return {
    ok: true,
    costingNo: costNo,
    status: 'Pending'
  };
}

// NEW: wrapper so front-end can call google.script.run.saveCostingRequest(payload)
function saveCostingRequest(payload) {
  // For now we only have Corrugated implementation
  return saveCostingRequestCorrugated(payload);
}

/* =========================
   Admin helpers
   ========================= */
/* =========================
   Web entrypoint & UI menu helpers
   ========================= */

function renderUnauthorizedPage() {
  return HtmlService
    .createHtmlOutput(`
      <html>
        <head>
          <style>
            body{
              font-family: system-ui;
              display:flex;
              justify-content:center;
              align-items:center;
              height:100vh;
              background:#f4f6f9;
            }
            .card{
              background:white;
              padding:40px;
              border-radius:12px;
              box-shadow:0 8px 24px rgba(0,0,0,0.1);
              text-align:center;
            }
            h2{color:#d32f2f;margin-bottom:10px;}
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Access Denied</h2>
            <p>You do not have permission to access this module.</p>
          </div>
        </body>
      </html>
    `)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function _canAccessPage_(page, sessionUser, token) {
  const currentPage = String(page || '').toLowerCase();
  if (!sessionUser) return false;
  if (String(sessionUser.role || '').toUpperCase() === 'ADMIN') return true;
  if (currentPage === 'menu') return true;
  if (currentPage === 'masteradmin') return false;
  if (currentPage === 'reports' || currentPage === 'planning') return true;

  const moduleCode = PAGE_MODULE_MAP[currentPage];
  if (!moduleCode) return true;

  try {
    return checkPermission(token, moduleCode, 'can_view');
  } catch (err) {
    return false;
  }
}

function doGet(e) {

  const page = (e?.parameter?.p || 'login').toString().toLowerCase();
  const token = e?.parameter?.token || '';
  const woNo = e?.parameter?.woNo || '';
  const soNo = e?.parameter?.soNo || '';
  const invoiceId = e?.parameter?.invoiceId || '';
  const challanValueMode = e?.parameter?.valueMode || '';

  // 🔥 HANDLE PRINT ROUTE FIRST (NO TEMPLATE ROUTING)
  if (page === 'printwo') {

    const sessionUser = getSessionUser(token);
    if (!sessionUser) {
      return renderLoginRedirectPage();
    }

    return printWorkOrder(woNo);
  }
  if (page === 'printflexowo') {

    const sessionUser = getSessionUser(token);
    if (!sessionUser) {
      return renderLoginRedirectPage();
    }

    return printFlexoWorkOrder(woNo);
  }
  if (page === 'printso') {

    const sessionUser = getSessionUser(token);
    if (!sessionUser) {
      return renderLoginRedirectPage();
    }
    if (!_canViewSalesOrderPrint_(token)) {
      return renderUnauthorizedPage();
    }

    return printSalesOrder(soNo, token);
  }

const ROUTES = {
  login: 'Login',
  menu: 'Menu',

  order: 'OrderForm',
  salesorderapproval: 'SalesOrderApproval',

    artwork: 'ArtworkApproval',
    masters: 'Masters',
    plates: 'Purchase',
  purchase: 'Purchase',
  itemmaster: 'ItemMaster',

  wow: 'WorkOrderWizard',
  flexowo: 'FlexoWorkOrder',

  inventory: 'Inventory',
  production: 'Production',

  packing: 'Packing',
  dispatch: 'Dispatch',

  billing: 'Invoice',
  printinvoice: 'InvoicePrint',
  printchallan: 'DeliveryChallanPrint',
  planning: 'Planning',
  reports: 'Reports',
  costing: 'Costing',

  masteradmin: 'MasterAdmin',

  printwo: 'PrintWO',
  printflexowo: 'PrintFlexoWO',
  printso: 'PrintSalesOrder'
};

  if (page === 'login') {
    return renderLoginPage();
  }

  const sessionUser = getSessionUser(token);

  if (!sessionUser) {
    return renderLoginRedirectPage();
  }

  if (!_canAccessPage_(page, sessionUser, token)) {
    return renderUnauthorizedPage();
  }

  const tplName = ROUTES[page] || 'Login';
  const tpl = HtmlService.createTemplateFromFile(tplName);

  tpl.WEB_APP_URL = ScriptApp.getService().getUrl();
  tpl.TOKEN = token;
  tpl.CURRENT_USER = sessionUser;
  tpl.invoiceId = invoiceId;
  tpl.challanValueMode = challanValueMode;

  return tpl.evaluate()
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  const action = String(e?.parameter?.action || '').toLowerCase();
  if (action === 'logout') {
    const token = String(e?.parameter?.token || '').trim();
    try {
      if (token) logout(token);
    } catch (err) {}
    return renderLoginPage();
  }

  if (action !== 'login') {
    return renderLoginPage('Invalid request. Please sign in again.');
  }

  const userId = String(e?.parameter?.userid || '').trim();
  const password = String(e?.parameter?.pwd || '').trim();

  if (!userId || !password) {
    return renderLoginPage('Please enter user id and password.');
  }

  try {
    const res = loginAndGetToken(userId, password);
    if (!res || !res.ok || !res.token) {
      return renderLoginPage((res && res.msg) || 'Invalid credentials.');
    }

    const tpl = HtmlService.createTemplateFromFile('Menu');
    tpl.WEB_APP_URL = ScriptApp.getService().getUrl();
    tpl.TOKEN = res.token;
    tpl.CURRENT_USER = res.user || getSessionUser(res.token);

    return tpl.evaluate()
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    return renderLoginPage(err && err.message ? err.message : 'Login failed.');
  }
}

/**
 * Return the computed web app exec URL (used by HTML for back→menu fallback)
 */
function getWebAppUrl() {
  return ScriptApp.getService().getUrl();
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function renderLoginPage(message) {
  const tpl = HtmlService.createTemplateFromFile('Login');
  tpl.WEB_APP_URL = ScriptApp.getService().getUrl();
  tpl.TOKEN = '';
  tpl.LOGIN_ERROR = message || '';
  return tpl.evaluate()
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function renderLoginRedirectPage() {
  return renderLoginPage('Your session has expired. Please sign in again.');
}

/******************************************************
 * ARTWORK & APPROVAL — BACKEND (DB_SalesOrders based)
 * PowerForge ERP
 ******************************************************/

function createArtworksFromSoLines(soId) {

  if (!soId) return;

  // 1️⃣ Fetch SO lines
  const lines = supabaseSelect('sales_order_lines', {
    filters: { so_id: 'eq.' + soId },
    order: 'line_no.asc'
  });

  if (!lines || !lines.length) return;

  // 2️⃣ Fetch existing artworks for this SO
  const existing = supabaseSelect('artworks', {
    filters: { so_id: 'eq.' + soId }
  });

  const existingLineNos = new Set(
    (existing || []).map(e => String(e.line_no))
  );

  // 3️⃣ Prepare only missing artworks
rowsToInsert = _filterSalesServiceOnlyItems_(lines)
  .filter(l => !existingLineNos.has(String(l.line_no)))
  .map(l => ({
    so_id: soId,
    line_no: l.line_no,
    artwork_no: null,
    product_type: l.category || '',
    plate_status: 'PENDING',
    die_status: 'PENDING',
    status: 'NO_ART',
    sheet_length: null,
    sheet_width: null,
    sheet_ups: null,
    printing_colors: null
  }));

  if (rowsToInsert.length) {
    supabaseInsert('artworks', rowsToInsert);
  }
}

/**
 * MAIN SOURCE
 * Reads artwork rows from Supabase
 */
function getArtworkJobs() {

  const rows = _filterSalesServiceOnlyItems_(_excludeCancelledSalesOrdersByNumber_(selectArtworkJobsActiveView_({
    order: 'so_number.asc,line_no.asc'
  }) || [], 'so_number'));

  if (!rows || !rows.length) return [];

  // 🔥 DEBUG FIRST ROW
  Logger.log('RAW ROW SAMPLE: ' + JSON.stringify(rows[0]));

  return rows.map(r => ({
    id: r.id,

    so: r.so_number || '',
    soDate: r.so_date || null,
    soCreatedAt: r.so_created_at || null,
    soTime: r.so_time || '',
    lineNo: r.line_no || '',
    salesRep: r.sales_rep || '',
    client: r.client_name || r.client_code || '',
    productName: r.product_name || '',
    category: r.category || '',
    qty: Number(r.qty || 0),
    unit: r.unit || '',

    artworkNo: r.artwork_no || '',
    productType: r.product_type || '',
    plateStatus: r.plate_status || '',
    dieStatus: r.die_status || '',
    sheetLength: r.sheet_length ?? '',
    sheetWidth: r.sheet_width ?? '',
    sheetUps: r.sheet_ups ?? '',
    printingColors: r.printing_colors || '',

    status: r.status || 'NO_ART',

    artworkAt: r.artwork_at
  ? new Date(r.artwork_at).toISOString()
  : null,
    approvedAt: r.approved_at
  ? new Date(r.approved_at).toISOString()
  : null,

accountsApproved: String(r.accounts_status || '').trim().toUpperCase(),
businessApproved: String(r.business_status || '').trim().toUpperCase(),
  }));
}

/**
 * JSON wrapper (frontend-safe)
 */
/**
 * SAVE artwork fields (bulk)
 * payload: [{ id, artworkNo, productType, plateStatus, dieStatus, status }]
 */
function saveArtworkBulk(payload) {

  if (!Array.isArray(payload) || !payload.length) {
    return { ok: false };
  }

  payload.forEach(p => {

    if (!p.id) return;

    const update = {};

    if ('artworkNo'   in p) update.artwork_no   = p.artworkNo;
    if ('productType' in p) update.product_type = p.productType;
    if ('plateStatus' in p) update.plate_status = p.plateStatus;
    if ('dieStatus'   in p) update.die_status   = p.dieStatus;
    if ('sheetLength' in p) update.sheet_length = p.sheetLength === '' ? null : Number(p.sheetLength);
    if ('sheetWidth'  in p) update.sheet_width  = p.sheetWidth === '' ? null : Number(p.sheetWidth);
    if ('sheetUps'    in p) update.sheet_ups    = p.sheetUps === '' ? null : Number(p.sheetUps);
    if ('printingColors' in p) update.printing_colors = p.printingColors || null;
if ('status' in p) {

  update.status = p.status;

  // 🔥 Set artwork_at ONLY when artwork fields first filled,
  // NOT based on status changes

  const art = supabaseSelect('artworks', {
    filters: { id: 'eq.' + p.id },
    limit: 1
  })[0];

  const isArtworkBeingFilled =
    p.artworkNo &&
    p.productType &&
    p.plateStatus &&
    p.dieStatus;

  if (isArtworkBeingFilled && !art.artwork_at) {
    update.artwork_at = new Date().toISOString();
  }
}

    if (Object.keys(update).length) {
      supabaseUpdate(
        'artworks',
        { id: 'eq.' + p.id },
        update
      );
    }
  });

  return { ok: true };
}

/**
 * APPROVE single artwork line
 */
function approveArtwork(id) {

  if (!id) throw new Error('Missing artwork id');

  const art = supabaseSelect('artworks', {
    filters: { id: 'eq.' + id },
    limit: 1
  })[0];

  if (!art) throw new Error('Artwork not found');

  supabaseUpdate(
    'artworks',
    { id: 'eq.' + id },
    {
      status: 'APPROVED',
      approved_at: new Date().toISOString()
    }
  );

  return { ok: true };
}

function unapproveArtwork(id) {

  if (!id) throw new Error('Missing artwork id');

  const art = supabaseSelect('artworks', {
    filters: { id: 'eq.' + id },
    limit: 1
  })[0];

  if (!art) throw new Error('Artwork not found');

  supabaseUpdate(
    'artworks',
    { id: 'eq.' + id },
    {
      status: 'PENDING_APPROVAL',
      approved_at: null
    }
  );

  return { ok: true };
}

function getArtworkSequenceConfig_(productType) {
  const type = String(productType || '').trim().toUpperCase();
  if (type === 'OFFSET') return { prefix: 'OFF', seed: 2621 };
  if (type === 'DIGITAL') return { prefix: 'DIG', seed: 0 };
  if (type === 'CORRUGATION') return { prefix: 'COR', seed: 647 };
  if (type === 'FLEXO') return { prefix: 'FLX', seed: 2973 };
  return { prefix: 'ART', seed: 0 };
}

function getArtworkSequenceFromExisting_(cfg) {
  const rows = supabaseSelect('artworks', {
    select: 'artwork_no',
    filters: {
      artwork_no: 'like.' + cfg.prefix + '-%'
    },
    limit: 1000
  }) || [];

  let maxNo = Number(cfg.seed || 0);
  const rx = new RegExp('^' + cfg.prefix + '-(\\d+)$', 'i');

  rows.forEach(function(row) {
    const val = String(row.artwork_no || '').trim();
    const m = rx.exec(val);
    if (!m) return;
    const n = Number(m[1] || 0);
    if (n > maxNo) maxNo = n;
  });

  return maxNo + 1;
}

function _getNextArtworkNumberCandidate_(productType) {
  const cfg = getArtworkSequenceConfig_(productType);
  let nextNo;

  try {
    const existing = supabaseSelect('artwork_sequences', {
      filters: { prefix: 'eq.' + cfg.prefix },
      limit: 1
    })[0];

    nextNo = Number((existing && existing.last_no) || cfg.seed) + 1;
  } catch (e) {
    // Fallback for environments where artwork_sequences is not yet created.
    nextNo = getArtworkSequenceFromExisting_(cfg);
  }

  return {
    cfg: cfg,
    nextNo: nextNo,
    artworkNo: cfg.prefix + '-' + String(nextNo)
  };
}

function _commitArtworkSequence_(cfg, nextNo) {
  try {
    const existing = supabaseSelect('artwork_sequences', {
      filters: { prefix: 'eq.' + cfg.prefix },
      limit: 1
    })[0];

    if (existing) {
      const current = Number(existing.last_no || 0);
      if (nextNo > current) {
        supabaseUpdate(
          'artwork_sequences',
          { prefix: 'eq.' + cfg.prefix },
          { last_no: nextNo }
        );
      }
    } else {
      supabaseInsert('artwork_sequences', {
        prefix: cfg.prefix,
        last_no: nextNo
      });
    }
  } catch (e) {
    // Ignore commit failures in fallback mode where the sequence table may not exist.
  }
}

function _artworkRowToWorkbenchJob_(r) {
  const artworkAssigned = !!String(r.artwork_no || '').trim();
  const normalizedProductType = _artworkNormalizeProductType_(
    artworkAssigned
      ? (r.product_type || r.division || r.category || '')
      : (r.division || r.product_type || r.category || '')
  );
  return {
    id: String(r.id || ''),
    so: String(r.so_number || ''),
    soDate: r.so_date || null,
    soCreatedAt: r.so_created_at || null,
    soTime: String(r.so_time || ''),
    salesRep: String(r.sales_rep || ''),
    lineNo: String(r.line_no || ''),
    productCode: String(r.product_code || ''),
    client: String(r.client_name || ''),
    productName: String(r.product_name || ''),
    category: String(r.category || ''),
    division: String(r.division || ''),
    qty: Number(r.qty || 0),
    unit: String(r.unit || ''),
    artworkNo: String(r.artwork_no || ''),
    productType: normalizedProductType,
    plateStatus: String(r.plate_status || ''),
    dieStatus: String(r.die_status || ''),
    plateSize: String(r.plate_size || ''),
    plateCount: r.plate_count === null || typeof r.plate_count === 'undefined' ? '' : Number(r.plate_count),
    hasHybridPlate: r.has_hybrid_plate === true,
    hybridPlateSize: String(r.hybrid_plate_size || ''),
    hybridPlateCount: r.hybrid_plate_count === null || typeof r.hybrid_plate_count === 'undefined' ? '' : Number(r.hybrid_plate_count),
    dieCount: r.die_count === null || typeof r.die_count === 'undefined' ? '' : Number(r.die_count),
    sheetLength: r.sheet_length === null || typeof r.sheet_length === 'undefined' ? '' : Number(r.sheet_length),
    sheetWidth: r.sheet_width === null || typeof r.sheet_width === 'undefined' ? '' : Number(r.sheet_width),
    sheetUps: r.sheet_ups === null || typeof r.sheet_ups === 'undefined' ? '' : Number(r.sheet_ups),
    printingColors: String(r.printing_colors || ''),
    acrossUps: r.across_ups === null || typeof r.across_ups === 'undefined' ? '' : Number(r.across_ups),
    alongUps: r.along_ups === null || typeof r.along_ups === 'undefined' ? '' : Number(r.along_ups),
    totalUps: r.total_ups === null || typeof r.total_ups === 'undefined' ? '' : Number(r.total_ups),
    acrossWidth: r.across_width === null || typeof r.across_width === 'undefined' ? '' : Number(r.across_width),
    teeth: r.teeth === null || typeof r.teeth === 'undefined' ? '' : Number(r.teeth),
    acrossGapMm: r.across_gap_mm === null || typeof r.across_gap_mm === 'undefined' ? '' : Number(r.across_gap_mm),
    alongGapMm: r.along_gap_mm === null || typeof r.along_gap_mm === 'undefined' ? '' : Number(r.along_gap_mm),
    fgStockQty: r.fg_stock_qty === null || typeof r.fg_stock_qty === 'undefined' ? 0 : Number(r.fg_stock_qty),
    stockQtyToBill: r.stock_qty_to_bill === null || typeof r.stock_qty_to_bill === 'undefined' ? 0 : Number(r.stock_qty_to_bill),
    status: String(r.status || 'NO_ART'),
    artworkAt: r.artwork_at ? new Date(r.artwork_at).toISOString() : null,
    approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null,
    accountsApproved: String(r.accounts_status || '').trim().toUpperCase(),
    businessApproved: String(r.business_status || '').trim().toUpperCase()
  };
}

function _deriveArtworkGroupStatus_(jobs) {
  const statuses = (jobs || []).map(j => String(j.status || '').toUpperCase());
  if (statuses.length && statuses.every(s => s === 'APPROVED')) return 'APPROVED';
  if (statuses.some(s => s === 'PENDING_APPROVAL')) return 'PENDING_APPROVAL';
  if (statuses.some(s => s === 'APPROVED')) return 'PENDING_APPROVAL';
  return 'NO_ART';
}

function _isArtworkGroupReady_(group) {
  const jobs = group.jobs || [];
  if (!jobs.length) return false;
  const normalizedType = String(group.productType || '').trim().toUpperCase();
  const isFlexo = normalizedType === 'FLEXO';
  const isDigital = normalizedType === 'DIGITAL';
  const plateNew = String(group.plateStatus || '').toUpperCase() === 'NEW';
  const dieNew = String(group.dieStatus || '').toUpperCase() === 'NEW';
  const commonRequired = isDigital
    ? [group.productType].every(v => !(v === '' || v === null || typeof v === 'undefined'))
    : [
        group.productType,
        group.plateStatus,
        group.dieStatus,
        group.printingColors
      ].every(v => !(v === '' || v === null || typeof v === 'undefined'));
  const typeRequired = isFlexo
    ? [
        group.acrossUps,
        group.alongUps,
        group.totalUps,
        group.acrossWidth,
        group.teeth,
        group.acrossGapMm,
        group.alongGapMm
      ].every(v => !(v === '' || v === null || typeof v === 'undefined'))
    : [
        group.sheetLength,
        group.sheetWidth
      ].every(v => !(v === '' || v === null || typeof v === 'undefined'));
  const plateRequired = isDigital || !plateNew || (
    Number(group.plateCount || 0) > 0 &&
    (isFlexo || !!String(group.plateSize || '').trim()) &&
    (!group.hasHybridPlate || (!!String(group.hybridPlateSize || '').trim() && Number(group.hybridPlateCount || 0) > 0))
  );
  const dieRequired = isDigital || !dieNew || Number(group.dieCount || 0) > 0;
  const requiredUps = jobs.every(j => Number(j.sheetUps || 0) > 0);
  return commonRequired && typeRequired && plateRequired && dieRequired && requiredUps;
}

function _validateArtworkGroupPayload_(payload) {
  if (!payload) throw new Error('Missing artwork payload');
  if (!Array.isArray(payload.jobs) || !payload.jobs.length) {
    throw new Error('Select at least one job for the artwork.');
  }

  const isStockClosedJob = function(job) {
    return Number(job.stockQtyToBill || 0) > 0 &&
      Number(job.stockQtyToBill || 0) >= Number(job.orderQty || 0);
  };
  const artworkJobs = payload.jobs.filter(function(job) {
    return !isStockClosedJob(job);
  });
  const normalizedType = String(payload.productType || '').trim().toUpperCase();
  const isDigital = normalizedType === 'DIGITAL';
  const isFlexo = normalizedType === 'FLEXO';

  if (artworkJobs.length) {
    ['productType'].forEach(function(key) {
      const value = payload[key];
      if (value === '' || value === null || typeof value === 'undefined') {
        throw new Error(key + ' is mandatory.');
      }
    });
    if (!isDigital) {
      ['plateStatus', 'dieStatus', 'printingColors'].forEach(function(key) {
        const value = payload[key];
        if (value === '' || value === null || typeof value === 'undefined') {
          throw new Error(key + ' is mandatory.');
        }
      });
    }
    const requiredFields = isFlexo
      ? ['acrossUps', 'alongUps', 'totalUps', 'acrossWidth', 'teeth', 'acrossGapMm', 'alongGapMm']
      : ['sheetLength', 'sheetWidth'];

    requiredFields.forEach(function(key) {
      const value = payload[key];
      if (value === '' || value === null || typeof value === 'undefined') {
        throw new Error(key + ' is mandatory.');
      }
    });

    if (!isDigital && String(payload.plateStatus || '').toUpperCase() === 'NEW') {
      if (!(Number(payload.plateCount || 0) > 0)) throw new Error('plateCount is mandatory.');
      if (!isFlexo && !String(payload.plateSize || '').trim()) throw new Error('plateSize is mandatory.');
      if (payload.hasHybridPlate === true) {
        if (!isFlexo && !String(payload.hybridPlateSize || '').trim()) throw new Error('hybridPlateSize is mandatory.');
        if (!isFlexo && !(Number(payload.hybridPlateCount || 0) > 0)) throw new Error('hybridPlateCount is mandatory.');
      }
    }
    if (!isDigital && String(payload.dieStatus || '').toUpperCase() === 'NEW' && !(Number(payload.dieCount || 0) > 0)) {
      throw new Error('dieCount is mandatory.');
    }
  }

  payload.jobs.forEach(function(job, idx) {
    if (!job || !job.id) {
      throw new Error('Selected job #' + (idx + 1) + ' is invalid.');
    }
    if (!isStockClosedJob(job) && !(Number(job.sheetUps || 0) > 0)) {
      throw new Error('UPS is mandatory for every selected job.');
    }
    if (Number(job.stockQtyToBill || 0) < 0) {
      throw new Error('Stock billing qty cannot be negative.');
    }
  });
}

function _validateArtworkStockAllocation_(jobs) {
  const list = Array.isArray(jobs) ? jobs : [];
  const allocatedJobs = list.map(function(job) {
    return {
      id: String(job.id || ''),
      stockQtyToBill: Math.max(0, Number(job.stockQtyToBill || 0) || 0)
    };
  }).filter(function(job) {
    return job.id && job.stockQtyToBill > 0;
  });
  if (!allocatedJobs.length) return {};

  const ids = allocatedJobs.map(function(job) { return job.id; });
  const rows = selectArtworkJobsView_({
    select: 'id,product_code,qty,stock_qty_to_bill',
    filters: { id: _supabaseInFilter_(ids) }
  }) || [];
  const rowMap = {};
  rows.forEach(function(row) {
    rowMap[String(row.id || '')] = row;
  });

  allocatedJobs.forEach(function(job) {
    const row = rowMap[job.id];
    if (!row) throw new Error('Artwork job not found for stock allocation: ' + job.id);
    const qty = Number(row.qty || 0) || 0;
    if (job.stockQtyToBill > qty) {
      throw new Error('Stock billing qty cannot exceed order qty.');
    }
    const code = String(row.product_code || '').trim();
    if (!code) {
      throw new Error('Product code is required before stock can be allocated for billing.');
    }
  });

  return allocatedJobs.reduce(function(out, job) {
    out[job.id] = job.stockQtyToBill;
    return out;
  }, {});
}

function saveArtworkStockClosure(payload) {
  const id = String(payload && payload.id || '').trim();
  const qty = Number(payload && payload.stockQtyToBill || 0);
  if (!id) throw new Error('Missing artwork job id.');
  if (isNaN(qty) || qty < 0) throw new Error('Stock billing qty cannot be negative.');

  const rows = selectArtworkJobsView_({
    select: 'id,product_code,qty,artwork_no,status,stock_qty_to_bill',
    filters: { id: 'eq.' + id },
    limit: 1
  }) || [];
  const row = rows[0];
  if (!row) throw new Error('Artwork job not found for stock closure.');

  const orderQty = Number(row.qty || 0) || 0;
  const currentStockQty = Number(row.stock_qty_to_bill || 0) || 0;
  const status = String(row.status || '').trim().toUpperCase();
  const artworkNo = String(row.artwork_no || '').trim();
  if (qty > orderQty) throw new Error('Stock billing qty cannot exceed order qty.');
  if (!String(row.product_code || '').trim()) {
    throw new Error('Product code is required before stock can be allocated for billing.');
  }
  if (status === 'APPROVED' && artworkNo) {
    throw new Error('Un-approve the artwork before changing stock closure for this job.');
  }
  if (status === 'APPROVED' && !artworkNo && currentStockQty > 0 && qty < currentStockQty) {
    throw new Error('Approved stock closure quantity cannot be reduced here. Please reverse it through an audited correction flow.');
  }

  const now = new Date().toISOString();
  const fullStockClosure = orderQty > 0 && qty >= orderQty;
  const update = fullStockClosure
    ? {
        artwork_no: null,
        product_type: null,
        plate_status: null,
        die_status: null,
        plate_size: null,
        plate_count: null,
        has_hybrid_plate: null,
        hybrid_plate_size: null,
        hybrid_plate_count: null,
        die_count: null,
        sheet_length: null,
        sheet_width: null,
        sheet_ups: null,
        printing_colors: null,
        across_ups: null,
        along_ups: null,
        total_ups: null,
        across_width: null,
        teeth: null,
        across_gap_mm: null,
        along_gap_mm: null,
        stock_qty_to_bill: qty,
        status: 'APPROVED',
        artwork_at: now,
        approved_at: now
      }
    : {
        stock_qty_to_bill: qty,
        status: artworkNo ? (status === 'APPROVED' ? 'PENDING_APPROVAL' : (status || 'PENDING_APPROVAL')) : 'NO_ART',
        approved_at: null
      };

  supabaseUpdateMinimal('artworks', { id: 'eq.' + id }, update);
  PropertiesService.getScriptProperties().setProperty('ARTWORK_WORKBENCH_VERSION', String(Date.now()));
  _opsBumpDatasetVersion_();
  return {
    ok: true,
    id: id,
    stockQtyToBill: qty,
    orderQty: orderQty,
    productionQty: Math.max(0, orderQty - qty),
    fullStockClosure: fullStockClosure,
    approvedAt: fullStockClosure ? now : null
  };
}

function _syncArtworkProductTypeToSalesOrderDivision_(artworkRows, productType) {
  const division = _artworkNormalizeProductType_(productType) || String(productType || '').trim();
  if (!division) return;
  const seen = {};
  (artworkRows || []).forEach(function(row) {
    const soId = String(row.so_id || '').trim();
    const lineNo = String(row.line_no || '').trim();
    const key = soId + '||' + lineNo;
    if (!soId || !lineNo || seen[key]) return;
    seen[key] = true;
    supabaseUpdateMinimal('sales_order_lines', {
      so_id: 'eq.' + soId,
      line_no: 'eq.' + lineNo
    }, {
      division: division
    });
  });
}

function _getFgStockByProductCodes_(codes) {
  const normalized = [...new Set((codes || []).map(function(code) {
    return String(code || '').trim();
  }).filter(Boolean))];
  if (!normalized.length) return {};

  const result = {};
  normalized.forEach(function(code) { result[code] = 0; });

  const packRows = [];
  for (let i = 0; i < normalized.length; i += 40) {
    const chunk = normalized.slice(i, i + 40);
    const rows = _fgSafeSelect_('packing_records', {
      select: 'so_line_id,product_code,packed_qty',
      filters: {
        product_code: _supabaseInFilter_(chunk),
        packed_qty: 'gt.0'
      },
      limit: 5000
    });
    packRows.push.apply(packRows, rows || []);
  }
  const soLineIds = [...new Set(packRows.map(function(row){ return row.so_line_id; }).filter(Boolean))];
  const dispatchMap = soLineIds.length ? _billingGetDispatchRowsByLineIds_(soLineIds) : {};
  packRows.forEach(function(row) {
    const code = String(row.product_code || '').trim();
    if (!code) return;
    const dispatchedQty = Number((dispatchMap[String(row.so_line_id)] || {}).dispatchedQty || 0);
    const availableQty = Math.max(Number(row.packed_qty || 0) - dispatchedQty, 0);
    result[code] = Number(result[code] || 0) + availableQty;
  });

  const openingRows = [];
  for (let j = 0; j < normalized.length; j += 40) {
    const chunk = normalized.slice(j, j + 40);
    const rows = _fgSafeSelect_('fg_opening_stock', {
      select: 'id,product_code,opening_qty',
      filters: {
        product_code: _supabaseInFilter_(chunk)
      },
      limit: 5000
    });
    openingRows.push.apply(openingRows, rows || []);
  }
  const openingIds = openingRows.map(function(row){ return row.id; }).filter(Boolean);
  const openingDispatchRows = openingIds.length
    ? _supabaseSelectByKeyInBatches_('fg_opening_dispatch_entries', 'opening_id,dispatch_qty', 'opening_id', openingIds, null, 40)
    : [];
  const openingDispatchMap = {};
  openingDispatchRows.forEach(function(row) {
    const key = String(row.opening_id || '');
    openingDispatchMap[key] = Number(openingDispatchMap[key] || 0) + Number(row.dispatch_qty || 0);
  });
  openingRows.forEach(function(row) {
    const code = String(row.product_code || '').trim();
    if (!code) return;
    const availableQty = Math.max(Number(row.opening_qty || 0) - Number(openingDispatchMap[String(row.id || '')] || 0), 0);
    result[code] = Number(result[code] || 0) + availableQty;
  });

  return result;
}

function getArtworkWorkbench(fromDate, toDate, pendingOnly) {
  const filters = {};
  if (!pendingOnly && fromDate && toDate) {
    filters.and = '(so_date.gte.' + fromDate + ',so_date.lte.' + toDate + ')';
  } else if (!pendingOnly && fromDate) {
    filters.so_date = 'gte.' + fromDate;
  } else if (!pendingOnly && toDate) {
    filters.so_date = 'lte.' + toDate;
  }
  if (pendingOnly === true) {
    filters.or = '(status.is.null,status.neq.APPROVED)';
  }

  const rows = _filterSalesServiceOnlyItems_(_excludeCancelledSalesOrdersByNumber_(selectArtworkJobsActiveView_({
    select: 'id,so_number,so_date,so_time,sales_rep,line_no,client_name,product_code,product_name,category,qty,unit,artwork_no,product_type,plate_status,die_status,plate_size,plate_count,has_hybrid_plate,hybrid_plate_size,hybrid_plate_count,die_count,sheet_length,sheet_width,sheet_ups,printing_colors,across_ups,along_ups,total_ups,across_width,teeth,across_gap_mm,along_gap_mm,stock_qty_to_bill,status,artwork_at,approved_at,accounts_status,business_status',
    filters: filters,
    order: 'so_date.asc,so_number.asc,line_no.asc'
  }) || [], 'so_number'));
  const divisionMap = _artworkDivisionBySoLineMap_(rows);
  rows.forEach(function(row) {
    const key = String(row.so_number || '').trim() + '||' + String(row.line_no || '').trim();
    row.division = divisionMap[key] || '';
  });
  const fgStockMap = _getFgStockByProductCodes_(rows.map(function(row){ return row.product_code; }));
  rows.forEach(function(row){
    row.fg_stock_qty = Number(fgStockMap[String(row.product_code || '').trim()] || 0);
  });

  const jobs = rows.map(_artworkRowToWorkbenchJob_);
  const groupsMap = {};

  jobs.forEach(function(job) {
    const artworkNo = String(job.artworkNo || '').trim();
    if (!artworkNo) return;

    if (!groupsMap[artworkNo]) {
      groupsMap[artworkNo] = {
        artworkNo: artworkNo,
        productType: job.productType || '',
        plateStatus: job.plateStatus || '',
        dieStatus: job.dieStatus || '',
        plateSize: job.plateSize || '',
        plateCount: job.plateCount,
        hasHybridPlate: job.hasHybridPlate === true,
        hybridPlateSize: job.hybridPlateSize || '',
        hybridPlateCount: job.hybridPlateCount,
        dieCount: job.dieCount,
        sheetLength: job.sheetLength,
        sheetWidth: job.sheetWidth,
        printingColors: job.printingColors || '',
        acrossUps: job.acrossUps,
        alongUps: job.alongUps,
        totalUps: job.totalUps,
        acrossWidth: job.acrossWidth,
        teeth: job.teeth,
        acrossGapMm: job.acrossGapMm,
        alongGapMm: job.alongGapMm,
        status: 'NO_ART',
        artworkAt: job.artworkAt,
        approvedAt: job.approvedAt,
        jobs: [],
        soList: [],
        salesRepList: [],
        clientList: [],
        divisionList: [],
        totalQty: 0
      };
    }

    const group = groupsMap[artworkNo];
    group.jobs.push(job);
    const fillGroupField = function(key, value) {
      if (group[key] !== '' && group[key] !== null && typeof group[key] !== 'undefined') return;
      if (value === '' || value === null || typeof value === 'undefined') return;
      group[key] = value;
    };
    [
      ['productType', job.productType],
      ['plateStatus', job.plateStatus],
      ['dieStatus', job.dieStatus],
      ['plateSize', job.plateSize],
      ['plateCount', job.plateCount],
      ['hybridPlateSize', job.hybridPlateSize],
      ['hybridPlateCount', job.hybridPlateCount],
      ['dieCount', job.dieCount],
      ['sheetLength', job.sheetLength],
      ['sheetWidth', job.sheetWidth],
      ['printingColors', job.printingColors],
      ['acrossUps', job.acrossUps],
      ['alongUps', job.alongUps],
      ['totalUps', job.totalUps],
      ['acrossWidth', job.acrossWidth],
      ['teeth', job.teeth],
      ['acrossGapMm', job.acrossGapMm],
      ['alongGapMm', job.alongGapMm]
    ].forEach(function(entry) {
      fillGroupField(entry[0], entry[1]);
    });
    if (job.hasHybridPlate === true) group.hasHybridPlate = true;
    group.totalQty += Number(job.qty || 0);
    if (job.so && group.soList.indexOf(job.so) === -1) group.soList.push(job.so);
    if (job.salesRep && group.salesRepList.indexOf(job.salesRep) === -1) group.salesRepList.push(job.salesRep);
    if (job.client && group.clientList.indexOf(job.client) === -1) group.clientList.push(job.client);
    if (job.division && group.divisionList.indexOf(job.division) === -1) group.divisionList.push(job.division);
    if (!group.artworkAt && job.artworkAt) group.artworkAt = job.artworkAt;
    if (job.approvedAt && (!group.approvedAt || new Date(job.approvedAt) > new Date(group.approvedAt))) {
      group.approvedAt = job.approvedAt;
    }
  });

  let groups = Object.keys(groupsMap).map(function(key) {
    const group = groupsMap[key];
    group.status = _deriveArtworkGroupStatus_(group.jobs);
    group.isReady = _isArtworkGroupReady_(group);
    group.jobCount = group.jobs.length;
    return group;
  });

  groups.sort(function(a, b) {
    const rank = function(status) {
      const s = String(status || '').toUpperCase();
      if (s === 'PENDING_APPROVAL') return 0;
      if (s === 'NO_ART') return 1;
      if (s === 'APPROVED') return 2;
      return 1;
    };
    const rankDiff = rank(a.status) - rank(b.status);
    if (rankDiff !== 0) return rankDiff;
    const aFirst = (a.soList && a.soList[0]) || '';
    const bFirst = (b.soList && b.soList[0]) || '';
    const aDate = a.jobs && a.jobs[0] ? String(a.jobs[0].soDate || '') : '';
    const bDate = b.jobs && b.jobs[0] ? String(b.jobs[0].soDate || '') : '';
    if (aDate !== bDate) return aDate.localeCompare(bDate);
    return aFirst.localeCompare(bFirst);
  });

  const filteredJobs = pendingOnly
    ? jobs.filter(function(j) {
        const status = String(j.status || '').toUpperCase();
        if (status === 'APPROVED' && Number(j.stockQtyToBill || 0) >= Number(j.qty || 0)) return false;
        return !String(j.artworkNo || '').trim() || status === 'NO_ART';
      })
    : jobs;

  return {
    allJobs: jobs,
    jobs: filteredJobs,
    groups: groups,
    meta: {
      totalJobs: filteredJobs.length,
      totalGroups: groups.length,
      unassignedJobs: filteredJobs.filter(j => !j.artworkNo).length
    }
  };
}

function getArtworkWorkbenchJson(fromDate, toDate, pendingOnly) {
  const version = PropertiesService.getScriptProperties().getProperty('ARTWORK_WORKBENCH_VERSION') || '0';
  const cacheKey = _cacheKeyHash_('ARTWORK_WORKBENCH', JSON.stringify({
    v: version,
    fromDate: fromDate || '',
    toDate: toDate || '',
    pendingOnly: pendingOnly === true
  }));
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const payload = JSON.stringify(getArtworkWorkbench(fromDate, toDate, pendingOnly));
  try { cache.put(cacheKey, payload, 180); } catch (e) {}
  return payload;
}

function getArtworkReference(artworkNo) {
  const no = String(artworkNo || '').trim();
  if (!no) throw new Error('Missing artwork no');

  const isFilled = function(value) {
    return !(value === '' || value === null || typeof value === 'undefined');
  };
  const toNumberOrBlank = function(value) {
    return isFilled(value) ? Number(value) : '';
  };
  const firstFilled = function(list, field) {
    for (let i = 0; i < list.length; i++) {
      const value = list[i] && list[i][field];
      if (isFilled(value)) return value;
    }
    return '';
  };
  const firstNumber = function(list, field) {
    return toNumberOrBlank(firstFilled(list, field));
  };
  const pickPath = function(obj, paths) {
    for (let i = 0; i < paths.length; i++) {
      const parts = paths[i].split('.');
      let cur = obj;
      for (let j = 0; j < parts.length; j++) {
        cur = cur && cur[parts[j]];
      }
      if (isFilled(cur)) return cur;
    }
    return '';
  };

  const buildProcurementReference = function() {
    const ref = {
      plateSize: '',
      plateCount: '',
      hasHybridPlate: false,
      hybridPlateSize: '770X1030',
      hybridPlateCount: '',
      dieCount: ''
    };
    let procRows = [];
    try {
      procRows = (supabaseSelect('purchase_artwork_procurement', {
        filters: { artwork_no: 'eq.' + no }
      }) || []);
    } catch (e) {}
    if (!procRows.length) {
      try {
        procRows = (supabaseSelect('purchase_artwork_procurement', {
          filters: { artwork_key: 'eq.' + no }
        }) || []);
      } catch (e) {}
    }
    procRows.forEach(function(row) {
      const type = String(row.type || '').trim().toUpperCase();
      if (type === 'PLATE') {
        ref.plateSize = row.plate_size || ref.plateSize;
        ref.plateCount = row.plate_count == null ? ref.plateCount : Number(row.plate_count);
        ref.hybridPlateSize = row.hybrid_plate_size || ref.hybridPlateSize;
        ref.hybridPlateCount = row.hybrid_plate_count == null ? ref.hybridPlateCount : Number(row.hybrid_plate_count);
        ref.hasHybridPlate = row.hybrid_plate_count != null || !!String(row.hybrid_plate_size || '').trim();
      }
      if (type === 'DIE') {
        ref.dieCount = row.die_count == null ? ref.dieCount : Number(row.die_count);
      }
    });
    return ref;
  };

  const buildWorkOrderSnapshotReference = function() {
    const ref = {
      productType: '',
      sheetLength: '',
      sheetWidth: '',
      printingColors: '',
      acrossUps: '',
      alongUps: '',
      totalUps: '',
      acrossWidth: '',
      teeth: '',
      acrossGapMm: '',
      alongGapMm: ''
    };
    const woJobs = supabaseSelect('work_order_jobs', {
      select: 'wo_id,artwork_no,category',
      filters: { artwork_no: 'eq.' + no },
      limit: 100
    }) || [];
    const woIds = [...new Set(woJobs.map(function(row) { return row.wo_id; }).filter(Boolean))];
    if (!woIds.length) {
      ref.productType = _artworkNormalizeProductType_(woJobs[0] && woJobs[0].category || '');
      return ref;
    }
    const workOrders = _supabaseSelectByKeyInBatches_('work_orders', 'id,wo_date,snapshot_json', 'id', woIds, 'wo_date.desc', 40) || [];
    workOrders.forEach(function(row) {
      const snap = row.snapshot_json || {};
      const fx = snap.flexoDetails || {};
      const art = snap.artworkRef || snap.artwork || {};
      if (!ref.productType) ref.productType = _artworkNormalizeProductType_(
        pickPath(snap, ['jobDetails.type', 'jobDetails.category', 'category', 'departmentCategory']) ||
        (woJobs[0] && woJobs[0].category) ||
        ''
      );
      if (!ref.sheetLength) ref.sheetLength = toNumberOrBlank(pickPath(snap, [
        'artworkRef.sheetLength',
        'artwork.sheetLength',
        'jobDetails.sheetLength',
        'sheetLength'
      ]));
      if (!ref.sheetWidth) ref.sheetWidth = toNumberOrBlank(pickPath(snap, [
        'artworkRef.sheetWidth',
        'artwork.sheetWidth',
        'jobDetails.sheetWidth',
        'sheetWidth'
      ]));
      if (!ref.printingColors) ref.printingColors = pickPath(snap, [
        'artworkRef.printingColors',
        'artwork.printingColors',
        'jobDetails.printingColors',
        'printingColors'
      ]);
      if (!ref.acrossUps) ref.acrossUps = toNumberOrBlank(fx.acrossUps || fx.across_ups);
      if (!ref.alongUps) ref.alongUps = toNumberOrBlank(fx.alongUps || fx.along_ups);
      if (!ref.totalUps) ref.totalUps = toNumberOrBlank(fx.totalUps || fx.total_ups);
      if (!ref.acrossWidth) ref.acrossWidth = toNumberOrBlank(fx.acrossWidth || fx.across_width);
      if (!ref.teeth) ref.teeth = toNumberOrBlank(fx.teeth || fx.cylinderTeeth || fx.cylinder_teeth);
      if (!ref.acrossGapMm) ref.acrossGapMm = toNumberOrBlank(fx.acrossGapMm || fx.across_gap_mm);
      if (!ref.alongGapMm) ref.alongGapMm = toNumberOrBlank(fx.alongGapMm || fx.along_gap_mm);
    });
    return ref;
  };

  const rows = supabaseSelect('artworks', {
    filters: { artwork_no: 'eq.' + no }
  }) || [];

  if (!rows.length) {
    const snapshotRef = buildWorkOrderSnapshotReference();
    if (!snapshotRef.productType) {
      throw new Error('Artwork no not found.');
    }
    const procurementRef = buildProcurementReference();
    return {
      artworkNo: no,
      legacyOnly: true,
      productType: snapshotRef.productType,
      plateStatus: '',
      dieStatus: '',
      plateSize: procurementRef.plateSize,
      plateCount: procurementRef.plateCount,
      hasHybridPlate: procurementRef.hasHybridPlate,
      hybridPlateSize: procurementRef.hybridPlateSize,
      hybridPlateCount: procurementRef.hybridPlateCount,
      dieCount: procurementRef.dieCount,
      sheetLength: snapshotRef.sheetLength,
      sheetWidth: snapshotRef.sheetWidth,
      printingColors: snapshotRef.printingColors,
      acrossUps: snapshotRef.acrossUps,
      alongUps: snapshotRef.alongUps,
      totalUps: snapshotRef.totalUps,
      acrossWidth: snapshotRef.acrossWidth,
      teeth: snapshotRef.teeth,
      acrossGapMm: snapshotRef.acrossGapMm,
      alongGapMm: snapshotRef.alongGapMm,
      status: 'PENDING_APPROVAL',
      artworkAt: null,
      approvedAt: null,
      jobCount: 0
    };
  }

  rows.sort(function(a, b) {
    return String(b.approved_at || b.artwork_at || '').localeCompare(String(a.approved_at || a.artwork_at || ''));
  });
  const statuses = rows.map(function(r){ return String(r.status || '').toUpperCase(); });
  const status = statuses.length && statuses.every(function(s){ return s === 'APPROVED'; })
    ? 'APPROVED'
    : (statuses.some(function(s){ return s === 'PENDING_APPROVAL'; }) ? 'PENDING_APPROVAL' : (rows[0].status || 'NO_ART'));

  return {
    artworkNo: no,
    productType: _artworkNormalizeProductType_(firstFilled(rows, 'product_type')),
    plateStatus: firstFilled(rows, 'plate_status'),
    dieStatus: firstFilled(rows, 'die_status'),
    plateSize: firstFilled(rows, 'plate_size'),
    plateCount: firstNumber(rows, 'plate_count'),
    hasHybridPlate: rows.some(function(r) { return r.has_hybrid_plate === true; }),
    hybridPlateSize: firstFilled(rows, 'hybrid_plate_size') || '770X1030',
    hybridPlateCount: firstNumber(rows, 'hybrid_plate_count'),
    dieCount: firstNumber(rows, 'die_count'),
    sheetLength: firstNumber(rows, 'sheet_length'),
    sheetWidth: firstNumber(rows, 'sheet_width'),
    printingColors: firstFilled(rows, 'printing_colors'),
    acrossUps: firstNumber(rows, 'across_ups'),
    alongUps: firstNumber(rows, 'along_ups'),
    totalUps: firstNumber(rows, 'total_ups'),
    acrossWidth: firstNumber(rows, 'across_width'),
    teeth: firstNumber(rows, 'teeth'),
    acrossGapMm: firstNumber(rows, 'across_gap_mm'),
    alongGapMm: firstNumber(rows, 'along_gap_mm'),
    status: status,
    artworkAt: firstFilled(rows, 'artwork_at') || null,
    approvedAt: firstFilled(rows, 'approved_at') || null,
    jobCount: rows.length
  };
}

function saveArtworkGroup(payload) {
  _validateArtworkGroupPayload_(payload);
  const lock = LockService.getScriptLock();
  const isNewArtwork = !String(payload.artworkNo || '').trim();
  const preserveExistingJobs = payload && payload.preserveExistingJobs === true;
  let lockHeld = false;

  if (isNewArtwork) {
    lock.waitLock(10000);
    lockHeld = true;
  }

  try {
    let sequenceCandidate = null;
    const now = new Date().toISOString();
    const selectedJobs = payload.jobs.map(function(job) {
      return {
        id: String(job.id),
        sheetUps: Number(job.sheetUps || 0),
        stockQtyToBill: Math.max(0, Number(job.stockQtyToBill || 0) || 0),
        orderQty: Number(job.orderQty || 0) || 0
      };
    });
    const stockQtyByJobId = _validateArtworkStockAllocation_(selectedJobs);
    const selectedRowsForSave = selectedJobs.length
      ? (supabaseSelect('artworks', {
          select: 'id,so_id,line_no,artwork_at',
          filters: { id: 'in.(' + selectedJobs.map(function(job) { return job.id; }).join(',') + ')' }
        }) || [])
      : [];
    const selectedRowMap = {};
    selectedRowsForSave.forEach(function(row) {
      selectedRowMap[String(row.id || '')] = row;
    });
    const stockClosedIdSet = {};
    selectedJobs.forEach(function(job) {
      const orderQty = Number(job.orderQty || 0) || 0;
      if (orderQty > 0 && Number(job.stockQtyToBill || 0) >= orderQty) {
        stockClosedIdSet[job.id] = true;
      }
    });
    const productionSelectedJobs = selectedJobs.filter(function(job) {
      return !stockClosedIdSet[job.id];
    });
    const needsArtworkGroup = productionSelectedJobs.length > 0 || preserveExistingJobs === true;
    const artworkNo = needsArtworkGroup
      ? (String(payload.artworkNo || '').trim() || (sequenceCandidate = _getNextArtworkNumberCandidate_(payload.productType)).artworkNo)
      : '';

    const selectedIdSet = {};
    productionSelectedJobs.forEach(function(job) { selectedIdSet[job.id] = true; });

    const currentRows = artworkNo
      ? (supabaseSelect('artworks', {
          filters: { artwork_no: 'eq.' + artworkNo }
        }) || [])
      : [];

    if (preserveExistingJobs && !currentRows.length) {
      throw new Error('Existing artwork no not found for repeat order.');
    }

    const deselectedIds = preserveExistingJobs
      ? []
      : currentRows
          .map(function(row) { return String(row.id || ''); })
          .filter(function(id) { return id && !selectedIdSet[id]; });

    if (deselectedIds.length) {
      supabaseUpdateMinimal('artworks', { id: 'in.(' + deselectedIds.join(',') + ')' }, {
        artwork_no: null,
        product_type: null,
        plate_status: null,
        die_status: null,
        plate_size: null,
        plate_count: null,
        has_hybrid_plate: null,
        hybrid_plate_size: null,
        hybrid_plate_count: null,
        die_count: null,
        sheet_length: null,
        sheet_width: null,
        sheet_ups: null,
        printing_colors: null,
        across_ups: null,
        along_ups: null,
        total_ups: null,
        across_width: null,
        teeth: null,
        across_gap_mm: null,
        along_gap_mm: null,
        stock_qty_to_bill: 0,
        status: 'NO_ART',
        artwork_at: null,
        approved_at: null
      });
    }

      const updateJobMap = {};
      currentRows.forEach(function(row) {
        const rowId = String(row.id || '');
        if (!rowId) return;
        if (!preserveExistingJobs && !selectedIdSet[rowId]) return;
        updateJobMap[rowId] = {
          id: rowId,
          sheetUps: row.sheet_ups,
          stockQtyToBill: row.stock_qty_to_bill
        };
      });
      productionSelectedJobs.forEach(function(job) {
        updateJobMap[String(job.id)] = {
          id: String(job.id),
          sheetUps: Number(job.sheetUps || 0),
          stockQtyToBill: Math.max(0, Number(job.stockQtyToBill || 0) || 0)
        };
      });
      const updateJobs = Object.keys(updateJobMap).map(function(id) {
        return updateJobMap[id];
      });
      const updateIds = updateJobs.map(function(job) { return job.id; });
      const selectedRows = updateIds.length
        ? (supabaseSelect('artworks', {
            select: 'id,so_id,line_no,artwork_at',
            filters: { id: 'in.(' + updateIds.join(',') + ')' }
          }) || [])
        : [];
      const artMap = {};
      selectedRows.forEach(function(row) {
        artMap[String(row.id)] = row;
      });
      const sourceRow = currentRows.length ? currentRows[0] : null;

      const updates = updateJobs.map(function(job) {
        const art = artMap[job.id];
        if (!art) throw new Error('Artwork job not found: ' + job.id);
        const normalizedType = String(payload.productType || '').trim().toUpperCase();
        const isFlexo = normalizedType === 'FLEXO';
        const isDigital = normalizedType === 'DIGITAL';
        return {
          id: job.id,
          artwork_no: artworkNo,
          product_type: payload.productType,
          plate_status: isDigital ? null : payload.plateStatus,
          die_status: isDigital ? null : payload.dieStatus,
          plate_size: (isDigital || isFlexo) ? null : (payload.plateSize || null),
          plate_count: isDigital ? null : (String(payload.plateStatus || '').toUpperCase() === 'NEW' ? Number(payload.plateCount) : null),
          has_hybrid_plate: !isDigital && !isFlexo && payload.hasHybridPlate === true,
          hybrid_plate_size: !isDigital && !isFlexo && payload.hasHybridPlate === true ? (payload.hybridPlateSize || null) : null,
          hybrid_plate_count: !isDigital && !isFlexo && payload.hasHybridPlate === true ? Number(payload.hybridPlateCount) : null,
          die_count: isDigital ? null : (String(payload.dieStatus || '').toUpperCase() === 'NEW' ? Number(payload.dieCount) : null),
          sheet_length: isFlexo ? null : Number(payload.sheetLength),
          sheet_width: isFlexo ? null : Number(payload.sheetWidth),
          sheet_ups: Number(job.sheetUps),
          printing_colors: isDigital ? null : payload.printingColors,
          across_ups: isFlexo ? Number(payload.acrossUps) : null,
          along_ups: isFlexo ? Number(payload.alongUps) : null,
          total_ups: isFlexo ? Number(payload.totalUps) : null,
          across_width: isFlexo ? Number(payload.acrossWidth) : null,
          teeth: isFlexo ? Number(payload.teeth) : null,
          across_gap_mm: isFlexo ? Number(payload.acrossGapMm) : null,
          along_gap_mm: isFlexo ? Number(payload.alongGapMm) : null,
          stock_qty_to_bill: Number(stockQtyByJobId[job.id] || job.stockQtyToBill || 0) || 0,
          status: 'PENDING_APPROVAL',
          artwork_at: art.artwork_at || now,
          approved_at: null
        };
      });

    if (updates.length) {
      supabaseUpsertMinimal('artworks', updates, { onConflict: 'id' });
      _syncArtworkProductTypeToSalesOrderDivision_(selectedRows, payload.productType);
    }
    const stockClosureUpdates = selectedRowsForSave
      .filter(function(row) { return stockClosedIdSet[String(row.id || '')]; })
      .map(function(row) {
        const id = String(row.id || '');
        return {
          id: id,
          artwork_no: null,
          product_type: null,
          plate_status: null,
          die_status: null,
          plate_size: null,
          plate_count: null,
          has_hybrid_plate: null,
          hybrid_plate_size: null,
          hybrid_plate_count: null,
          die_count: null,
          sheet_length: null,
          sheet_width: null,
          sheet_ups: null,
          printing_colors: null,
          across_ups: null,
          along_ups: null,
          total_ups: null,
          across_width: null,
          teeth: null,
          across_gap_mm: null,
          along_gap_mm: null,
          stock_qty_to_bill: Number(stockQtyByJobId[id] || 0) || 0,
          status: 'APPROVED',
          artwork_at: row.artwork_at || now,
          approved_at: now
        };
      });
    if (stockClosureUpdates.length) {
      supabaseUpsertMinimal('artworks', stockClosureUpdates, { onConflict: 'id' });
    }

    if (sequenceCandidate) {
      _commitArtworkSequence_(sequenceCandidate.cfg, sequenceCandidate.nextNo);
    }

    PropertiesService.getScriptProperties().setProperty('ARTWORK_WORKBENCH_VERSION', String(Date.now()));
    _opsBumpDatasetVersion_();
    return { ok: true, artworkNo: artworkNo, stockClosedOnly: !needsArtworkGroup && stockClosureUpdates.length > 0 };
  } finally {
    if (lockHeld) {
      try { lock.releaseLock(); } catch (e) {}
    }
  }
}

function approveArtworkGroup(artworkNo) {
  const no = String(artworkNo || '').trim();
  if (!no) throw new Error('Missing artwork number');

  const rows = supabaseSelect('artworks', {
    filters: { artwork_no: 'eq.' + no }
  }) || [];

  if (!rows.length) throw new Error('Artwork group not found');

  rows.forEach(function(row) {
    const normalizedType = String(row.product_type || '').trim().toUpperCase();
    const isDigital = normalizedType === 'DIGITAL';
    if (!row.product_type || !(Number(row.sheet_ups || 0) > 0)) {
      throw new Error('All artwork fields and job UPS are mandatory before approval.');
    }
    if (!isDigital && (!row.plate_status || !row.die_status || !row.printing_colors)) {
      throw new Error('All artwork fields and job UPS are mandatory before approval.');
    }
    if (!isDigital && String(row.plate_status || '').toUpperCase() === 'NEW') {
      if (!(Number(row.plate_count || 0) > 0)) throw new Error('Plate count is mandatory before approval.');
      if (normalizedType !== 'FLEXO' && !String(row.plate_size || '').trim()) {
        throw new Error('Plate size is mandatory before approval.');
      }
      if (row.has_hybrid_plate === true) {
        if (!String(row.hybrid_plate_size || '').trim() || !(Number(row.hybrid_plate_count || 0) > 0)) {
          throw new Error('Hybrid plate size and count are mandatory before approval.');
        }
      }
    }
    if (!isDigital && String(row.die_status || '').toUpperCase() === 'NEW' && !(Number(row.die_count || 0) > 0)) {
      throw new Error('Die count is mandatory before approval.');
    }
    if (normalizedType === 'FLEXO') {
      if (row.across_ups === null || row.along_ups === null || row.total_ups === null ||
          row.across_width === null || row.teeth === null || row.across_gap_mm === null || row.along_gap_mm === null) {
        throw new Error('All Flexo artwork fields are mandatory before approval.');
      }
    } else if (row.sheet_length === null || row.sheet_width === null) {
      throw new Error('All artwork fields and job UPS are mandatory before approval.');
    }
  });

  const now = new Date().toISOString();
  supabaseUpdateMinimal('artworks', { artwork_no: 'eq.' + no }, {
    status: 'APPROVED',
    approved_at: now
  });

  PropertiesService.getScriptProperties().setProperty('ARTWORK_WORKBENCH_VERSION', String(Date.now()));
  _opsBumpDatasetVersion_();
  return { ok: true, artworkNo: no };
}

function unapproveArtworkGroup(artworkNo) {
  const no = String(artworkNo || '').trim();
  if (!no) throw new Error('Missing artwork number');

  const rows = supabaseSelect('artworks', {
    filters: { artwork_no: 'eq.' + no }
  }) || [];

  if (!rows.length) throw new Error('Artwork group not found');

  supabaseUpdateMinimal('artworks', { artwork_no: 'eq.' + no }, {
    status: 'PENDING_APPROVAL',
    approved_at: null
  });

  PropertiesService.getScriptProperties().setProperty('ARTWORK_WORKBENCH_VERSION', String(Date.now()));
  _opsBumpDatasetVersion_();
  return { ok: true, artworkNo: no };
}

/******************************************************
 * SALES ORDER LINE-WISE APPROVAL — FINAL BACKEND
 * PowerForge ERP
 * Source of Truth: DB_SalesOrders
 ******************************************************/
/**
 * READ — LINE-WISE Sales Orders for Approval
 * JSON ONLY (frontend-safe)
 */
function getSalesOrderLinesForApproval() {

const rows = _excludeCancelledSalesOrdersByNumber_(supabaseSelect(
  'v_sales_order_lines_for_approval',
  {
    select: `
      so_number,
      so_date,
      so_created_at:created_at,
      line_no,
      sales_rep,
      client_name,
      product_name,
      category,
      qty,
      rate,
      accounts_status,
      accounts_at,
      business_status,
      business_at
    `,
    order: 'so_number.desc',
    limit: 2000
  }
) || [], 'so_number');

  if (!rows || !rows.length) {
    return { ok: true, rows: [] };
  }

  return {
    ok: true,
    meta: { total: rows.length },
rows: rows.map(r => ({
  soNo: String(r.so_number || ''),
  soDate: r.so_date || null,
  soCreatedAt: r.so_created_at || null,
  lineNo: String(r.line_no || ''),
  salesRep: String(r.sales_rep || ''),
  client: String(r.client_name || ''),
  product: String(r.product_name || ''),
  category: String(r.category || ''),
  qty: Number(r.qty || 0),
  approvedRate: r.rate ?? '',

  accountsStatus: r.accounts_status || 'PENDING',
  accountsAt: r.accounts_at || null,

  businessStatus: r.business_status || 'PENDING',
  businessAt: r.business_at || null
}))
  };
}

function _getApprovalCache_() {
  return CacheService.getScriptCache();
}

function _cacheKeyHash_(prefix, value) {
  const raw = String(value == null ? '' : value);
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw);
  const hex = digest.map(function(b) {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
  return String(prefix || 'CACHE') + '_' + hex;
}

function _getCachedJson_(key) {
  const cache = _getApprovalCache_();
  const raw = cache.get(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (err) {
    cache.remove(key);
    return null;
  }
}

function _putCachedJson_(key, value, ttlSeconds) {
  _getApprovalCache_().put(
    key,
    JSON.stringify(value),
    ttlSeconds || 600
  );
}

function _approvalSoIdCacheKey_(soNo) {
  return 'so_approval:so_id:' + String(soNo || '');
}

function _approvalLineIdCacheKey_(soId, lineNo) {
  return 'so_approval:line_id:' + String(soId || '') + ':' + String(lineNo || '');
}

function _normalizeApprovalPayload_(payload) {
  if (!payload?.soNo || !payload?.lineNo) {
    throw new Error('Missing soNo or lineNo');
  }

  const decision = String(payload.decision || '').toUpperCase();
  const role = String(payload.approvalType || '').toUpperCase();

  if (!['APPROVED', 'HOLD'].includes(decision)) {
    throw new Error('Invalid decision');
  }

  if (!['ACCOUNTS', 'BUSINESS'].includes(role)) {
    throw new Error('Invalid approvalType');
  }

  return {
    soNo: String(payload.soNo),
    lineNo: String(payload.lineNo),
    decision: decision,
    approvalType: role
  };
}

function _getSalesOrderIdsByNumber_(soNumbers) {
  const out = {};
  const misses = [];

  (soNumbers || []).forEach(function(soNo) {
    const key = String(soNo || '');
    if (!key || out[key]) return;

    const cached = _getCachedJson_(_approvalSoIdCacheKey_(key));
    if (cached && cached.id) {
      out[key] = cached.id;
      return;
    }

    misses.push(key);
  });

  if (misses.length) {
    const rows = supabaseSelect('sales_orders', {
      select: 'id,so_number',
      filters: { so_number: _supabaseInFilter_(misses) }
    }) || [];

    rows.forEach(function(row) {
      const soNo = String(row.so_number || '');
      if (!soNo || !row.id) return;
      out[soNo] = row.id;
      _putCachedJson_(_approvalSoIdCacheKey_(soNo), { id: row.id }, 1800);
    });
  }

  return out;
}

function _getSalesOrderLineIds_(entries) {
  const out = {};
  const missingBySoId = {};

  (entries || []).forEach(function(entry) {
    const soId = entry && entry.soId;
    const lineNo = String(entry && entry.lineNo || '');
    if (!soId || !lineNo) return;

    const compositeKey = String(soId) + '||' + lineNo;
    const cached = _getCachedJson_(_approvalLineIdCacheKey_(soId, lineNo));
    if (cached && cached.id) {
      out[compositeKey] = cached.id;
      return;
    }

    if (!missingBySoId[soId]) missingBySoId[soId] = {};
    missingBySoId[soId][lineNo] = true;
  });

  Object.keys(missingBySoId).forEach(function(soId) {
    const lineNos = Object.keys(missingBySoId[soId]);
    if (!lineNos.length) return;

    const rows = supabaseSelect('sales_order_lines', {
      select: 'id,so_id,line_no',
      filters: {
        so_id: 'eq.' + soId,
        line_no: _supabaseInFilter_(lineNos)
      }
    }) || [];

    rows.forEach(function(row) {
      const compositeKey = String(row.so_id) + '||' + String(row.line_no);
      if (!row.id) return;
      out[compositeKey] = row.id;
      _putCachedJson_(
        _approvalLineIdCacheKey_(row.so_id, row.line_no),
        { id: row.id },
        1800
      );
    });
  });

  return out;
}

/**
 * UPDATE — Approve / Hold / Reject ONE SO LINE
 */
function updateSalesOrderLineApproval(payload) {

  if (!payload?.soNo || !payload?.lineNo) {
    throw new Error('Missing soNo or lineNo');
  }

  const decision = String(payload.decision || '').toUpperCase();
  const role = String(payload.approvalType || '').toUpperCase();

  if (!['APPROVED','HOLD'].includes(decision)) {
    throw new Error('Invalid decision');
  }

  if (!['ACCOUNTS','BUSINESS'].includes(role)) {
    throw new Error('Invalid approvalType');
  }

  // 1️⃣ Find SO
  const so = supabaseSelect('sales_orders', {
    filters: { so_number: 'eq.' + payload.soNo },
    limit: 1
  })[0];

  if (!so) {
    throw new Error('Sales Order not found: ' + payload.soNo);
  }

  // 2️⃣ Prepare update
  const now = new Date().toISOString();
  const update = {};

  if (role === 'ACCOUNTS') {
    update.accounts_status = decision;
    update.accounts_at = now;
  } else {
    update.business_status = decision;
    update.business_at = now;
  }

  // 3️⃣ Update ONLY that line
  supabaseUpdate(
    'sales_order_lines',
    {
      so_id: 'eq.' + so.id,
      line_no: 'eq.' + payload.lineNo
    },
    update
  );

  return { ok:true };
}

function bulkUpdateSalesOrderApproval(payload) {

  if (!Array.isArray(payload) || !payload.length) {
    return { ok: true };
  }

  const now = new Date().toISOString();
  const soNumbers = [...new Set(payload.map(function(row) { return row.soNo; }).filter(Boolean))];
  const salesOrders = soNumbers.length
    ? (supabaseSelect('sales_orders', {
        select: 'id,so_number',
        filters: { so_number: 'in.(' + soNumbers.join(',') + ')' }
      }) || [])
    : [];
  const soIdByNumber = {};
  salesOrders.forEach(function(row) {
    soIdByNumber[String(row.so_number)] = row.id;
  });

  const soIds = salesOrders.map(function(row) { return row.id; }).filter(Boolean);
  const targetLines = soIds.length
    ? (supabaseSelect('sales_order_lines', {
        select: 'id,so_id,line_no',
        filters: { so_id: 'in.(' + soIds.join(',') + ')' }
      }) || [])
    : [];
  const lineMap = {};
  targetLines.forEach(function(row) {
    lineMap[String(row.so_id) + '||' + String(row.line_no)] = row;
  });

  const updates = [];
  payload.forEach(function(p) {
    const soId = soIdByNumber[String(p.soNo)];
    if (!soId) return;

    const targetLine = lineMap[String(soId) + '||' + String(p.lineNo)];
    if (!targetLine) return;

    const update = { id: targetLine.id };
    if (p.approvalType === 'ACCOUNTS') {
      update.accounts_status = p.decision;
      update.accounts_at = now;
    } else {
      update.business_status = p.decision;
      update.business_at = now;
    }
    updates.push(update);
  });

  if (updates.length) {
    supabaseUpsertMinimal('sales_order_lines', updates, { onConflict: 'id' });
  }

  return { ok: true };
}

// Optimized overrides for Sales Order approval writes.
function updateSalesOrderLineApproval(payload) {

  const normalized = _normalizeApprovalPayload_(payload);
  const soIdByNumber = _getSalesOrderIdsByNumber_([normalized.soNo]);
  const soId = soIdByNumber[normalized.soNo];

  if (!soId) {
    throw new Error('Sales Order not found: ' + normalized.soNo);
  }

  const lineIds = _getSalesOrderLineIds_([{
    soId: soId,
    lineNo: normalized.lineNo
  }]);
  const lineId = lineIds[String(soId) + '||' + normalized.lineNo];

  if (!lineId) {
    throw new Error('Sales Order line not found: ' + normalized.soNo + ' / ' + normalized.lineNo);
  }

  const now = new Date().toISOString();
  const update = {};

  if (normalized.approvalType === 'ACCOUNTS') {
    update.accounts_status = normalized.decision;
    update.accounts_at = now;
  } else {
    update.business_status = normalized.decision;
    update.business_at = now;
  }

  supabaseUpdateMinimal(
    'sales_order_lines',
    { id: 'eq.' + lineId },
    update
  );

  return { ok:true, soNo: normalized.soNo, lineNo: normalized.lineNo };
}

function bulkUpdateSalesOrderApproval(payload) {

  if (!Array.isArray(payload) || !payload.length) {
    return { ok: true };
  }

  const normalizedPayload = payload.map(_normalizeApprovalPayload_);
  const now = new Date().toISOString();
  const soNumbers = [...new Set(normalizedPayload.map(function(row) {
    return row.soNo;
  }))];
  const soIdByNumber = _getSalesOrderIdsByNumber_(soNumbers);
  const lineIdMap = _getSalesOrderLineIds_(
    normalizedPayload.map(function(row) {
      return {
        soId: soIdByNumber[row.soNo],
        lineNo: row.lineNo
      };
    })
  );

  const updates = [];
  normalizedPayload.forEach(function(p) {
    const soId = soIdByNumber[p.soNo];
    if (!soId) return;

    const lineId = lineIdMap[String(soId) + '||' + String(p.lineNo)];
    if (!lineId) return;

    const update = { id: lineId };
    if (p.approvalType === 'ACCOUNTS') {
      update.accounts_status = p.decision;
      update.accounts_at = now;
    } else {
      update.business_status = p.decision;
      update.business_at = now;
    }
    updates.push(update);
  });

  if (updates.length) {
    supabaseUpsertMinimal('sales_order_lines', updates, { onConflict: 'id' });
  }

  return { ok: true, updated: updates.length };
}

function _opsRequireSession_(token) {
  const user = getSessionUser(token);
  if (!user) throw new Error('Unauthorized');
  return user;
}

function _opsNormalizeStatus_(value) {
  const v = String(value || '').trim().toUpperCase();
  return ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'HOLD'].includes(v) ? v : 'PENDING';
}

function _opsStatusRank_(value) {
  const v = _opsNormalizeStatus_(value);
  if (v === 'HOLD') return 4;
  if (v === 'IN_PROGRESS') return 3;
  if (v === 'PENDING') return 2;
  return 1;
}

function _opsComputeLineStatuses_(row) {
  const orderQty = Number(row.orderQty || 0);
  const producedQty = Number(row.producedQty || 0);
  const packedQty = Number(row.packedQty || 0);
  const dispatchedQty = Number(row.dispatchedQty || 0);
  const hold = !!row.holdFlag;
  const productionStarted = !!row.productionStarted || Number(row.productionActivityQty || 0) > 0;

  const productionPendingQty = Math.max(orderQty - producedQty, 0);
  const packingPendingQty = Math.max(producedQty - packedQty, 0);
  const dispatchPendingQty = Math.max(packedQty - dispatchedQty, 0);

  let productionStatus = 'PENDING';
  let packingStatus = 'PENDING';
  let dispatchStatus = 'PENDING';

  if (hold) {
    productionStatus = 'HOLD';
    packingStatus = producedQty > 0 ? 'HOLD' : 'PENDING';
    dispatchStatus = packedQty > 0 ? 'HOLD' : 'PENDING';
  } else {
    if (producedQty >= orderQty && orderQty > 0) productionStatus = 'COMPLETED';
    else if (productionStarted || producedQty > 0) productionStatus = 'IN_PROGRESS';

    if (producedQty <= 0) packingStatus = 'PENDING';
    else if (packedQty >= producedQty && producedQty > 0) packingStatus = 'COMPLETED';
    else if (packedQty > 0) packingStatus = 'IN_PROGRESS';

    if (packedQty <= 0) dispatchStatus = 'PENDING';
    else if (dispatchedQty >= packedQty && packedQty > 0) dispatchStatus = 'COMPLETED';
    else if (dispatchedQty > 0) dispatchStatus = 'IN_PROGRESS';
  }

  let currentStage = 'Completed';
  if (hold) currentStage = 'Hold';
  else if (productionStatus !== 'COMPLETED') currentStage = 'Production';
  else if (packingStatus !== 'COMPLETED') currentStage = 'Packing';
  else if (dispatchStatus !== 'COMPLETED') currentStage = 'Dispatch';

  let overallStatus = 'COMPLETED';
  if (hold) overallStatus = 'HOLD';
  else if (dispatchStatus === 'COMPLETED' && orderQty > 0) overallStatus = 'COMPLETED';
  else if (
    productionStatus === 'IN_PROGRESS' ||
    packingStatus === 'IN_PROGRESS' ||
    dispatchStatus === 'IN_PROGRESS'
  ) overallStatus = 'IN_PROGRESS';
  else overallStatus = 'PENDING';

  return {
    currentStage: currentStage,
    overallStatus: overallStatus,
    productionStatus: productionStatus,
    packingStatus: packingStatus,
    dispatchStatus: dispatchStatus,
    productionPendingQty: productionPendingQty,
    packingPendingQty: packingPendingQty,
    dispatchPendingQty: dispatchPendingQty
  };
}

function _opsStageMatches_(row, stageFocus) {
  const focus = String(stageFocus || 'ALL').trim().toUpperCase();
  if (!focus || focus === 'ALL') return true;
  if (focus === 'PRODUCTION') return row.productionStatus !== 'COMPLETED' || row.overallStatus === 'HOLD';
  if (focus === 'PACKING') return (row.packingStatus !== 'COMPLETED' && Number(row.producedQty || 0) > 0) || row.overallStatus === 'HOLD';
  if (focus === 'DISPATCH') return (row.dispatchStatus !== 'COMPLETED' && Number(row.packedQty || 0) > 0) || row.overallStatus === 'HOLD';
  return true;
}

function _opsQuickMatches_(row, quickFilter) {
  const filter = String(quickFilter || 'ALL').trim().toUpperCase();
  if (!filter || filter === 'ALL') return true;
  return row.overallStatus === filter;
}

function _opsLoadLifecycleRows_(params) {
  const p = params || {};
  const stageFocus = String(p.stageFocus || 'ALL').toUpperCase();
  const quickFilter = String(p.quickFilter || 'ALL').toUpperCase();
  const q = String(p.q || '').trim().toLowerCase();

  const workOrderJobs = supabaseSelect('work_order_jobs', {
    select: 'wo_id,so_number,line_no,product_name,qty,category,artwork_no,client_name,job_priority,expected_delivery,product_remarks,so_remarks,job_reference'
  }) || [];
  const packingRows = supabaseSelect('packing_records', {
    select: 'id,so_id,so_line_id,so_number,line_no,product_code,product_name,order_qty,produced_qty,packed_qty,ready_to_dispatch,packed_at,packed_by'
  }) || [];
  const dispatchRows = supabaseSelect('v_dispatch_board', {
    select: 'pack_id,so_line_id,dispatched_qty',
    order: 'so_number.asc'
  }) || [];
  const stockClosure = _opsLoadArtworkStockClosureRows_();
  const stockClosureByComposite = stockClosure.byComposite || {};

  const jobKeys = {};
  workOrderJobs.forEach(function(job) {
    const key = String(job.so_number || '') + '||' + String(job.line_no || '');
    if (!jobKeys[key]) jobKeys[key] = [];
    jobKeys[key].push(job);
  });

  const packByLineId = {};
  const packByComposite = {};
  packingRows.forEach(function(row) {
    if (row.so_line_id) packByLineId[String(row.so_line_id)] = row;
    const key = String(row.so_number || '') + '||' + String(row.line_no || '');
    packByComposite[key] = row;
  });

  const dispatchByPackId = {};
  const dispatchByLineId = {};
  dispatchRows.forEach(function(row) {
    if (row.pack_id) dispatchByPackId[String(row.pack_id)] = row;
    if (row.so_line_id) {
      const key = String(row.so_line_id);
      dispatchByLineId[key] = (dispatchByLineId[key] || 0) + Number(row.dispatched_qty || 0);
    }
  });

  const soNumbers = [...new Set(
    workOrderJobs.map(function(row){ return row.so_number; })
      .concat(packingRows.map(function(row){ return row.so_number; }))
      .concat(stockClosure.soNumbers || [])
      .filter(Boolean)
  )];
  const salesOrders = (_supabaseSelectByKeyInBatches_('sales_orders', 'id,so_number,client_code,remarks,status', 'so_number', soNumbers) || [])
    .filter(function(row) {
      return String(row.status || '').toUpperCase() !== 'CANCELLED';
    });
  const salesOrderByNo = {};
  const soIdToNo = {};
  salesOrders.forEach(function(row) {
    salesOrderByNo[String(row.so_number)] = row;
    soIdToNo[String(row.id)] = row.so_number || '';
  });

  const soIds = salesOrders.map(function(row){ return row.id; }).filter(Boolean);
  const salesOrderLines = _supabaseSelectByKeyInBatches_(
    'sales_order_lines',
    'id,so_id,line_no,product_code,product_name,category,qty,accounts_status,business_status,product_remarks,prepress_remarks,expected_delivery,final_delivery,division,quote_no,pm_code',
    'so_id',
    soIds
  );
  const lineById = {};
  const lineByComposite = {};
  salesOrderLines.forEach(function(row) {
    const soNo = soIdToNo[String(row.so_id)] || '';
    const key = soNo + '||' + String(row.line_no || '');
    lineById[String(row.id)] = row;
    lineByComposite[key] = row;
  });

  const clientCodes = [...new Set(salesOrders.map(function(row){ return row.client_code; }).filter(Boolean))];
  const clients = _supabaseSelectByKeyInBatches_('clients', 'client_code,client_name', 'client_code', clientCodes);
  const clientMap = {};
  clients.forEach(function(row) { clientMap[String(row.client_code)] = row.client_name || row.client_code; });

  const woIds = [...new Set(workOrderJobs.map(function(job){ return job.wo_id; }).filter(Boolean))];
  const workOrders = _supabaseSelectByKeyInBatches_('work_orders', 'id,wo_number,status', 'id', woIds);
  const woMap = {};
  workOrders.forEach(function(row) { woMap[String(row.id)] = row; });
  const routingRows = _supabaseSelectByKeyInBatches_(
    'work_order_routing',
    'id,wo_id,sequence_no,process_name,department,status,planned_machine',
    'wo_id',
    woIds,
    'sequence_no.asc'
  );
  const routingByWoId = {};
  routingRows.forEach(function(row) {
    const key = String(row.wo_id);
    if (!routingByWoId[key]) routingByWoId[key] = [];
    routingByWoId[key].push(row);
  });
  const routingIds = routingRows.map(function(row){ return row.id; }).filter(Boolean);
  const productionEntries = _prodGetProducedEntryRowsForRoutingIds_(routingIds);
  const productionTotals = _prodBuildTotalsFromEntryRows_(productionEntries);
  const producedByRouting = productionTotals.combinedTotals || {};
  const producedByRoutingJob = productionTotals.jobTotals || {};
  const activityByRouting = {};
  productionEntries.forEach(function(entry) {
    const key = String(entry.routing_id);
    activityByRouting[key] = (activityByRouting[key] || 0) + Number(entry.produced_qty || 0);
  });

  const baseKeys = {};
  Object.keys(jobKeys).forEach(function(key) { baseKeys[key] = true; });
  Object.keys(packByComposite).forEach(function(key) { baseKeys[key] = true; });
  Object.keys(stockClosureByComposite).forEach(function(key) { baseKeys[key] = true; });

  const rows = Object.keys(baseKeys).map(function(key) {
    const jobs = jobKeys[key] || [];
    const primaryJob = jobs[0] || {};
    const stockRow = stockClosureByComposite[key] || {};
    const line = (lineByComposite[key] && typeof lineByComposite[key] === 'object') ? lineByComposite[key] : {};
    const lineId = line && line.id ? String(line.id) : '';
    const packRowCandidate = lineId ? packByLineId[lineId] : null;
    const packRow = (packRowCandidate && typeof packRowCandidate === 'object')
      ? packRowCandidate
      : ((packByComposite[key] && typeof packByComposite[key] === 'object') ? packByComposite[key] : {});
    const soNumber = primaryJob.so_number || packRow.so_number || key.split('||')[0];
    const so = (salesOrderByNo[String(soNumber)] && typeof salesOrderByNo[String(soNumber)] === 'object')
      ? salesOrderByNo[String(soNumber)]
      : {};
    const routing = primaryJob.wo_id ? (routingByWoId[String(primaryJob.wo_id)] || []) : [];
    const productionRouting = routing.filter(function(route) {
      return !_prodIsExcludedProcess_(route.process_name || route.department || '');
    });
    const finalRouting = productionRouting.length
      ? productionRouting[productionRouting.length - 1]
      : (routing.length ? routing[routing.length - 1] : null);
    const finalRoutingKey = String(finalRouting && finalRouting.id || '');
    const jobKeysForLine = jobs.map(function(job) {
      return _prodRowJobKey_(job);
    }).filter(Boolean);
    const productionProducedQty = finalRouting
      ? (function() {
          const routingJobTotals = producedByRoutingJob[finalRoutingKey] || {};
          const hasLineSpecificTotals = jobKeysForLine.some(function(jobKey) {
            return Object.prototype.hasOwnProperty.call(routingJobTotals, jobKey);
          });
          if (hasLineSpecificTotals) {
            return jobKeysForLine.reduce(function(sum, jobKey) {
              return sum + Number(routingJobTotals[jobKey] || 0);
            }, 0);
          }
          return Number(producedByRouting[finalRoutingKey] || 0);
        })()
      : Number(packRow.produced_qty || 0);
    const stockClosedQty = Math.max(0, Number(stockRow.stockClosedQty || 0) || 0);
    const producedQty = productionProducedQty + stockClosedQty;
    const productionActivityQty = routing.reduce(function(sum, row) {
      return sum + Number(activityByRouting[String(row.id)] || 0);
    }, 0);
    const routingHold = routing.some(function(row) {
      const status = String(row.status || '').toUpperCase();
      return status === 'HOLD' || status === 'SHORT_CLOSED';
    });
    const holdFlag =
      routingHold ||
      String(line.accounts_status || '').toUpperCase() === 'HOLD' ||
      String(line.business_status || '').toUpperCase() === 'HOLD';
    const dispatchedQty = packRow && packRow.id
      ? Number((dispatchByPackId[String(packRow.id)] || {}).dispatched_qty || 0)
      : Number(lineId ? (dispatchByLineId[lineId] || 0) : 0);
    const row = {
      packId: packRow.id || null,
      soId: line.so_id || packRow.so_id || stockRow.soId || so.id || '',
      soLineId: lineId || packRow.so_line_id || stockRow.soLineId || '',
      soNumber: soNumber,
      lineNo: primaryJob.line_no || packRow.line_no || line.line_no || stockRow.lineNo || '',
      client: clientMap[String(so.client_code || '')] || primaryJob.client_name || so.client_code || '',
      product: line.product_name || primaryJob.product_name || packRow.product_name || stockRow.productName || '',
      productCode: line.product_code || packRow.product_code || stockRow.productCode || '',
      category: line.category || primaryJob.category || stockRow.category || '',
      orderQty: Number(line.qty || primaryJob.qty || packRow.order_qty || 0),
      producedQty: producedQty,
      productionProducedQty: productionProducedQty,
      stockClosedQty: stockClosedQty,
      stockMarked: stockClosedQty > 0,
      packedQty: Number(packRow.packed_qty || 0),
      dispatchedQty: dispatchedQty,
      readyToDispatch: packRow.ready_to_dispatch === true,
      holdFlag: holdFlag,
      holdReason: holdFlag ? (routingHold ? 'Production hold / short close' : 'Sales order approval hold') : '',
      productionStarted: productionActivityQty > 0,
      productionActivityQty: productionActivityQty,
      soRemarks: so.remarks || '',
      lineRemarks: line.product_remarks || line.prepress_remarks || '',
      productRemarks: line.product_remarks || '',
      prepressRemarks: line.prepress_remarks || '',
      expectedDelivery: line.expected_delivery || primaryJob.expected_delivery || '',
      finalDelivery: line.final_delivery || '',
      division: line.division || '',
      quoteNo: line.quote_no || '',
      pmCode: line.pm_code || '',
      artworkNo: stockRow.artworkNo || '',
      sourceMode: stockClosedQty > 0 ? 'STOCK' : 'PRODUCTION'
    };
    return Object.assign(row, _opsComputeLineStatuses_(row));
  }).filter(function(row) {
    if (!_opsStageMatches_(row, stageFocus)) return false;
    if (!_opsQuickMatches_(row, quickFilter)) return false;
    if (p.category && String(row.category || '').toUpperCase() !== String(p.category || '').toUpperCase()) return false;
    if (!q) return true;
    return [row.soNumber, row.client, row.product, row.category].join(' ').toLowerCase().includes(q);
  });

  rows.sort(function(a, b) {
    const statusDelta = _opsStatusRank_(b.overallStatus) - _opsStatusRank_(a.overallStatus);
    if (statusDelta) return statusDelta;
    if (String(a.soNumber) < String(b.soNumber)) return -1;
    if (String(a.soNumber) > String(b.soNumber)) return 1;
    return Number(a.lineNo || 0) - Number(b.lineNo || 0);
  });
  return rows;
}

function _opsEnsurePackingRecord_(payload) {
  const soLineId = String(payload.soLineId || '').trim();
  if (!soLineId) throw new Error('Sales order line missing for packing');
  const existing = supabaseSelect('packing_records', {
    select: 'id,so_line_id,packed_qty,packed_weight_kg',
    filters: { so_line_id: 'eq.' + soLineId },
    limit: 1
  }) || [];
  if (existing[0]?.id) return existing[0];
  const inserted = supabaseInsert('packing_records', {
    so_id: payload.soId,
    so_line_id: payload.soLineId,
    so_number: payload.soNumber || '',
    line_no: payload.lineNo || '',
    product_code: payload.productCode || '',
    product_name: payload.product || '',
    order_qty: Number(payload.orderQty || 0),
    produced_qty: Number(payload.producedQty || 0),
    packed_qty: 0,
    packed_weight_kg: 0,
    ready_to_dispatch: false,
    packed_by: '',
    packed_at: null
  }) || [];
  if (!inserted[0]?.id) throw new Error('Unable to initialize packing record');
  return inserted[0];
}

function _opsEnrichChunkRows_(rows) {
  const chunkRows = Array.isArray(rows) ? rows.map(function(row){ return Object.assign({}, row); }) : [];
  if (!chunkRows.length) return chunkRows;
  const soNumbers = [...new Set(chunkRows.map(function(row){ return row.soNumber; }).filter(Boolean))];
  const workOrderJobs = _supabaseSelectByKeyInBatches_('work_order_jobs', 'wo_id,so_number,line_no,artwork_no,client_name,job_priority,expected_delivery,product_remarks,so_remarks', 'so_number', soNumbers);
  const jobsByKey = {};
  workOrderJobs.forEach(function(job) {
    const key = String(job.so_number || '') + '||' + String(job.line_no || '');
    if (!jobsByKey[key]) jobsByKey[key] = [];
    jobsByKey[key].push(job);
  });
  const woIds = [...new Set(workOrderJobs.map(function(job){ return job.wo_id; }).filter(Boolean))];
  const workOrders = _supabaseSelectByKeyInBatches_('work_orders', 'id,wo_number,status,snapshot_json', 'id', woIds);
  const woMap = {};
  workOrders.forEach(function(row) { woMap[String(row.id)] = row; });
  const routingRows = _supabaseSelectByKeyInBatches_('work_order_routing', 'id,wo_id,sequence_no,process_name,department,status,planned_machine', 'wo_id', woIds, 'sequence_no.asc');
  const routingByWoId = {};
  routingRows.forEach(function(row) {
    const key = String(row.wo_id);
    if (!routingByWoId[key]) routingByWoId[key] = [];
    routingByWoId[key].push(row);
  });
  chunkRows.forEach(function(row) {
    const key = String(row.soNumber || '') + '||' + String(row.lineNo || '');
    const jobs = jobsByKey[key] || [];
    const primaryJob = jobs[0] || {};
    const primaryWo = primaryJob.wo_id ? woMap[String(primaryJob.wo_id)] : null;
    const routing = primaryJob.wo_id ? (routingByWoId[String(primaryJob.wo_id)] || []) : [];
    const activeRouting = routing.find(function(rt) {
      const status = String(rt.status || '').toUpperCase();
      return status !== 'COMPLETED' && status !== 'SHORT_CLOSED';
    }) || null;
    const categoryRaw = primaryJob.category || row.category || primaryWo?.snapshot_json?.jobDetails?.type || '';
    row.artworkNo = primaryJob.artwork_no || row.artworkNo || '';
    row.woNumber = primaryWo?.wo_number || (Number(row.stockClosedQty || 0) > 0 ? 'Stock' : '');
    row.woStatus = primaryWo?.status || '';
    row.activeRoutingId = activeRouting?.id || null;
    row.activeProcess = activeRouting?.process_name || activeRouting?.department || '';
    row.activeMachine = activeRouting?.planned_machine || '';
    row.expectedDelivery = primaryJob.expected_delivery || '';
    row.jobPriority = primaryJob.job_priority || '';
    row.remarksPreview = primaryJob.product_remarks || primaryJob.so_remarks || row.lineRemarks || row.soRemarks || '';
    row.categoryGroup = _prodFormatCategoryGroupLabel_(categoryRaw || _prodExtractCategoryGroupFromSnapshot_(primaryWo?.snapshot_json));
    row.transportMode = primaryWo?.snapshot_json?.modeOfTransport || primaryWo?.snapshot_json?.dispatch?.modeOfTransport || '';
    row.canEditProduction = !!row.activeRoutingId && row.productionStatus !== 'COMPLETED' && row.productionStatus !== 'HOLD';
    row.canEditPacking = !!row.soLineId && Number(row.producedQty || 0) > Number(row.packedQty || 0) && row.packingStatus !== 'HOLD';
    row.canEditDispatch = (!!row.packId || !!row.soLineId) && Number(row.packedQty || 0) > Number(row.dispatchedQty || 0) && row.dispatchStatus !== 'HOLD';
  });
  return chunkRows;
}

function _opsBuildStageDataset_(stage, token) {
  _opsRequireSession_(token);
  const focus = String(stage || '').trim().toUpperCase();
  const allRows = _opsEnrichChunkRows_(_opsLoadLifecycleRows_({ stageFocus: 'ALL', quickFilter: 'ALL', q: '' }));
  let rows = allRows.filter(function(row) {
    if (focus === 'PACKING') {
      return Number(row.producedQty || 0) > 0 || Number(row.packedQty || 0) > 0 || row.packingStatus === 'HOLD';
    }
    if (focus === 'DISPATCH') {
      return row.readyToDispatch === true || Number(row.dispatchedQty || 0) > 0 || row.dispatchStatus === 'HOLD';
    }
    return true;
  });
  rows.sort(function(a, b) {
    const aHold = a.overallStatus === 'HOLD' ? 1 : 0;
    const bHold = b.overallStatus === 'HOLD' ? 1 : 0;
    if (aHold !== bHold) return bHold - aHold;
    const aDate = String(a.finalDelivery || a.expectedDelivery || '');
    const bDate = String(b.finalDelivery || b.expectedDelivery || '');
    if (aDate !== bDate) return aDate.localeCompare(bDate);
    if (String(a.soNumber || '') !== String(b.soNumber || '')) return String(a.soNumber || '').localeCompare(String(b.soNumber || ''));
    return Number(a.lineNo || 0) - Number(b.lineNo || 0);
  });
  return rows;
}

function _opsRowIdentity_(row) {
  if (row && row.soLineId) return 'LINE::' + String(row.soLineId);
  return 'KEY::' + String((row && row.soNumber) || '') + '||' + String((row && row.lineNo) || '');
}

function _opsRequiresPackingWeight_(row) {
  const text = [row && row.departmentCategory, row && row.categoryGroup, row && row.category].join(' ').toUpperCase();
  return text.indexOf('CORR') !== -1;
}

function _opsResolveDatasetRows_(stage, fastRows, params, token) {
  const fallbackRows = _opsFilterStageRows_(_opsBuildStageDataset_(stage, token), stage, params || {});
  if (!(fastRows || []).length) return fallbackRows;
  const orderedKeys = [];
  const rowMap = {};
  (fastRows || []).forEach(function(row) {
    const key = _opsRowIdentity_(row);
    if (!rowMap[key]) orderedKeys.push(key);
    rowMap[key] = row;
  });
  fallbackRows.forEach(function(row) {
    const key = _opsRowIdentity_(row);
    if (!rowMap[key]) {
      orderedKeys.push(key);
      rowMap[key] = row;
      return;
    }
    if (Number(row.stockClosedQty || 0) > 0) {
      rowMap[key] = Object.assign({}, rowMap[key], row);
    }
  });
  return orderedKeys.map(function(key) { return rowMap[key]; });
}

function _opsStageDatasetSummary_(rows, stage) {
  const focus = String(stage || '').toUpperCase();
  return {
    totalRows: rows.length,
    pendingQty: rows.reduce(function(sum, row) {
      return sum + Number(focus === 'DISPATCH' ? row.dispatchPendingQty : row.packingPendingQty || 0);
    }, 0),
    readyRows: rows.filter(function(row) { return row.readyToDispatch === true; }).length,
    completedRows: rows.filter(function(row) { return focus === 'DISPATCH' ? row.dispatchStatus === 'COMPLETED' : row.packingStatus === 'COMPLETED'; }).length
  };
}

function _opsFastDatasetCacheKey_(stage, params) {
  return _cacheKeyHash_('OPS_FAST_DATASET', JSON.stringify({
    v: _opsDatasetVersion_(),
    stage: stage,
    params: params || {}
  }));
}

function _opsDatasetVersion_() {
  return PropertiesService.getScriptProperties().getProperty('OPS_STAGE_VERSION') || '0';
}

function _opsBumpDatasetVersion_() {
  PropertiesService.getScriptProperties().setProperty('OPS_STAGE_VERSION', String(Date.now()));
}

function _invBumpStockSnapshotVersion_() {
  PropertiesService.getScriptProperties().setProperty('INV_STOCK_SNAPSHOT_VERSION', String(Date.now()));
}

function _opsMapPackingFastRows_(rows) {
  return (rows || []).map(function(row) {
    const base = {
      packId: row.pack_id || null,
      soId: row.so_id || '',
      soLineId: row.so_line_id || '',
      soNumber: row.so_number || '',
      lineNo: row.line_no || '',
      client: row.client_name || '',
      product: row.product_name || '',
      productCode: row.product_code || '',
      category: row.category || '',
      departmentCategory: row.department_category || '',
      categoryGroup: _prodFormatCategoryGroupLabel_(row.department_category || row.category || ''),
      orderQty: Number(row.order_qty || 0),
      producedQty: Number(row.produced_qty || 0),
      productionProducedQty: Number(row.produced_qty || 0),
      stockClosedQty: Number(row.stock_closed_qty || 0),
      stockMarked: Number(row.stock_closed_qty || 0) > 0,
      sourceMode: Number(row.stock_closed_qty || 0) > 0 ? 'STOCK' : 'PRODUCTION',
      packedQty: Number(row.packed_qty || 0),
      packedWeightKg: Number(row.packed_weight_kg || 0),
      dispatchedQty: 0,
      readyToDispatch: row.ready_to_dispatch === true,
      holdFlag: false,
      holdReason: '',
      productionStarted: Number(row.produced_qty || 0) > 0,
      productionActivityQty: Number(row.produced_qty || 0),
      soRemarks: row.so_remarks || '',
      lineRemarks: row.product_remarks || row.prepress_remarks || '',
      productRemarks: row.product_remarks || '',
      prepressRemarks: row.prepress_remarks || '',
      expectedDelivery: row.expected_delivery || '',
      finalDelivery: row.final_delivery || '',
      division: row.division || '',
      quoteNo: row.quote_no || '',
      pmCode: row.pm_code || '',
      artworkNo: row.artwork_no || '',
      woNumber: row.wo_number || '',
      woDate: row.wo_date || '',
      remarksPreview: row.product_remarks || row.so_remarks || '',
      transportMode: row.transport_mode || ''
    };
    return Object.assign(base, _opsComputeLineStatuses_(base));
  });
}

function _opsMapDispatchFastRows_(rows) {
  return (rows || []).map(function(row) {
    const base = {
      packId: row.pack_id || null,
      soId: row.so_id || '',
      soLineId: row.so_line_id || '',
      soNumber: row.so_number || '',
      lineNo: row.line_no || '',
      client: row.client_name || '',
      product: row.product_name || '',
      productCode: row.product_code || '',
      category: row.category || '',
      categoryGroup: _prodFormatCategoryGroupLabel_(row.department_category || row.category || ''),
      orderQty: Number(row.order_qty || 0),
      producedQty: Number(row.produced_qty || 0),
      packedQty: Number(row.packed_qty || 0),
      dispatchedQty: Number(row.dispatched_qty || 0),
      readyToDispatch: row.ready_to_dispatch === true,
      holdFlag: false,
      holdReason: '',
      productionStarted: Number(row.produced_qty || 0) > 0,
      productionActivityQty: Number(row.produced_qty || 0),
      soRemarks: row.so_remarks || '',
      lineRemarks: row.product_remarks || row.prepress_remarks || '',
      productRemarks: row.product_remarks || '',
      prepressRemarks: row.prepress_remarks || '',
      expectedDelivery: row.expected_delivery || '',
      finalDelivery: row.final_delivery || '',
      division: row.division || '',
      quoteNo: row.quote_no || '',
      pmCode: row.pm_code || '',
      artworkNo: row.artwork_no || '',
      woNumber: row.wo_number || '',
      woDate: row.wo_date || '',
      remarksPreview: row.product_remarks || row.so_remarks || '',
      transportMode: row.transport_mode || ''
    };
    return Object.assign(base, _opsComputeLineStatuses_(base));
  });
}

function _opsFilterStageRows_(rows, stage, params) {
  const p = params || {};
  const dateFrom = _prodToDateKey_(p.dateFrom);
  const dateTo = _prodToDateKey_(p.dateTo);
  const showPendingAll = p.showPendingAll === true;
  const focus = String(stage || '').toUpperCase();
  return (rows || []).filter(function(row) {
    if (focus === 'DISPATCH' && row.readyToDispatch !== true && Number(row.dispatchedQty || 0) <= 0) {
      return false;
    }
    const stageStatus = focus === 'DISPATCH' ? row.dispatchStatus : row.packingStatus;
    if (showPendingAll) {
      return stageStatus !== 'COMPLETED' && stageStatus !== 'SHORT_CLOSED';
    }
    return _prodDateInRange_(row.woDate || row.expectedDelivery, dateFrom, dateTo);
  });
}

function packGetDataset(params, token) {
  _opsRequireSession_(token);
  const p = params || {};
  const cache = CacheService.getScriptCache();
  const cacheKey = _opsFastDatasetCacheKey_('PACKING', p);
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);
  const fastRows = _opsFilterStageRows_(_opsMapPackingFastRows_(_excludeCancelledSalesOrdersByNumber_(supabaseSelect('v_packing_queue_fast', {
    select: 'pack_id,so_id,so_line_id,so_number,line_no,product_code,product_name,client_name,category,department_category,order_qty,produced_qty,packed_qty,packed_weight_kg,ready_to_dispatch,expected_delivery,final_delivery,division,quote_no,pm_code,product_remarks,prepress_remarks,so_remarks,artwork_no,wo_number,wo_date,transport_mode',
    order: 'wo_date.desc,so_number.asc,line_no.asc'
  }) || [], 'so_number')), 'PACKING', p);
  const rows = _opsResolveDatasetRows_('PACKING', fastRows, p, token);
  const result = { ok: true, rows: rows, summary: _opsStageDatasetSummary_(rows, 'PACKING') };
  _prodCachePutJsonSafe_(cache, cacheKey, result, 60);
  return result;
}

function dispatchGetDataset(params, token) {
  _opsRequireSession_(token);
  const p = params || {};
  const cache = CacheService.getScriptCache();
  const cacheKey = _opsFastDatasetCacheKey_('DISPATCH', p);
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);
  const rows = _opsFilterStageRows_(_opsMapDispatchFastRows_(_excludeCancelledSalesOrdersByNumber_(supabaseSelect('v_dispatch_queue_fast', {
    select: 'pack_id,so_id,so_line_id,so_number,line_no,product_code,product_name,client_name,category,department_category,order_qty,produced_qty,packed_qty,dispatched_qty,ready_to_dispatch,expected_delivery,final_delivery,division,quote_no,pm_code,product_remarks,prepress_remarks,so_remarks,artwork_no,wo_number,wo_date,transport_mode',
    order: 'wo_date.desc,so_number.asc,line_no.asc'
  }) || [], 'so_number')), 'DISPATCH', p);
  const result = { ok: true, rows: rows, summary: _opsStageDatasetSummary_(rows, 'DISPATCH') };
  _prodCachePutJsonSafe_(cache, cacheKey, result, 60);
  return result;
}

function opsLifecycleGetChunk(params, token) {
  _opsRequireSession_(token);
  const p = params || {};
  const offset = Math.max(0, Number(p.offset || 0));
  const limit = Math.min(100, Math.max(20, Number(p.limit || 60)));
  const allRows = _opsLoadLifecycleRows_(p);
  const slice = allRows.slice(offset, offset + limit);
  return {
    ok: true,
    offset: offset,
    limit: limit,
    total: allRows.length,
    hasMore: offset + limit < allRows.length,
    summary: {
      totalOrders: allRows.length,
      pendingProductionQty: allRows.reduce(function(sum, row){ return sum + Number(row.productionPendingQty || 0); }, 0),
      pendingPackingQty: allRows.reduce(function(sum, row){ return sum + Number(row.packingPendingQty || 0); }, 0),
      pendingDispatchQty: allRows.reduce(function(sum, row){ return sum + Number(row.dispatchPendingQty || 0); }, 0),
      completedOrders: allRows.filter(function(row){ return row.overallStatus === 'COMPLETED'; }).length
    },
    rows: _opsEnrichChunkRows_(slice)
  };
}

function opsLifecycleGetDetails(payload, token) {
  _opsRequireSession_(token);
  const p = payload || {};
  const soId = String(p.soId || '').trim();
  const soLineId = String(p.soLineId || '').trim();
  const soNumber = String(p.soNumber || '').trim();
  const lineNo = String(p.lineNo || '').trim();
  if (!soNumber || !lineNo) throw new Error('Job reference missing');
  const salesOrder = supabaseSelect('sales_orders', {
    select: 'id,so_number,remarks',
    filters: { so_number: 'eq.' + soNumber },
    limit: 1
  }) || [];
  const soHeader = salesOrder[0] || {};
  const salesLine = (soHeader.id ? supabaseSelect('sales_order_lines', {
    select: 'id,product_name,category,qty,product_remarks,prepress_remarks,expected_delivery,final_delivery,division,quote_no,pm_code',
    filters: { so_id: 'eq.' + soHeader.id, line_no: 'eq.' + lineNo },
    limit: 1
  }) : []) || [];
  const soLine = salesLine[0] || {};
  const workOrderJobs = supabaseSelect('work_order_jobs', {
    select: 'wo_id,so_number,line_no,artwork_no,client_name,job_priority,expected_delivery,product_remarks,so_remarks,prepress_remark',
    filters: { so_number: 'eq.' + soNumber, line_no: 'eq.' + lineNo }
  }) || [];
  const woIds = [...new Set(workOrderJobs.map(function(job){ return job.wo_id; }).filter(Boolean))];
  const workOrders = _supabaseSelectByKeyInBatches_('work_orders', 'id,wo_number,status,snapshot_json', 'id', woIds);
  const woMap = {};
  workOrders.forEach(function(row) { woMap[String(row.id)] = row; });
  const routingRows = _supabaseSelectByKeyInBatches_('work_order_routing', 'id,wo_id,sequence_no,process_name,department,status,planned_machine', 'wo_id', woIds, 'sequence_no.asc');
  const routingIds = routingRows.map(function(row){ return row.id; }).filter(Boolean);
  const productionEntries = _supabaseSelectByKeyInBatches_('production_entries', 'routing_id,entry_datetime,produced_qty,rejected_qty,ok_qty,machine,operator_name,downtime_reason', 'routing_id', routingIds);
  const productionByRouting = {};
  productionEntries.forEach(function(row) {
    const key = String(row.routing_id);
    if (!productionByRouting[key]) productionByRouting[key] = [];
    productionByRouting[key].push(row);
  });
  const artworks = soId ? (supabaseSelect('artworks', {
    select: 'artwork_no,status,plate_status,die_status,product_type',
    filters: { so_id: 'eq.' + soId, line_no: 'eq.' + lineNo },
    order: 'id.desc',
    limit: 1
  }) || []) : [];
  const artwork = artworks[0] || {};
  const packingRows = soLineId ? (supabaseSelect('packing_records', { filters: { so_line_id: 'eq.' + soLineId }, order: 'packed_at.desc', limit: 5 }) || []) : [];
  const dispatchRows = soLineId ? (supabaseSelect('dispatch_records', { filters: { so_line_id: 'eq.' + soLineId }, order: 'created_at.desc', limit: 10 }) || []) : [];
  const routing = routingRows.map(function(row) {
    const entries = productionByRouting[String(row.id)] || [];
    const produced = entries.reduce(function(sum, entry) { return sum + _getProductionEntryGoodQty_(entry); }, 0);
    const rejected = entries.reduce(function(sum, entry) { return sum + Number(entry.rejected_qty || 0); }, 0);
    return {
      woNumber: woMap[String(row.wo_id)]?.wo_number || '',
      sequenceNo: row.sequence_no,
      processName: row.process_name || row.department || '',
      department: row.department || '',
      machine: row.planned_machine || '',
      status: row.status || '',
      producedQty: produced,
      rejectedQty: rejected
    };
  });
  const history = [];
  productionEntries.forEach(function(entry) { history.push({ type: 'Production', at: entry.entry_datetime || '', text: 'Produced ' + Number(entry.produced_qty || 0) + ' / Reject ' + Number(entry.rejected_qty || 0) }); });
  packingRows.forEach(function(row) { history.push({ type: 'Packing', at: row.packed_at || '', text: 'Packed total ' + Number(row.packed_qty || 0) }); });
  dispatchRows.forEach(function(row) { history.push({ type: 'Dispatch', at: row.created_at || row.dispatch_date || '', text: 'Dispatched ' + Number(row.dispatch_qty || 0) + (row.dispatch_no ? (' (' + row.dispatch_no + ')') : '') }); });
  history.sort(function(a, b) { return String(b.at || '').localeCompare(String(a.at || '')); });
  return {
    ok: true,
    artwork: {
      artworkNo: artwork.artwork_no || '',
      status: artwork.status || '',
      plateStatus: artwork.plate_status || '',
      dieStatus: artwork.die_status || '',
      productType: artwork.product_type || ''
    },
    salesInfo: {
      soRemarks: soHeader.remarks || '',
      productRemarks: soLine.product_remarks || '',
      prepressRemarks: soLine.prepress_remarks || '',
      expectedDelivery: soLine.expected_delivery || '',
      finalDelivery: soLine.final_delivery || '',
      category: soLine.category || '',
      qty: Number(soLine.qty || 0),
      division: soLine.division || '',
      quoteNo: soLine.quote_no || '',
      pmCode: soLine.pm_code || ''
    },
    workOrders: workOrderJobs.map(function(job) {
      const wo = woMap[String(job.wo_id)] || {};
      return {
        woNumber: wo.wo_number || '',
        status: wo.status || '',
        artworkNo: job.artwork_no || '',
        expectedDelivery: job.expected_delivery || '',
        jobPriority: job.job_priority || '',
        productRemarks: job.product_remarks || '',
        soRemarks: job.so_remarks || '',
        prepressRemark: job.prepress_remark || ''
      };
    }),
    routing: routing,
    wastage: { rejectedQty: routing.reduce(function(sum, row){ return sum + Number(row.rejectedQty || 0); }, 0) },
    packing: packingRows.map(function(row) { return { packedQty: Number(row.packed_qty || 0), packedAt: row.packed_at || '', packedBy: row.packed_by || '', readyToDispatch: row.ready_to_dispatch === true }; }),
    dispatch: dispatchRows.map(function(row) { return { dispatchNo: row.dispatch_no || '', dispatchQty: Number(row.dispatch_qty || 0), transporter: row.transporter || '', lrNo: row.lr_no || '', vehicleNo: row.vehicle_no || '', dispatchDate: row.dispatch_date || row.created_at || '' }; }),
    history: history.slice(0, 20)
  };
}

function opsLifecycleSaveInline(payload, token) {
  _opsRequireSession_(token);
  const p = payload || {};
  const stage = String(p.stage || '').trim().toUpperCase();
  const qty = Number(p.qty || 0);
  if (!qty || qty <= 0) throw new Error('Quantity must be greater than 0');
  if (stage === 'PRODUCTION') {
    if (!p.activeRoutingId) throw new Error('Active routing not found for this job');
    return saveProductionBulk([{ routingId: p.activeRoutingId, producedQty: qty, rejectedQty: 0, machine: p.machine || '', operator: p.operator || '', downtimeReason: p.downtimeReason || '' }], token);
  }
  if (stage === 'PACKING') {
    const pack = _opsEnsurePackingRecord_(p);
    const currentPacked = Number(pack.packed_qty || 0);
    const currentWeightKg = Number(pack.packed_weight_kg || 0);
    const producedQty = Number(p.producedQty || 0);
    const weightKg = Number(p.weightKg || 0);
    if (qty > Math.max(producedQty - currentPacked, 0)) {
      throw new Error('Packed qty cannot exceed produced balance');
    }
    if (_opsRequiresPackingWeight_(p) && weightKg <= 0) {
      throw new Error('Weight in kg is required for corrugation packing');
    }
    const result = supabaseUpsertMinimal('packing_records', [{
      id: pack.id,
      packed_qty: currentPacked + qty,
      packed_weight_kg: currentWeightKg + (_opsRequiresPackingWeight_(p) ? weightKg : 0),
      produced_qty: producedQty,
      ready_to_dispatch: true,
      packed_by: Session.getActiveUser()?.getEmail?.() || 'user',
      packed_at: new Date().toISOString()
    }], { onConflict: 'id' });
    _opsBumpDatasetVersion_();
    _invBumpStockSnapshotVersion_();
    return result;
  }
  if (stage === 'DISPATCH') {
    const pack = p.packId ? { id: p.packId } : _opsEnsurePackingRecord_(p);
    return saveDispatchBulk([{ packId: pack.id, dispatchQty: qty, transporter: p.transporter || '', lrNo: p.lrNo || '', vehicleNo: p.vehicleNo || '', dispatchDate: p.dispatchDate || '' }]);
  }
  throw new Error('Unsupported stage');
}

function opsLifecycleSaveBulk(payload, token) {
  _opsRequireSession_(token);
  const p = payload || {};
  const stage = String(p.stage || '').trim().toUpperCase();
  const entries = Array.isArray(p.entries) ? p.entries : [];
  if (!entries.length) throw new Error('No entries to save');

  if (stage === 'PACKING') {
    const packedAt = new Date().toISOString();
    const packedBy = Session.getActiveUser()?.getEmail?.() || 'user';
    const grouped = {};
    entries.forEach(function(entry) {
      const qty = Number(entry.qty || 0);
      if (!qty || qty <= 0) return;
      const pack = _opsEnsurePackingRecord_(entry);
      const currentPacked = Number(pack.packed_qty || 0);
      const currentWeightKg = Number(pack.packed_weight_kg || 0);
      const producedQty = Number(entry.producedQty || 0);
      const weightKg = Number(entry.weightKg || 0);
      const requiresWeight = _opsRequiresPackingWeight_(entry);
      if (requiresWeight && weightKg <= 0) {
        throw new Error('Weight in kg is required for corrugation SO ' + String(entry.soNumber || '') + ' line ' + String(entry.lineNo || ''));
      }
      const key = String(pack.id || '');
      if (!key) throw new Error('Packing record missing for SO ' + String(entry.soNumber || '') + ' line ' + String(entry.lineNo || ''));
      if (!grouped[key]) {
        grouped[key] = {
          id: pack.id,
          soLineId: entry.soLineId || pack.so_line_id || '',
          currentPacked: currentPacked,
          currentWeightKg: currentWeightKg,
          producedQty: producedQty,
          addedQty: 0,
          addedWeightKg: 0
        };
      }
      if (grouped[key].addedQty + qty > Math.max(grouped[key].producedQty - grouped[key].currentPacked, 0)) {
        throw new Error('Packed qty cannot exceed produced balance for SO ' + String(entry.soNumber || '') + ' line ' + String(entry.lineNo || ''));
      }
      grouped[key].addedQty += qty;
      if (requiresWeight) grouped[key].addedWeightKg += weightKg;
    });
    const updates = Object.keys(grouped).map(function(key) {
      const item = grouped[key];
      return {
        id: item.id,
        packed_qty: item.currentPacked + item.addedQty,
        packed_weight_kg: item.currentWeightKg + item.addedWeightKg,
        produced_qty: item.producedQty,
        ready_to_dispatch: true,
        packed_by: packedBy,
        packed_at: packedAt
      };
    });
    if (updates.length) {
      supabaseUpsertMinimal('packing_records', updates, { onConflict: 'id' });
      _opsBumpDatasetVersion_();
      _invBumpStockSnapshotVersion_();
    }
    return {
      ok: true,
      count: updates.length,
      rows: Object.keys(grouped).map(function(key) {
        const item = grouped[key];
        return {
          packId: item.id,
          soLineId: item.soLineId,
          addedQty: item.addedQty,
          addedWeightKg: item.addedWeightKg,
          packedQty: item.currentPacked + item.addedQty,
          packedWeightKg: item.currentWeightKg + item.addedWeightKg,
          producedQty: item.producedQty
        };
      })
    };
  }

  if (stage === 'DISPATCH') {
    const dispatchEntries = entries.map(function(entry) {
      const pack = entry.packId ? { id: entry.packId } : _opsEnsurePackingRecord_(entry);
      return {
        packId: pack.id,
        dispatchQty: Number(entry.qty || 0),
        transporter: entry.transporter || '',
        lrNo: entry.lrNo || '',
        vehicleNo: entry.vehicleNo || '',
        dispatchDate: entry.dispatchDate || ''
      };
    }).filter(function(entry) { return Number(entry.dispatchQty || 0) > 0; });
    if (!dispatchEntries.length) throw new Error('No dispatch entries to save');
    return saveDispatchBulk(dispatchEntries);
  }

  throw new Error('Unsupported stage');
}

/****************************************************
 * INVENTORY / STORES — BACKEND FOUNDATION v3
 * JSON-FIRST | Ledger-driven | Avg valuation
 ****************************************************/

const DEFAULT_LOCATION = 'MAIN';

function refreshStockMV_(force){

  const cache = CacheService.getScriptCache();

  if(!force && cache.get('mv_refresh_lock')) return;

  cache.put('mv_refresh_lock','1',10);

  supabaseRpc('refresh_stock_mv',{});
  PropertiesService.getScriptProperties().setProperty('INV_STOCK_SNAPSHOT_VERSION', String(Date.now()));

}

function syncItemToInventory_(itemCode, itemHeader, active) {
  const code = String(itemCode || '').trim();
  if (!code) return;

  const header = itemHeader || {};
  const existing = (supabaseSelect('inv_items', {
    filters: { item_code: 'eq.' + code },
    limit: 1
  }) || [])[0];

  supabaseUpsert('inv_items', {
    item_code: code,
    item_name: String(header.itemName || existing?.item_name || '').trim() || code,
    category: String(header.category || existing?.category || '').trim() || '',
    department: String(existing?.department || '').trim(),
    uom: String(header.unit || existing?.uom || 'NOS').trim() || 'NOS',
    is_consumable: existing?.is_consumable === true,
    active: active !== false
  }, { onConflict: 'item_code' });
  PropertiesService.getScriptProperties().setProperty('INV_STOCK_SNAPSHOT_VERSION', String(Date.now()));
}

function normalizeWOMaterialKey_(label, gsm, deckle, cutSize, uom) {
  return [
    String(label || '').trim(),
    String(gsm || '').trim(),
    Number(deckle || 0).toFixed(2),
    Number(cutSize || 0).toFixed(2),
    String(uom || '').trim()
  ].join('|');
}

function parseStoredWOMaterialKey_(key) {
  const parts = String(key || '').split('|');
  return {
    label: String(parts[0] || '').trim(),
    gsm: String(parts[1] || '').trim(),
    deckle: Number(parts[2] || 0),
    cutSize: Number(parts[3] || 0),
    uom: String(parts[4] || '').trim()
  };
}

function normalizeStoredWOMaterialKey_(key) {
  const parts = parseStoredWOMaterialKey_(key);
  return normalizeWOMaterialKey_(
    parts.label || '',
    parts.gsm || '',
    parts.deckle || 0,
    parts.cutSize || 0,
    parts.uom || ''
  );
}

function buildWOMaterialRequirementRows_(materials, issuedRows) {
  const approxEqual = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) <= 0.01;
  const issuedPools = (issuedRows || []).map(r => {
    const parsed = parseStoredWOMaterialKey_(r.remarks);
    return {
      remainingQty: Number(r.qty_out || 0),
      parsed: parsed,
      exactKey: normalizeWOMaterialKey_(
        parsed.label,
        parsed.gsm,
        parsed.deckle,
        parsed.cutSize,
        parsed.uom
      )
    };
  });

  return (materials || []).map(m => {
    const stored = parseStoredWOMaterialKey_(m.material_key);
    const label = stored.label || m.item_name || '';
    const deckle = Number(m.deckle ?? stored.deckle ?? 0);
    const cutSize = Number(m.cut_size ?? m.cutSize ?? stored.cutSize ?? 0);
    const uom = String(m.uom || stored.uom || '').trim();
    const materialKey = normalizeWOMaterialKey_(
      label,
      m.gsm,
      deckle,
      cutSize,
      uom
    );
    const requiredQty = Number(m.required_qty || 0);
    let issuedQty = 0;

    const consume = (predicate, allowExcess) => {
      issuedPools.forEach(pool => {
        if (pool.remainingQty <= 0) return;
        if (!predicate(pool)) return;
        const needQty = Math.max(requiredQty - issuedQty, 0);
        const take = allowExcess
          ? pool.remainingQty
          : Math.min(needQty, pool.remainingQty);
        issuedQty += take;
        pool.remainingQty -= take;
      });
    };

    consume(pool => pool.exactKey === materialKey, false);
    consume(pool =>
      pool.parsed.label === label &&
      (!pool.parsed.gsm || pool.parsed.gsm === String(m.gsm || '').trim()) &&
      (!pool.parsed.deckle || approxEqual(pool.parsed.deckle, deckle)) &&
      (!pool.parsed.cutSize || approxEqual(pool.parsed.cutSize, cutSize)) &&
      (!pool.parsed.uom || pool.parsed.uom === uom),
      false
    );
    consume(pool => pool.parsed.label === label, false);

    // Preserve real over-issue quantities in the grouped WO view.
    consume(pool => pool.exactKey === materialKey, true);
    consume(pool =>
      pool.parsed.label === label &&
      (!pool.parsed.gsm || pool.parsed.gsm === String(m.gsm || '').trim()) &&
      (!pool.parsed.deckle || approxEqual(pool.parsed.deckle, deckle)) &&
      (!pool.parsed.cutSize || approxEqual(pool.parsed.cutSize, cutSize)) &&
      (!pool.parsed.uom || pool.parsed.uom === uom),
      true
    );
    consume(pool => pool.parsed.label === label, true);

    return {
      materialKey,
      itemLabel: label,
      gsm: m.gsm,
      deckleMm: deckle,
      cutMm: cutSize,
      uom: uom,
      requiredQty: requiredQty,
      issuedQty: issuedQty,
      remainingQty: Math.max(requiredQty - issuedQty, 0)
    };
  });
}

function buildWOMaterialFallbackMap_(snapshotJson) {
  const map = {};
  const snap = snapshotJson || {};
  const isFlexo = String(snap?.jobDetails?.type || '').trim().toUpperCase() === 'FLEXO';

  const pushEntry = function(label, gsm, uom, deckle, cutSize, requiredQty) {
    const key = [
      String(label || '').trim().toUpperCase(),
      String(gsm || '').trim(),
      String(uom || '').trim().toUpperCase()
    ].join('||');
    if (!key || map[key]) return;
    map[key] = {
      deckle: Number(deckle || 0),
      cutSize: Number(cutSize || 0),
      requiredQty: Number(requiredQty || 0),
      uom: String(uom || '').trim().toUpperCase()
    };
  };

  (snap.papers || []).forEach(function(row) {
    pushEntry(
      row.stock || row.itemLabel || row.item_name || '',
      row.gsm || '',
      'SHEET',
      row.deckle || 0,
      row.cutSize || row.cut_size || 0,
      row.requiredQty || row.sheetsWithWaste || row.sheets || 0
    );
  });
  (snap.corrugation || []).forEach(function(row) {
    pushEntry(
      row.itemDetails || row.itemLabel || row.item_name || '',
      row.gsm || '',
      isFlexo ? 'RM' : 'KG',
      row.deckle || 0,
      row.cutSize || row.cut_size || 0,
      isFlexo
        ? (row.runningMeter || row.runningMeters || row.rm || row.requiredQty || 0)
        : (row.weightKg || row.requiredQty || 0)
    );
  });
  (snap.extraMaterials || []).forEach(function(row) {
    pushEntry(
      row.materialItemCode || row.materialName || row.itemLabel || row.item_name || '',
      row.gsm || '',
      row.uom || 'NOS',
      row.deckle || 0,
      row.cutSize || row.cut_size || 0,
      row.requiredQty || row.qtyPerUnit || 0
    );
  });

  return map;
}

function applyWOMaterialFallbacks_(materials, snapshotJson) {
  const fallbackMap = buildWOMaterialFallbackMap_(snapshotJson);
  const isFlexo = String(snapshotJson?.jobDetails?.type || '').trim().toUpperCase() === 'FLEXO';
  const flexoItemCode = String(snapshotJson?.flexoDetails?.itemCode || '').trim().toUpperCase();
  const flexoItemName = String(snapshotJson?.flexoDetails?.itemName || '').trim().toUpperCase();
  const flexoRunningMeter = Number(snapshotJson?.flexoDetails?.totalRunningMeter || 0);
  const flexoRequiredKg = Number(snapshotJson?.flexoDetails?.requiredKg || 0);
  return (materials || []).map(function(row) {
    const materialLabel = String(String(row.material_key || '').split('|')[0] || row.item_name || '').trim().toUpperCase();
    const materialKeyUom = String(parseStoredWOMaterialKey_(row.material_key || '').uom || '').trim().toUpperCase();
    const currentUom = String(row.uom || materialKeyUom || '').trim().toUpperCase();
    const baseKey = [
      materialLabel,
      String(row.gsm || '').trim(),
      currentUom
    ].join('||');
    const flexoAltKey = isFlexo
      ? [
          materialLabel,
          String(row.gsm || '').trim(),
          'RM'
        ].join('||')
      : '';
    const fallback = fallbackMap[baseKey] || fallbackMap[flexoAltKey] || null;
    const next = Object.assign({}, row);
    const isPrimaryFlexoMaterial =
      isFlexo &&
      flexoRunningMeter > 0 &&
      (
        (flexoItemCode && (
          materialLabel === flexoItemCode ||
          String(next.item_code || '').trim().toUpperCase() === flexoItemCode
        )) ||
        (flexoItemName && (
          materialLabel === flexoItemName ||
          String(next.item_name || '').trim().toUpperCase() === flexoItemName
        ))
      );

    if (isPrimaryFlexoMaterial && ['RM', 'R.M.', 'RUNNING METER', 'RUNNING METERS'].indexOf(currentUom) !== -1) {
      next.uom = 'RM';
      next.required_qty = flexoRunningMeter;
    } else if (isPrimaryFlexoMaterial && ['KG', 'KGS', 'KILOGRAM', 'KILOGRAMS'].indexOf(currentUom) !== -1 && flexoRequiredKg > 0) {
      next.uom = 'KG';
      next.required_qty = flexoRequiredKg;
    }

    if (!fallback) return next;
    if (isFlexo && Number(fallback.requiredQty || 0) > 0) next.required_qty = Number(fallback.requiredQty || 0);
    if (isFlexo && String(fallback.uom || '').trim()) next.uom = String(fallback.uom || '').trim().toUpperCase();
    if (!Number(next.deckle || 0) && Number(fallback.deckle || 0)) next.deckle = fallback.deckle;
    if (!Number(next.cut_size || 0) && Number(fallback.cutSize || 0)) next.cut_size = fallback.cutSize;
    return next;
  });
}

function invSaveItem(payload) {

  if (!payload?.itemName)
    throw new Error('Item Name required');

  if (!payload?.department)
    throw new Error('Department required');

  if (!payload?.uom)
    throw new Error('UOM required');

  const itemCode =
    payload.itemCode ||
    generateInvItemCode_();

  const rec = {
    item_code: itemCode,
    item_name: payload.itemName.trim(),
    category: payload.category || '',
    department: payload.department.trim(),
    uom: payload.uom.trim(),
    is_consumable: !!payload.isConsumable,
    active: payload.active === false ? false : true
  };

  supabaseUpsert(
    'inv_items',
    rec,
    { onConflict: 'item_code' }
  );
  PropertiesService.getScriptProperties().setProperty('INV_STOCK_SNAPSHOT_VERSION', String(Date.now()));

  return {
    ok: true,
    itemCode: itemCode,
    item: {
      itemCode: itemCode,
      itemName: rec.item_name,
      category: rec.category,
      department: rec.department,
      uom: rec.uom,
      isConsumable: rec.is_consumable,
      active: rec.active
    }
  };
}

function _normalizeInventoryItemCode_(value) {
  return String(value || '').trim().toUpperCase();
}

function _mapInventoryItemRow_(row, source) {
  const src = row || {};
  return {
    id: src.id || null,
    itemCode: String(src.item_code || src.itemCode || '').trim(),
    itemName: String(src.item_name || src.itemName || '').trim(),
    category: String(src.category || '').trim(),
    department: String(src.department || '').trim(),
    uom: String(src.uom || src.unit || '').trim(),
    isConsumable: src.is_consumable === true || src.isConsumable === true,
    active: src.active !== false,
    source: source || 'inventory'
  };
}

function _getUnifiedInventoryItems_(opts) {
  const q = String(opts?.q || '').trim().toLowerCase();
  const onlyActive = opts?.onlyActive === true;

  const invRows = (supabaseSelect('inv_items', {
    select: 'id,item_code,item_name,category,department,uom,is_consumable,active',
    order: 'item_name.asc'
  }) || []).map(function(row) {
    return _mapInventoryItemRow_(row, 'inventory');
  });

  const masterRows = (supabaseSelect('items', {
    select: 'item_code,item_name,category,unit,active',
    order: 'item_name.asc'
  }) || []).map(function(row) {
    return _mapInventoryItemRow_(row, 'item_master');
  });

  const merged = {};
  masterRows.forEach(function(row) {
    const key = _normalizeInventoryItemCode_(row.itemCode);
    if (!key) return;
    merged[key] = row;
  });
  invRows.forEach(function(row) {
    const key = _normalizeInventoryItemCode_(row.itemCode);
    if (!key) return;
    merged[key] = Object.assign({}, merged[key] || {}, row, {
      department: row.department || (merged[key] && merged[key].department) || '',
      uom: row.uom || (merged[key] && merged[key].uom) || '',
      isConsumable: row.isConsumable === true || (merged[key] && merged[key].isConsumable === true),
      active: row.active !== false && (!merged[key] || merged[key].active !== false)
    });
  });

  let rows = Object.keys(merged).map(function(key) { return merged[key]; });

  if (onlyActive) {
    rows = rows.filter(function(row) { return row.active !== false; });
  }

  if (q) {
    rows = rows.filter(function(row) {
      const hay = [
        row.itemCode,
        row.itemName,
        row.category,
        row.department,
        row.uom
      ].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  rows.sort(function(a, b) {
    return String(a.itemName || a.itemCode || '').localeCompare(String(b.itemName || b.itemCode || ''));
  });

  if (opts?.limit && Number(opts.limit) > 0) {
    rows = rows.slice(0, Number(opts.limit));
  }

  return rows;
}

function ensureInventoryItemExists_(itemCode) {
  const code = String(itemCode || '').trim();
  if (!code) throw new Error('Item code required');

  let item = (supabaseSelect('inv_items', {
    filters: { item_code: 'eq.' + code },
    limit: 1
  }) || [])[0];

  if (item) return item;

  const master = (supabaseSelect('items', {
    filters: { item_code: 'eq.' + code },
    limit: 1
  }) || [])[0];

  if (!master) throw new Error('Inventory item not found');

  supabaseUpsert('inv_items', {
    item_code: code,
    item_name: String(master.item_name || code).trim(),
    category: String(master.category || '').trim(),
    department: '',
    uom: String(master.unit || 'NOS').trim() || 'NOS',
    is_consumable: false,
    active: master.active !== false
  }, { onConflict: 'item_code' });

  PropertiesService.getScriptProperties().setProperty('INV_STOCK_SNAPSHOT_VERSION', String(Date.now()));

  item = (supabaseSelect('inv_items', {
    filters: { item_code: 'eq.' + code },
    limit: 1
  }) || [])[0];

  if (!item) throw new Error('Inventory item not found');
  return item;
}

function resolveInventoryItemForEntry_(itemCode, itemName) {
  const code = String(itemCode || '').trim();
  const name = String(itemName || '').trim();

  if (code) {
    return ensureInventoryItemExists_(code);
  }

  if (!name) throw new Error('Item required');

  const normalizedName = name.toLowerCase();
  const rows = supabaseSelect('inv_items', {
    select: 'id,item_code,item_name,category,department,uom,is_consumable,active',
    filters: {
      active: 'eq.true',
      item_name: 'ilike.' + name
    },
    limit: 20
  }) || [];

  const exact = rows.find(function(row) {
    return String(row.item_name || '').trim().toLowerCase() === normalizedName;
  });
  if (exact) return exact;

  if (rows.length === 1) return rows[0];

  throw new Error('Inventory item not found');
}

function generateInvItemCode_() {

  const prefix = 'RITM';

  const seq = supabaseSelect('inv_item_sequences', {
    filters: { prefix: 'eq.' + prefix },
    limit: 1
  })[0];

  let next = 1;

  if (seq) {
    next = Number(seq.last_no || 0) + 1;

    supabaseUpdate(
      'inv_item_sequences',
      { prefix: 'eq.' + prefix },
      { last_no: next }
    );
  } else {
    supabaseInsert('inv_item_sequences', {
      prefix: prefix,
      last_no: 1
    });
  }

  return prefix + String(next).padStart(5, '0');
}


function invListItemsJSON(opts = {}) {
  let rows = (supabaseSelect('inv_items', {
    select: 'id,item_code,item_name,category,department,uom,is_consumable,active',
    order: 'item_name.asc'
  }) || []).map(function(row) {
    return _mapInventoryItemRow_(row, 'inventory');
  });

  const q = String(opts?.q || '').trim().toLowerCase();
  if (q) {
    rows = rows.filter(function(row) {
      const hay = [
        row.itemCode,
        row.itemName,
        row.category,
        row.department,
        row.uom
      ].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  if (opts?.onlyActive === true) {
    rows = rows.filter(function(row) { return row.active !== false; });
  }

  rows.sort(function(a, b) {
    return String(a.itemName || a.itemCode || '').localeCompare(String(b.itemName || b.itemCode || ''));
  });

  if (opts?.limit && Number(opts.limit) > 0) {
    rows = rows.slice(0, Number(opts.limit));
  }

  return {
    ok: true,
    rows: rows.map(r => ({
      id: r.id,
      itemCode: r.itemCode,
      itemName: r.itemName,
      category: r.category,
      department: r.department || '',
      uom: r.uom,
      isConsumable: r.isConsumable,
      active: r.active
    }))
  };
}

function invListIssueJSON(opts = {}) {

const filters = {ref_type: 'eq.ISSUE'};

if (opts.fromDate && opts.toDate) {

  const from = opts.fromDate + 'T00:00:00';
  const to   = opts.toDate   + 'T23:59:59';

  filters.and =
    `(created_at.gte.${from},created_at.lte.${to})`;
}
else if (opts.fromDate) {
  filters.created_at = `gte.${opts.fromDate}T00:00:00`;
}
else if (opts.toDate) {
  filters.created_at = `lte.${opts.toDate}T23:59:59`;
}
  // 🔹 Fetch ledger rows
  const rows = supabaseSelect('inv_ledger', {
    select: `
      id,
      created_at,
      ref_no,
      item_id,
      qty_out,
      rate,
      value,
      location,
      department,
      batch_no
    `,
    filters: filters,
    order: 'created_at.desc',
    limit: opts.limit || 50
  }) || [];

  const allocationMap = invGetAllocationSummaryMap_(rows.map(r => r.id));
  const reversalMap = invGetReversalSummaryMap_(rows.map(r => r.id));

  // 🔹 Fetch item map (optimized)
  const itemIds = [...new Set(rows.map(r => r.item_id).filter(Boolean))];

  let itemMap = {};

  if (itemIds.length) {
    const chunkSize = 10;
    for (let i = 0; i < itemIds.length; i += chunkSize) {
      const chunk = itemIds.slice(i, i + chunkSize);
      const items = supabaseSelect('inv_items', {
        select: 'id, item_code, item_name',
        filters: { id: 'in.(' + chunk.join(',') + ')' }
      }) || [];

      items.forEach(item => {
        itemMap[item.id] = item;
      });
    }
  }

  return {
    ok: true,
    rows: rows.map(r => {
      const item = itemMap[r.item_id] || {};

      return {
        issueNo: r.id,
        date: r.created_at,
        itemCode: item.item_code || '',
        itemName: item.item_name || '',
        workOrderNo: r.ref_no || '',
        department: r.department || '',
        batchNo: allocationMap[r.id]?.batchNo || r.batch_no || '',
        batchDisplay: allocationMap[r.id]?.batchDisplay || r.batch_no || '',
        qty: Number(r.qty_out || 0),
        rate: Number(r.rate || 0),
        value: Math.abs(Number(r.value || 0)), // show positive in UI
        location: r.location || '',
        reversed: reversalMap[String(r.id || '')]?.reversed === true,
        reversalDate: reversalMap[String(r.id || '')]?.reversalDate || ''
      };
    })
  };
}

function invSearchItemsJSON(q){

  if(!q || q.length < 2){
    return {ok:true, rows:[]};
  }
  const rows = _getUnifiedInventoryItems_({
    q: q,
    onlyActive: true,
    limit: 50
  });

  return {
    ok:true,
    rows:rows.map(r=>({
      id:r.id,
      itemCode:r.itemCode,
      itemName:r.itemName,
      category:r.category,
      department:r.department || '',
      uom:r.uom,
      isConsumable:r.isConsumable,
      active:r.active

    }))
  };

}

function invAppendLedger_(p) {

  const item = ensureInventoryItemExists_(p.itemCode);

  const qtyIn  = Number(p.qtyIn || 0);
  const qtyOut = Number(p.qtyOut || 0);

  if (qtyIn <= 0 && qtyOut <= 0)
    throw new Error('Ledger entry must have qtyIn or qtyOut');

  const rate  = Number(p.rate || 0);
  const value = Number((qtyIn * rate - qtyOut * rate).toFixed(6));

  const inserted = supabaseInsert('inv_ledger', {
    item_id: item.id,
    location: p.location || DEFAULT_LOCATION,
    ref_type: p.refType,
    ref_no: p.refNo || '',
    qty_in: qtyIn,
    qty_out: qtyOut,
    rate: rate,
    value: value,
    batch_no: p.batchNo || '',
    department: p.department || '',
    remarks: p.remarks || ''
  });
  return Array.isArray(inserted) && inserted.length ? inserted[0] : inserted;
}

function invGenerateBatchNo_(itemCode, receiptDate) {
  const code = String(itemCode || '').trim().toUpperCase() || 'ITEM';
  const dt = receiptDate ? new Date(receiptDate) : new Date();
  const stamp = Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyyMMdd');
  return [code, stamp, Utilities.getUuid().slice(0, 6).toUpperCase()].join('-');
}

function invCreateLot_(payload) {
  const item = ensureInventoryItemExists_(payload.itemCode);
  const qty = Number(payload.qty || 0);
  const rate = Number(payload.rate || 0);
  if (qty <= 0) throw new Error('Lot qty must be positive');
  const receiptDate = payload.receiptDate || new Date().toISOString();
  const batchNo = String(payload.batchNo || '').trim() || invGenerateBatchNo_(payload.itemCode, receiptDate);
  supabaseInsert('inv_lots', {
    id: Utilities.getUuid(),
    item_id: item.id,
    item_code: item.item_code || payload.itemCode,
    batch_no: batchNo,
    source_type: String(payload.sourceType || '').trim(),
    source_ref: String(payload.sourceRef || '').trim(),
    location: payload.location || DEFAULT_LOCATION,
    receipt_date: receiptDate,
    qty_received: qty,
    qty_available: qty,
    rate: rate,
    department: String(payload.department || '').trim(),
    remarks: String(payload.remarks || '').trim(),
    created_at: new Date().toISOString()
  });
  return { batchNo: batchNo, itemId: item.id };
}

function invGetLegacyBatchNo_(itemCode, location) {
  return [
    'LEGACY',
    String(itemCode || '').trim().toUpperCase(),
    String(location || DEFAULT_LOCATION).trim().toUpperCase()
  ].join('-');
}

function invEnsureLegacyLotCoverage_(itemCode, location) {
  const item = ensureInventoryItemExists_(itemCode);
  const normalizedLocation = location || DEFAULT_LOCATION;
  const snapshotQty = Number(invGetCurrentQty_(item.item_code || itemCode, normalizedLocation) || 0);
  if (snapshotQty <= 0) {
    return { item: item, addedQty: 0 };
  }

  const openLots = supabaseSelect('inv_lots', {
    select: 'id,batch_no,qty_received,qty_available',
    filters: {
      item_id: 'eq.' + item.id,
      location: 'eq.' + normalizedLocation,
      qty_available: 'gt.0'
    },
    limit: 500
  }) || [];

  const openLotQty = openLots.reduce(function(sum, row) {
    return sum + Number(row.qty_available || 0);
  }, 0);
  const gap = Number((snapshotQty - openLotQty).toFixed(6));
  if (gap <= 0.0001) {
    return { item: item, addedQty: 0 };
  }

  const legacyBatchNo = invGetLegacyBatchNo_(item.item_code || itemCode, normalizedLocation);
  const existingLegacy = (supabaseSelect('inv_lots', {
    select: 'id,qty_received,qty_available',
    filters: {
      item_id: 'eq.' + item.id,
      location: 'eq.' + normalizedLocation,
      batch_no: 'eq.' + legacyBatchNo
    },
    limit: 1
  }) || [])[0];

  const firstLedger = (supabaseSelect('inv_ledger', {
    select: 'created_at',
    filters: {
      item_id: 'eq.' + item.id,
      location: 'eq.' + normalizedLocation
    },
    order: 'created_at.asc',
    limit: 1
  }) || [])[0];

  const receiptDate = firstLedger?.created_at || new Date().toISOString();
  const rate = Number(invGetCurrentAvgRate(item.item_code || itemCode, normalizedLocation) || 0);

  if (existingLegacy) {
    supabaseUpdate('inv_lots', { id: 'eq.' + existingLegacy.id }, {
      qty_received: Number((Number(existingLegacy.qty_received || 0) + gap).toFixed(6)),
      qty_available: Number((Number(existingLegacy.qty_available || 0) + gap).toFixed(6)),
      rate: rate
    });
  } else {
    supabaseInsert('inv_lots', {
      id: Utilities.getUuid(),
      item_id: item.id,
      item_code: item.item_code || itemCode,
      batch_no: legacyBatchNo,
      source_type: 'OPENING-BALANCE',
      source_ref: 'LEGACY-STOCK',
      location: normalizedLocation,
      receipt_date: receiptDate,
      qty_received: gap,
      qty_available: gap,
      rate: rate,
      department: item.department || '',
      remarks: 'Auto-created legacy opening lot for pre-batch stock',
      created_at: new Date().toISOString()
    });
  }

  PropertiesService.getScriptProperties()
    .setProperty('INV_STOCK_SNAPSHOT_VERSION', String(Date.now()));

  return {
    item: item,
    addedQty: gap,
    batchNo: legacyBatchNo
  };
}

function invListAvailableLotsJSON(itemCode, location) {
  const item = ensureInventoryItemExists_(itemCode);
  invEnsureLegacyLotCoverage_(item.item_code || itemCode, location || DEFAULT_LOCATION);
  const rows = supabaseSelect('inv_lots', {
    select: 'id,batch_no,receipt_date,qty_received,qty_available,rate,location,department',
    filters: {
      item_id: 'eq.' + item.id,
      location: 'eq.' + (location || DEFAULT_LOCATION),
      qty_available: 'gt.0'
    },
    order: 'receipt_date.asc,created_at.asc',
    limit: 200
  }) || [];

  return {
    ok: true,
    rows: rows.map(function(row) {
      const receiptDate = row.receipt_date || '';
      const ageingDays = receiptDate
        ? Math.max(0, Math.ceil((Date.now() - new Date(receiptDate).getTime()) / (24 * 60 * 60 * 1000)))
        : null;
      return {
        id: row.id,
        batchNo: row.batch_no || '',
        receiptDate: receiptDate,
        qtyReceived: Number(row.qty_received || 0),
        qtyAvailable: Number(row.qty_available || 0),
        rate: Number(row.rate || 0),
        location: row.location || '',
        department: row.department || '',
        ageingDays: ageingDays
      };
    })
  };
}

function invAllocateLots_(payload) {
  const item = ensureInventoryItemExists_(payload.itemCode);
  const qty = Number(payload.qty || 0);
  if (qty <= 0) throw new Error('Allocation qty must be positive');
  invEnsureLegacyLotCoverage_(item.item_code || payload.itemCode, payload.location || DEFAULT_LOCATION);

  const filters = {
    item_id: 'eq.' + item.id,
    location: 'eq.' + (payload.location || DEFAULT_LOCATION),
    qty_available: 'gt.0'
  };
  if (payload.batchNo) {
    filters.batch_no = 'eq.' + String(payload.batchNo).trim();
  }

  const lots = supabaseSelect('inv_lots', {
    select: 'id,batch_no,qty_available,rate,receipt_date',
    filters: filters,
    order: 'receipt_date.asc,created_at.asc',
    limit: 200
  }) || [];

  let balance = qty;
  const allocations = [];
  lots.forEach(function(lot) {
    if (balance <= 0) return;
    const available = Number(lot.qty_available || 0);
    if (available <= 0) return;
    const take = Math.min(available, balance);
    if (take <= 0) return;
    allocations.push({
      lotId: lot.id,
      batchNo: lot.batch_no || '',
      availableQty: available,
      qty: take,
      rate: Number(lot.rate || 0)
    });
    balance -= take;
  });

  if (balance > 0.0001) {
    throw new Error(payload.batchNo
      ? ('Insufficient stock in batch ' + payload.batchNo)
      : ('Insufficient FIFO stock for ' + payload.itemCode));
  }

  return { item: item, allocations: allocations };
}

function invApplyLotIssue_(ledgerId, payload) {
  const allocationResult = invAllocateLots_(payload);
  allocationResult.allocations.forEach(function(part) {
    supabaseUpdate('inv_lots', { id: 'eq.' + part.lotId }, {
      qty_available: Number((Number(part.availableQty || 0) - Number(part.qty || 0)).toFixed(6))
    });

    supabaseInsert('inv_lot_allocations', {
      id: Utilities.getUuid(),
      ledger_id: ledgerId,
      lot_id: part.lotId,
      batch_no: part.batchNo,
      item_id: allocationResult.item.id,
      qty: part.qty,
      rate: part.rate,
      txn_type: String(payload.txnType || '').trim(),
      created_at: new Date().toISOString()
    });
  });

  return allocationResult.allocations;
}

function invGetAllocationSummaryMap_(ledgerIds) {
  const ids = [...new Set((ledgerIds || []).filter(Boolean))];
  const out = {};
  if (!ids.length) return out;
  const chunkSize = 5;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const rows = supabaseSelect('inv_lot_allocations', {
      select: 'ledger_id,batch_no,qty',
      filters: {
        ledger_id: _supabaseInFilter_(chunk)
      },
      order: 'created_at.asc',
      limit: 5000
    }) || [];
    rows.forEach(function(row) {
      const key = String(row.ledger_id || '');
      if (!key) return;
      if (!out[key]) out[key] = { batchNos: [], totalQty: 0 };
      const batchNo = String(row.batch_no || '').trim();
      if (batchNo && out[key].batchNos.indexOf(batchNo) === -1) out[key].batchNos.push(batchNo);
      out[key].totalQty += Number(row.qty || 0);
    });
  }
  Object.keys(out).forEach(function(key) {
    out[key].batchDisplay = out[key].batchNos.join(', ');
    out[key].batchNo = out[key].batchNos.length === 1 ? out[key].batchNos[0] : (out[key].batchNos[0] || '');
  });
  return out;
}

function invGetReversalSummaryMap_(ledgerIds) {
  const ids = [...new Set((ledgerIds || []).filter(Boolean).map(function(id) {
    return String(id || '').trim();
  }).filter(Boolean))];
  const out = {};
  if (!ids.length) return out;

  const chunkSize = 5;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const rows = supabaseSelect('inv_ledger', {
      select: 'id,ref_no,ref_type,created_at,remarks',
      filters: {
        ref_no: _supabaseInFilter_(chunk)
      },
      order: 'created_at.desc',
      limit: 5000
    }) || [];

    rows.forEach(function(row) {
      const refType = String(row.ref_type || '').trim().toUpperCase();
      if (refType.indexOf('REV-') !== 0) return;
      const key = String(row.ref_no || '').trim();
      if (!key) return;
      if (!out[key]) {
        out[key] = {
          reversed: false,
          reversalId: '',
          reversalType: '',
          reversalDate: '',
          reversalRemarks: ''
        };
      }
      out[key] = {
        reversed: true,
        reversalId: row.id || '',
        reversalType: refType,
        reversalDate: row.created_at || '',
        reversalRemarks: row.remarks || ''
      };
    });
  }

  return out;
}

function invParseReceiptNote_(remarks) {
  const out = {};
  String(remarks || '').split('|').forEach(function(part) {
    const token = String(part || '').trim();
    if (!token) return;
    const idx = token.indexOf(':');
    if (idx <= 0) return;
    const key = token.slice(0, idx).trim().toUpperCase();
    const value = token.slice(idx + 1).trim();
    if (!value) return;
    out[key] = value;
  });
  return out;
}

function invBuildGRNIdempotencyKey_(header, lines) {
  const normalizedHeader = {
    invoiceNo: String(header.invoiceNo || '').trim().toUpperCase(),
    poNo: String(header.poNo || '').trim().toUpperCase(),
    location: String(header.location || DEFAULT_LOCATION || '').trim().toUpperCase(),
    freightValue: Number(header.freightValue || 0).toFixed(4),
    freightGstPct: Number(header.freightGstPct || 0).toFixed(4)
  };
  const normalizedLines = (lines || []).map(function(line) {
    return [
      String(line.poLineId || '').trim(),
      String(line.prNo || '').trim(),
      String(line.itemCode || '').trim().toUpperCase(),
      Number(line.qty || 0).toFixed(6),
      Number(line.rate || 0).toFixed(6),
      Number(line.taxPct || 0).toFixed(4)
    ].join('~');
  }).sort();

  return _cacheKeyHash_('GRN', JSON.stringify({
    header: normalizedHeader,
    lines: normalizedLines
  }));
}

function invFindExistingGRNByKey_(idempotencyKey) {
  const key = String(idempotencyKey || '').trim();
  if (!key) return null;

  const rows = supabaseSelect('inv_ledger', {
    select: 'id,ref_type,ref_no,remarks,created_at',
    filters: {
      ref_type: _supabaseInFilter_(['PR-RECEIPT', 'PO-RECEIPT', 'DIRECT-RECEIPT']),
      remarks: 'ilike.%Idem:' + key + '%'
    },
    order: 'created_at.asc',
    limit: 100
  }) || [];

  if (!rows.length) return null;

  const first = rows[0];
  const note = invParseReceiptNote_(first.remarks);
  return {
    ok: true,
    duplicate: true,
    grnNo: note.GRN || '',
    receiptNo: first.id || '',
    receipts: rows.map(function(row) {
      return { receiptNo: row.id || '', refType: row.ref_type || '', refNo: row.ref_no || '' };
    })
  };
}

function invRestoreLotAllocations_(ledgerRow) {
  const ledgerId = String(ledgerRow?.id || '').trim();
  if (!ledgerId) throw new Error('Ledger id missing');

  const allocations = supabaseSelect('inv_lot_allocations', {
    select: 'id,lot_id,batch_no,qty',
    filters: {
      ledger_id: 'eq.' + ledgerId
    },
    limit: 500
  }) || [];

  if (allocations.length) {
    allocations.forEach(function(part) {
      const lot = (supabaseSelect('inv_lots', {
        select: 'id,qty_available',
        filters: { id: 'eq.' + part.lot_id },
        limit: 1
      }) || [])[0];
      if (!lot) return;
      supabaseUpdate('inv_lots', { id: 'eq.' + part.lot_id }, {
        qty_available: Number((Number(lot.qty_available || 0) + Number(part.qty || 0)).toFixed(6))
      });
    });
    return allocations.map(function(part) {
      return String(part.batch_no || '').trim();
    }).filter(Boolean);
  }

  const fallbackBatch = String(ledgerRow?.batch_no || '').trim();
  if (!fallbackBatch || !Number(ledgerRow?.qty_out || 0)) {
    throw new Error('Unable to restore FIFO allocations for this transaction');
  }

  const lot = (supabaseSelect('inv_lots', {
    select: 'id,qty_available',
    filters: {
      item_id: 'eq.' + ledgerRow.item_id,
      location: 'eq.' + (ledgerRow.location || DEFAULT_LOCATION),
      batch_no: 'eq.' + fallbackBatch
    },
    order: 'receipt_date.asc,created_at.asc',
    limit: 1
  }) || [])[0];

  if (!lot) throw new Error('Original batch not found for reversal');

  supabaseUpdate('inv_lots', { id: 'eq.' + lot.id }, {
    qty_available: Number((Number(lot.qty_available || 0) + Number(ledgerRow.qty_out || 0)).toFixed(6))
  });
  return [fallbackBatch];
}

function invReverseInboundLot_(ledgerRow) {
  const qty = Number(ledgerRow?.qty_in || 0);
  const batchNo = String(ledgerRow?.batch_no || '').trim();
  if (qty <= 0) throw new Error('Inbound quantity missing');
  if (!batchNo) throw new Error('Batch not found for reversal');

  const lot = (supabaseSelect('inv_lots', {
    select: 'id,qty_received,qty_available',
    filters: {
      item_id: 'eq.' + ledgerRow.item_id,
      location: 'eq.' + (ledgerRow.location || DEFAULT_LOCATION),
      batch_no: 'eq.' + batchNo
    },
    order: 'receipt_date.asc,created_at.asc',
    limit: 1
  }) || [])[0];

  if (!lot) throw new Error('Receipt batch not found');

  const qtyAvailable = Number(lot.qty_available || 0);
  const qtyReceived = Number(lot.qty_received || 0);
  if (qtyAvailable + 0.0001 < qty) {
    throw new Error('Cannot reverse receipt after that batch has already been consumed');
  }
  if (qtyReceived + 0.0001 < qty) {
    throw new Error('Lot quantity is inconsistent for reversal');
  }

  supabaseUpdate('inv_lots', { id: 'eq.' + lot.id }, {
    qty_received: Number((qtyReceived - qty).toFixed(6)),
    qty_available: Number((qtyAvailable - qty).toFixed(6))
  });

  return batchNo;
}

function invReverseLedgerTransaction(ledgerId, reason) {
  const id = String(ledgerId || '').trim();
  const reversalReason = String(reason || '').trim();
  if (!id) throw new Error('Transaction id required');
  if (!reversalReason) throw new Error('Reversal reason required');

  const ledger = (supabaseSelect('inv_ledger', {
    select: `
      id,
      item_id,
      created_at,
      ref_type,
      ref_no,
      qty_in,
      qty_out,
      rate,
      value,
      location,
      department,
      batch_no,
      remarks,
      inv_items!inv_ledger_item_id_fkey (
        item_code,
        item_name
      )
    `,
    filters: { id: 'eq.' + id },
    limit: 1
  }) || [])[0];

  if (!ledger) throw new Error('Transaction not found');

  const originalType = String(ledger.ref_type || '').trim().toUpperCase();
  if (originalType.indexOf('REV-') === 0) {
    throw new Error('Reversal entries cannot be reversed again');
  }

  const existingReversal = invGetReversalSummaryMap_([id])[id];
  if (existingReversal?.reversed) {
    throw new Error('This transaction is already reversed');
  }

  const itemMeta = ledger.inv_items || (ledger.item_id ? (supabaseSelect('inv_items', {
    select: 'item_code,item_name',
    filters: { id: 'eq.' + ledger.item_id },
    limit: 1
  }) || [])[0] : null) || {};
  const itemCode = itemMeta.item_code || '';
  if (!itemCode) throw new Error('Item details not found for transaction');

  const location = ledger.location || DEFAULT_LOCATION;
  const qtyIn = Number(ledger.qty_in || 0);
  const qtyOut = Number(ledger.qty_out || 0);
  const isInbound = qtyIn > 0;
  const isOutbound = qtyOut > 0;
  const reversalType = 'REV-' + originalType;
  const reversalRemarks = [
    'Reversal of ' + originalType,
    'TXN:' + id,
    'Reason:' + reversalReason
  ].join(' | ');

  if (!isInbound && !isOutbound) {
    throw new Error('Unsupported transaction quantity');
  }

  let batchNo = String(ledger.batch_no || '').trim();

  if (isOutbound) {
    const batchNos = invRestoreLotAllocations_(ledger);
    if (batchNos.length) {
      batchNo = batchNos.join(', ');
    }

    invAppendLedger_({
      refType: reversalType,
      refNo: id,
      itemCode: itemCode,
      qtyIn: qtyOut,
      rate: Number(ledger.rate || 0),
      batchNo: String(batchNos[0] || ledger.batch_no || '').trim(),
      location: location,
      department: ledger.department || '',
      remarks: reversalRemarks
    });
  } else if (isInbound) {
    batchNo = invReverseInboundLot_(ledger);

    invAppendLedger_({
      refType: reversalType,
      refNo: id,
      itemCode: itemCode,
      qtyOut: qtyIn,
      rate: Number(ledger.rate || 0),
      batchNo: batchNo,
      location: location,
      department: ledger.department || '',
      remarks: reversalRemarks
    });

    if (originalType === 'PR-RECEIPT') {
      const prNo = String(ledger.ref_no || '').trim();
      if (prNo) {
        const pr = (supabaseSelect('inv_purchase_requests', {
          select: 'pr_no,requested_qty,received_qty,status',
          filters: { pr_no: 'eq.' + prNo },
          limit: 1
        }) || [])[0];
        if (pr) {
          const nextReceived = Math.max(0, Number(pr.received_qty || 0) - qtyIn);
          supabaseUpdate('inv_purchase_requests', { pr_no: 'eq.' + prNo }, {
            received_qty: nextReceived,
            status: nextReceived >= Number(pr.requested_qty || 0) ? 'CLOSED' : 'OPEN'
          });
        }
      }
    }
  }

  refreshStockMV_();

  return {
    ok: true,
    reversedId: id,
    reversalType: reversalType,
    batchNo: batchNo
  };
}

function invGetPurchaseAvgRateMap_(itemIds, location) {
  const ids = [...new Set((itemIds || []).filter(Boolean))];
  const map = {};
  if (!ids.length) return map;

  const receiptTypes = ['PR-RECEIPT', 'PO-RECEIPT', 'DIRECT-RECEIPT'];
  const chunkSize = 200;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const rows = supabaseSelect('inv_ledger', {
      select: 'item_id, qty_in, rate, created_at',
      filters: {
        item_id: _supabaseInFilter_(chunk),
        qty_in: 'gt.0',
        ref_type: _supabaseInFilter_(receiptTypes),
        location: 'eq.' + (location || DEFAULT_LOCATION)
      },
      order: 'created_at.asc',
      limit: 5000
    }) || [];

    rows.forEach(row => {
      const itemId = row.item_id;
      if (!itemId) return;
      if (!map[itemId]) {
        map[itemId] = { qty: 0, value: 0 };
      }
      const qtyIn = Number(row.qty_in || 0);
      const rate = Number(row.rate || 0);
      map[itemId].qty += qtyIn;
      map[itemId].value += qtyIn * rate;
    });
  }

  Object.keys(map).forEach(itemId => {
    const qty = Number(map[itemId].qty || 0);
    const value = Number(map[itemId].value || 0);
    map[itemId] = qty > 0 ? Number((value / qty).toFixed(6)) : 0;
  });

  return map;
}

function invGetCurrentQty_(itemCode, location) {
  const code = String(itemCode || '').trim();
  const loc = String(location || DEFAULT_LOCATION).trim() || DEFAULT_LOCATION;

  if (!code) return 0;

  const item = (supabaseSelect('inv_items', {
    select: 'id,item_code',
    filters: { item_code: 'eq.' + code },
    limit: 1
  }) || [])[0];

  if (item?.id) {
    const lotRows = supabaseSelect('inv_lots', {
      select: 'qty_available',
      filters: {
        item_id: 'eq.' + item.id,
        location: 'eq.' + loc
      },
      limit: 10000
    }) || [];

    if (lotRows.length) {
      return Number(lotRows.reduce(function(sum, row) {
        return sum + Number(row.qty_available || 0);
      }, 0).toFixed(6));
    }
  }

  const rows = supabaseRpc('inv_stock_snapshot', {
    p_location: loc,
    p_search: code
  }) || [];

  const normalizedCode = code.toUpperCase();
  const row = rows.find(function(r) {
    return String(r.itemcode || r.item_code || '').trim().toUpperCase() === normalizedCode;
  });

  return Number(row?.qty || 0);
}

function invGetCurrentStockQty(itemCode, location) {
  return invGetCurrentQty_(itemCode, location);
}

function invGetCurrentAvgRate(itemCode, location) {
  const item = supabaseSelect('inv_items', {
    select: 'id',
    filters: { item_code: 'eq.' + itemCode },
    limit: 1
  })[0];

  if (item?.id) {
    const purchaseRateMap = invGetPurchaseAvgRateMap_([item.id], location || DEFAULT_LOCATION);
    const purchaseRate = Number(purchaseRateMap[item.id] || 0);
    if (purchaseRate > 0) {
      return purchaseRate;
    }
  }

  const rows = supabaseRpc('inv_stock_snapshot', {
    p_location: location || DEFAULT_LOCATION,
    p_search: itemCode
  }) || [];

  const row = rows.find(r => r.itemcode === itemCode);

  return Number(row?.avgrate || 0);
}

function invCreatePurchaseRequest(payload) {

  if (!payload.itemCode && !payload.itemName)
    throw new Error('Item required');

  if (!payload.prQty || payload.prQty <= 0)
    throw new Error('Invalid quantity');

  if (!payload.prDept)
    throw new Error('Department required');

  // 🔎 Fetch full item row
  const item = resolveInventoryItemForEntry_(payload.itemCode, payload.itemName);

  const prNo = generatePRNo_();

  supabaseInsert('inv_purchase_requests', {
    pr_no: prNo,

    item_id: item.id,              // ✅ FIXED
    item_code: item.item_code,
    item_name: item.item_name,

    requested_qty: payload.prQty,
    received_qty: 0,

    department: payload.prDept,
    job_ref: payload.jobRef || '',
    remarks: payload.remarks || '',
    status: 'OPEN'
  });

  return { ok: true, prNo };
}

function invCreatePurchaseRequestsBulk(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error('No PR rows to create');
  }

  const prepared = rows.map(function(row) {
    if (!row.itemCode && !row.itemName) throw new Error('Item required');
    if (!row.prQty || Number(row.prQty) <= 0) throw new Error('Invalid quantity');
    if (!row.prDept) throw new Error('Department required');
    const item = resolveInventoryItemForEntry_(row.itemCode, row.itemName);
    return {
      item: item,
      qty: Number(row.prQty || 0),
      department: String(row.prDept || '').trim(),
      jobRef: String(row.jobRef || '').trim(),
      remarks: String(row.remarks || '').trim()
    };
  });

  const created = prepared.map(function(row) {
    const prNo = generatePRNo_();
    supabaseInsert('inv_purchase_requests', {
      pr_no: prNo,
      item_id: row.item.id,
      item_code: row.item.item_code,
      item_name: row.item.item_name,
      requested_qty: row.qty,
      received_qty: 0,
      department: row.department,
      job_ref: row.jobRef,
      remarks: row.remarks,
      status: 'OPEN'
    });
    return prNo;
  });

  return {
    ok: true,
    count: created.length,
    prNos: created,
    prNo: created[0] || ''
  };
}

function _artworkNormalizeProductType_(value) {
  const raw = String(value || '').trim();
  const upper = raw.toUpperCase();
  if (!upper) return '';
  if (upper.indexOf('CORR') !== -1) return 'Corrugation';
  if (upper.indexOf('FLEXO') !== -1) return 'Flexo';
  if (upper.indexOf('OFFSET') !== -1) return 'Offset';
  if (upper.indexOf('DIGIT') !== -1) return 'Digital';
  return raw;
}

function _artworkDivisionBySoLineMap_(rows) {
  const rowList = Array.isArray(rows) ? rows : [];
  if (!rowList.length) return {};

  const soNumbers = [...new Set(rowList.map(function(row) {
    return String(row.so_number || '').trim();
  }).filter(Boolean))];
  if (!soNumbers.length) return {};

  const salesOrders = _supabaseSelectByKeyInBatches_('sales_orders', 'id,so_number', 'so_number', soNumbers, null, 40) || [];
  const soIdToNumber = {};
  salesOrders.forEach(function(row) {
    const soNumber = String(row.so_number || '').trim();
    const soId = String(row.id || '').trim();
    if (!soNumber || !soId) return;
    soIdToNumber[soId] = soNumber;
  });

  const soIds = Object.keys(soIdToNumber);
  if (!soIds.length) return {};

  const lineRows = _supabaseSelectByKeyInBatches_('sales_order_lines', 'so_id,line_no,division', 'so_id', soIds, null, 40) || [];
  const map = {};
  lineRows.forEach(function(row) {
    const soId = String(row.so_id || '').trim();
    const soNumber = soIdToNumber[soId] || '';
    const lineNo = String(row.line_no || '').trim();
    if (!soNumber || !lineNo) return;
    map[soNumber + '||' + lineNo] = String(row.division || '').trim();
  });
  return map;
}

function invListPurchaseRequestsJSON(opts = {}) {

const filters = {};

if (opts.status)
  filters.status = 'eq.' + opts.status;

if (opts.fromDate && opts.toDate) {

  const from = opts.fromDate + 'T00:00:00';
  const to   = opts.toDate   + 'T23:59:59';

  filters.and =
    `(created_at.gte.${from},created_at.lte.${to})`;
}
else if (opts.fromDate) {
  filters.created_at = `gte.${opts.fromDate}T00:00:00`;
}
else if (opts.toDate) {
  filters.created_at = `lte.${opts.toDate}T23:59:59`;
}

  const rows = supabaseSelect('inv_purchase_requests', {
select: `
  pr_no,
  created_at,
  item_id,
  item_code,
  item_name,
  requested_qty,
  received_qty,
  department,
  job_ref,
  remarks,
  status
`,
    filters,
    order: 'created_at.desc'
  }) || [];

  const purchaseRows = purchaseListInventoryRequestsJSON(opts).rows || [];
  const purchaseMap = {};
  purchaseRows.forEach(r => { purchaseMap[r.prNo] = r; });

  const itemCodes = rows
    .map(function(r) { return String(r.item_code || '').trim(); })
    .filter(Boolean);
  const itemUomMap = {};
  _supabaseSelectByKeyInBatches_(
    'inv_items',
    'item_code,uom',
    'item_code',
    itemCodes,
    null,
    40
  ).forEach(function(item) {
    const code = String(item.item_code || '').trim().toUpperCase();
    if (code) itemUomMap[code] = item.uom || '';
  });

  return {
    ok: true,
    rows: rows.map(r => ({
      prNo: r.pr_no,
      date: r.created_at,
      itemId: r.item_id,
      itemCode: r.item_code,
      itemName: r.item_name,
      uom: itemUomMap[String(r.item_code || '').trim().toUpperCase()] || '',
      prQty: r.requested_qty,          // ✅ FIXED
      receivedQty: r.received_qty || 0,
      balanceQty: Math.max(0, Number(r.requested_qty || 0) - Number(r.received_qty || 0)),
      pendingQty: Math.max(0, Number(r.requested_qty || 0) - Number(r.received_qty || 0)),
      poQty: purchaseMap[r.pr_no]?.openPOQty || 0,
      poRate: purchaseMap[r.pr_no]?.poRate || 0,
      poRefs: purchaseMap[r.pr_no]?.poRefs || [],
      prDept: r.department,
      jobRef: r.job_ref,
      remarks: r.remarks || '',
      status: r.status,
      canEdit: String(r.status || '').toUpperCase() === 'OPEN' &&
        Number(r.received_qty || 0) <= 0 &&
        !(purchaseMap[r.pr_no]?.poRefs || []).length
    }))
  };
}

function invUpdatePurchaseRequest(payload) {
  const prNo = String(payload?.prNo || '').trim();
  if (!prNo) throw new Error('PR No required');

  const pr = (supabaseSelect('inv_purchase_requests', {
    select: 'pr_no,status,received_qty',
    filters: { pr_no: 'eq.' + prNo },
    limit: 1
  }) || [])[0];
  if (!pr) throw new Error('PR not found');
  if (String(pr.status || '').toUpperCase() !== 'OPEN') {
    throw new Error('Only open PR can be edited');
  }
  if (Number(pr.received_qty || 0) > 0) {
    throw new Error('PR cannot be edited after receipt activity');
  }

  const purchaseRows = purchaseListInventoryRequestsJSON({ status: '' }).rows || [];
  const linked = purchaseRows.find(function(row) {
    return String(row.prNo || '') === prNo;
  });
  if ((linked?.poRefs || []).length) {
    throw new Error('PR cannot be edited after PO linkage');
  }

  if (!payload.itemCode && !payload.itemName) throw new Error('Item required');
  if (Number(payload.prQty || 0) <= 0) throw new Error('Invalid requested qty');
  if (!String(payload.prDept || '').trim()) throw new Error('Department required');

  const item = resolveInventoryItemForEntry_(payload.itemCode, payload.itemName);
  supabaseUpdate('inv_purchase_requests', { pr_no: 'eq.' + prNo }, {
    item_id: item.id,
    item_code: item.item_code,
    item_name: item.item_name,
    requested_qty: Number(payload.prQty || 0),
    department: String(payload.prDept || '').trim(),
    job_ref: String(payload.jobRef || '').trim(),
    remarks: String(payload.remarks || '').trim()
  });

  return { ok: true, prNo: prNo };
}

function invListPurchaseReceiptsJSON(opts = {}) {
  const filters = { ref_type: _supabaseInFilter_(['PR-RECEIPT', 'PO-RECEIPT', 'DIRECT-RECEIPT']) };

  if (opts.fromDate && opts.toDate) {
    const from = opts.fromDate + 'T00:00:00';
    const to = opts.toDate + 'T23:59:59';
    filters.and = `(created_at.gte.${from},created_at.lte.${to})`;
  } else if (opts.fromDate) {
    filters.created_at = `gte.${opts.fromDate}T00:00:00`;
  } else if (opts.toDate) {
    filters.created_at = `lte.${opts.toDate}T23:59:59`;
  }

  const rows = supabaseSelect('inv_ledger', {
    select: `
      id,
      item_id,
      created_at,
      ref_type,
      ref_no,
      qty_in,
      rate,
      value,
      location,
      department,
      batch_no,
      remarks,
      inv_items!inv_ledger_item_id_fkey (
        item_code,
        item_name
      )
    `,
    filters,
    order: 'created_at.desc',
    limit: opts.limit || 200
  }) || [];

  const reversalMap = invGetReversalSummaryMap_(rows.map(function(r) { return r.id; }));
  const missingItemIds = [...new Set(rows
    .filter(function(r) {
      return !!r.item_id && (!r.inv_items || (!r.inv_items.item_code && !r.inv_items.item_name));
    })
    .map(function(r) { return r.item_id; }))];
  const itemMap = {};

  if (missingItemIds.length) {
    for (let i = 0; i < missingItemIds.length; i += 20) {
      const chunk = missingItemIds.slice(i, i + 20);
      const itemRows = supabaseSelect('inv_items', {
        select: 'id,item_code,item_name',
        filters: { id: _supabaseInFilter_(chunk) }
      }) || [];
      itemRows.forEach(function(item) {
        itemMap[item.id] = item;
      });
    }
  }

  return {
    ok: true,
    rows: rows.map(function(r) {
      const note = invParseReceiptNote_(r.remarks);
      const itemMeta = r.inv_items || itemMap[r.item_id] || {};
      return {
        receiptNo: r.id,
        grnNo: note.GRN || '',
        date: r.created_at,
        receiptType: r.ref_type || '',
        prNo: r.ref_no || '',
        itemCode: itemMeta.item_code || '',
        itemName: itemMeta.item_name || '',
        department: r.department || '',
        qty: Number(r.qty_in || 0),
        rate: Number(r.rate || 0),
        value: Number(r.value || 0),
        invoiceNo: note.INV || '',
        batchNo: r.batch_no || '',
        location: r.location || '',
        reversed: reversalMap[String(r.id || '')]?.reversed === true,
        reversalDate: reversalMap[String(r.id || '')]?.reversalDate || ''
      };
    })
  };
}

function invPostPOReceiptLine_(payload) {
  if (!payload || !payload.poNo || !payload.poLineId) {
    throw new Error('PO line reference is required');
  }

  const qty = Number(payload.qty || 0);
  const rate = Number(payload.rate || 0);
  if (qty <= 0 || rate <= 0) throw new Error('Invalid qty or rate');

  const line = _purchaseListPOLines_().find(function(row) {
    return String(row.poNo || '') === String(payload.poNo || '') &&
      String(row.id || '') === String(payload.poLineId || '');
  });
  if (!line) throw new Error('PO line not found');

  const sourceType = String(line.sourceType || '').toUpperCase();
  if (_purchaseIsPlateDieSource_(sourceType)) {
    throw new Error('Plate or die PO lines cannot be received from inventory GRN');
  }

  const poRows = purchaseListPOsJSON().rows || [];
  const po = poRows.find(function(r) {
    return String(r.poNo || '') === String(payload.poNo || '');
  });
  const liveLine = (po?.lines || []).find(function(r) {
    return String(r.id || '') === String(payload.poLineId || '');
  }) || line;
  const pendingQty = Number(liveLine.pendingQty || 0);

  const receiptNote = [
    'PO Receipt',
    payload.grnNo ? 'GRN:' + String(payload.grnNo).trim() : '',
    payload.idempotencyKey ? 'Idem:' + String(payload.idempotencyKey).trim() : '',
    'INV:' + String(payload.invoiceNo || '').trim(),
    payload.poNo ? 'PO:' + String(payload.poNo).trim() : '',
    payload.taxPct !== undefined && payload.taxPct !== null
      ? 'TaxPct:' + String(payload.taxPct).trim()
      : '',
    payload.vendorName ? 'Vendor:' + String(payload.vendorName).trim() : '',
    payload.paymentTerms ? 'Pay:' + String(payload.paymentTerms).trim() : '',
    payload.freightTerms ? 'Freight:' + String(payload.freightTerms).trim() : '',
    payload.freightValue !== undefined && payload.freightValue !== null
      ? 'FreightValue:' + String(payload.freightValue).trim()
      : '',
    payload.freightGstPct !== undefined && payload.freightGstPct !== null
      ? 'FreightGST:' + String(payload.freightGstPct).trim()
      : '',
    payload.deliveryTerms ? 'Delivery:' + String(payload.deliveryTerms).trim() : '',
    payload.remarks ? 'Remarks:' + String(payload.remarks).trim() : ''
  ].filter(Boolean).join(' | ');

  const lot = invCreateLot_({
    itemCode: line.itemCode,
    qty: qty,
    rate: rate,
    batchNo: payload.batchNo,
    sourceType: 'PO-RECEIPT',
    sourceRef: payload.poNo,
    receiptDate: new Date().toISOString(),
    location: payload.location || DEFAULT_LOCATION,
    department: line.department || '',
    remarks: receiptNote
  });

  const ledger = invAppendLedger_({
    refType: 'PO-RECEIPT',
    refNo: payload.poNo,
    itemCode: line.itemCode,
    qtyIn: qty,
    rate: rate,
    batchNo: lot.batchNo,
    location: payload.location || DEFAULT_LOCATION,
    department: line.department || '',
    remarks: receiptNote
  });

  refreshStockMV_();

  try {
    supabaseInsert('purchase_po_receipts', {
      id: Utilities.getUuid(),
      po_id: line.poId || null,
      po_no: payload.poNo,
      po_line_id: line.id,
      line_no: line.lineNo,
      source_type: line.sourceType,
      receipt_date: _purchaseIsoDate_(new Date()),
      challan_no: '',
      qty: qty,
      rate: rate,
      remarks: String(payload.remarks || '').trim(),
      created_at: _purchaseNowIso_(),
      updated_at: _purchaseNowIso_()
    });
  } catch (e) {}

  const linkedPrNo = String(line.sourceRef || '').trim();
  if (linkedPrNo) {
    try {
      const pr = supabaseSelect('inv_purchase_requests', {
        select: 'pr_no,requested_qty,received_qty,status',
        filters: { pr_no: 'eq.' + linkedPrNo },
        limit: 1
      })[0];
      if (pr) {
        const nextReceived = Number(pr.received_qty || 0) + qty;
        const requestedQty = Number(pr.requested_qty || 0);
        supabaseUpdate(
          'inv_purchase_requests',
          { pr_no: 'eq.' + linkedPrNo },
          {
            received_qty: nextReceived,
            status: nextReceived >= requestedQty ? 'CLOSED' : 'OPEN'
          }
        );
      }
    } catch (e) {
      Logger.log('Linked PR receipt update failed for ' + linkedPrNo + ': ' + e.message);
    }
  }

  _purchaseUpdatePOStatus_(payload.poNo);
  PropertiesService.getScriptProperties().setProperty('PURCHASE_CACHE_VERSION', String(Date.now()));

  return { ok: true, receiptNo: ledger?.id || '', batchNo: lot.batchNo || '' };
}

function invPostPurchaseReceipt(payload) {

  if (!payload.prNo)
    throw new Error('PR required');

  const pr = supabaseSelect('inv_purchase_requests', {
    filters: { pr_no: 'eq.' + payload.prNo },
    limit: 1
  })[0];

  if (!pr)
    throw new Error('PR not found');

  if (pr.status === 'CLOSED')
    throw new Error('PR already closed');

  const qty = Number(payload.qty);
  const rate = Number(payload.rate);

  if (qty <= 0 || rate <= 0)
    throw new Error('Invalid qty or rate');

  if (!String(payload.invoiceNo || '').trim())
    throw new Error('Invoice No required');

  const pending = Number(pr.requested_qty) - Number(pr.received_qty || 0);

  const receiptNote = [
    'PR Receipt',
    payload.grnNo ? 'GRN:' + String(payload.grnNo).trim() : '',
    payload.idempotencyKey ? 'Idem:' + String(payload.idempotencyKey).trim() : '',
    'INV:' + String(payload.invoiceNo || '').trim(),
    payload.poNo ? 'PO:' + String(payload.poNo).trim() : '',
    payload.taxPct !== undefined && payload.taxPct !== null
      ? 'TaxPct:' + String(payload.taxPct).trim()
      : '',
    payload.vendorName ? 'Vendor:' + String(payload.vendorName).trim() : '',
    payload.paymentTerms ? 'Pay:' + String(payload.paymentTerms).trim() : '',
    payload.freightTerms ? 'Freight:' + String(payload.freightTerms).trim() : '',
    payload.freightValue !== undefined && payload.freightValue !== null
      ? 'FreightValue:' + String(payload.freightValue).trim()
      : '',
    payload.freightGstPct !== undefined && payload.freightGstPct !== null
      ? 'FreightGST:' + String(payload.freightGstPct).trim()
      : '',
    payload.deliveryTerms ? 'Delivery:' + String(payload.deliveryTerms).trim() : '',
    payload.remarks ? 'Remarks:' + String(payload.remarks).trim() : ''
  ].filter(Boolean).join(' | ');

  const lot = invCreateLot_({
    itemCode: payload.itemCode,
    qty: qty,
    rate: rate,
    batchNo: payload.batchNo,
    sourceType: 'PR-RECEIPT',
    sourceRef: payload.prNo,
    receiptDate: new Date().toISOString(),
    location: payload.location || DEFAULT_LOCATION,
    department: pr.department,
    remarks: receiptNote
  });

  // 1️⃣ Post ledger
  const ledger = invAppendLedger_({
    refType: 'PR-RECEIPT',
    refNo: payload.prNo,
    itemCode: payload.itemCode,
    qtyIn: qty,
    rate: rate,
    batchNo: lot.batchNo,
    location: payload.location || DEFAULT_LOCATION,
    department: pr.department,
    remarks: receiptNote
  });

refreshStockMV_();

  // 2️⃣ Update PR received qty
  const newReceived = Number(pr.received_qty || 0) + qty;

  const newStatus =
    newReceived >= pr.requested_qty
      ? 'CLOSED'
      : 'OPEN';

  supabaseUpdate(
    'inv_purchase_requests',
    { pr_no: 'eq.' + payload.prNo },
    {
      received_qty: newReceived,
      status: newStatus
    }
  );

  return { ok: true, receiptNo: ledger?.id || '', batchNo: lot.batchNo || '' };
}

function invPostPurchaseReceiptBulk(payload) {
  const header = payload || {};
  const lines = Array.isArray(header.lines) ? header.lines : [];
  const receiptLines = lines
    .map(function(line) {
      return Object.assign({}, line, {
        qty: Number(line.qty || 0),
        rate: Number(line.rate || 0),
        taxPct: Number(line.taxPct || 0)
      });
    })
    .filter(function(line) {
      return Number(line.qty || 0) > 0 && Number(line.rate || 0) > 0;
    });

  if (!lines.length) throw new Error('At least one receipt line is required');
  if (!String(header.invoiceNo || '').trim()) throw new Error('Invoice No required');
  if (header.freightValue === '' || header.freightValue === null || header.freightValue === undefined) {
    throw new Error('Freight value is required');
  }
  if (!receiptLines.length) throw new Error('No valid receipt lines to post');

  const idempotencyKey = invBuildGRNIdempotencyKey_(header, receiptLines);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('GRN posting is already in progress. Please wait a few seconds and refresh.');
  }

  try {
    const existing = invFindExistingGRNByKey_(idempotencyKey);
    if (existing) return existing;

    const grnNo = 'GRN' +
      Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Kolkata', 'yyyyMMddHHmmss') +
      '-' +
      idempotencyKey.slice(-6).toUpperCase();
    const posted = [];

    receiptLines.forEach(function(line) {
      const basePayload = {
        itemCode: line.itemCode,
        itemName: line.itemName,
        qty: Number(line.qty || 0),
        rate: Number(line.rate || 0),
        taxPct: Number(line.taxPct || 0),
        location: header.location || DEFAULT_LOCATION,
        invoiceNo: String(header.invoiceNo || '').trim(),
        poNo: String(header.poNo || '').trim(),
        vendorName: String(header.vendorName || '').trim(),
        paymentTerms: String(header.paymentTerms || '').trim(),
        freightTerms: String(header.freightTerms || '').trim(),
        freightValue: Number(header.freightValue || 0),
        freightGstPct: Number(header.freightGstPct || 0),
        deliveryTerms: String(header.deliveryTerms || '').trim(),
        remarks: String(header.remarks || '').trim(),
        allowOverReceipt: header.allowOverReceipt === true,
        grnNo: grnNo,
        idempotencyKey: idempotencyKey
      };
      if (String(line.poLineId || '').trim()) {
        posted.push(invPostPOReceiptLine_(Object.assign({}, basePayload, {
          poLineId: line.poLineId,
          sourceType: line.sourceType
        })));
      } else if (String(line.prNo || '').trim()) {
        posted.push(invPostPurchaseReceipt(Object.assign({}, basePayload, {
          prNo: line.prNo
        })));
      }
    });

    if (!posted.length) throw new Error('No valid receipt lines to post');

    return {
      ok: true,
      duplicate: false,
      grnNo: grnNo,
      receiptNo: posted[0]?.receiptNo || '',
      receipts: posted
    };
  } finally {
    lock.releaseLock();
  }
}

function invClosePurchaseRequest(prNo, reason) {

  if (!reason)
    throw new Error('Close reason required');

  supabaseUpdate(
    'inv_purchase_requests',
    { pr_no: 'eq.' + prNo },
    {
      status: 'CLOSED',
      closed_at: new Date().toISOString(),
      remarks: reason
    }
  );

  return { ok: true };
}

function generatePRNo_() {

  const seq = supabaseSelect('inv_pr_sequences', {
    filters: { prefix: 'eq.PR' },
    limit: 1
  })[0];

  const next = Number(seq.last_no || 0) + 1;

  supabaseUpdate(
    'inv_pr_sequences',
    { prefix: 'eq.PR' },
    { last_no: next }
  );

  return 'PR' + String(next).padStart(5, '0');
}

function invPostDirectReceipt(payload) {
  if ((!payload.itemCode && !payload.itemName) || !payload.qty || !payload.rate || !payload.reason)
    throw new Error('Item, qty, rate & reason required');

  const item = resolveInventoryItemForEntry_(payload.itemCode, payload.itemName);

  const lot = invCreateLot_({
    itemCode: item.item_code || payload.itemCode,
    qty: payload.qty,
    rate: payload.rate,
    batchNo: payload.batchNo,
    sourceType: 'DIRECT-RECEIPT',
    sourceRef: payload.refNo || '',
    receiptDate: new Date().toISOString(),
    location: payload.location,
    department: payload.department || '',
    remarks: payload.reason
  });

  const ledger = invAppendLedger_({
    refType: 'DIRECT-RECEIPT',
    refNo: payload.refNo || '',
    itemCode: item.item_code || payload.itemCode,
    qtyIn: payload.qty,
    rate: payload.rate,
    batchNo: lot.batchNo,
    location: payload.location,
    remarks: payload.reason
  });

refreshStockMV_();

  return { ok: true, receiptNo: ledger?.id || '', batchNo: lot.batchNo || '' };
}

function invGetReceiptPrintData(receiptNo) {
  const id = String(receiptNo || '').trim();
  if (!id) throw new Error('Receipt number is required');

  const ledger = (supabaseSelect('inv_ledger', {
    select: `
      id,
      item_id,
      created_at,
      ref_type,
      ref_no,
      qty_in,
      rate,
      value,
      location,
      department,
      batch_no,
      remarks,
      inv_items!inv_ledger_item_id_fkey (
        item_code,
        item_name,
        uom,
        category
      )
    `,
    filters: { id: 'eq.' + id },
    limit: 1
  }) || [])[0];

  if (!ledger) throw new Error('Receipt not found');
  if (['PR-RECEIPT', 'PO-RECEIPT', 'DIRECT-RECEIPT'].indexOf(String(ledger.ref_type || '').trim().toUpperCase()) === -1) {
    throw new Error('Print supported only for material receipts');
  }

  const item = ledger.inv_items || (ledger.item_id ? (supabaseSelect('inv_items', {
    select: 'item_code,item_name,uom,category',
    filters: { id: 'eq.' + ledger.item_id },
    limit: 1
  }) || [])[0] : null) || {};
  const note = invParseReceiptNote_(ledger.remarks);
  const poNo = String(note.PO || '').trim();
  const poHeader = poNo ? _purchaseListPOHeaders_().find(function(row) {
    return String(row.poNo || '') === poNo;
  }) : null;
  const vendor = poHeader ? (_purchaseListVendors_().find(function(v) {
    return String(v.id || '') === String(poHeader.vendorId || '');
  }) || {}) : {};
  const vendorName = String(note.VENDOR || poHeader?.vendorName || vendor.vendorName || '').trim();
  const vendorAddress = String(vendor.address || poHeader?.vendorAddress || '').trim();
  const vendorGstin = String(vendor.gstin || '').trim();
  const invoiceNo = String(note.INV || '').trim();
  const qty = Number(ledger.qty_in || 0);
  const rate = Number(ledger.rate || 0);
  const value = Number(ledger.value || 0);
  const preparedBy = String(Session.getActiveUser?.().getEmail?.() || 'ERP User').trim();
  const receiptType = String(ledger.ref_type || '').trim().toUpperCase();

  return {
    ok: true,
    company: PURCHASE_COMPANY,
    receipt: {
      receiptNo: ledger.id,
      documentNo: 'GRN-' + String(ledger.id || '').trim(),
      date: ledger.created_at || '',
      type: receiptType,
      sourceRef: ledger.ref_no || '',
      invoiceNo: invoiceNo,
      poNo: poNo,
      vendorName: vendorName,
      vendorAddress: vendorAddress,
      vendorGstin: vendorGstin,
      department: ledger.department || '',
      location: ledger.location || DEFAULT_LOCATION,
      batchNo: ledger.batch_no || '',
      remarks: String(note.REMARKS || ledger.remarks || '').trim()
    },
    line: {
      itemCode: item.item_code || '',
      itemName: item.item_name || '',
      category: item.category || '',
      uom: item.uom || '',
      qty: qty,
      rate: rate,
      value: value
    },
    meta: {
      paymentTerms: String(note.PAY || poHeader?.paymentTerms || '').trim(),
      freightTerms: String(note.FREIGHT || poHeader?.freightTerms || '').trim(),
      deliveryTerms: String(note.DELIVERY || poHeader?.deliveryTerms || '').trim(),
      printedBy: preparedBy
    }
  };
}

function invBuildWorkOrdersForIssueFromPreparedRows_(preparedRows) {
  const grouped = {};
  (preparedRows || []).forEach(function(row) {
    const woNo = String(row.wo_no || row.woNo || row.wo_number || '').trim();
    if (!woNo) return;
    if (!grouped[woNo]) {
      grouped[woNo] = {
        woNo: woNo,
        issueDepartment: String(row.issue_department || row.issueDepartment || '').trim(),
        materialStatus: String(row.material_status || row.materialStatus || 'PENDING').trim().toUpperCase() || 'PENDING',
        requirements: []
      };
    }
    if (!grouped[woNo].issueDepartment && (row.issue_department || row.issueDepartment)) {
      grouped[woNo].issueDepartment = String(row.issue_department || row.issueDepartment || '').trim();
    }
    const lineStatus = String(row.line_status || '').trim().toUpperCase();
    if (lineStatus === 'PENDING') grouped[woNo].materialStatus = 'PENDING';
    grouped[woNo].requirements.push({
      materialKey: row.material_key || row.materialKey || '',
      itemLabel: row.item_label || row.itemLabel || '',
      gsm: row.gsm || '',
      deckleMm: Number(row.deckle_mm ?? row.deckleMm ?? 0),
      cutMm: Number(row.cut_mm ?? row.cutMm ?? 0),
      uom: row.uom || '',
      requiredQty: Number(row.required_qty ?? row.requiredQty ?? 0),
      issuedQty: Number(row.issued_qty ?? row.issuedQty ?? 0),
      remainingQty: Number(row.remaining_qty ?? row.remainingQty ?? 0)
    });
  });

  return Object.keys(grouped)
    .sort(function(a, b) { return a.localeCompare(b); })
    .map(function(key) {
      const row = grouped[key];
      if (!row.materialStatus || row.materialStatus !== 'ISSUED') {
        row.materialStatus = row.requirements.some(function(req) {
          return Number(req.remainingQty || 0) > 0.0001;
        }) ? 'PENDING' : 'ISSUED';
      }
      return row;
    });
}

function invListWorkOrdersForIssueFromView_() {
  try {
    const rows = supabaseRpc('inv_work_orders_for_issue_ui', {}) || [];
    const preparedRows = Array.isArray(rows) ? rows : (rows.rows || []);
    return invBuildWorkOrdersForIssueFromPreparedRows_(preparedRows);
  } catch (err) {
    const msg = String(err && err.message || err || '');
    if (msg.indexOf('inv_work_orders_for_issue_ui') === -1 &&
        msg.indexOf('inv_wo_issue_requirement_v') === -1 &&
        msg.indexOf('schema cache') === -1 &&
        msg.indexOf('Could not find') === -1 &&
        msg.indexOf('does not exist') === -1) {
      Logger.log('WO issue prepared view failed, using fallback: ' + msg);
    }
    return null;
  }
}

function resolveWOIssueDepartment_(snapshotJson) {
  const snap = snapshotJson || {};
  const raw = String(
    snap?.jobDetails?.department ||
    snap?.department ||
    snap?.departmentCategory ||
    snap?.jobDetails?.category ||
    snap?.jobDetails?.type ||
    ''
  ).trim();
  const upper = raw.toUpperCase();
  if (upper.indexOf('FLEXO') !== -1) return 'Flexo';
  if (upper.indexOf('OFFSET') !== -1) return 'Offset';
  if (upper === 'FLAT' || upper.indexOf('FLAT') !== -1) return 'Offset';
  if (upper.indexOf('DIGITAL') !== -1) return 'Digital';
  if (upper.indexOf('CORR') !== -1) return 'Corrugation';
  return 'Offset';
}

function invListWorkOrdersForIssue() {

  const preparedRows = invListWorkOrdersForIssueFromView_();
  if (preparedRows && preparedRows.length) {
    return { ok: true, rows: preparedRows };
  }

  const workOrders = supabaseSelect('work_orders', {
    select: 'id, wo_number, status, snapshot_json',
    filters: { status: 'neq.CLOSED' },
    order: 'wo_number.asc'
  }) || [];

  if (!workOrders.length) {
    return { ok: true, rows: [] };
  }

  const woIds = workOrders.map(w => w.id);
  const woIdToNo = {};
  workOrders.forEach(w => woIdToNo[w.id] = w.wo_number);

  // 1️⃣ Fetch required materials
  const chunkSize = 20;
  let materials = [];
  for (let i = 0; i < woIds.length; i += chunkSize) {
    const chunk = woIds.slice(i, i + chunkSize);
    const batch = supabaseSelect('work_order_materials', {
      select: `
        wo_id,
        material_key,
        item_name,
        gsm,
        deckle,
        cut_size,
        uom,
        required_qty
      `,
      filters: { wo_id: 'in.(' + chunk.join(',') + ')' }
    }) || [];
    materials = materials.concat(batch);
  }

  // 2️⃣ Fetch issued quantities
  let issuedRows = [];
  for (let i = 0; i < workOrders.length; i += chunkSize) {
    const chunk = workOrders.slice(i, i + chunkSize);
    const woNumbers = chunk.map(w => w.wo_number).filter(Boolean);
    const batch = supabaseSelect('inv_ledger', {
      select: 'id, ref_no, remarks, qty_out',
      filters: {
        ref_type: 'eq.ISSUE',
        ref_no: _supabaseInFilter_(woNumbers)
      }
    }) || [];
    issuedRows = issuedRows.concat(batch);
  }

  const issueReversalMap = invGetReversalSummaryMap_(issuedRows.map(function(row) {
    return row.id;
  }));
  issuedRows = issuedRows.filter(function(row) {
    return issueReversalMap[String(row.id || '')]?.reversed !== true;
  });

  const issuedMap = {};
  issuedRows.forEach(r => {

    const woNo = r.ref_no;
    const key = normalizeStoredWOMaterialKey_(r.remarks);
    const qty = Number(r.qty_out || 0);

    if (!woNo || !key) return;

    if (!issuedMap[woNo]) issuedMap[woNo] = {};
    issuedMap[woNo][key] =
      (issuedMap[woNo][key] || 0) + qty;
  });

  // 3️⃣ Final evaluation (WITH TOLERANCE)
  const rows = [];

  workOrders.forEach(w => {

    const woId = w.id;
    const woNo = w.wo_number;
    const woMaterials = applyWOMaterialFallbacks_(
      materials.filter(m => m.wo_id === woId),
      w.snapshot_json || {}
    );
    const requirementRows = buildWOMaterialRequirementRows_(
      woMaterials,
      issuedRows.filter(r => r.ref_no === woNo)
    );

    const hasPending = requirementRows.some(function(row) {
      return Number(row.remainingQty || 0) > 0.0001;
    });

    for (const key in req) {

      const reqQty = Number(req[key] || 0);
      const issQty = Number(issued[key] || 0);

      // 🔥 TOLERANCE FIX
      if ((reqQty - issQty) > 0.0001) {
        hasPending = true;
        break;
      }
    }

    rows.push({
      woNo: woNo,
      materialStatus: hasPending ? 'PENDING' : 'ISSUED',
      requirements: requirementRows
    });
  });

  return { ok: true, rows };
}


function invListWorkOrdersForIssue() {

  const preparedRows = invListWorkOrdersForIssueFromView_();
  if (preparedRows && preparedRows.length) {
    return { ok: true, rows: preparedRows };
  }

  const workOrders = supabaseSelect('work_orders', {
    select: 'id, wo_number, status, snapshot_json',
    filters: { status: 'neq.CLOSED' },
    order: 'wo_number.asc'
  }) || [];

  if (!workOrders.length) {
    return { ok: true, rows: [] };
  }

  const woIds = workOrders.map(function(w) { return w.id; });
  const chunkSize = 20;
  let materials = [];
  for (let i = 0; i < woIds.length; i += chunkSize) {
    const chunk = woIds.slice(i, i + chunkSize);
    const batch = supabaseSelect('work_order_materials', {
      select: `
        wo_id,
        material_key,
        item_name,
        gsm,
        deckle,
        cut_size,
        uom,
        required_qty
      `,
      filters: { wo_id: 'in.(' + chunk.join(',') + ')' }
    }) || [];
    materials = materials.concat(batch);
  }

  let issuedRows = [];
  for (let i = 0; i < workOrders.length; i += chunkSize) {
    const chunk = workOrders.slice(i, i + chunkSize);
    const woNumbers = chunk.map(function(w) { return w.wo_number; }).filter(Boolean);
    const batch = supabaseSelect('inv_ledger', {
      select: 'id, ref_no, remarks, qty_out',
      filters: {
        ref_type: 'eq.ISSUE',
        ref_no: _supabaseInFilter_(woNumbers)
      }
    }) || [];
    issuedRows = issuedRows.concat(batch);
  }

  const issueReversalMap = invGetReversalSummaryMap_(issuedRows.map(function(row) {
    return row.id;
  }));
  issuedRows = issuedRows.filter(function(row) {
    return issueReversalMap[String(row.id || '')]?.reversed !== true;
  });

  const rows = [];
  workOrders.forEach(function(w) {
    const woMaterials = applyWOMaterialFallbacks_(
      materials.filter(function(m) { return m.wo_id === w.id; }),
      w.snapshot_json || {}
    );
    const requirementRows = buildWOMaterialRequirementRows_(
      woMaterials,
      issuedRows.filter(function(r) { return r.ref_no === w.wo_number; })
    );
    const hasPending = requirementRows.some(function(row) {
      return Number(row.remainingQty || 0) > 0.0001;
    });

    rows.push({
      woNo: w.wo_number,
      issueDepartment: resolveWOIssueDepartment_(w.snapshot_json || {}),
      materialStatus: hasPending ? 'PENDING' : 'ISSUED',
      requirements: requirementRows
    });
  });

  return { ok: true, rows };
}

function invPostIssue(payload) {
  if (!payload.itemCode || !payload.qty)
    throw new Error('Item and qty required');

  const location = payload.location || DEFAULT_LOCATION;
  const qty = Number(payload.qty);

  const currentQty = invGetCurrentQty_(payload.itemCode, location);
  if (currentQty < qty) {
    throw new Error(`Insufficient stock. Available: ${currentQty}`);
  }

  if (qty <= 0)
  throw new Error('Invalid quantity');

  const isDirect = !payload.workOrderNo || payload.workOrderNo === 'DIRECT';

  // 🔒 WO issue requires materialKey
  if (!isDirect && !payload.materialKey) {
    throw new Error('materialKey required for WO issue');
  }

  // WO over-issue is intentionally allowed after user confirmation in UI.
  // Keep the warning flow on the frontend, but do not hard-block posting here.

  const allocations = invAllocateLots_({
    itemCode: payload.itemCode,
    qty: qty,
    location: location,
    batchNo: payload.batchNo || ''
  }).allocations;
  const weightedValue = allocations.reduce((sum, part) => sum + (Number(part.qty || 0) * Number(part.rate || 0)), 0);
  const rate = qty > 0 ? Number((weightedValue / qty).toFixed(6)) : 0;
  const batchSummary = allocations.map(function(part) { return part.batchNo; }).filter(Boolean);

  const ledger = invAppendLedger_({
    refType: 'ISSUE',
    refNo: payload.workOrderNo || 'DIRECT',
    itemCode: payload.itemCode,
    qtyOut: qty,
    rate: rate,
    batchNo: batchSummary.length === 1 ? batchSummary[0] : (batchSummary[0] || ''),
    location: location,
    department: payload.department || '',
remarks: isDirect
      ? (payload.remarks || 'Direct Issue')
      : String(payload.materialKey || '').trim()
  });
  invApplyLotIssue_(ledger?.id || null, {
    itemCode: payload.itemCode,
    qty: qty,
    location: location,
    batchNo: payload.batchNo || '',
    txnType: 'ISSUE'
  });

  if (payload.skipStockRefresh !== true) {
    refreshStockMV_();
  }

  return { ok: true };
}

function invPostIssueBulk(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error('No issue rows to post');
  }

  const grouped = {};
  rows.forEach(function(row) {
    if (!row.itemCode || !row.qty) throw new Error('Item and qty required');
    const qty = Number(row.qty || 0);
    if (!(qty > 0)) throw new Error('Invalid quantity');
    const location = String(row.location || DEFAULT_LOCATION).trim() || DEFAULT_LOCATION;
    const itemCode = String(row.itemCode || '').trim();
    const key = itemCode + '||' + location;
    grouped[key] = (grouped[key] || 0) + qty;
  });

  Object.keys(grouped).forEach(function(key) {
    const parts = key.split('||');
    const itemCode = parts[0];
    const location = parts[1] || DEFAULT_LOCATION;
    const currentQty = invGetCurrentQty_(itemCode, location);
    if (currentQty < grouped[key]) {
      throw new Error(`Insufficient stock for ${itemCode}. Available: ${currentQty}`);
    }
  });

  rows.forEach(function(row) {
    invPostIssue(Object.assign({}, row, { skipStockRefresh: true }));
  });
  refreshStockMV_(true);

  return {
    ok: true,
    count: rows.length
  };
}

function invPostRTS(payload) {
  if (!payload.itemCode || !payload.qty)
    throw new Error('Item and qty required');

  const location = payload.location || DEFAULT_LOCATION;
  const qty = Number(payload.qty);

  const currentQty = invGetCurrentQty_(payload.itemCode, location);
  if (currentQty < qty) {
    throw new Error(`Insufficient stock for RTS. Available: ${currentQty}`);
  }

  const allocations = invAllocateLots_({
    itemCode: payload.itemCode,
    qty: qty,
    location: location,
    batchNo: payload.batchNo || ''
  }).allocations;
  const weightedValue = allocations.reduce((sum, part) => sum + (Number(part.qty || 0) * Number(part.rate || 0)), 0);
  const rate = qty > 0 ? Number((weightedValue / qty).toFixed(6)) : 0;
  const batchSummary = allocations.map(function(part) { return part.batchNo; }).filter(Boolean);
  const ledger = invAppendLedger_({
    refType: 'RTS',
    refNo: payload.refNo || '',
    itemCode: payload.itemCode,
    qtyOut: qty,
    rate: rate,
    batchNo: batchSummary.length === 1 ? batchSummary[0] : (batchSummary[0] || ''),
    location: location,
    remarks: payload.remarks || ''
  });
  invApplyLotIssue_(ledger?.id || null, {
    itemCode: payload.itemCode,
    qty: qty,
    location: location,
    batchNo: payload.batchNo || '',
    txnType: 'RTS'
  });

refreshStockMV_();

  return { ok: true };
}

function invListRTSJSON(opts = {}) {

const filters = {ref_type: 'eq.RTS'};

if (opts.fromDate && opts.toDate) {

  const from = opts.fromDate + 'T00:00:00';
  const to   = opts.toDate   + 'T23:59:59';

  filters.and =
    `(created_at.gte.${from},created_at.lte.${to})`;
}
else if (opts.fromDate) {
  filters.created_at = `gte.${opts.fromDate}T00:00:00`;
}
else if (opts.toDate) {
  filters.created_at = `lte.${opts.toDate}T23:59:59`;
}

  const rows = supabaseSelect('inv_ledger', {
    select: `
      id,
      created_at,
      qty_out,
      rate,
      value,
      location,
      department,
      batch_no,
      inv_items!inv_ledger_item_id_fkey (
        item_code,
        item_name
      )
    `,
    filters,
    order: 'created_at.desc',
    limit: opts.limit || 50
  }) || [];

  const allocationMap = invGetAllocationSummaryMap_(rows.map(r => r.id));
  const reversalMap = invGetReversalSummaryMap_(rows.map(r => r.id));

  return {
    ok: true,
    rows: rows.map(r => ({
      rtsNo: r.id,
      date: r.created_at,
      itemCode: r.inv_items?.item_code || '',
      itemName: r.inv_items?.item_name || '',
      department: r.department || '',
      batchNo: allocationMap[r.id]?.batchNo || r.batch_no || '',
      batchDisplay: allocationMap[r.id]?.batchDisplay || r.batch_no || '',
      qty: Number(r.qty_out || 0),
      rate: Number(r.rate || 0),
      value: Math.abs(Number(r.value || 0)),
      location: r.location || '',
      reversed: reversalMap[String(r.id || '')]?.reversed === true,
      reversalDate: reversalMap[String(r.id || '')]?.reversalDate || ''
    }))
  };
}

function invPostRFP(payload) {
  if (!payload.itemCode || !payload.qty || !payload.workOrderNo)
    throw new Error('Item, qty & WO required');

  const location = payload.location || DEFAULT_LOCATION;
  const rate = invGetCurrentAvgRate(payload.itemCode, location);
  const lot = invCreateLot_({
    itemCode: payload.itemCode,
    qty: payload.qty,
    rate: rate,
    batchNo: payload.batchNo,
    sourceType: 'RFP',
    sourceRef: payload.workOrderNo,
    receiptDate: new Date().toISOString(),
    location: location,
    department: payload.department || '',
    remarks: payload.remarks || ''
  });
  invAppendLedger_({
    refType: 'RFP',
    refNo: payload.workOrderNo,
    itemCode: payload.itemCode,
    qtyIn: payload.qty,
    rate: rate,
    batchNo: lot.batchNo,
    location: location,
    remarks: payload.remarks || ''
  });
refreshStockMV_();

  return { ok: true };
}

function invListRFPJSON(opts = {}) {

  const filters = { ref_type: 'eq.RFP' };

  if (opts.fromDate && opts.toDate) {
    const from = opts.fromDate + 'T00:00:00';
    const to   = opts.toDate   + 'T23:59:59';
    filters.and =
      `(created_at.gte.${from},created_at.lte.${to})`;
  }

  const rows = supabaseSelect('inv_ledger', {
    select: `
      id,
      created_at,
      ref_no,
      department,
      qty_in,
      rate,
      value,
      location,
      batch_no,
      inv_items!inv_ledger_item_id_fkey (
        item_code,
        item_name
      )
    `,
    filters,
    order: 'created_at.desc',
    limit: opts.limit || 50
  }) || [];

  const allocationMap = invGetAllocationSummaryMap_(rows.map(r => r.id));
  const reversalMap = invGetReversalSummaryMap_(rows.map(r => r.id));

  return {
    ok: true,
    rows: rows.map(r => ({
      rfpNo: r.id,
      date: r.created_at,
      itemCode: r.inv_items?.item_code || '',
      itemName: r.inv_items?.item_name || '',
      workOrderNo: r.ref_no || '',
      department: r.department || '',
      batchNo: allocationMap[r.id]?.batchNo || r.batch_no || '',
      batchDisplay: allocationMap[r.id]?.batchDisplay || r.batch_no || '',
      qty: Number(r.qty_in || 0),
      rate: Number(r.rate || 0),
      value: Number(r.value || 0),
      location: r.location || '',
      reversed: reversalMap[String(r.id || '')]?.reversed === true,
      reversalDate: reversalMap[String(r.id || '')]?.reversalDate || ''
    }))
  };
}

function invPostAdjustment(payload) {
  if (!payload.itemCode || !payload.qty || !payload.reason)
    throw new Error('Item, qty & reason required');

  const adjType = String(payload.adjType || '').toUpperCase();
  if (!['GAIN','LOSS'].includes(adjType))
    throw new Error('adjType must be GAIN or LOSS');

  const location = payload.location || DEFAULT_LOCATION;
  let rate = invGetCurrentAvgRate(payload.itemCode, location);
  let batchNo = '';
  if (adjType === 'GAIN') {
    const lot = invCreateLot_({
      itemCode: payload.itemCode,
      qty: payload.qty,
      rate: rate,
      batchNo: payload.batchNo,
      sourceType: 'ADJ-GAIN',
      sourceRef: '',
      receiptDate: new Date().toISOString(),
      location: location,
      remarks: payload.reason
    });
    batchNo = lot.batchNo;
  } else {
    const allocations = invAllocateLots_({
      itemCode: payload.itemCode,
      qty: payload.qty,
      location: location,
      batchNo: payload.batchNo || ''
    }).allocations;
    const totalQty = allocations.reduce((sum, part) => sum + Number(part.qty || 0), 0);
    const totalValue = allocations.reduce((sum, part) => sum + (Number(part.qty || 0) * Number(part.rate || 0)), 0);
    rate = totalQty > 0 ? Number((totalValue / totalQty).toFixed(6)) : rate;
    batchNo = allocations.length === 1 ? allocations[0].batchNo : (allocations[0]?.batchNo || '');
  }

  const ledger = invAppendLedger_({
    refType: 'ADJ',
    refNo: '',
    itemCode: payload.itemCode,
    qtyIn:  adjType === 'GAIN' ? payload.qty : 0,
    qtyOut: adjType === 'LOSS' ? payload.qty : 0,
    rate: rate,
    batchNo: batchNo,
    location: location,
    remarks: payload.reason
  });
  if (adjType === 'LOSS') {
    invApplyLotIssue_(ledger?.id || null, {
      itemCode: payload.itemCode,
      qty: Number(payload.qty || 0),
      location: location,
      batchNo: payload.batchNo || '',
      txnType: 'ADJ-LOSS'
    });
  }

refreshStockMV_();

  return { ok: true };
}

function invListAdjustmentsJSON(opts = {}) {

  const filters = { ref_type: 'eq.ADJ' };

  if (opts.fromDate && opts.toDate) {
    const from = opts.fromDate + 'T00:00:00';
    const to   = opts.toDate   + 'T23:59:59';
    filters.and = `(created_at.gte.${from},created_at.lte.${to})`;
  }

  const rows = supabaseSelect('inv_ledger', {
    select: `
      id,
      created_at,
      qty_in,
      qty_out,
      rate,
      value,
      location,
      remarks,
      batch_no,
      inv_items!inv_ledger_item_id_fkey (
        item_code,
        item_name
      )
    `,
    filters,
    order: 'created_at.desc',
    limit: opts.limit || 50
  }) || [];

  const allocationMap = invGetAllocationSummaryMap_(rows.map(r => r.id));
  const reversalMap = invGetReversalSummaryMap_(rows.map(r => r.id));

  return {
    ok: true,
    rows: rows.map(r => ({
      adjNo: r.id,
      date: r.created_at,
      itemCode: r.inv_items?.item_code || '',
      itemName: r.inv_items?.item_name || '',
      adjType: r.qty_in > 0 ? 'GAIN' : 'LOSS',
      batchNo: allocationMap[r.id]?.batchNo || r.batch_no || '',
      batchDisplay: allocationMap[r.id]?.batchDisplay || r.batch_no || '',
      qty: Number(r.qty_in || r.qty_out || 0),
      rate: Number(r.rate || 0),
      value: Number(r.value || 0),
      location: r.location || '',
      reason: r.remarks || '',
      reversed: reversalMap[String(r.id || '')]?.reversed === true,
      reversalDate: reversalMap[String(r.id || '')]?.reversalDate || ''
    }))
  };
}

function invGetStockSnapshotJSON(opts = {}) {
  const includeAnalytics = opts.includeAnalytics === true;
  const requestedLimit = Math.max(1, Number(opts.limit || 5000) || 5000);
  const snapshotLimit = Math.min(requestedLimit, 5000);
  const version = PropertiesService.getScriptProperties().getProperty('INV_STOCK_SNAPSHOT_VERSION') || '0';
  const cacheKey = _cacheKeyHash_('INV_STOCK_SNAPSHOT', JSON.stringify({
    v: version,
    q: String(opts.q || '').trim().toLowerCase(),
    l: String(opts.location || ''),
    n: snapshotLimit,
    a: includeAnalytics ? 1 : 0
  }));
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  try {
    const uiRows = supabaseRpc('inv_stock_snapshot_ui', {
      p_location: opts.location || null,
      p_search: opts.q || null,
      p_limit: snapshotLimit
    }) || [];
    if (Array.isArray(uiRows) && uiRows.length >= 0) {
      const result = {
        ok: true,
        rows: uiRows.map(function(r) {
          return {
            itemCode: r.itemcode || '',
            itemName: r.itemname || '',
            category: r.category || '',
            department: r.department || '',
            uom: r.uom || '',
            location: r.location || '',
            qty: Number(r.qty || 0),
            avgRate: Number(r.avg_rate || r.avgrate || 0),
            value: Number(r.value || 0),
            ageingDays: r.ageing_days == null ? null : Number(r.ageing_days),
            movementClass: r.movement_class || 'UNKNOWN',
            lastMovementAt: r.last_movement_at || '',
            oldestReceiptAt: r.oldest_receipt_at || '',
            nextBatchNo: r.next_batch_no || '',
            batchCount: Number(r.batch_count || 0),
            avgLeadTimeDays: Number(r.avg_lead_time_days || 0),
            avgDailyConsumption: Number(r.avg_daily_consumption || 0),
            safetyFactor: Number(r.safety_factor || 1.2),
            minimumStockLevel: Number(r.minimum_stock_level || 0),
            mslStatus: r.msl_status || 'OK',
            mslGap: Number(r.msl_gap || 0)
          };
        })
      };
      try {
        cache.put(cacheKey, JSON.stringify(result), includeAnalytics ? 600 : 120);
      } catch (err) {}
      return result;
    }
  } catch (err) {}

  const AGEING_NON_MOVING_DAYS = 60;
  const AGEING_SLOW_MOVING_DAYS = 30;
  const CONSUMPTION_WINDOW_DAYS = 30;
  const DEFAULT_LEAD_TIME_DAYS = 7;
  const SAFETY_FACTOR = 1.2;
  const now = new Date();
  const consumptionCutoff = new Date(now.getTime() - (CONSUMPTION_WINDOW_DAYS * 24 * 60 * 60 * 1000));
  const stockSearch = String(opts.q || '').trim().toLowerCase();
  const stockLocation = String(opts.location || '').trim().toUpperCase();

  const snapshotRows = (supabaseRpc('inv_stock_snapshot_mv', {
    p_location: opts.location || null,
    p_search: opts.q || null
  }) || []).slice(0, snapshotLimit);

  let fgRows = [];
  let openingFgRows = [];
  if (stockLocation === 'FG') {
    const fgPackingRows = supabaseSelect('packing_records', {
      select: 'so_line_id,so_number,line_no,product_code,product_name,packed_qty,ready_to_dispatch,packed_at',
      filters: {
        packed_qty: 'gt.0'
      },
      order: 'packed_at.desc'
    }) || [];
    const fgDispatchTotals = {};
    const fgSoLineIds = [...new Set(fgPackingRows.map(function(row) {
      return row.so_line_id;
    }).filter(Boolean))];
    if (fgSoLineIds.length) {
      const fgDispatchRows = _supabaseSelectByKeyInBatches_(
        'dispatch_records',
        'so_line_id,dispatch_qty',
        'so_line_id',
        fgSoLineIds
      );
      fgDispatchRows.forEach(function(row) {
        const key = String(row.so_line_id || '');
        fgDispatchTotals[key] = (fgDispatchTotals[key] || 0) + Number(row.dispatch_qty || 0);
      });
    }
    fgRows = fgPackingRows.map(function(row) {
      const soLineKey = String(row.so_line_id || '');
      const balanceQty = Math.max(Number(row.packed_qty || 0) - Number(fgDispatchTotals[soLineKey] || 0), 0);
      if (balanceQty <= 0) return null;
      return {
        itemcode: 'FG:' + String(row.so_number || '') + ':' + String(row.line_no || ''),
        itemname: row.product_name || ('FG Stock ' + String(row.so_number || '')),
        category: 'Finished Goods',
        department: 'FG',
        uom: 'PCS',
        location: 'FG',
        qty: balanceQty,
        avgrate: 0,
        avg_rate: 0,
        value: 0,
        last_movement_at: row.packed_at || ''
      };
    }).filter(Boolean);
    const openingStockRows = _fgSafeSelect_('fg_opening_stock', {
      select: 'id,client_code,client_name,product_code,product_name,uom,opening_qty,opening_date',
      order: 'opening_date.desc,created_at.desc',
      limit: 5000
    });
    const openingIds = openingStockRows.map(function(row) { return row.id; }).filter(Boolean);
    const openingDispatchRows = openingIds.length ? _fgSafeSelect_('fg_opening_dispatch_entries', {
      select: 'opening_id,dispatch_qty',
      filters: { opening_id: _supabaseInFilter_(openingIds) },
      limit: 5000
    }) : [];
    const openingDispatchMap = {};
    openingDispatchRows.forEach(function(row) {
      const key = String(row.opening_id || '');
      openingDispatchMap[key] = (openingDispatchMap[key] || 0) + Number(row.dispatch_qty || 0);
    });
    openingFgRows = openingStockRows.map(function(row) {
      const balanceQty = Math.max(Number(row.opening_qty || 0) - Number(openingDispatchMap[String(row.id || '')] || 0), 0);
      if (balanceQty <= 0) return null;
      return {
        itemcode: 'FGOPEN:' + String(row.id || ''),
        itemname: row.product_name || ('FG Opening ' + String(row.client_name || row.client_code || '')),
        category: 'Finished Goods',
        department: 'FG',
        uom: row.uom || 'PCS',
        location: 'FG',
        qty: balanceQty,
        avgrate: 0,
        avg_rate: 0,
        value: 0,
        last_movement_at: row.opening_date || ''
      };
    }).filter(Boolean);
  }
  const allSnapshotRows = openingFgRows.concat(fgRows).concat(snapshotRows).slice(0, snapshotLimit);

  const normalizeItemCode = code =>
    String(code || '').trim().toUpperCase();

  const itemMetaMap = {};
  const snapshotItemCodes = [...new Set(allSnapshotRows
    .map(r => normalizeItemCode(r.itemcode || r.item_code || ''))
    .filter(Boolean))];
  if (snapshotItemCodes.length) {
    const chunkSize = 200;
    for (let i = 0; i < snapshotItemCodes.length; i += chunkSize) {
      const chunk = snapshotItemCodes.slice(i, i + chunkSize);
      const itemRows = supabaseSelect('inv_items', {
        select: 'id,item_code,category,department,uom',
        filters: { item_code: _supabaseInFilter_(chunk) }
      }) || [];
      itemRows.forEach(item => {
        const key = normalizeItemCode(item.item_code);
        if (!key || itemMetaMap[key]) return;
        itemMetaMap[key] = item;
      });
    }
  }

  const daysBetween = (start, end) =>
    Math.max(0, Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));

  if (!includeAnalytics) {
    const quickRows = allSnapshotRows.map(function(r) {
      const itemCode = r.itemcode || r.item_code || '';
      const meta = itemMetaMap[normalizeItemCode(itemCode)] || {};
      const effectiveLastMovementAt = r.last_movement_at ? new Date(r.last_movement_at) : null;
      const ageingDays = effectiveLastMovementAt ? daysBetween(effectiveLastMovementAt, now) : null;
      const movementClass = ageingDays === null
        ? 'UNKNOWN'
        : ageingDays > AGEING_NON_MOVING_DAYS
          ? 'NON_MOVING'
          : ageingDays > AGEING_SLOW_MOVING_DAYS
            ? 'SLOW_MOVING'
            : 'FAST_MOVING';
      return {
        itemCode: itemCode,
        itemName: r.itemname || r.item_name || '',
        category: meta.category || r.category || '',
        department: meta.department || r.department || '',
        uom: meta.uom || r.uom || '',
        location: r.location || '',
        qty: Number(r.qty || 0),
        avgRate: Number(r.avgrate || r.avg_rate || 0),
        value: Number(r.value || 0),
        ageingDays: ageingDays,
        movementClass: movementClass,
        lastMovementAt: effectiveLastMovementAt ? effectiveLastMovementAt.toISOString() : '',
        oldestReceiptAt: '',
        nextBatchNo: '',
        batchCount: 0,
        avgLeadTimeDays: 0,
        avgDailyConsumption: 0,
        safetyFactor: SAFETY_FACTOR,
        minimumStockLevel: 0,
        mslStatus: 'OK',
        mslGap: Number(r.qty || 0)
      };
    });
    const quickResult = { ok: true, rows: quickRows };
    try {
      cache.put(cacheKey, JSON.stringify(quickResult), 120);
    } catch (err) {}
    return quickResult;
  }

  const itemIds = [...new Set(allSnapshotRows
    .map(r => {
      const meta = itemMetaMap[normalizeItemCode(r.itemcode || r.item_code || '')] || {};
      return meta.id;
    })
    .filter(Boolean))];
  const consumptionMap = {};
  const prMap = {};
  const receiptMap = {};
  const lotMap = {};
  const purchaseAvgRateMap = invGetPurchaseAvgRateMap_(itemIds, opts.location || DEFAULT_LOCATION);

  if (itemIds.length) {
    const chunkSize = 200;
    const receiptPrNosAll = [];

    for (let i = 0; i < itemIds.length; i += chunkSize) {
      const chunk = itemIds.slice(i, i + chunkSize);

      const lotRows = supabaseSelect('inv_lots', {
        select: 'item_id,batch_no,receipt_date,qty_available',
        filters: {
          item_id: _supabaseInFilter_(chunk),
          location: 'eq.' + (opts.location || DEFAULT_LOCATION),
          qty_available: 'gt.0'
        },
        order: 'receipt_date.asc,created_at.asc',
        limit: 5000
      }) || [];

      lotRows.forEach(lot => {
        const itemId = lot.item_id;
        if (!itemId) return;
        if (!lotMap[itemId]) {
          lotMap[itemId] = {
            oldestReceiptAt: null,
            nextBatchNo: '',
            batchCount: 0
          };
        }
        lotMap[itemId].batchCount += 1;
        const receiptAt = lot.receipt_date ? new Date(lot.receipt_date) : null;
        if (receiptAt && (!lotMap[itemId].oldestReceiptAt || receiptAt < lotMap[itemId].oldestReceiptAt)) {
          lotMap[itemId].oldestReceiptAt = receiptAt;
          lotMap[itemId].nextBatchNo = String(lot.batch_no || '').trim();
        }
      });

      const issueRows = supabaseSelect('inv_ledger', {
        select: 'item_id, qty_out',
        filters: {
          item_id: _supabaseInFilter_(chunk),
          ref_type: 'eq.ISSUE',
          created_at: 'gte.' + consumptionCutoff.toISOString()
        },
        limit: 5000
      }) || [];
      issueRows.forEach(function(entry) {
        if (!entry.item_id) return;
        consumptionMap[entry.item_id] =
          (consumptionMap[entry.item_id] || 0) + Number(entry.qty_out || 0);
      });

      const receiptRows = supabaseSelect('inv_ledger', {
        select: 'item_id, created_at, ref_no',
        filters: {
          item_id: _supabaseInFilter_(chunk),
          ref_type: 'eq.PR-RECEIPT'
        },
        order: 'created_at.asc',
        limit: 5000
      }) || [];
      receiptRows.forEach(function(entry) {
        if (!entry.item_id || !entry.created_at || !entry.ref_no) return;
        const prNo = String(entry.ref_no || '').trim();
        if (!prNo) return;
        if (receiptPrNosAll.indexOf(prNo) === -1) {
          receiptPrNosAll.push(prNo);
        }
        const ts = new Date(entry.created_at);
        const key = String(entry.item_id) + '|' + prNo;
        const currentReceipt = receiptMap[key];
        if (!currentReceipt || ts < currentReceipt) {
          receiptMap[key] = ts;
        }
      });
    }

    if (receiptPrNosAll.length) {
      const prChunkSize = 200;
      for (let j = 0; j < receiptPrNosAll.length; j += prChunkSize) {
        const prChunk = receiptPrNosAll.slice(j, j + prChunkSize);
        const purchaseRequests = supabaseSelect('inv_purchase_requests', {
          select: 'item_id, pr_no, created_at',
          filters: {
            pr_no: _supabaseInFilter_(prChunk)
          }
        }) || [];

        purchaseRequests.forEach(function(pr) {
          if (!pr.item_id || !pr.pr_no || !pr.created_at) return;
          if (!prMap[pr.item_id]) prMap[pr.item_id] = [];
          prMap[pr.item_id].push({
            prNo: pr.pr_no,
            createdAt: new Date(pr.created_at)
          });
        });
      }
    }
  }

  const result = {
    ok: true,
    rows: allSnapshotRows.map(r => {
      const itemCode = r.itemcode || r.item_code || '';
      const meta = itemMetaMap[normalizeItemCode(itemCode)] || {};
      const itemId = meta.id;
      const lotInfo = itemId ? lotMap[itemId] : null;
      const effectiveLastMovementAt = r.last_movement_at ? new Date(r.last_movement_at) : null;
      const oldestReceiptAt = lotInfo?.oldestReceiptAt || null;
      const ageingBase = oldestReceiptAt || effectiveLastMovementAt;
      const ageingDays = ageingBase ? daysBetween(ageingBase, now) : null;
      const movementClass = ageingDays === null
        ? 'UNKNOWN'
        : ageingDays > AGEING_NON_MOVING_DAYS
          ? 'NON_MOVING'
          : ageingDays > AGEING_SLOW_MOVING_DAYS
            ? 'SLOW_MOVING'
            : 'FAST_MOVING';
      const totalConsumption = itemId ? Number(consumptionMap[itemId] || 0) : 0;
      const avgDailyConsumption = totalConsumption / CONSUMPTION_WINDOW_DAYS;
      const leadTimes = (prMap[itemId] || [])
        .map(pr => {
          const receiptAt = receiptMap[String(itemId) + '|' + pr.prNo];
          return receiptAt ? daysBetween(pr.createdAt, receiptAt) : null;
        })
        .filter(v => v !== null);
      const avgLeadTimeDays = leadTimes.length
        ? leadTimes.reduce((sum, days) => sum + days, 0) / leadTimes.length
        : DEFAULT_LEAD_TIME_DAYS;
      const msl = avgLeadTimeDays * avgDailyConsumption * SAFETY_FACTOR;
      const qty = Number(r.qty || 0);
      const avgRate = Number(purchaseAvgRateMap[itemId] || r.avgrate || r.avg_rate || 0);
      const value = Number(r.value || 0);

      return {
        itemCode: itemCode,
        itemName: r.itemname || r.item_name || '',
        category: meta.category || r.category || '',
        department: meta.department || r.department || '',
        uom: meta.uom || r.uom || '',
        location: r.location || '',
        qty: qty,
        avgRate: avgRate,
        value: value,
        ageingDays: ageingDays,
        movementClass: movementClass,
        lastMovementAt: effectiveLastMovementAt ? effectiveLastMovementAt.toISOString() : '',
        oldestReceiptAt: oldestReceiptAt ? oldestReceiptAt.toISOString() : '',
        nextBatchNo: lotInfo?.nextBatchNo || '',
        batchCount: Number(lotInfo?.batchCount || 0),
        avgLeadTimeDays: Number(avgLeadTimeDays.toFixed(2)),
        avgDailyConsumption: Number(avgDailyConsumption.toFixed(4)),
        safetyFactor: SAFETY_FACTOR,
        minimumStockLevel: Number(msl.toFixed(2)),
        mslStatus: qty < msl ? 'BELOW_MSL' : 'OK',
        mslGap: Number((qty - msl).toFixed(2))
      };
    })
  };

  try {
    cache.put(cacheKey, JSON.stringify(result), 600);
  } catch (err) {}
  return result;
}

/****************************************************
 * FG STOCK MANAGEMENT
 ****************************************************/

function _fgMissingTable_(err, tableName) {
  const msg = String(err && err.message || '');
  return msg.indexOf('relation "' + tableName + '" does not exist') !== -1 ||
    msg.indexOf('relation "' + tableName + '"') !== -1 && msg.indexOf('does not exist') !== -1;
}

function _fgSafeSelect_(tableName, opts) {
  try {
    return supabaseSelect(tableName, opts || {}) || [];
  } catch (err) {
    if (_fgMissingTable_(err, tableName)) return [];
    throw err;
  }
}

function _fgSafeSelectByKeyInBatches_(tableName, select, key, values, order, chunkSize) {
  try {
    return _supabaseSelectByKeyInBatches_(tableName, select, key, values, order, chunkSize) || [];
  } catch (err) {
    if (_fgMissingTable_(err, tableName)) return [];
    throw err;
  }
}

function _fgRequireTable_(tableName) {
  try {
    supabaseSelect(tableName, { select: 'id', limit: 1 });
  } catch (err) {
    if (_fgMissingTable_(err, tableName)) {
      throw new Error('Missing Supabase table "' + tableName + '". Apply supabase_fg_stock_module.sql first.');
    }
    throw err;
  }
}

function _fgQty_(value) {
  const n = Number(value || 0);
  return isFinite(n) ? n : 0;
}

function _fgDateOnly_(value) {
  if (!value) return '';
  const dt = new Date(value);
  if (isNaN(dt.getTime())) return '';
  return Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function _fgAgeBucket_(days) {
  const age = Number(days || 0);
  if (age > 90) return '90+';
  if (age > 60) return '61-90';
  if (age > 30) return '31-60';
  if (age > 15) return '16-30';
  return '0-15';
}

function _fgDaysOld_(value) {
  if (!value) return null;
  const dt = new Date(value);
  if (isNaN(dt.getTime())) return null;
  return Math.max(0, Math.ceil((Date.now() - dt.getTime()) / (24 * 60 * 60 * 1000)));
}

function _fgBuildAdjustmentMap_(rows, keyField) {
  const map = {};
  (rows || []).forEach(function(row) {
    const key = String(row && row[keyField] || '').trim();
    if (!key) return;
    if (!map[key]) {
      map[key] = {
        adjustedQty: 0,
        latestReason: '',
        latestRemarks: '',
        latestAdjustedAt: ''
      };
    }
    map[key].adjustedQty += _fgQty_(row.adjustment_qty);
    if (!map[key].latestAdjustedAt) {
      map[key].latestAdjustedAt = row.adjustment_date || row.created_at || '';
      map[key].latestReason = row.reason || '';
      map[key].latestRemarks = row.remarks || '';
    }
  });
  return map;
}

function _fgBuildPackedDetailRows_() {
  const packRows = _fgSafeSelect_('packing_records', {
    select: 'id,so_id,so_line_id,so_number,line_no,product_code,product_name,packed_qty,packed_at',
    filters: { packed_qty: 'gt.0' },
    order: 'packed_at.desc',
    limit: 5000
  });
  if (!packRows.length) return [];

  const soLineIds = [...new Set(packRows.map(function(row) { return row.so_line_id; }).filter(Boolean))];
  const soIds = [...new Set(packRows.map(function(row) { return row.so_id; }).filter(Boolean))];
  const packIds = [...new Set(packRows.map(function(row) { return row.id; }).filter(Boolean))];
  const salesOrderLines = soIds.length ? enrichSalesOrderLines(_billingLoadSalesOrderLinesBySoIds_(soIds)) : [];
  const lineMap = {};
  salesOrderLines.forEach(function(row) { lineMap[String(row.id)] = row; });

  const salesOrders = soIds.length ? _supabaseSelectByKeyInBatches_(
    'sales_orders',
    'id,so_number,client_code',
    'id',
    soIds
  ) : [];
  const soMap = {};
  salesOrders.forEach(function(row) { soMap[String(row.id)] = row; });
  const clientMap = _billingSelectClientsByCodes_(salesOrders.map(function(row) { return row.client_code; }));
  const usageMap = _billingGetInvoiceUsageByLineIds_(soLineIds);
  const adjustmentMap = _fgBuildAdjustmentMap_(
    _fgSafeSelectByKeyInBatches_(
      'fg_stock_adjustments',
      'pack_id,adjustment_qty,reason,remarks,adjustment_date,created_at',
      'pack_id',
      packIds,
      'adjustment_date.desc,created_at.desc'
    ),
    'pack_id'
  );

  return packRows.map(function(row) {
    const so = soMap[String(row.so_id)] || {};
    const line = lineMap[String(row.so_line_id)] || {};
    const client = clientMap[String(so.client_code || '')] || {};
    const usage = usageMap[String(row.so_line_id)] || {};
    const adjustment = adjustmentMap[String(row.id || '')] || {};
    const packedQty = _fgQty_(row.packed_qty);
    const billedQty = _fgQty_(usage.billedQty);
    const adjustedQty = _fgQty_(adjustment.adjustedQty);
    const availableQty = Math.max(packedQty - billedQty - adjustedQty, 0);
    return {
      rowId: 'PACKED::' + String(row.id || row.so_line_id || ''),
      sourceType: 'PACKED',
      packId: row.id || '',
      openingId: '',
      soId: row.so_id || '',
      soLineId: row.so_line_id || '',
      soNumber: row.so_number || '',
      lineNo: row.line_no || '',
      clientCode: so.client_code || '',
      clientName: client.client_name || so.client_code || '',
      productCode: line.product_code || row.product_code || '',
      productName: line.product_name || row.product_name || '',
      uom: line.unit || 'Pcs',
      openingQty: 0,
      packedQty: packedQty,
      adjustedQty: adjustedQty,
      availableQty: availableQty,
      billedQty: billedQty,
      billableQty: availableQty,
      stockDate: row.packed_at || '',
      stockDateLabel: _fgDateOnly_(row.packed_at),
      ageingDays: _fgDaysOld_(row.packed_at),
      ageingBucket: _fgAgeBucket_(_fgDaysOld_(row.packed_at)),
      dispatchNo: '',
      dispatchDate: '',
      transporter: '',
      vehicleNo: '',
      lrNo: '',
      adjustmentReason: adjustment.latestReason || '',
      adjustmentRemarks: adjustment.latestRemarks || '',
      adjustmentDate: adjustment.latestAdjustedAt || '',
      remarks: line.product_remarks || ''
    };
  });
}

function _fgBuildOpeningDetailRows_() {
  const openingRows = _fgSafeSelect_('fg_opening_stock', {
    select: 'id,client_code,client_name,product_code,product_name,uom,opening_qty,opening_date,remarks,created_at',
    order: 'opening_date.desc,created_at.desc',
    limit: 5000
  });
  if (!openingRows.length) return [];

  const openingIds = openingRows.map(function(row) { return row.id; }).filter(Boolean);
  const adjustmentMap = _fgBuildAdjustmentMap_(
    _fgSafeSelectByKeyInBatches_(
      'fg_stock_adjustments',
      'opening_id,adjustment_qty,reason,remarks,adjustment_date,created_at',
      'opening_id',
      openingIds,
      'adjustment_date.desc,created_at.desc'
    ),
    'opening_id'
  );

  return openingRows.map(function(row) {
    const adjustment = adjustmentMap[String(row.id)] || {};
    const openingQty = _fgQty_(row.opening_qty);
    const adjustedQty = _fgQty_(adjustment.adjustedQty);
    const availableQty = Math.max(openingQty - adjustedQty, 0);
    const stockDate = row.opening_date || row.created_at || '';
    const ageingDays = _fgDaysOld_(stockDate);
    return {
      rowId: 'OPENING::' + String(row.id || ''),
      sourceType: 'OPENING',
      packId: '',
      openingId: row.id || '',
      soId: '',
      soLineId: '',
      soNumber: '',
      lineNo: '',
      clientCode: row.client_code || '',
      clientName: row.client_name || row.client_code || '',
      productCode: row.product_code || '',
      productName: row.product_name || '',
      uom: row.uom || 'Pcs',
      openingQty: openingQty,
      packedQty: 0,
      adjustedQty: adjustedQty,
      availableQty: availableQty,
      billedQty: 0,
      billableQty: 0,
      stockDate: stockDate,
      stockDateLabel: _fgDateOnly_(stockDate),
      ageingDays: ageingDays,
      ageingBucket: _fgAgeBucket_(ageingDays),
      dispatchNo: '',
      dispatchDate: '',
      transporter: '',
      vehicleNo: '',
      lrNo: '',
      adjustmentReason: adjustment.latestReason || '',
      adjustmentRemarks: adjustment.latestRemarks || '',
      adjustmentDate: adjustment.latestAdjustedAt || '',
      remarks: row.remarks || ''
    };
  });
}

function fgGetBootstrap(token) {
  _requireModuleAccess_(token, 'DISPATCH', 'can_view');
  return {
    ok: true,
    clients: _billingClientSelectRows_().map(function(row) {
      return {
        clientCode: row.client_code || '',
        clientName: row.client_name || row.client_code || ''
      };
    }),
    tablesReady: _fgSafeSelect_('fg_opening_stock', { select: 'id', limit: 1 }) !== null
  };
}

function _fgGetDetailRowsFromView_() {
  const rows = supabaseSelect('v_fg_stock_available', {
    select: 'row_id,source_type,pack_id,opening_id,so_id,so_line_id,so_number,line_no,client_code,client_name,product_code,product_name,uom,opening_qty,packed_qty,billed_qty,adjusted_qty,available_qty,billable_qty,stock_date,latest_adjustment_reason,latest_adjustment_remarks,latest_adjustment_at,remarks',
    order: 'stock_date.desc',
    limit: 5000
  }) || [];
  return rows.map(function(row) {
    const stockDate = row.stock_date || '';
    const ageingDays = _fgDaysOld_(stockDate);
    return {
      rowId: row.row_id || String(row.source_type || '') + '::' + String(row.pack_id || row.opening_id || ''),
      sourceType: row.source_type || '',
      packId: row.pack_id || '',
      openingId: row.opening_id || '',
      soId: row.so_id || '',
      soLineId: row.so_line_id || '',
      soNumber: row.so_number || '',
      lineNo: row.line_no || '',
      clientCode: row.client_code || '',
      clientName: row.client_name || row.client_code || '',
      productCode: row.product_code || '',
      productName: row.product_name || '',
      uom: row.uom || 'Pcs',
      openingQty: _fgQty_(row.opening_qty),
      packedQty: _fgQty_(row.packed_qty),
      adjustedQty: _fgQty_(row.adjusted_qty),
      availableQty: _fgQty_(row.available_qty),
      billedQty: _fgQty_(row.billed_qty),
      billableQty: _fgQty_(row.billable_qty),
      stockDate: stockDate,
      stockDateLabel: _fgDateOnly_(stockDate),
      ageingDays: ageingDays,
      ageingBucket: _fgAgeBucket_(ageingDays),
      adjustmentReason: row.latest_adjustment_reason || '',
      adjustmentRemarks: row.latest_adjustment_remarks || '',
      adjustmentDate: row.latest_adjustment_at || '',
      remarks: row.remarks || ''
    };
  });
}

function fgGetDashboard(params, token) {
  _requireModuleAccess_(token, 'DISPATCH', 'can_view');
  const p = params || {};
  const q = String(p.q || '').trim().toLowerCase();
  const clientCode = String(p.clientCode || '').trim();
  const sourceType = String(p.sourceType || '').trim().toUpperCase();
  const ageingBucket = String(p.ageingBucket || '').trim().toUpperCase();
  const includeZero = p.includeZero === true;

  const detailRows = _fgGetDetailRowsFromView_().filter(function(row) {
    if (!includeZero && _fgQty_(row.availableQty) <= 0) return false;
    if (clientCode && String(row.clientCode || '') !== clientCode) return false;
    if (sourceType && sourceType !== 'ALL' && String(row.sourceType || '') !== sourceType) return false;
    if (ageingBucket && ageingBucket !== 'ALL' && String(row.ageingBucket || '') !== ageingBucket) return false;
    if (!q) return true;
    return [
      row.clientName,
      row.clientCode,
      row.productCode,
      row.productName,
      row.soNumber,
      row.lineNo,
      row.sourceType
    ].join(' ').toLowerCase().indexOf(q) !== -1;
  });

  detailRows.sort(function(a, b) {
    const ageDelta = _fgQty_(b.ageingDays) - _fgQty_(a.ageingDays);
    if (ageDelta) return ageDelta;
    if (String(a.clientName || '') !== String(b.clientName || '')) return String(a.clientName || '').localeCompare(String(b.clientName || ''));
    return String(a.productName || '').localeCompare(String(b.productName || ''));
  });

  const itemPartyMap = {};
  const partyMap = {};
  const ageingMap = { '0-15': 0, '16-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };

  detailRows.forEach(function(row) {
    const itemKey = [
      String(row.clientCode || row.clientName || '').trim().toUpperCase(),
      String(row.productCode || row.productName || '').trim().toUpperCase()
    ].join('||');
    if (!itemPartyMap[itemKey]) {
      itemPartyMap[itemKey] = {
        clientCode: row.clientCode || '',
        clientName: row.clientName || '',
        productCode: row.productCode || '',
        productName: row.productName || '',
        openingQty: 0,
        packedQty: 0,
        adjustedQty: 0,
        availableQty: 0,
        billedQty: 0,
        billableQty: 0,
        oldestStockDate: row.stockDate || '',
        maxAgeingDays: _fgQty_(row.ageingDays)
      };
    }
    itemPartyMap[itemKey].openingQty += _fgQty_(row.openingQty);
    itemPartyMap[itemKey].packedQty += _fgQty_(row.packedQty);
    itemPartyMap[itemKey].adjustedQty += _fgQty_(row.adjustedQty);
    itemPartyMap[itemKey].availableQty += _fgQty_(row.availableQty);
    itemPartyMap[itemKey].billedQty += _fgQty_(row.billedQty);
    itemPartyMap[itemKey].billableQty += _fgQty_(row.billableQty);
    if (row.stockDate && (!itemPartyMap[itemKey].oldestStockDate || new Date(row.stockDate) < new Date(itemPartyMap[itemKey].oldestStockDate))) {
      itemPartyMap[itemKey].oldestStockDate = row.stockDate;
    }
    itemPartyMap[itemKey].maxAgeingDays = Math.max(itemPartyMap[itemKey].maxAgeingDays, _fgQty_(row.ageingDays));

    const partyKey = String(row.clientCode || row.clientName || 'UNASSIGNED').trim().toUpperCase();
    if (!partyMap[partyKey]) {
      partyMap[partyKey] = {
        clientCode: row.clientCode || '',
        clientName: row.clientName || row.clientCode || 'Unassigned',
        skuCount: 0,
        availableQty: 0,
        ageingQty: 0
      };
    }
    partyMap[partyKey].availableQty += _fgQty_(row.availableQty);
    if (_fgQty_(row.ageingDays) > 30) partyMap[partyKey].ageingQty += _fgQty_(row.availableQty);
  });

  Object.keys(itemPartyMap).forEach(function(key) {
    const partyKey = String(itemPartyMap[key].clientCode || itemPartyMap[key].clientName || 'UNASSIGNED').trim().toUpperCase();
    if (partyMap[partyKey]) partyMap[partyKey].skuCount += 1;
  });

  detailRows.forEach(function(row) {
    const bucket = String(row.ageingBucket || '0-15');
    ageingMap[bucket] = (ageingMap[bucket] || 0) + _fgQty_(row.availableQty);
  });

  return {
    ok: true,
    summary: {
      openingQty: detailRows.reduce(function(sum, row) { return sum + _fgQty_(row.openingQty); }, 0),
      packedQty: detailRows.reduce(function(sum, row) { return sum + _fgQty_(row.packedQty); }, 0),
      adjustedQty: detailRows.reduce(function(sum, row) { return sum + _fgQty_(row.adjustedQty); }, 0),
      availableQty: detailRows.reduce(function(sum, row) { return sum + _fgQty_(row.availableQty); }, 0),
      billableQty: detailRows.reduce(function(sum, row) { return sum + _fgQty_(row.billableQty); }, 0),
      partyCount: Object.keys(partyMap).length,
      skuCount: Object.keys(itemPartyMap).length
    },
    ageing: Object.keys(ageingMap).map(function(bucket) {
      return { bucket: bucket, qty: ageingMap[bucket] || 0 };
    }),
    itemPartyRows: Object.keys(itemPartyMap).map(function(key) {
      const row = itemPartyMap[key];
      row.ageingBucket = _fgAgeBucket_(row.maxAgeingDays);
      row.oldestStockDateLabel = _fgDateOnly_(row.oldestStockDate);
      return row;
    }).sort(function(a, b) {
      return _fgQty_(b.availableQty) - _fgQty_(a.availableQty);
    }),
    partyRows: Object.keys(partyMap).map(function(key) { return partyMap[key]; }).sort(function(a, b) {
      return _fgQty_(b.availableQty) - _fgQty_(a.availableQty);
    }),
    detailRows: detailRows
  };
}

function fgSaveOpeningStock(payload, token) {
  _requireModuleAccess_(token, 'DISPATCH', 'can_edit');
  _fgRequireTable_('fg_opening_stock');
  const p = payload || {};
  const qty = _fgQty_(p.openingQty);
  if (qty <= 0) throw new Error('Opening qty must be greater than 0.');
  if (!String(p.clientName || p.clientCode || '').trim()) throw new Error('Party is required.');
  if (!String(p.productName || p.productCode || '').trim()) throw new Error('Product is required.');
  const stockDate = p.openingDate ? new Date(p.openingDate) : new Date();
  if (isNaN(stockDate.getTime())) throw new Error('Opening date is invalid.');

  supabaseInsert('fg_opening_stock', {
    client_code: String(p.clientCode || '').trim(),
    client_name: String(p.clientName || p.clientCode || '').trim(),
    product_code: String(p.productCode || '').trim(),
    product_name: String(p.productName || p.productCode || '').trim(),
    uom: String(p.uom || 'Pcs').trim(),
    opening_qty: qty,
    opening_date: stockDate.toISOString(),
    remarks: String(p.remarks || '').trim(),
    created_by: Session.getActiveUser()?.getEmail?.() || 'user',
    created_at: new Date().toISOString()
  });
  _invBumpStockSnapshotVersion_();
  return { ok: true };
}

function fgSaveOpeningDispatch(payload, token) {
  _requireModuleAccess_(token, 'DISPATCH', 'can_edit');
  _fgRequireTable_('fg_opening_stock');
  _fgRequireTable_('fg_opening_dispatch_entries');
  const p = payload || {};
  const openingId = String(p.openingId || '').trim();
  const qty = _fgQty_(p.dispatchQty);
  if (!openingId) throw new Error('Opening stock row is required.');
  if (qty <= 0) throw new Error('Dispatch qty must be greater than 0.');

  const opening = _fgSafeSelect_('fg_opening_stock', {
    select: 'id,client_code,client_name,product_code,product_name,uom,opening_qty',
    filters: { id: 'eq.' + openingId },
    limit: 1
  })[0];
  if (!opening) throw new Error('Opening stock row not found.');

  const previousDispatch = _fgSafeSelect_('fg_opening_dispatch_entries', {
    select: 'dispatch_qty',
    filters: { opening_id: 'eq.' + openingId },
    limit: 5000
  }).reduce(function(sum, row) { return sum + _fgQty_(row.dispatch_qty); }, 0);
  const available = Math.max(_fgQty_(opening.opening_qty) - previousDispatch, 0);
  if (qty > available) throw new Error('Dispatch qty cannot exceed available FG opening balance.');

  const dispatchDate = p.dispatchDate ? new Date(p.dispatchDate) : new Date();
  if (isNaN(dispatchDate.getTime())) throw new Error('Dispatch date is invalid.');

  supabaseInsert('fg_opening_dispatch_entries', {
    opening_id: opening.id,
    client_code: opening.client_code || '',
    client_name: opening.client_name || '',
    product_code: opening.product_code || '',
    product_name: opening.product_name || '',
    uom: opening.uom || 'Pcs',
    dispatch_qty: qty,
    dispatch_date: dispatchDate.toISOString(),
    transporter: String(p.transporter || '').trim(),
    vehicle_no: String(p.vehicleNo || '').trim(),
    lr_no: String(p.lrNo || '').trim(),
    remarks: String(p.remarks || '').trim(),
    created_by: Session.getActiveUser()?.getEmail?.() || 'user',
    created_at: new Date().toISOString()
  });
  _invBumpStockSnapshotVersion_();
  return { ok: true };
}

function _billingGetFGAdjustmentRowsByLineIds_(lineIds) {
  const ids = (lineIds || []).filter(Boolean);
  if (!ids.length) return {};
  const rows = _fgSafeSelectByKeyInBatches_(
    'fg_stock_adjustments',
    'so_line_id,adjustment_qty',
    'so_line_id',
    ids
  );
  const totals = {};
  rows.forEach(function(row) {
    const key = String(row.so_line_id || '').trim();
    if (!key) return;
    totals[key] = _billingRound2_(_billingToNumber_(totals[key]) + _billingToNumber_(row.adjustment_qty));
  });
  return totals;
}

function fgSaveStockAdjustment(payload, token) {
  _requireModuleAccess_(token, 'DISPATCH', 'can_edit');
  _fgRequireTable_('fg_stock_adjustments');
  const p = payload || {};
  const sourceType = String(p.sourceType || '').trim().toUpperCase();
  const qty = _fgQty_(p.adjustmentQty);
  const reason = String(p.reason || '').trim();
  const remarks = String(p.remarks || '').trim();
  if (!['PACKED', 'OPENING'].includes(sourceType)) throw new Error('Adjustment source is invalid.');
  if (qty <= 0) throw new Error('Adjustment qty must be greater than 0.');
  if (!reason) throw new Error('Adjustment reason is required.');

  if (sourceType === 'PACKED') {
    const packId = String(p.packId || '').trim();
    if (!packId) throw new Error('Packed FG row is required.');
    const pack = _fgSafeSelect_('packing_records', {
      select: 'id,so_id,so_line_id,so_number,line_no,product_code,product_name,packed_qty',
      filters: { id: 'eq.' + packId },
      limit: 1
    })[0];
    if (!pack) throw new Error('Packed FG row not found.');
    const usage = _billingGetInvoiceUsageByLineIds_([pack.so_line_id || '']);
    const priorAdjustments = _fgSafeSelect_('fg_stock_adjustments', {
      select: 'adjustment_qty',
      filters: { pack_id: 'eq.' + packId },
      limit: 5000
    }).reduce(function(sum, row) { return sum + _fgQty_(row.adjustment_qty); }, 0);
    const billedQty = _fgQty_((usage[String(pack.so_line_id || '')] || {}).billedQty);
    const available = Math.max(_fgQty_(pack.packed_qty) - billedQty - priorAdjustments, 0);
    if (qty > available) throw new Error('Adjustment qty cannot exceed available FG balance.');
    supabaseInsert('fg_stock_adjustments', {
      source_type: 'PACKED',
      pack_id: pack.id,
      opening_id: null,
      so_id: pack.so_id || null,
      so_line_id: pack.so_line_id || null,
      so_number: pack.so_number || '',
      line_no: pack.line_no || '',
      client_code: String(p.clientCode || '').trim(),
      product_code: pack.product_code || '',
      product_name: pack.product_name || '',
      adjustment_qty: qty,
      reason: reason,
      remarks: remarks,
      adjustment_date: new Date().toISOString(),
      created_by: Session.getActiveUser()?.getEmail?.() || 'user'
    });
  } else {
    const openingId = String(p.openingId || '').trim();
    if (!openingId) throw new Error('Opening FG row is required.');
    const opening = _fgSafeSelect_('fg_opening_stock', {
      select: 'id,client_code,client_name,product_code,product_name,opening_qty',
      filters: { id: 'eq.' + openingId },
      limit: 1
    })[0];
    if (!opening) throw new Error('Opening FG row not found.');
    const priorAdjustments = _fgSafeSelect_('fg_stock_adjustments', {
      select: 'adjustment_qty',
      filters: { opening_id: 'eq.' + openingId },
      limit: 5000
    }).reduce(function(sum, row) { return sum + _fgQty_(row.adjustment_qty); }, 0);
    const available = Math.max(_fgQty_(opening.opening_qty) - priorAdjustments, 0);
    if (qty > available) throw new Error('Adjustment qty cannot exceed available FG opening balance.');
    supabaseInsert('fg_stock_adjustments', {
      source_type: 'OPENING',
      pack_id: null,
      opening_id: opening.id,
      so_id: null,
      so_line_id: null,
      so_number: '',
      line_no: '',
      client_code: opening.client_code || '',
      product_code: opening.product_code || '',
      product_name: opening.product_name || '',
      adjustment_qty: qty,
      reason: reason,
      remarks: remarks,
      adjustment_date: new Date().toISOString(),
      created_by: Session.getActiveUser()?.getEmail?.() || 'user'
    });
  }

  _opsBumpDatasetVersion_();
  _invBumpStockSnapshotVersion_();
  return { ok: true };
}

function fgPostPackedDispatch(payload, token) {
  _requireModuleAccess_(token, 'DISPATCH', 'can_edit');
  const p = payload || {};
  const packId = String(p.packId || '').trim();
  const qty = _fgQty_(p.dispatchQty);
  if (!packId) throw new Error('Packed FG row is required.');
  if (qty <= 0) throw new Error('Dispatch qty must be greater than 0.');
  return saveDispatchBulk([{
    packId: packId,
    dispatchQty: qty,
    transporter: String(p.transporter || '').trim(),
    lrNo: String(p.lrNo || '').trim(),
    vehicleNo: String(p.vehicleNo || '').trim(),
    dispatchDate: String(p.dispatchDate || '').trim()
  }]);
}

/****************************************************
 *Invocing/Billing
 ****************************************************/
function _billingToNumber_(value) {
  const num = Number(value || 0);
  return isFinite(num) ? num : 0;
}

function _billingRound2_(value) {
  return Number(_billingToNumber_(value).toFixed(2));
}

function _billingNormalizeMode_(mode) {
  const normalized = String(mode || 'DISPATCH').trim().toUpperCase();
  if (normalized === 'MANUAL') return 'MANUAL';
  if (normalized === 'DIRECT') return 'DIRECT';
  if (normalized === 'FG') return 'FG';
  return 'DISPATCH';
}

function _billingSafeDate_(value) {
  if (!value) return new Date();
  const dt = new Date(value);
  return isNaN(dt.getTime()) ? new Date() : dt;
}

function _billingCompanyProfile_() {
  return {
    name: PURCHASE_COMPANY.name,
    gstin: PURCHASE_COMPANY.gstin,
    address: PURCHASE_COMPANY.address,
    email: PURCHASE_COMPANY.email,
    phone: PURCHASE_COMPANY.landline,
    website: PURCHASE_COMPANY.website,
    state: PURCHASE_COMPANY.state,
    pan: PURCHASE_COMPANY.pan
  };
}

function _billingRequireSession_(token) {
  const user = getSessionUser(token);
  if (!user) throw new Error('Unauthorized');
  return user;
}

function _billingCanDirect_(user, token) {
  if (!user) return false;
  return _userHasPermission_(user, 'BILLING', 'can_view');
}

function _billingCalcTaxSplit_(clientState, gstPct, taxableAmount) {
  const totalPct = _billingToNumber_(gstPct);
  const taxable = _billingRound2_(taxableAmount);
  const companyState = String(DEFAULT_MASTERS.companyState || COMPANY_STATE || '').trim().toLowerCase();
  const partyState = String(clientState || '').trim().toLowerCase();
  let cgstPct = 0;
  let sgstPct = 0;
  let igstPct = 0;

  if (totalPct > 0) {
    if (partyState && companyState && partyState === companyState) {
      cgstPct = totalPct / 2;
      sgstPct = totalPct / 2;
    } else {
      igstPct = totalPct;
    }
  }

  return {
    gstPct: totalPct,
    cgstPct: _billingRound2_(cgstPct),
    sgstPct: _billingRound2_(sgstPct),
    igstPct: _billingRound2_(igstPct),
    cgstAmt: _billingRound2_(taxable * cgstPct / 100),
    sgstAmt: _billingRound2_(taxable * sgstPct / 100),
    igstAmt: _billingRound2_(taxable * igstPct / 100)
  };
}

function _billingResolveFreightGstPct_(invoiceLike, lines, documentType) {
  if (_billingNormalizeDocumentType_(documentType) === 'CHALLAN') return 0;
  const inv = invoiceLike || {};
  if (inv.freight_gst_pct !== undefined && inv.freight_gst_pct !== null && String(inv.freight_gst_pct) !== '') {
    return _billingRound2_(inv.freight_gst_pct);
  }
  const freight = _billingRound2_(inv.freight);
  if (!(freight > 0)) return 0;
  const list = Array.isArray(lines) ? lines : [];
  const lineTax = _billingRound2_(list.reduce(function(sum, row) {
    return sum +
      _billingToNumber_(row.cgst_amt != null ? row.cgst_amt : row.cgstAmt) +
      _billingToNumber_(row.sgst_amt != null ? row.sgst_amt : row.sgstAmt) +
      _billingToNumber_(row.igst_amt != null ? row.igst_amt : row.igstAmt);
  }, 0));
  let totalTax = _billingRound2_(inv.tax_total);
  if (!(totalTax > 0)) {
    const subtotal = _billingRound2_(inv.subtotal != null ? inv.subtotal : list.reduce(function(sum, row) {
      return sum + _billingToNumber_(row.line_amount != null ? row.line_amount : (row.taxable_amount != null ? row.taxable_amount : row.taxable));
    }, 0));
    const grand = _billingRound2_(inv.grand_total);
    if (grand > 0) totalTax = Math.max(_billingRound2_(grand - subtotal - freight), 0);
  }
  const freightTax = Math.max(_billingRound2_(totalTax - lineTax), 0);
  if (!(freightTax > 0)) return 0;
  return _billingRound2_(freightTax * 100 / freight);
}

function _billingCalcFreightTax_(clientState, freightAmount, documentType, freightGstPct) {
  const freight = _billingRound2_(freightAmount);
  if (!(freight > 0)) {
    return {
      gstPct: 0,
      cgstPct: 0,
      sgstPct: 0,
      igstPct: 0,
      cgstAmt: 0,
      sgstAmt: 0,
      igstAmt: 0
    };
  }
  if (_billingNormalizeDocumentType_(documentType) === 'CHALLAN') {
    return {
      gstPct: 0,
      cgstPct: 0,
      sgstPct: 0,
      igstPct: 0,
      cgstAmt: 0,
      sgstAmt: 0,
      igstAmt: 0
    };
  }
  return _billingCalcTaxSplit_(clientState, _billingRound2_(freightGstPct), freight);
}

function _billingClientSelectRows_() {
  return _clientSelectRows_({
    filters: { active: 'eq.true' },
    order: 'client_name.asc'
  }) || [];
}

function _billingSelectClientsByCodes_(clientCodes) {
  const codes = [...new Set((clientCodes || []).map(function(code){ return String(code || '').trim(); }).filter(Boolean))];
  if (!codes.length) return {};
  const rows = _clientSelectRows_({
    filters: { client_code: 'in.(' + codes.join(',') + ')' },
    order: 'client_name.asc'
  }) || [];
  const map = {};
  rows.forEach(function(row) {
    map[String(row.client_code || '').trim()] = row;
  });
  return map;
}

function _billingComposePartyAddress_(row) {
  if (!row) return '';
  return [
    String(row.address_line1 || row.address || '').trim(),
    String(row.address_line2 || '').trim(),
    String(row.city || '').trim(),
    String(row.state || '').trim(),
    String(row.pincode || '').trim()
  ].filter(Boolean).join(', ');
}

function _billingSelectClientPartiesByClients_(clients) {
  const list = Array.isArray(clients) ? clients : [];
  if (!list.length) return {};
  const clientIds = [];
  const clientCodeById = {};
  list.forEach(function(client) {
    const clientId = String(client && client.id || '').trim();
    const clientCode = String(client && client.client_code || '').trim();
    if (!clientId) return;
    clientIds.push(clientId);
    if (clientCode) clientCodeById[clientId] = clientCode;
  });
  if (!clientIds.length) return {};
  const rows = _clientPartySelectRowsByClientIds_(
    clientIds,
    'client_id.asc,address_type.asc,is_default.desc,label.asc,party_name.asc'
  ) || [];
  const map = {};
  rows.filter(function(row) {
    return row.active !== false;
  }).forEach(function(row) {
    const key = String(row.client_code || clientCodeById[String(row.client_id || '').trim()] || '').trim();
    if (!key) return;
    if (!map[key]) map[key] = [];
    map[key].push(row);
  });
  return map;
}

function _billingPartyOptionFromRow_(row, fallbackType) {
  const addressType = String(row.address_type || fallbackType || '').trim().toUpperCase();
  return {
    id: String(row.id || '').trim(),
    addressType: addressType,
    label: String(row.label || row.party_name || '').trim(),
    partyName: String(row.party_name || '').trim(),
    address: _billingComposePartyAddress_(row),
    gstin: String(row.gstin || '').trim(),
    panNo: String(row.pan_no || '').trim(),
    state: String(row.state || '').trim(),
    city: String(row.city || '').trim(),
    pincode: String(row.pincode || '').trim(),
    paymentTerms: String(row.payment_terms || '').trim(),
    contactPerson: String(row.contact_person || '').trim(),
    contactPhone: String(row.contact_phone || '').trim(),
    isDefault: row.is_default === true
  };
}

function _billingFallbackAddressOption_(client, addressType) {
  const isBill = String(addressType || '').toUpperCase() === 'BILL_TO';
  const address = isBill
    ? _clientComposeAddress_(client.bill_to_address || client.address, client.bill_to_city || client.city, client.bill_to_state || client.state, client.bill_to_pincode || client.pincode)
    : _clientComposeAddress_(client.ship_to_address, client.ship_to_city, client.ship_to_state, client.ship_to_pincode);
  return {
    id: '',
    addressType: isBill ? 'BILL_TO' : 'SHIP_TO',
    label: isBill ? 'Default Bill To' : 'Default Ship To',
    partyName: String(client.client_name || client.client_code || '').trim(),
    address: address,
    gstin: String(client.gstin || '').trim(),
    panNo: String(client.pan_no || '').trim(),
    state: String((isBill ? (client.bill_to_state || client.state) : client.ship_to_state) || client.state || '').trim(),
    city: String((isBill ? (client.bill_to_city || client.city) : client.ship_to_city) || client.city || '').trim(),
    pincode: String((isBill ? (client.bill_to_pincode || client.pincode) : client.ship_to_pincode) || client.pincode || '').trim(),
    paymentTerms: String(client.payment_terms || '').trim(),
    contactPerson: '',
    contactPhone: '',
    isDefault: true
  };
}

function _billingBuildAddressChoices_(client, partyRows) {
  const rows = Array.isArray(partyRows) ? partyRows : [];
  const billToOptions = rows
    .filter(function(row){ return String(row.address_type || '').toUpperCase() === 'BILL_TO'; })
    .map(function(row){ return _billingPartyOptionFromRow_(row, 'BILL_TO'); });
  const shipToOptions = rows
    .filter(function(row){ return String(row.address_type || '').toUpperCase() === 'SHIP_TO'; })
    .map(function(row){ return _billingPartyOptionFromRow_(row, 'SHIP_TO'); });

  if (!billToOptions.length && client) billToOptions.push(_billingFallbackAddressOption_(client, 'BILL_TO'));
  if (!shipToOptions.length && client) shipToOptions.push(_billingFallbackAddressOption_(client, 'SHIP_TO'));

  return {
    billToOptions: billToOptions,
    shipToOptions: shipToOptions,
    defaultBillTo: billToOptions.find(function(row){ return row.isDefault; }) || billToOptions[0] || null,
    defaultShipTo: shipToOptions.find(function(row){ return row.isDefault; }) || shipToOptions[0] || null
  };
}

function _billingManualAddressOption_(addressType) {
  const type = String(addressType || '').toUpperCase() === 'SHIP_TO' ? 'SHIP_TO' : 'BILL_TO';
  return {
    id: 'MANUAL',
    addressType: type,
    label: 'Manual Entry',
    partyName: '',
    address: '',
    gstin: '',
    panNo: '',
    state: '',
    city: '',
    pincode: '',
    paymentTerms: '',
    contactPerson: '',
    contactPhone: '',
    isDefault: false
  };
}

function _billingClientPayload_(selectedClient, selectedParties) {
  return selectedClient ? {
    clientCode: selectedClient.client_code || '',
    clientName: selectedClient.client_name || '',
    gstin: selectedClient.gstin || '',
    state: selectedClient.state || '',
    panNo: selectedClient.pan_no || '',
    paymentTerms: selectedClient.payment_terms || '',
    address: _clientComposeAddress_(selectedClient.bill_to_address || selectedClient.address, selectedClient.bill_to_city || selectedClient.city, selectedClient.bill_to_state || selectedClient.state, selectedClient.bill_to_pincode || selectedClient.pincode),
    shipToAddress: _clientComposeAddress_(selectedClient.ship_to_address, selectedClient.ship_to_city, selectedClient.ship_to_state, selectedClient.ship_to_pincode),
    billToOptions: (selectedParties ? selectedParties.billToOptions.slice() : []).concat([_billingManualAddressOption_('BILL_TO')]),
    shipToOptions: (selectedParties ? selectedParties.shipToOptions.slice() : []).concat([_billingManualAddressOption_('SHIP_TO')]),
    defaultBillTo: selectedParties ? selectedParties.defaultBillTo : null,
    defaultShipTo: selectedParties ? selectedParties.defaultShipTo : null
  } : null;
}

function _billingResolveSelectedAddress_(selectedId, options, fallbackOption) {
  const opts = Array.isArray(options) ? options : [];
  const key = String(selectedId || '').trim();
  if (key) {
    const matched = opts.find(function(row){ return String(row.id || '').trim() === key; });
    if (matched) return matched;
  }
  return fallbackOption || opts[0] || null;
}

function _billingNormalizeManualAddress_(kind, payload, client) {
  const src = payload || {};
  const label = String(kind || '').toUpperCase() === 'SHIP_TO' ? 'Ship To' : 'Bill To';
  const partyName = String(src.partyName || client.client_name || client.client_code || '').trim();
  const address = String(src.address || '').trim();
  const state = String(src.state || '').trim();
  if (!partyName) throw new Error(label + ' name is required.');
  if (!address) throw new Error(label + ' address is required.');
  if (!state) throw new Error(label + ' state is required.');
  return {
    id: 'MANUAL',
    addressType: String(kind || '').toUpperCase() === 'SHIP_TO' ? 'SHIP_TO' : 'BILL_TO',
    label: 'Manual Entry',
    partyName: partyName,
    address: address,
    gstin: String(src.gstin || '').trim(),
    panNo: String(src.panNo || client.pan_no || '').trim(),
    state: state,
    city: '',
    pincode: '',
    paymentTerms: String(src.paymentTerms || client.payment_terms || '').trim(),
    contactPerson: String(src.contactPerson || '').trim(),
    contactPhone: String(src.contactPhone || '').trim(),
    isDefault: false
  };
}

function _billingNormalizeManualLines_(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.map(function(row, idx) {
    const src = row || {};
    return {
      lineNo: idx + 1,
      productCode: String(src.productCode || '').trim(),
      productName: String(src.productName || '').trim(),
      hsn: String(src.hsn || '').trim(),
      unit: String(src.unit || 'Nos').trim() || 'Nos',
      qty: _billingRound2_(src.qty),
      rate: _billingRound2_(src.rate),
      gstPct: _billingRound2_(src.gstPct),
      remarks: String(src.remarks || '').trim()
    };
  }).filter(function(row) {
    return row.productName || row.productCode || row.hsn || row.qty || row.rate;
  });
}

function _billingGetSalesOrders_(clientCode, soNumber) {
  const filters = { status: 'neq.CANCELLED' };
  if (clientCode) filters.client_code = 'eq.' + clientCode;
  if (soNumber) filters.so_number = 'eq.' + soNumber;
  return _salesOrderSelectBillingHeaders_(filters, 'so_date.desc,so_number.desc');
}

function _billingGetDispatchRowsByLineIds_(lineIds) {
  const ids = (lineIds || []).filter(Boolean);
  if (!ids.length) return {};
  let rows = [];
  try {
    rows = _supabaseSelectByKeyInBatches_(
      'v_billing_dispatch_summary',
      'so_line_id,dispatched_qty,latest_dispatch_no,latest_dispatch_date,transporter,vehicle_no,lr_no',
      'so_line_id',
      ids,
      'so_line_id.asc'
    ) || [];
  } catch (err) {
    const rowsRaw = _supabaseSelectByKeyInBatches_(
      'dispatch_records',
      'so_line_id,dispatch_no,dispatch_qty,dispatch_date,transporter,vehicle_no,lr_no,created_at',
      'so_line_id',
      ids,
      'dispatch_date.desc,created_at.desc'
    ) || [];
    rows = rowsRaw;
  }
  const totals = {};
  rows.forEach(function(row) {
    const key = String(row.so_line_id || '').trim();
    if (!key) return;
    if (!totals[key]) {
      totals[key] = {
        dispatchedQty: 0,
        latestDispatchNo: '',
        latestDispatchDate: '',
        transporter: '',
        vehicleNo: '',
        lrNo: ''
      };
    }
    const qty = row.dispatched_qty != null ? row.dispatched_qty : row.dispatch_qty;
    totals[key].dispatchedQty += _billingToNumber_(qty);
    if (!totals[key].latestDispatchNo) {
      totals[key].latestDispatchNo = row.latest_dispatch_no || row.dispatch_no || '';
      totals[key].latestDispatchDate = row.latest_dispatch_date || row.dispatch_date || row.created_at || '';
      totals[key].transporter = row.transporter || '';
      totals[key].vehicleNo = row.vehicle_no || '';
      totals[key].lrNo = row.lr_no || '';
    }
  });
  Object.keys(totals).forEach(function(key) {
    totals[key].dispatchedQty = _billingRound2_(totals[key].dispatchedQty);
  });
  return totals;
}

function _billingGetPackingRowsByLineIds_(lineIds) {
  const ids = (lineIds || []).filter(Boolean);
  if (!ids.length) return {};
  let rows = [];
  try {
    rows = _supabaseSelectByKeyInBatches_(
      'v_billing_packing_summary',
      'so_line_id,packed_qty,latest_packed_at',
      'so_line_id',
      ids,
      'so_line_id.asc'
    ) || [];
  } catch (err) {
    rows = _supabaseSelectByKeyInBatches_(
      'packing_records',
      'so_line_id,packed_qty,packed_at',
      'so_line_id',
      ids,
      'packed_at.desc'
    ) || [];
  }
  const totals = {};
  rows.forEach(function(row) {
    const key = String(row.so_line_id || '').trim();
    if (!key) return;
    if (!totals[key]) {
      totals[key] = {
        packedQty: 0,
        latestPackedAt: ''
      };
    }
    totals[key].packedQty += _billingToNumber_(row.packed_qty);
    if (!totals[key].latestPackedAt) {
      totals[key].latestPackedAt = row.latest_packed_at || row.packed_at || '';
    }
  });
  Object.keys(totals).forEach(function(key) {
    totals[key].packedQty = _billingRound2_(totals[key].packedQty);
  });
  return totals;
}

function _billingGetInvoiceUsageByLineIds_(lineIds) {
  const ids = (lineIds || []).filter(Boolean);
  if (!ids.length) return {};
  const buildLiveTotals = function() {
    const invoiceLines = _supabaseSelectByKeyInBatches_(
      'invoice_lines',
      'invoice_id,so_line_id,qty',
      'so_line_id',
      ids
    ) || [];
    const invoiceIds = [...new Set(invoiceLines.map(function(row){ return row.invoice_id; }).filter(Boolean))];
    const invoiceMap = {};
    if (invoiceIds.length) {
      const invoices = _supabaseSelectByKeyInBatches_(
        'invoices',
        'id,invoice_no,status',
        'id',
        invoiceIds
      ) || [];
      invoices.forEach(function(row) {
        invoiceMap[String(row.id)] = row;
      });
    }
    const totals = {};
    invoiceLines.forEach(function(row) {
      const key = String(row.so_line_id || '').trim();
      const invoice = invoiceMap[String(row.invoice_id)] || {};
      if (!key || !invoice.id) return;
      if (!totals[key]) {
        totals[key] = {
          billedQty: 0,
          postedQty: 0,
          draftQty: 0,
          references: []
        };
      }
      const qty = _billingToNumber_(row.qty);
      totals[key].billedQty += qty;
      if (String(invoice.status || '').toUpperCase() === 'POSTED') totals[key].postedQty += qty;
      else totals[key].draftQty += qty;
      if (invoice.invoice_no) totals[key].references.push(invoice.invoice_no + ' [' + (invoice.status || 'DRAFT') + ']');
    });
    Object.keys(totals).forEach(function(key) {
      totals[key].billedQty = _billingRound2_(totals[key].billedQty);
      totals[key].postedQty = _billingRound2_(totals[key].postedQty);
      totals[key].draftQty = _billingRound2_(totals[key].draftQty);
      totals[key].references = [...new Set(totals[key].references)];
    });
    return totals;
  };
  try {
    const viewRows = _supabaseSelectByKeyInBatches_(
      'v_billing_invoice_usage_summary',
      'so_line_id,billed_qty,posted_qty,draft_qty,invoice_refs',
      'so_line_id',
      ids,
      'so_line_id.asc'
    ) || [];
    const out = {};
    viewRows.forEach(function(row) {
      const key = String(row.so_line_id || '').trim();
      if (!key) return;
      out[key] = {
        billedQty: _billingRound2_(row.billed_qty),
        postedQty: _billingRound2_(row.posted_qty),
        draftQty: _billingRound2_(row.draft_qty),
        references: String(row.invoice_refs || '').trim()
          ? String(row.invoice_refs).split(' || ').map(function(v){ return String(v || '').trim(); }).filter(Boolean)
          : []
      };
    });
    const live = buildLiveTotals();
    const suspicious = ids.some(function(id) {
      const key = String(id || '').trim();
      const a = out[key] || { billedQty:0, postedQty:0, draftQty:0 };
      const b = live[key] || { billedQty:0, postedQty:0, draftQty:0 };
      return _billingRound2_(a.billedQty) !== _billingRound2_(b.billedQty) ||
        _billingRound2_(a.postedQty) !== _billingRound2_(b.postedQty) ||
        _billingRound2_(a.draftQty) !== _billingRound2_(b.draftQty);
    });
    return suspicious ? live : out;
  } catch (err) {}
  return buildLiveTotals();
}

function _billingListInvoicesFast_(params, token) {
  const p = params || {};
  try {
    const filters = {};
    if (p.dateFrom) filters.invoice_date = 'gte.' + p.dateFrom;
    if (p.dateTo) filters.invoice_date = 'lte.' + p.dateTo;
    if (String(p.status || '').trim() && String(p.status || '').trim().toUpperCase() !== 'ALL') {
      filters.status = 'eq.' + String(p.status || '').trim().toUpperCase();
    }
    const q = String(p.q || '').trim().replace(/[(),]/g, ' ');
    if (q) {
      const term = '*' + q.replace(/\*/g, '') + '*';
      filters.or = '(' + [
        'invoice_no.ilike.' + term,
        'client_code.ilike.' + term,
        'client_name.ilike.' + term,
        'status.ilike.' + term,
        'billing_mode.ilike.' + term,
        'remarks.ilike.' + term
      ].join(',') + ')';
    }
    const rows = supabaseSelect('v_billing_document_register', {
      select: 'id,invoice_no,invoice_date,document_type,client_code,client_name,status,billing_mode,total_qty,line_count,product_preview,remarks,subtotal,tax_total,grand_total,created_at,posted_at,sort_ts',
      filters: filters,
      order: 'invoice_date.desc,sort_ts.desc,invoice_no.desc',
      limit: 500
    }) || [];
    return {
      ok: true,
      rows: rows.map(function(row) {
        return {
          id: row.id,
          invoiceNo: row.invoice_no || '',
          invoiceDate: row.invoice_date || '',
          documentType: _billingInferDocumentType_(row.document_type || row.invoice_no || ''),
          clientCode: row.client_code || '',
          clientName: row.client_name || '',
          status: row.status || '',
          billingMode: row.billing_mode || '',
          totalQty: _billingRound2_(row.total_qty),
          lineCount: Number(row.line_count || 0),
          productPreview: row.product_preview || '',
          remarks: row.remarks || '',
          subtotal: _billingRound2_(row.subtotal),
          taxTotal: _billingRound2_(row.tax_total),
          grandTotal: _billingRound2_(row.grand_total),
          createdAt: row.created_at || '',
          postedAt: row.posted_at || '',
          sortTs: row.sort_ts || row.posted_at || row.created_at || '',
          printUrl: _billingBuildPrintUrl_(row.id, token, row.document_type || row.invoice_no || '')
        };
      })
    };
  } catch (viewErr) {
  }
  try {
    const rows = supabaseRpc('billing_document_register_v2', {
      p_date_from: p.dateFrom || null,
      p_date_to: p.dateTo || null,
      p_status: p.status || 'ALL',
      p_q: p.q || null
    }) || [];
    return {
      ok: true,
      rows: rows.map(function(row) {
        return {
          id: row.id,
          invoiceNo: row.invoice_no || '',
          invoiceDate: row.invoice_date || '',
          documentType: _billingInferDocumentType_(row.document_type || row),
          clientCode: row.client_code || '',
          clientName: row.client_name || '',
          status: row.status || '',
          billingMode: row.billing_mode || '',
          totalQty: _billingRound2_(row.total_qty),
          lineCount: Number(row.line_count || 0),
          productPreview: row.product_preview || '',
          remarks: row.remarks || '',
          subtotal: _billingRound2_(row.subtotal),
          taxTotal: _billingRound2_(row.tax_total),
          grandTotal: _billingRound2_(row.grand_total),
          createdAt: row.created_at || '',
          postedAt: row.posted_at || '',
          printUrl: _billingBuildPrintUrl_(row.id, token, row.document_type || row.invoice_no || '')
        };
      })
    };
  } catch (err) {
    try {
      const rows = supabaseRpc('billing_invoice_register', {
        p_date_from: p.dateFrom || null,
        p_date_to: p.dateTo || null,
        p_status: p.status || 'ALL',
        p_q: p.q || null
      }) || [];
      return {
        ok: true,
        rows: rows.map(function(row) {
          return {
            id: row.id,
            invoiceNo: row.invoice_no || '',
            invoiceDate: row.invoice_date || '',
            documentType: _billingInferDocumentType_(row),
            clientCode: row.client_code || '',
            clientName: row.client_name || '',
            status: row.status || '',
            billingMode: row.billing_mode || '',
            totalQty: _billingRound2_(row.total_qty),
            remarks: row.remarks || '',
            subtotal: _billingRound2_(row.subtotal),
            taxTotal: _billingRound2_(row.tax_total),
            grandTotal: _billingRound2_(row.grand_total),
            createdAt: row.created_at || '',
            postedAt: row.posted_at || '',
            printUrl: _billingBuildPrintUrl_(row.id, token, row.document_type || row.invoice_no || '')
          };
        })
      };
    } catch (fallbackErr) {
      return null;
    }
  }
}

function _billingSelectInvoiceRegisterRows_(filters, order, limit) {
  const tries = [
    'id,invoice_no,invoice_date,document_type,client_code,client_name,bill_to_name,status,billing_mode,total_qty,remarks,grand_total,subtotal,tax_total,created_at,posted_at',
    'id,invoice_no,invoice_date,document_type,client_code,client_name,bill_to_name,status,billing_mode,remarks,grand_total,subtotal,tax_total,created_at,posted_at',
    'id,invoice_no,invoice_date,document_type,client_code,client_name,bill_to_name,status,remarks,grand_total,subtotal,tax_total,created_at,posted_at',
    'id,invoice_no,invoice_date,document_type,client_code,client_name,bill_to_name,status,grand_total,subtotal,tax_total,created_at,posted_at',
    'id,invoice_no,invoice_date,client_code,client_name,bill_to_name,status,grand_total,subtotal,tax_total,created_at,posted_at',
    'id,invoice_no,invoice_date,client_code,client_name,status,grand_total,subtotal,tax_total,created_at,posted_at',
    'id,invoice_no,invoice_date,client_code,status,grand_total,subtotal,created_at'
  ];
  let lastErr = null;
  for (let i = 0; i < tries.length; i++) {
    try {
      return supabaseSelect('invoices', {
        select: tries[i],
        filters: filters,
        order: order,
        limit: limit
      }) || [];
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

function _billingBuildInvoiceRegisterMeta_(invoiceIds) {
  const ids = (invoiceIds || []).filter(Boolean);
  const out = {};
  if (!ids.length) return out;
  const lines = _supabaseSelectByKeyInBatches_(
    'invoice_lines',
    'invoice_id,product_name,product_code,qty,source_mode',
    'invoice_id',
    ids,
    'invoice_id.asc,line_no.asc'
  ) || [];
  lines.forEach(function(row) {
    const key = String(row.invoice_id || '').trim();
    if (!key) return;
    if (!out[key]) {
      out[key] = {
        lineCount: 0,
        totalQty: 0,
        previewProducts: [],
        sourceModes: []
      };
    }
    out[key].lineCount += 1;
    out[key].totalQty = _billingRound2_(out[key].totalQty + _billingToNumber_(row.qty));
    const label = String(row.product_name || row.product_code || '').trim();
    if (label && out[key].previewProducts.length < 2 && out[key].previewProducts.indexOf(label) === -1) {
      out[key].previewProducts.push(label);
    }
    const sourceMode = String(row.source_mode || '').trim().toUpperCase();
    if (sourceMode && out[key].sourceModes.indexOf(sourceMode) === -1) {
      out[key].sourceModes.push(sourceMode);
    }
  });
  Object.keys(out).forEach(function(key) {
    const meta = out[key];
    meta.productPreview = meta.previewProducts.join(', ');
    meta.derivedBillingMode = meta.sourceModes[0] || '';
  });
  return out;
}

function _billingEnrichRegisterClientNames_(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const clientCodes = [...new Set(list.map(function(row) {
    return String(row && row.clientCode || row && row.client_code || '').trim();
  }).filter(function(code) {
    return !!code && code.toUpperCase() !== 'MANUAL';
  }))];
  if (!clientCodes.length) return list;
  const clientMap = {};
  (_supabaseSelectByKeyInBatches_('clients', 'client_code,client_name', 'client_code', clientCodes) || []).forEach(function(row) {
    clientMap[String(row.client_code || '').trim()] = String(row.client_name || '').trim();
  });
  return list.map(function(row) {
    const code = String(row.clientCode || row.client_code || '').trim();
    const resolved = String(row.billToName || row.bill_to_name || row.clientName || row.client_name || '').trim() || clientMap[code] || code;
    return Object.assign({}, row, { clientName: resolved });
  });
}

function _billingLoadSalesOrderLinesBySoIds_(soIds) {
  const ids = (soIds || []).filter(Boolean);
  if (!ids.length) return [];
  try {
    return _supabaseSelectByKeyInBatches_(
      'sales_order_lines',
      'id,so_id,line_no,product_code,product_name,category,qty,unit,rate,gst_pct,hsn_group,job_reference,division,quote_no,pm_code,expected_delivery,final_delivery,prepress_remarks,product_remarks,line_total',
      'so_id',
      ids,
      'so_id.asc,line_no.asc'
    ) || [];
  } catch (err) {
    const msg = String((err && err.message) || '');
    const missingHsn =
      msg.indexOf('column sales_order_lines.hsn_group does not exist') !== -1 ||
      msg.indexOf('column "hsn_group" of relation "sales_order_lines" does not exist') !== -1 ||
      msg.indexOf('sales_order_lines.hsn_group') !== -1;
    if (!missingHsn) throw err;
    return (_supabaseSelectByKeyInBatches_(
      'sales_order_lines',
      'id,so_id,line_no,product_code,product_name,category,qty,unit,rate,gst_pct,job_reference,division,quote_no,pm_code,expected_delivery,final_delivery,prepress_remarks,product_remarks,line_total',
      'so_id',
      ids,
      'so_id.asc,line_no.asc'
    ) || []).map(function(row) {
      if (row && typeof row === 'object' && !Object.prototype.hasOwnProperty.call(row, 'hsn_group')) {
        row.hsn_group = '';
      }
      return row;
    });
  }
}

function _billingBuildSoOptions_(salesOrders) {
  return (salesOrders || []).map(function(row) {
    return {
      soNumber: row.so_number,
      soDate: row.so_date || '',
      currency: row.currency || 'INR'
    };
  });
}

function _billingBuildSummaryFromRows_(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    totalLines: list.length,
    dispatchBillableQty: _billingRound2_(list.reduce(function(sum, row){ return sum + _billingToNumber_(row.dispatchBillableQty); }, 0)),
    fgBillableQty: _billingRound2_(list.reduce(function(sum, row){ return sum + _billingToNumber_(row.fgBillableQty); }, 0)),
    directBillableQty: _billingRound2_(list.reduce(function(sum, row){ return sum + _billingToNumber_(row.directBillableQty); }, 0)),
    billedQty: _billingRound2_(list.reduce(function(sum, row){ return sum + _billingToNumber_(row.billedQty); }, 0)),
    selectedCustomerOrders: [...new Set(list.map(function(row){ return row.soNumber; }).filter(Boolean))].length
  };
}

function _billingEnrichFastDatasetRows_(rows) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  const missingCodes = [...new Set(list.map(function(row) {
    return !String(row && row.hsn_group || row && row.hsn || '').trim() && String(row && row.product_code || row && row.productCode || '').trim()
      ? String(row.product_code || row.productCode).trim()
      : '';
  }).filter(Boolean))];
  const itemHsnMap = {};
  if (missingCodes.length) {
    (supabaseSelect('items', {
      select: 'item_code,hsn_group',
      filters: { item_code: 'in.(' + missingCodes.join(',') + ')' }
    }) || []).forEach(function(row) {
      itemHsnMap[String(row.item_code || '').trim()] = String(row.hsn_group || '').trim();
    });
  }
  return list.map(function(row) {
    const productCode = String(row.product_code || row.productCode || '').trim();
    const rawRefs = String(row.invoice_refs || row.invoiceRefs || '').trim();
    const hsn = String(row.hsn_group || row.hsn || itemHsnMap[productCode] || '').trim();
    return {
      key: String(row.so_line_id || row.soLineId || ''),
      soId: row.so_id || row.soId || '',
      soLineId: row.so_line_id || row.soLineId || '',
      soNumber: row.so_number || row.soNumber || '',
      soDate: row.so_date || row.soDate || '',
      clientCode: row.client_code || row.clientCode || '',
      clientName: row.client_name || row.clientName || row.client_code || row.clientCode || '',
      clientState: row.client_state || row.clientState || '',
      clientGstin: row.client_gstin || row.clientGstin || '',
      clientAddress: row.client_address || row.clientAddress || '',
      poNumber: row.po_number || row.poNumber || '',
      poDate: row.po_date || row.poDate || '',
      currency: row.currency || 'INR',
      salesRemarks: row.sales_remarks || row.salesRemarks || '',
      modeOfTransport: row.mode_of_transport || row.modeOfTransport || '',
      transportPreference: row.transport_preference || row.transportPreference || '',
      transportPayment: row.transport_payment || row.transportPayment || '',
      billingRemarks: row.billing_remarks || row.billingRemarks || '',
      salesRep: row.sales_rep || row.salesRep || '',
      lineNo: Number(row.line_no || row.lineNo || 0),
      productCode: productCode,
      productName: row.product_name || row.productName || '',
      category: row.category || '',
      unit: row.unit || 'Pcs',
      rate: _billingRound2_(row.rate),
      gstPct: _billingRound2_(row.gst_pct != null ? row.gst_pct : row.gstPct),
      hsn: hsn,
      orderQty: _billingRound2_(row.order_qty != null ? row.order_qty : row.orderQty),
      packedQty: _billingRound2_(row.packed_qty != null ? row.packed_qty : row.packedQty),
      dispatchedQty: _billingRound2_(row.dispatched_qty != null ? row.dispatched_qty : row.dispatchedQty),
      fgAdjustedQty: _billingRound2_(row.fg_adjusted_qty != null ? row.fg_adjusted_qty : row.fgAdjustedQty),
      billedQty: _billingRound2_(row.billed_qty != null ? row.billed_qty : row.billedQty),
      postedQty: _billingRound2_(row.posted_qty != null ? row.posted_qty : row.postedQty),
      draftQty: _billingRound2_(row.draft_qty != null ? row.draft_qty : row.draftQty),
      dispatchBillableQty: _billingRound2_(row.dispatch_billable_qty != null ? row.dispatch_billable_qty : row.dispatchBillableQty),
      fgBillableQty: _billingRound2_(row.fg_billable_qty != null ? row.fg_billable_qty : row.fgBillableQty),
      directBillableQty: _billingRound2_(row.direct_billable_qty != null ? row.direct_billable_qty : row.directBillableQty),
      billableQty: _billingRound2_(row.billable_qty != null ? row.billable_qty : row.billableQty),
      packedAt: row.latest_packed_at || row.packedAt || '',
      dispatchNo: row.dispatch_no || row.dispatchNo || '',
      dispatchDate: row.dispatch_date || row.dispatchDate || '',
      transporter: row.transporter || '',
      vehicleNo: row.vehicle_no || row.vehicleNo || '',
      lrNo: row.lr_no || row.lrNo || '',
      jobReference: row.job_reference || row.jobReference || '',
      division: row.division || '',
      quoteNo: row.quote_no || row.quoteNo || '',
      pmCode: row.pm_code || row.pmCode || '',
      expectedDelivery: row.expected_delivery || row.expectedDelivery || '',
      finalDelivery: row.final_delivery || row.finalDelivery || '',
      prepressRemarks: row.prepress_remarks || row.prepressRemarks || '',
      productRemarks: row.product_remarks || row.productRemarks || '',
      invoiceRefs: rawRefs ? rawRefs.split(' || ').map(function(v){ return String(v || '').trim(); }).filter(Boolean) : [],
      matchText: String(row.match_text || '').trim() || [
        row.so_number || row.soNumber || '',
        row.line_no || row.lineNo || '',
        productCode,
        row.product_name || row.productName || '',
        row.job_reference || row.jobReference || '',
        row.client_name || row.clientName || '',
        row.po_number || row.poNumber || ''
      ].join(' ').toLowerCase()
    };
  });
}

function _billingTryFastDatasetRows_(params) {
  const p = params || {};
  if (!p.clientCode) return null;
  try {
    const rows = supabaseRpc('billing_job_dataset', {
      p_client_code: p.clientCode,
      p_so_number: p.soNumber || null,
      p_mode: _billingNormalizeMode_(p.mode),
      p_q: p.q || null,
      p_only_open: p.onlyOpen === false ? false : true
    }) || [];
    return _billingEnrichFastDatasetRows_(rows);
  } catch (err) {
    return null;
  }
}

function _billingBuildDatasetRows_(options) {
  const p = options || {};
  const mode = _billingNormalizeMode_(p.mode);
  const emptySummary = {
    totalLines: 0,
    dispatchBillableQty: 0,
    fgBillableQty: 0,
    directBillableQty: 0,
    billedQty: 0,
    selectedCustomerOrders: 0
  };
  if (mode === 'MANUAL') {
    const clientMap = _billingSelectClientsByCodes_(p.clientCode ? [p.clientCode] : []);
    const selectedClient = p.clientCode ? (clientMap[String(p.clientCode)] || null) : null;
    const partyMap = _billingSelectClientPartiesByClients_(selectedClient ? [selectedClient] : []);
    const selectedParties = selectedClient ? _billingBuildAddressChoices_(selectedClient, partyMap[String(p.clientCode)] || []) : null;
    return {
      ok: true,
      mode: mode,
      rows: [],
      soOptions: [],
      client: _billingClientPayload_(selectedClient, selectedParties),
      rowsDeferred: false,
      summary: emptySummary
    };
  }
  if (!p.clientCode) {
    return {
      ok: true,
      mode: mode,
      rows: [],
      soOptions: [],
      client: null,
      summary: emptySummary
    };
  }
  const salesOrders = _billingGetSalesOrders_(p.clientCode, p.soNumber);
  const clientMap = _billingSelectClientsByCodes_(p.clientCode ? [p.clientCode] : []);
  const selectedClient = p.clientCode ? (clientMap[String(p.clientCode)] || null) : null;
  const partyMap = _billingSelectClientPartiesByClients_(selectedClient ? [selectedClient] : []);
  const selectedParties = selectedClient ? _billingBuildAddressChoices_(selectedClient, partyMap[String(p.clientCode)] || []) : null;
  const soOptions = _billingBuildSoOptions_(salesOrders);
  if (!salesOrders.length) {
    return {
      ok: true,
      mode: mode,
      rows: [],
      soOptions: [],
      client: _billingClientPayload_(selectedClient, selectedParties),
      rowsDeferred: false,
      summary: emptySummary
    };
  }

  const soIds = salesOrders.map(function(row){ return row.id; }).filter(Boolean);
  const soMap = {};
  salesOrders.forEach(function(row) { soMap[String(row.id)] = row; });

  const shouldLoadRows =
    p.includeRows === true ||
    !!String(p.soNumber || '').trim() ||
    !!String(p.q || '').trim() ||
    mode !== 'DISPATCH' ||
    salesOrders.length <= 8;
  if (!shouldLoadRows) {
    return {
      ok: true,
      mode: mode,
      rows: [],
      soOptions: soOptions,
      client: _billingClientPayload_(selectedClient, selectedParties),
      rowsDeferred: true,
      summary: {
        totalLines: emptySummary.totalLines,
        dispatchBillableQty: emptySummary.dispatchBillableQty,
        fgBillableQty: emptySummary.fgBillableQty,
        directBillableQty: emptySummary.directBillableQty,
        billedQty: emptySummary.billedQty,
        selectedCustomerOrders: salesOrders.length
      }
    };
  }

  const fastRows = _billingTryFastDatasetRows_(p);
  if (fastRows) {
    return {
      ok: true,
      mode: mode,
      rows: fastRows,
      soOptions: soOptions,
      client: _billingClientPayload_(selectedClient, selectedParties),
      rowsDeferred: false,
      summary: _billingBuildSummaryFromRows_(fastRows)
    };
  }

  const lines = enrichSalesOrderLines(_billingLoadSalesOrderLinesBySoIds_(soIds));
  const lineIds = lines.map(function(row){ return row.id; }).filter(Boolean);
  const packingMap = _billingGetPackingRowsByLineIds_(lineIds);
  const dispatchMap = _billingGetDispatchRowsByLineIds_(lineIds);
  const fgAdjustmentMap = _billingGetFGAdjustmentRowsByLineIds_(lineIds);
  const usageMap = _billingGetInvoiceUsageByLineIds_(lineIds);
  const q = String(p.q || '').trim().toLowerCase();

  const rows = lines.map(function(line) {
    const so = soMap[String(line.so_id)] || {};
    const client = clientMap[String(so.client_code || '')] || {};
    const packing = packingMap[String(line.id)] || {};
    const dispatch = dispatchMap[String(line.id)] || {};
    const usage = usageMap[String(line.id)] || {};
    const orderQty = _billingRound2_(line.qty);
    const billedQty = _billingRound2_(usage.billedQty);
    const packedQty = _billingRound2_(packing.packedQty);
    const dispatchedQty = _billingRound2_(dispatch.dispatchedQty);
    const fgAdjustedQty = _billingRound2_(fgAdjustmentMap[String(line.id)] || 0);
    const dispatchBillableQty = _billingRound2_(Math.max(dispatchedQty - billedQty, 0));
    const fgBillableQty = _billingRound2_(Math.max(packedQty - billedQty - fgAdjustedQty, 0));
    const directBillableQty = _billingRound2_(Math.max(orderQty - billedQty, 0));
    const currentBillableQty = mode === 'DIRECT'
      ? directBillableQty
      : (mode === 'FG' ? fgBillableQty : dispatchBillableQty);
    const textBlob = [
      so.so_number,
      line.line_no,
      line.product_code,
      line.product_name,
      line.job_reference,
      client.client_name,
      so.po_number
    ].join(' ').toLowerCase();

    return {
      key: String(line.id),
      soId: so.id || '',
      soLineId: line.id || '',
      soNumber: so.so_number || '',
      soDate: so.so_date || '',
      clientCode: so.client_code || '',
      clientName: client.client_name || so.client_code || '',
      clientState: client.state || '',
      clientGstin: client.gstin || '',
      clientAddress: _clientComposeAddress_(client.bill_to_address || client.address, client.bill_to_city || client.city, client.bill_to_state || client.state, client.bill_to_pincode || client.pincode),
      poNumber: so.po_number || '',
      poDate: so.po_date || '',
      currency: so.currency || 'INR',
      salesRemarks: so.remarks || '',
      modeOfTransport: so.mode_of_transport || '',
      transportPreference: so.transport_preference || '',
      transportPayment: so.transport_payment || '',
      billingRemarks: so.billing_remarks || '',
      salesRep: so.sales_rep || '',
      lineNo: Number(line.line_no || 0),
      productCode: line.product_code || '',
      productName: line.product_name || '',
      category: line.category || '',
      unit: line.unit || 'Pcs',
      rate: _billingRound2_(line.rate),
      gstPct: _billingRound2_(line.gst_pct),
      hsn: line.hsn_group || '',
      orderQty: orderQty,
      packedQty: packedQty,
      dispatchedQty: dispatchedQty,
      fgAdjustedQty: fgAdjustedQty,
      billedQty: billedQty,
      postedQty: _billingRound2_(usage.postedQty),
      draftQty: _billingRound2_(usage.draftQty),
      dispatchBillableQty: dispatchBillableQty,
      fgBillableQty: fgBillableQty,
      directBillableQty: directBillableQty,
      billableQty: currentBillableQty,
      packedAt: packing.latestPackedAt || '',
      dispatchNo: dispatch.latestDispatchNo || '',
      dispatchDate: dispatch.latestDispatchDate || '',
      transporter: dispatch.transporter || '',
      vehicleNo: dispatch.vehicleNo || '',
      lrNo: dispatch.lrNo || '',
      jobReference: line.job_reference || '',
      division: line.division || '',
      quoteNo: line.quote_no || '',
      pmCode: line.pm_code || '',
      expectedDelivery: line.expected_delivery || '',
      finalDelivery: line.final_delivery || '',
      prepressRemarks: line.prepress_remarks || '',
      productRemarks: line.product_remarks || '',
      invoiceRefs: usage.references || [],
      matchText: textBlob
    };
  }).filter(function(row) {
    if (q && row.matchText.indexOf(q) === -1) return false;
    if (p.onlyOpen !== false && !(row.billableQty > 0)) return false;
    return true;
  });

  return {
    ok: true,
    mode: mode,
    rows: rows,
    soOptions: soOptions,
    client: _billingClientPayload_(selectedClient, selectedParties),
    rowsDeferred: false,
    summary: _billingBuildSummaryFromRows_(rows)
  };
}

  function billingGetBootstrap(token) {
    const user = _requireModuleAccess_(token, 'BILLING', 'can_view');
    const clients = _billingClientSelectRows_().map(function(row) {
      return {
        clientCode: row.client_code || '',
        clientName: row.client_name || '',
        gstin: row.gstin || '',
        state: row.state || '',
        panNo: row.pan_no || '',
        paymentTerms: row.payment_terms || '',
        address: _clientComposeAddress_(row.bill_to_address || row.address, row.bill_to_city || row.city, row.bill_to_state || row.state, row.bill_to_pincode || row.pincode),
        shipToAddress: _clientComposeAddress_(row.ship_to_address, row.ship_to_city, row.ship_to_state, row.ship_to_pincode)
      };
    });
  return {
    ok: true,
    company: _billingCompanyProfile_(),
    clients: clients,
    companyState: DEFAULT_MASTERS.companyState || COMPANY_STATE,
    canDirectBilling: _billingCanDirect_(user, token),
    canEditBilling: _userHasPermission_(user, 'BILLING', 'can_edit')
  };
}

function billingGetDataset(params, token) {
  _billingRequireSession_(token);
  return _billingBuildDatasetRows_(params || {});
}

function billingGetDraftDocumentNo(params, token) {
  _billingRequireSession_(token);
  const p = params || {};
  const documentType = _billingNormalizeDocumentType_(p.documentType);
  const invoiceDate = _billingSafeDate_(p.invoiceDate).toISOString().slice(0, 10);
  return {
    ok: true,
    documentType: documentType,
    documentLabel: _billingDocumentLabel_(documentType),
    documentNo: _billingPreviewDocumentNo_(documentType, invoiceDate),
    invoiceDate: invoiceDate
  };
}

function _billingMatchMissingColumn_(message, table, keys) {
  const msg = String(message || '');
  return (keys || []).find(function(key) {
    return msg.indexOf('column "' + key + '" of relation "' + table + '" does not exist') !== -1 ||
      (msg.indexOf(table + '.' + key) !== -1 && msg.indexOf('does not exist') !== -1) ||
      msg.indexOf("Could not find the '" + key + "' column of '" + table + "' in the schema cache") !== -1;
  }) || '';
}

function _billingInsertWithFallback_(table, payload, optionalKeys) {
  const safeKeys = Array.isArray(optionalKeys) ? optionalKeys.slice() : [];
  let current = Object.assign({}, payload);
  while (true) {
    try {
      return supabaseInsert(table, current);
    } catch (err) {
      const missing = _billingMatchMissingColumn_(err && err.message, table, safeKeys);
      if (!missing) throw err;
      delete current[missing];
      const idx = safeKeys.indexOf(missing);
      if (idx !== -1) safeKeys.splice(idx, 1);
    }
  }
}

function _billingUpdateWithFallback_(table, filters, payload, optionalKeys) {
  const safeKeys = Array.isArray(optionalKeys) ? optionalKeys.slice() : [];
  let current = Object.assign({}, payload);
  while (true) {
    try {
      return supabaseUpdate(table, filters, current);
    } catch (err) {
      const missing = _billingMatchMissingColumn_(err && err.message, table, safeKeys);
      if (!missing) throw err;
      delete current[missing];
      const idx = safeKeys.indexOf(missing);
      if (idx !== -1) safeKeys.splice(idx, 1);
    }
  }
}

function _billingNormalizeDocumentType_(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'CHALLAN' || normalized === 'DELIVERY_CHALLAN' || normalized === 'DC') return 'CHALLAN';
  return 'INVOICE';
}

function _billingInferDocumentType_(rowOrValue) {
  if (rowOrValue && typeof rowOrValue === 'object') {
    const explicit = _billingNormalizeDocumentType_(rowOrValue.document_type || rowOrValue.documentType);
    if (explicit === 'CHALLAN') return explicit;
    return _billingInferDocumentType_(rowOrValue.invoice_no || rowOrValue.invoiceNo || '');
  }
  const value = String(rowOrValue || '').trim().toUpperCase();
  if (value.indexOf('DC-H/') === 0 || value.indexOf('DC-H-') === 0) return 'CHALLAN';
  return 'INVOICE';
}

function _billingDocumentLabel_(documentType) {
  return _billingNormalizeDocumentType_(documentType) === 'CHALLAN' ? 'Delivery Challan' : 'Invoice';
}

function _billingBuildPrintUrl_(invoiceId, token, documentType, options) {
  const base = ScriptApp.getService().getUrl();
  const docType = _billingNormalizeDocumentType_(documentType);
  const page = docType === 'CHALLAN' ? 'printchallan' : 'printinvoice';
  const qs = ['p=' + page, 'invoiceId=' + encodeURIComponent(invoiceId)];
  if (token) qs.push('token=' + encodeURIComponent(token));
  if (docType === 'CHALLAN' && String((options || {}).valueMode || '').toUpperCase() === 'VALUE') {
    qs.push('valueMode=value');
  }
  return base + '?' + qs.join('&');
}

function _billingGenerateDocumentNo_(documentType, invoiceDate) {
  const dateText = String(invoiceDate || '').trim() || new Date().toISOString().slice(0, 10);
  const fyKey = getFinancialYear(new Date(dateText));
  const fyLabel = String(fyKey || '').replace('_', '-');
  const docType = _billingNormalizeDocumentType_(documentType);
  const prefix = docType === 'CHALLAN' ? 'DC-H' : 'DI-H';
  try {
    const rpcRes = supabaseRpc('get_next_invoice_no', {
      p_prefix: prefix,
      p_invoice_date: dateText
    });
    const fromRpc = Array.isArray(rpcRes)
      ? (rpcRes[0] && (rpcRes[0].get_next_invoice_no || rpcRes[0].invoice_no || rpcRes[0].next_invoice_no))
      : (rpcRes && (rpcRes.get_next_invoice_no || rpcRes.invoice_no || rpcRes.next_invoice_no));
    if (fromRpc) {
      const candidate = String(fromRpc).trim().replace(new RegExp('^' + prefix + '\\/(\\d{2})_(\\d{2})\\/', 'i'), prefix + '/$1-$2/');
      if (new RegExp('^' + prefix + '\\/\\d{2}-\\d{2}\\/\\d+$', 'i').test(candidate)) return candidate;
    }
  } catch (err) {}

  const rows = supabaseSelect('invoices', {
    select: 'invoice_no',
    order: 'invoice_no.desc',
    limit: 500
  }) || [];
  let maxSeq = 0;
  rows.forEach(function(row) {
    const invNo = String(row && row.invoice_no || '').trim();
    const m = invNo.match(new RegExp('^' + prefix + '\\/?(\\d{2}-\\d{2})\\/?(\\d+)$', 'i')) ||
      invNo.match(new RegExp('^' + prefix + '[-\\/]?(\\d{2}-\\d{2})[-\\/]?(\\d+)$', 'i'));
    if (!m) return;
    if (m[1] !== fyLabel) return;
    maxSeq = Math.max(maxSeq, Number(m[2] || 0) || 0);
  });
  return prefix + '/' + fyLabel + '/' + String(maxSeq + 1).padStart(5, '0');
}

function _billingPreviewDocumentNo_(documentType, invoiceDate) {
  const dateText = String(invoiceDate || '').trim() || new Date().toISOString().slice(0, 10);
  const fyKey = getFinancialYear(new Date(dateText));
  const fyLabel = String(fyKey || '').replace('_', '-');
  const docType = _billingNormalizeDocumentType_(documentType);
  const prefix = docType === 'CHALLAN' ? 'DC-H' : 'DI-H';
  const rows = supabaseSelect('invoices', {
    select: 'invoice_no',
    order: 'invoice_no.desc',
    limit: 500
  }) || [];
  let maxSeq = 0;
  rows.forEach(function(row) {
    const invNo = String(row && row.invoice_no || '').trim();
    const m = invNo.match(new RegExp('^' + prefix + '\\/?(\\d{2}-\\d{2})\\/?(\\d+)$', 'i')) ||
      invNo.match(new RegExp('^' + prefix + '[-\\/]?(\\d{2}-\\d{2})[-\\/]?(\\d+)$', 'i'));
    if (!m) return;
    if (m[1] !== fyLabel) return;
    maxSeq = Math.max(maxSeq, Number(m[2] || 0) || 0);
  });
  return prefix + '/' + fyLabel + '/' + String(maxSeq + 1).padStart(5, '0');
}

function _billingGenerateInvoiceNo_(invoiceDate) {
  return _billingGenerateDocumentNo_('INVOICE', invoiceDate);
}

function _billingGenerateDeliveryChallanNo_(invoiceDate) {
  return _billingGenerateDocumentNo_('CHALLAN', invoiceDate);
}

function _billingGenerateManualSoNumber_(invoiceDate) {
  const dateText = String(invoiceDate || '').trim() || new Date().toISOString().slice(0, 10);
  try {
    return generateSalesOrderNumber('MB', dateText);
  } catch (err) {}

  const fy = getFinancialYear(new Date(dateText));
  const rows = supabaseSelect('sales_orders', {
    select: 'so_number',
    order: 'so_number.desc',
    limit: 500
  }) || [];
  let maxSeq = 0;
  rows.forEach(function(row) {
    const soNumber = String(row && row.so_number || '').trim();
    const m = soNumber.match(/^MB\/?(\d{2}_\d{2})\/?(\d+)$/i) || soNumber.match(/^MB[-\/]?(\d{2}_\d{2})[-\/]?(\d+)$/i);
    if (!m) return;
    if (m[1] !== fy) return;
    maxSeq = Math.max(maxSeq, Number(m[2] || 0) || 0);
  });
  return 'MB/' + fy + '/' + String(maxSeq + 1).padStart(5, '0');
}

function _billingManualSalesOrderHeaderPayload_(ctx) {
  const c = ctx || {};
  const selectedBillTo = c.selectedBillTo || {};
  const selectedShipTo = c.selectedShipTo || {};
  const normalized = c.normalized || {};
  const user = c.user || {};
  const transportMode = String(normalized.transporter || '').trim();
  const transportPreference = String(normalized.vehicleNo || '').trim();
  const transportPayment = String(normalized.transportPayment || '').trim().toUpperCase();
  return {
    so_number: c.soNumber,
    so_date: c.invoiceDate,
    order_prefix: 'MB',
    client_code: normalized.clientCode || 'MANUAL',
    currency: 'INR',
    sales_rep: '',
    sales_type: 'MANUAL_BILLING',
    po_number: '',
    po_date: null,
    remarks: [
      'SYSTEM GENERATED FOR MANUAL BILLING',
      c.invoiceNo ? ('Invoice Ref: ' + c.invoiceNo) : '',
      selectedBillTo.partyName ? ('Bill To: ' + selectedBillTo.partyName) : '',
      selectedShipTo.partyName ? ('Ship To: ' + selectedShipTo.partyName) : '',
      normalized.remarks || ''
    ].filter(Boolean).join(' | '),
    mode_of_transport: transportMode || null,
    transport_preference: transportPreference || null,
    transport_payment: (transportPayment === 'PREPAID' || transportPayment === 'TO_PAY') ? transportPayment : null,
    billing_remarks: normalized.remarks || null,
    status: 'OPEN',
    subtotal: _billingRound2_(c.subtotal),
    discount_total: 0,
    cgst_total: _billingRound2_(c.cgstTotal),
    sgst_total: _billingRound2_(c.sgstTotal),
    igst_total: _billingRound2_(c.igstTotal),
    grand_total: _billingRound2_(c.grandTotal),
    created_by: String(user.userId || user.displayName || Session.getActiveUser()?.getEmail?.() || 'user')
  };
}

function invGetGRNPrintData(grnNo) {
  const key = String(grnNo || '').trim();
  if (!key) throw new Error('GRN number is required');

  const rows = supabaseSelect('inv_ledger', {
    select: `
      id,
      item_id,
      created_at,
      ref_type,
      ref_no,
      qty_in,
      rate,
      value,
      location,
      department,
      batch_no,
      remarks,
      inv_items!inv_ledger_item_id_fkey (
        item_code,
        item_name,
        uom,
        category
      )
    `,
    filters: {
      ref_type: _supabaseInFilter_(['PR-RECEIPT', 'PO-RECEIPT', 'DIRECT-RECEIPT']),
      remarks: 'ilike.%GRN:' + key + '%'
    },
    order: 'created_at.asc',
    limit: 500
  }) || [];

  if (!rows.length) throw new Error('GRN not found');

  const first = rows[0];
  const firstNote = invParseReceiptNote_(first.remarks);
  const poNo = String(firstNote.PO || '').trim();
  const poHeader = poNo ? _purchaseListPOHeaders_().find(function(row) {
    return String(row.poNo || '') === poNo;
  }) : null;
  const vendor = poHeader ? (_purchaseListVendors_().find(function(v) {
    return String(v.id || '') === String(poHeader.vendorId || '');
  }) || {}) : {};
  const vendorName = String(firstNote.VENDOR || poHeader?.vendorName || vendor.vendorName || '').trim();
  const vendorAddress = String(vendor.address || poHeader?.vendorAddress || '').trim();
  const vendorGstin = String(vendor.gstin || '').trim();
  const invoiceNo = String(firstNote.INV || '').trim();
  const paymentTerms = String(firstNote.PAY || '').trim();
  const freightTerms = String(firstNote.FREIGHT || '').trim();
  const deliveryTerms = String(firstNote.DELIVERY || '').trim();
  const freightValue = Number(firstNote.FREIGHTVALUE || 0);
  const freightGstPct = Number(firstNote.FREIGHTGST || 0);
  const freightGstValue = freightValue * freightGstPct / 100;
  const preparedBy = String(Session.getActiveUser?.().getEmail?.() || 'ERP User').trim();
  const missingItemIds = [...new Set(rows
    .filter(function(row) {
      return !!row.item_id && (!row.inv_items || (!row.inv_items.item_code && !row.inv_items.item_name));
    })
    .map(function(row) { return row.item_id; }))];
  const itemMap = {};
  if (missingItemIds.length) {
    for (let i = 0; i < missingItemIds.length; i += 20) {
      const chunk = missingItemIds.slice(i, i + 20);
      const itemRows = supabaseSelect('inv_items', {
        select: 'id,item_code,item_name,uom,category',
        filters: { id: _supabaseInFilter_(chunk) }
      }) || [];
      itemRows.forEach(function(item) {
        itemMap[item.id] = item;
      });
    }
  }
  const poLineRows = _purchaseListPOLines_();
  const poLineLookup = {};
  poLineRows.forEach(function(line) {
    const poKey = String(line.poNo || '').trim().toUpperCase();
    const sourceKey = String(line.sourceRef || '').trim().toUpperCase();
    const itemKey = String(line.itemCode || '').trim().toUpperCase();
    if (poKey && sourceKey && itemKey && !poLineLookup[poKey + '|' + sourceKey + '|' + itemKey]) {
      poLineLookup[poKey + '|' + sourceKey + '|' + itemKey] = line;
    }
    if (poKey && itemKey && !poLineLookup[poKey + '||' + itemKey]) {
      poLineLookup[poKey + '||' + itemKey] = line;
    }
  });
  const lines = rows.map(function(row, idx) {
    const item = row.inv_items || (row.item_id ? itemMap[row.item_id] : null) || {};
    const qty = Number(row.qty_in || 0);
    const rate = Number(row.rate || 0);
    const value = Number(row.value || 0);
    const note = invParseReceiptNote_(row.remarks);
    const poNoForLine = String(note.PO || '').trim().toUpperCase();
    const refNoForLine = String(row.ref_no || '').trim().toUpperCase();
    const itemCodeForLine = String(item.item_code || '').trim().toUpperCase();
    const resolvedPoLine = poLineLookup[poNoForLine + '|' + refNoForLine + '|' + itemCodeForLine] ||
      poLineLookup[poNoForLine + '||' + itemCodeForLine] ||
      null;
    let gstPct = Number(note.TAXPCT);
    if (isNaN(gstPct)) gstPct = Number(resolvedPoLine?.taxPct);
    if (isNaN(gstPct)) gstPct = _purchaseItemTaxPct_(item);
    gstPct = Number(isNaN(gstPct) ? 0 : gstPct);
    const gstValue = Number((value * gstPct / 100).toFixed(2));
    const lineTotal = Number((value + gstValue).toFixed(2));
    return {
      srNo: idx + 1,
      receiptNo: row.id,
      prNo: row.ref_no || '',
      itemCode: item.item_code || '',
      itemName: item.item_name || '',
      category: item.category || '',
      uom: item.uom || '',
      qty: qty,
      rate: rate,
      value: value,
      gstPct: gstPct,
      gstValue: gstValue,
      lineTotal: lineTotal,
      batchNo: row.batch_no || '',
      department: row.department || '',
      location: row.location || DEFAULT_LOCATION,
      remarks: String(note.REMARKS || '').trim()
    };
  });

  const totalQty = lines.reduce(function(sum, line) { return sum + Number(line.qty || 0); }, 0);
  const totalValue = lines.reduce(function(sum, line) { return sum + Number(line.value || 0); }, 0);
  const totalGstValue = lines.reduce(function(sum, line) { return sum + Number(line.gstValue || 0); }, 0);

  return {
    ok: true,
    company: PURCHASE_COMPANY,
    grn: {
      grnNo: key,
      documentNo: key,
      date: first.created_at || '',
      type: 'GOODS_RECEIPT_NOTE',
      invoiceNo: invoiceNo,
      poNo: poNo,
      vendorName: vendorName,
      vendorAddress: vendorAddress,
      vendorGstin: vendorGstin,
      location: first.location || DEFAULT_LOCATION,
      department: first.department || '',
      paymentTerms: paymentTerms,
      freightTerms: freightTerms,
      deliveryTerms: deliveryTerms,
      freightValue: freightValue,
      freightGstPct: freightGstPct,
      freightGstValue: freightGstValue,
      remarks: String(firstNote.REMARKS || '').trim()
    },
    lines: lines,
    totals: {
      qty: totalQty,
      value: totalValue,
      gstValue: totalGstValue,
      freightValue: freightValue,
      freightGstValue: freightGstValue,
      grandTotal: Number((totalValue + totalGstValue + freightValue + freightGstValue).toFixed(2))
    },
    meta: {
      printedBy: preparedBy
    }
  };
}

function _billingManualSalesOrderLineRows_(manualLines, billToState) {
  return (manualLines || []).map(function(row, idx) {
    const taxable = _billingRound2_(row.qty * row.rate);
    const tax = _billingCalcTaxSplit_(billToState, row.gstPct, taxable);
    return {
      line_no: idx + 1,
      product_code: row.productCode || '',
      product_name: row.productName || '',
      category: 'MANUAL',
      qty: _billingRound2_(row.qty),
      unit: row.unit || 'Nos',
      rate: _billingRound2_(row.rate),
      disc_pct: 0,
      gst_pct: _billingRound2_(row.gstPct),
      amount: taxable,
      disc_amount: 0,
      cgst: tax.cgstAmt,
      sgst: tax.sgstAmt,
      igst: tax.igstAmt,
      line_total: _billingRound2_(taxable + tax.cgstAmt + tax.sgstAmt + tax.igstAmt),
      job_type: 'MANUAL',
      job_reference: String(row.remarks || row.hsn || row.productCode || 'MANUAL').trim(),
      job_priority: '',
      product_remarks: String(row.remarks || '').trim(),
      division: 'MANUAL',
      quote_no: '',
      pm_code: '',
      prepress_remarks: String(row.hsn || '').trim(),
      expected_delivery: null,
      final_delivery: null
    };
  });
}

function _billingCloseManualSalesOrderLines_(lineIds, user) {
  const ids = [...new Set((lineIds || []).map(function(id) {
    return String(id || '').trim();
  }).filter(Boolean))];
  if (!ids.length) return;

  const stamp = new Date().toISOString();
  const actor = String((user && (user.userId || user.displayName)) || Session.getActiveUser()?.getEmail?.() || 'system').trim();
  const payload = {
    status: 'CLOSED',
    closed_at: stamp,
    closed_by: 'Manual Billing - ' + actor,
    status_updated_at: stamp
  };

  _supabaseChunkValuesByFilterLength_(ids, 1200, 40).forEach(function(chunk) {
    try {
      supabaseUpdateMinimal('sales_order_lines', { id: _supabaseInFilter_(chunk) }, payload);
    } catch (err) {
      const msg = String((err && err.message) || err || '');
      const missingLifecycleColumn = ['status', 'closed_at', 'closed_by', 'status_updated_at'].some(function(key) {
        return msg.indexOf('sales_order_lines.' + key) !== -1 ||
          msg.indexOf('column "' + key + '" of relation "sales_order_lines" does not exist') !== -1 ||
          msg.indexOf("Could not find the '" + key + "' column of 'sales_order_lines'") !== -1;
      });
      if (!missingLifecycleColumn) throw err;
      Logger.log('Manual billing line close skipped until sales_order_lines lifecycle columns are applied.');
    }
  });
}

function _billingCreateOrUpdateManualSalesOrder_(options) {
  const opts = options || {};
  const soNumber = String(opts.soNumber || '').trim() || _billingGenerateManualSoNumber_(opts.invoiceDate);
  const headerPayload = _billingManualSalesOrderHeaderPayload_(Object.assign({}, opts, { soNumber: soNumber }));
  let soId = String(opts.soId || '').trim();
  if (soId) {
    _salesOrderUpdateHeader_({ id: 'eq.' + soId }, headerPayload);
    supabaseDelete('sales_order_lines', { so_id: 'eq.' + soId });
  } else {
    const soInsert = _salesOrderInsertHeader_(headerPayload);
    const soRow = soInsert && soInsert[0];
    if (!soRow?.id) throw new Error('Manual sales order creation failed');
    soId = String(soRow.id);
  }

  const lineRows = _billingManualSalesOrderLineRows_(opts.manualLines, opts.selectedBillTo?.state || '').map(function(row) {
    return Object.assign({ so_id: soId }, row);
  });
  let inserted = supabaseBulkInsert('sales_order_lines', lineRows) || [];
  if (!inserted.length || inserted.some(function(row) { return !row || !row.id; })) {
    inserted = supabaseSelect('sales_order_lines', {
      select: 'id,so_id,line_no,product_code,product_name,qty,unit,rate,gst_pct,amount,cgst,sgst,igst,line_total,prepress_remarks',
      filters: { so_id: 'eq.' + soId },
      order: 'line_no.asc'
    }) || [];
  }
  if (!inserted.length) throw new Error('Manual sales order line creation failed');
  const insertedByLineNo = {};
  inserted.forEach(function(row) {
    insertedByLineNo[String(row.line_no || '')] = row;
  });
  _billingCloseManualSalesOrderLines_(inserted.map(function(row) {
    return row && row.id;
  }), opts.user);
  return {
    soId: soId,
    soNumber: soNumber,
    lines: lineRows.map(function(row) {
      const insertedRow = insertedByLineNo[String(row.line_no || '')] || {};
      return {
        soId: soId,
        soLineId: String(insertedRow.id || insertedRow.so_line_id || '').trim(),
        soNumber: soNumber,
        lineNo: Number(row.line_no || 0),
        productCode: row.product_code || '',
        productName: row.product_name || '',
        hsn: row.prepress_remarks || '',
        unit: row.unit || 'Nos',
        qty: _billingRound2_(row.qty),
        rate: _billingRound2_(row.rate),
        gstPct: _billingRound2_(row.gst_pct),
        taxableAmount: _billingRound2_(row.amount),
        cgstAmt: _billingRound2_(row.cgst),
        sgstAmt: _billingRound2_(row.sgst),
        igstAmt: _billingRound2_(row.igst),
        lineTotal: _billingRound2_(row.line_total)
      };
    })
  };
}

function _billingExtractReusableManualSo_(invoiceLines) {
  const ids = [...new Set((invoiceLines || []).map(function(row) {
    return String(row.so_id || '').trim();
  }).filter(Boolean))];
  if (ids.length !== 1) return { soId: '', soNumber: '' };
  const rows = _supabaseSelectByKeyInBatches_('sales_orders', 'id,so_number,order_prefix', 'id', ids) || [];
  const so = rows[0] || {};
  return {
    soId: String(so.id || '').trim(),
    soNumber: String(so.so_number || '').trim()
  };
}

function _billingValidateCreatePayload_(payload, token, sessionUser) {
  const p = payload || {};
  const mode = _billingNormalizeMode_(p.mode);
  const documentType = _billingNormalizeDocumentType_(p.documentType);
  const manualLines = _billingNormalizeManualLines_(p.manualLines);
  const lines = (p.lines || []).map(function(row) {
    return {
      soLineId: String(row.soLineId || '').trim(),
      qty: _billingRound2_(row.qty),
      rate: _billingRound2_(row.rate),
      gstPct: _billingRound2_(row.gstPct),
      sourceMode: _billingNormalizeMode_(row.sourceMode || mode)
    };
  }).filter(function(row) {
    return row.soLineId && row.qty > 0;
  });
  if (mode === 'MANUAL') {
    if (!manualLines.length) throw new Error('Add at least one manual line item.');
    manualLines.forEach(function(row, idx) {
      if (!row.productName) throw new Error('Manual line ' + (idx + 1) + ' requires item description.');
      if (!(row.qty > 0)) throw new Error('Manual line ' + (idx + 1) + ' requires quantity.');
      if (row.rate < 0) throw new Error('Manual line ' + (idx + 1) + ' has invalid rate.');
    });
  } else {
    if (!lines.length) throw new Error('Select at least one billable line and enter billing quantity.');
    if (!p.clientCode) throw new Error('Select a customer before preparing the invoice.');
  }
  if (mode === 'DIRECT' && !_billingCanDirect_(sessionUser || getSessionUser(token), token)) {
    throw new Error('Direct billing is not allowed for this user.');
  }
  return {
    documentType: documentType,
    mode: mode,
    invoiceDate: _billingSafeDate_(p.invoiceDate),
    clientCode: String(p.clientCode || '').trim(),
    billToId: String(p.billToId || '').trim(),
    shipToId: String(p.shipToId || '').trim(),
    manualBillTo: p.manualBillTo || null,
    manualShipTo: p.manualShipTo || null,
    manualLines: manualLines,
    exchangeRate: _billingRound2_(p.exchangeRate || 1) || 1,
    freight: _billingRound2_(p.freight),
    freightGstPct: _billingRound2_(p.freightGstPct),
    packing: _billingRound2_(p.packing),
    other: _billingRound2_(p.other),
    paymentTerms: String(p.paymentTerms || '').trim(),
    remarks: String(p.remarks || '').trim(),
    transporter: String(p.transporter || '').trim(),
    vehicleNo: String(p.vehicleNo || '').trim(),
    lrNo: String(p.lrNo || '').trim(),
    ewayBillNo: String(p.ewayBillNo || '').trim(),
    directApprovalNote: String(p.directApprovalNote || '').trim(),
    lines: lines
  };
}

function createInvoice(payload, token) {
  const user = _requireModuleAccess_(token, 'BILLING', 'can_edit');
  const normalized = _billingValidateCreatePayload_(payload, token, user);
  const documentType = normalized.documentType;
  const isChallan = documentType === 'CHALLAN';
  if (normalized.mode === 'MANUAL') {
    return _billingCreateManualInvoice_(normalized, token, user);
  }
  const dataset = _billingBuildDatasetRows_({
    clientCode: normalized.clientCode,
    mode: normalized.mode,
    onlyOpen: false
  });
  const rowMap = {};
  (dataset.rows || []).forEach(function(row) {
    rowMap[String(row.soLineId)] = row;
  });
  const clientMap = _billingSelectClientsByCodes_([normalized.clientCode]);
  const client = clientMap[normalized.clientCode];
  if (!client) throw new Error('Customer not found for billing.');
  const addressChoices = _billingBuildAddressChoices_(client, (_billingSelectClientPartiesByClients_([client])[normalized.clientCode] || []));
  const selectedBillTo = normalized.billToId === 'MANUAL'
    ? _billingNormalizeManualAddress_('BILL_TO', normalized.manualBillTo, client)
    : _billingResolveSelectedAddress_(normalized.billToId, addressChoices.billToOptions, addressChoices.defaultBillTo);
  const selectedShipTo = normalized.shipToId === 'MANUAL'
    ? _billingNormalizeManualAddress_('SHIP_TO', normalized.manualShipTo, client)
    : _billingResolveSelectedAddress_(normalized.shipToId, addressChoices.shipToOptions, addressChoices.defaultShipTo);
  if (!selectedBillTo) throw new Error('Select a Bill To address before saving the invoice.');
  if (!selectedShipTo) throw new Error('Select a Ship To address before saving the invoice.');

  const selectedRows = normalized.lines.map(function(entry) {
    const row = rowMap[entry.soLineId];
    if (!row) throw new Error('Billing line not found or no longer available: ' + entry.soLineId);
    if (row.clientCode !== normalized.clientCode) {
      throw new Error('Invoice lines must belong to the same customer.');
    }
    return Object.assign({}, row, {
      sourceMode: entry.sourceMode,
      billingQty: _billingRound2_(entry.qty),
      billingRate: _billingRound2_(entry.rate > 0 ? entry.rate : row.rate),
      billingGstPct: isChallan ? 0 : _billingRound2_(entry.gstPct != null ? entry.gstPct : row.gstPct)
    });
  });

  const invoiceDate = normalized.invoiceDate.toISOString().slice(0, 10);
  const invoiceNo = _billingGenerateDocumentNo_(documentType, invoiceDate);
  if (!invoiceNo) throw new Error(_billingDocumentLabel_(documentType) + ' number generation failed');

  let subtotal = 0;
  let taxTotal = 0;
  let totalQty = 0;
  const lineInserts = [];

  selectedRows.forEach(function(row) {
    const taxable = _billingRound2_(row.billingQty * row.billingRate);
    const tax = isChallan
      ? { cgstPct:0, sgstPct:0, igstPct:0, cgstAmt:0, sgstAmt:0, igstAmt:0 }
      : _billingCalcTaxSplit_(selectedBillTo.state || client.state, row.billingGstPct, taxable);
    const lineTotal = _billingRound2_(taxable + tax.cgstAmt + tax.sgstAmt + tax.igstAmt);
    subtotal += taxable;
    taxTotal += tax.cgstAmt + tax.sgstAmt + tax.igstAmt;
    totalQty += row.billingQty;
    lineInserts.push({
      so_id: row.soId,
      so_line_id: row.soLineId,
      so_number: row.soNumber,
      line_no: row.lineNo,
      product_code: row.productCode,
      product_name: row.productName,
      hsn: row.hsn,
      unit: row.unit,
      qty: row.billingQty,
      rate: row.billingRate,
      gst_pct: isChallan ? 0 : row.billingGstPct,
      taxable_amount: taxable,
      line_amount: taxable,
      cgst_pct: tax.cgstPct,
      sgst_pct: tax.sgstPct,
      igst_pct: tax.igstPct,
      cgst_amt: tax.cgstAmt,
      sgst_amt: tax.sgstAmt,
      igst_amt: tax.igstAmt,
      line_total: lineTotal,
      source_mode: row.sourceMode,
      dispatch_qty_snapshot: row.dispatchedQty,
      ordered_qty_snapshot: row.orderQty,
      billed_qty_snapshot: row.billedQty
    });
  });

  const freightTax = _billingCalcFreightTax_(selectedBillTo.state || client.state, normalized.freight, documentType, normalized.freightGstPct);
  taxTotal = _billingRound2_(taxTotal + freightTax.cgstAmt + freightTax.sgstAmt + freightTax.igstAmt);

  const grandTotal = _billingRound2_(subtotal + taxTotal + normalized.freight + normalized.packing + normalized.other);
  const optionalHeaderFields = [
    'document_type',
    'currency',
    'exchange_rate',
    'freight',
    'freight_gst_pct',
    'packing',
    'other',
    'subtotal',
    'tax_total',
    'grand_total',
    'status',
    'client_name',
    'client_gst',
    'client_state',
    'billing_mode',
    'payment_terms',
    'remarks',
    'transporter',
    'vehicle_no',
    'lr_no',
    'eway_bill_no',
    'direct_approval_note',
    'total_qty',
    'created_by',
    'bill_to_party_id',
    'bill_to_label',
    'bill_to_name',
    'bill_to_address',
    'bill_to_gstin',
    'bill_to_state',
    'ship_to_party_id',
    'ship_to_label',
    'ship_to_name',
    'ship_to_address',
    'ship_to_gstin',
    'ship_to_state'
  ];
  const invoiceInsert = _billingInsertWithFallback_('invoices', {
    invoice_no: invoiceNo,
    invoice_date: invoiceDate,
    document_type: documentType,
    client_code: normalized.clientCode,
    client_name: client.client_name || normalized.clientCode,
    client_gst: client.gstin || '',
    client_state: client.state || '',
    currency: selectedRows[0]?.currency || 'INR',
    exchange_rate: normalized.exchangeRate,
    freight: normalized.freight,
    freight_gst_pct: normalized.freightGstPct,
    packing: normalized.packing,
    other: normalized.other,
    subtotal: _billingRound2_(subtotal),
    tax_total: _billingRound2_(taxTotal),
    grand_total: grandTotal,
    status: 'DRAFT',
    billing_mode: normalized.mode,
    payment_terms: normalized.paymentTerms,
    remarks: normalized.remarks,
    transporter: normalized.transporter,
    vehicle_no: normalized.vehicleNo,
    lr_no: normalized.lrNo,
    eway_bill_no: normalized.ewayBillNo,
    direct_approval_note: normalized.directApprovalNote,
    total_qty: _billingRound2_(totalQty),
    created_by: String(user.userId || user.displayName || Session.getActiveUser()?.getEmail?.() || 'user'),
    bill_to_party_id: selectedBillTo.id || null,
    bill_to_label: selectedBillTo.label || null,
    bill_to_name: selectedBillTo.partyName || client.client_name || normalized.clientCode,
    bill_to_address: selectedBillTo.address || '',
    bill_to_gstin: selectedBillTo.gstin || client.gstin || '',
    bill_to_state: selectedBillTo.state || client.state || '',
    ship_to_party_id: selectedShipTo.id || null,
    ship_to_label: selectedShipTo.label || null,
    ship_to_name: selectedShipTo.partyName || client.client_name || normalized.clientCode,
    ship_to_address: selectedShipTo.address || '',
    ship_to_gstin: selectedShipTo.gstin || client.gstin || '',
    ship_to_state: selectedShipTo.state || client.state || ''
  }, optionalHeaderFields);
  const invoice = invoiceInsert && invoiceInsert[0];
  if (!invoice?.id) throw new Error(_billingDocumentLabel_(documentType) + ' header insert failed');

  const optionalLineFields = [
    'so_number',
    'line_no',
    'unit',
    'gst_pct',
    'taxable_amount',
    'source_mode',
    'dispatch_qty_snapshot',
    'ordered_qty_snapshot',
    'billed_qty_snapshot'
  ];
  lineInserts.forEach(function(row) {
    row.invoice_id = invoice.id;
    _billingInsertWithFallback_('invoice_lines', row, optionalLineFields);
  });

  return {
    ok: true,
    invoiceId: invoice.id,
    invoiceNo: invoiceNo,
    documentType: documentType,
    status: 'DRAFT',
    printUrl: _billingBuildPrintUrl_(invoice.id, token, documentType)
  };
}

function _billingCreateManualInvoice_(normalized, token, user) {
  const documentType = normalized.documentType;
  const isChallan = documentType === 'CHALLAN';
  const clientMap = normalized.clientCode ? _billingSelectClientsByCodes_([normalized.clientCode]) : {};
  const client = normalized.clientCode ? (clientMap[normalized.clientCode] || null) : null;
  const addressChoices = client ? _billingBuildAddressChoices_(client, (_billingSelectClientPartiesByClients_([client])[normalized.clientCode] || [])) : { billToOptions: [], shipToOptions: [], defaultBillTo: null, defaultShipTo: null };
  const selectedBillTo = normalized.billToId === 'MANUAL' || !client
    ? _billingNormalizeManualAddress_('BILL_TO', normalized.manualBillTo, client || { client_name:'', client_code:'', pan_no:'', payment_terms:'' })
    : _billingResolveSelectedAddress_(normalized.billToId, addressChoices.billToOptions, addressChoices.defaultBillTo);
  const selectedShipTo = normalized.shipToId === 'MANUAL' || !client
    ? _billingNormalizeManualAddress_('SHIP_TO', normalized.manualShipTo || normalized.manualBillTo, client || { client_name:'', client_code:'', pan_no:'', payment_terms:'' })
    : _billingResolveSelectedAddress_(normalized.shipToId, addressChoices.shipToOptions, addressChoices.defaultShipTo);
  if (!selectedBillTo) throw new Error('Select or enter a Bill To address.');
  if (!selectedShipTo) throw new Error('Select or enter a Ship To address.');

  const invoiceDate = normalized.invoiceDate.toISOString().slice(0, 10);
  const invoiceNo = _billingGenerateDocumentNo_(documentType, invoiceDate);
  if (!invoiceNo) throw new Error(_billingDocumentLabel_(documentType) + ' number generation failed');

  let subtotal = 0;
  let taxTotal = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;
  let totalQty = 0;
  normalized.manualLines.forEach(function(row, idx) {
    const taxable = _billingRound2_(row.qty * row.rate);
    const tax = isChallan
      ? { cgstAmt:0, sgstAmt:0, igstAmt:0 }
      : _billingCalcTaxSplit_(selectedBillTo.state, row.gstPct, taxable);
    subtotal += taxable;
    taxTotal += tax.cgstAmt + tax.sgstAmt + tax.igstAmt;
    cgstTotal += tax.cgstAmt;
    sgstTotal += tax.sgstAmt;
    igstTotal += tax.igstAmt;
    totalQty += row.qty;
  });

  const freightTax = _billingCalcFreightTax_(selectedBillTo.state, normalized.freight, documentType, normalized.freightGstPct);
  taxTotal = _billingRound2_(taxTotal + freightTax.cgstAmt + freightTax.sgstAmt + freightTax.igstAmt);
  cgstTotal = _billingRound2_(cgstTotal + freightTax.cgstAmt);
  sgstTotal = _billingRound2_(sgstTotal + freightTax.sgstAmt);
  igstTotal = _billingRound2_(igstTotal + freightTax.igstAmt);

  const grandTotal = _billingRound2_(subtotal + taxTotal + normalized.freight + normalized.packing + normalized.other);
  const manualSo = _billingCreateOrUpdateManualSalesOrder_({
    normalized: normalized,
    user: user,
    invoiceNo: invoiceNo,
    invoiceDate: invoiceDate,
    selectedBillTo: selectedBillTo,
    selectedShipTo: selectedShipTo,
    manualLines: normalized.manualLines,
    subtotal: subtotal,
    cgstTotal: cgstTotal,
    sgstTotal: sgstTotal,
    igstTotal: igstTotal,
    grandTotal: grandTotal
  });
  const optionalHeaderFields = ['document_type','currency','exchange_rate','freight','freight_gst_pct','packing','other','subtotal','tax_total','grand_total','status','billing_mode','payment_terms','remarks','transporter','vehicle_no','lr_no','eway_bill_no','direct_approval_note','total_qty','created_by','bill_to_party_id','bill_to_label','bill_to_name','bill_to_address','bill_to_gstin','bill_to_state','ship_to_party_id','ship_to_label','ship_to_name','ship_to_address','ship_to_gstin','ship_to_state'];
  optionalHeaderFields.unshift('client_name', 'client_gst', 'client_state');
  const invoiceInsert = _billingInsertWithFallback_('invoices', {
    invoice_no: invoiceNo,
    invoice_date: invoiceDate,
    document_type: documentType,
    client_code: normalized.clientCode || 'MANUAL',
    client_name: selectedBillTo.partyName || 'Manual Party',
    client_gst: selectedBillTo.gstin || '',
    client_state: selectedBillTo.state || '',
    currency: 'INR',
    exchange_rate: normalized.exchangeRate,
    freight: normalized.freight,
    freight_gst_pct: normalized.freightGstPct,
    packing: normalized.packing,
    other: normalized.other,
    subtotal: _billingRound2_(subtotal),
    tax_total: _billingRound2_(taxTotal),
    grand_total: grandTotal,
    status: 'DRAFT',
    billing_mode: 'MANUAL',
    payment_terms: normalized.paymentTerms,
    remarks: normalized.remarks,
    transporter: normalized.transporter,
    vehicle_no: normalized.vehicleNo,
    lr_no: normalized.lrNo,
    eway_bill_no: normalized.ewayBillNo,
    direct_approval_note: normalized.directApprovalNote,
    total_qty: _billingRound2_(totalQty),
    created_by: String(user.userId || user.displayName || Session.getActiveUser()?.getEmail?.() || 'user'),
    bill_to_party_id: 'MANUAL',
    bill_to_label: selectedBillTo.label || 'Manual Entry',
    bill_to_name: selectedBillTo.partyName || '',
    bill_to_address: selectedBillTo.address || '',
    bill_to_gstin: selectedBillTo.gstin || '',
    bill_to_state: selectedBillTo.state || '',
    ship_to_party_id: 'MANUAL',
    ship_to_label: selectedShipTo.label || 'Manual Entry',
    ship_to_name: selectedShipTo.partyName || '',
    ship_to_address: selectedShipTo.address || '',
    ship_to_gstin: selectedShipTo.gstin || '',
    ship_to_state: selectedShipTo.state || ''
  }, optionalHeaderFields);
  const invoice = invoiceInsert && invoiceInsert[0];
  if (!invoice?.id) throw new Error(_billingDocumentLabel_(documentType) + ' header insert failed');

  const optionalLineFields = ['so_number','line_no','unit','gst_pct','taxable_amount','source_mode','dispatch_qty_snapshot','ordered_qty_snapshot','billed_qty_snapshot'];
  manualSo.lines.forEach(function(row) {
    const tax = isChallan
      ? { cgstPct:0, sgstPct:0, igstPct:0 }
      : _billingCalcTaxSplit_(selectedBillTo.state, row.gstPct, row.taxableAmount);
    const linePayload = {
      invoice_id: invoice.id,
      so_id: row.soId,
      so_line_id: row.soLineId || null,
      so_number: row.soNumber,
      line_no: row.lineNo,
      product_code: row.productCode,
      product_name: row.productName,
      hsn: row.hsn,
      unit: row.unit,
      qty: row.qty,
      rate: row.rate,
      gst_pct: isChallan ? 0 : row.gstPct,
      taxable_amount: row.taxableAmount,
      line_amount: row.taxableAmount,
      cgst_pct: tax.cgstPct,
      sgst_pct: tax.sgstPct,
      igst_pct: tax.igstPct,
      cgst_amt: isChallan ? 0 : row.cgstAmt,
      sgst_amt: isChallan ? 0 : row.sgstAmt,
      igst_amt: isChallan ? 0 : row.igstAmt,
      line_total: isChallan ? row.taxableAmount : row.lineTotal,
      source_mode: 'MANUAL',
      dispatch_qty_snapshot: 0,
      ordered_qty_snapshot: row.qty,
      billed_qty_snapshot: 0
    };
    _billingInsertWithFallback_('invoice_lines', linePayload, optionalLineFields);
  });
  return { ok:true, invoiceId: invoice.id, invoiceNo: invoiceNo, documentType: documentType, status:'DRAFT', printUrl:_billingBuildPrintUrl_(invoice.id, token, documentType) };
}

function billingListInvoices(params, token) {
  _billingRequireSession_(token);
  const p = params || {};
  const fast = _billingListInvoicesFast_(p, token);
  if (fast && fast.ok) {
    const fastRows = fast.rows || [];
    const needsMeta = fastRows.some(function(row) {
      return !Number(row.lineCount || 0) && !String(row.productPreview || '').trim();
    });
    if (needsMeta) {
      const meta = _billingBuildInvoiceRegisterMeta_(fastRows.map(function(row) { return row.id; }));
      fast.rows = _billingEnrichRegisterClientNames_(fastRows.map(function(row) {
        const extra = meta[String(row.id || '')] || {};
        return Object.assign({}, row, {
          billToName: row.billToName || row.bill_to_name || '',
          billingMode: row.billingMode || extra.derivedBillingMode || 'UNKNOWN',
          totalQty: row.totalQty || extra.totalQty || 0,
          lineCount: row.lineCount || extra.lineCount || 0,
          productPreview: row.productPreview || extra.productPreview || ''
        });
      }));
    } else {
      const needsClientEnrichment = fastRows.some(function(row) {
        return !String(row.clientName || '').trim();
      });
      fast.rows = needsClientEnrichment ? _billingEnrichRegisterClientNames_(fastRows) : fastRows;
    }
    return fast;
  }
  const dateFrom = String(p.dateFrom || '').trim();
  const dateTo = String(p.dateTo || '').trim();
  const status = String(p.status || '').trim().toUpperCase();
  const q = String(p.q || '').trim().toLowerCase();
  const filters = {};
  if (dateFrom) filters.invoice_date = 'gte.' + dateFrom;
  if (dateTo) filters.invoice_date = 'lte.' + dateTo;
  if (status && status !== 'ALL') filters.status = 'eq.' + status;
  const rows = _billingSelectInvoiceRegisterRows_(filters, 'invoice_date.desc,created_at.desc,id.desc', 200);
  const filtered = rows.filter(function(row) {
    const invDate = String(row.invoice_date || '');
    if (dateFrom && invDate && invDate < dateFrom) return false;
    if (dateTo && invDate && invDate > dateTo) return false;
    if (status && status !== 'ALL' && String(row.status || '').toUpperCase() !== status) return false;
    if (q) {
      const text = [
        row.invoice_no,
        row.client_code,
        row.client_name,
        row.status,
        row.invoice_date
      ].join(' ').toLowerCase();
      if (text.indexOf(q) === -1) return false;
    }
    return true;
  }).sort(function(a, b) {
    const dateA = String(a.invoice_date || '');
    const dateB = String(b.invoice_date || '');
    if (dateA !== dateB) return dateA < dateB ? 1 : -1;
    const timeA = String(a.posted_at || a.created_at || '');
    const timeB = String(b.posted_at || b.created_at || '');
    if (timeA !== timeB) return timeA < timeB ? 1 : -1;
    return String(a.id || '') < String(b.id || '') ? 1 : -1;
  });
  const meta = _billingBuildInvoiceRegisterMeta_(filtered.map(function(row) { return row.id; }));
  return {
    ok: true,
    rows: _billingEnrichRegisterClientNames_(filtered.map(function(row) {
      const extra = meta[String(row.id || '')] || {};
      return {
        id: row.id,
        invoiceNo: row.invoice_no || '',
        invoiceDate: row.invoice_date || '',
        documentType: _billingInferDocumentType_(row),
        clientCode: row.client_code || '',
        clientName: row.client_name || '',
        billToName: row.bill_to_name || '',
        status: row.status || '',
        billingMode: row.billing_mode || extra.derivedBillingMode || 'UNKNOWN',
        totalQty: _billingRound2_(row.total_qty || extra.totalQty),
        lineCount: extra.lineCount || 0,
        productPreview: extra.productPreview || '',
        remarks: row.remarks || '',
        subtotal: _billingRound2_(row.subtotal),
        taxTotal: _billingRound2_(row.tax_total),
        grandTotal: _billingRound2_(row.grand_total),
        postedAt: row.posted_at || '',
        printUrl: _billingBuildPrintUrl_(row.id, token, row.document_type || row.invoice_no || '')
      };
    }))
  };
}

function deleteInvoiceDraft(invoiceId, token) {
  _requireModuleAccess_(token, 'BILLING', 'can_edit');
  if (!invoiceId) throw new Error('InvoiceId required');

  const inv = (supabaseSelect('invoices', {
    filters: { id: 'eq.' + invoiceId },
    limit: 1
  }) || [])[0];
  if (!inv) throw new Error('Invoice not found');
  const lines = supabaseSelect('invoice_lines', {
    filters: { invoice_id: 'eq.' + invoiceId }
  }) || [];
  if (String(inv.status || '').toUpperCase() === 'POSTED') {
    throw new Error('Posted invoice cannot be deleted.');
  }

  const manualSoIds = [...new Set(lines.map(function(row) {
    return String(row.so_id || '').trim();
  }).filter(Boolean))];
  let manualSoMap = {};
  if (manualSoIds.length) {
    (_supabaseSelectByKeyInBatches_('sales_orders', 'id,so_number,order_prefix,sales_type', 'id', manualSoIds) || []).forEach(function(row) {
      const isManual = String(row.order_prefix || '').toUpperCase() === 'MB' || String(row.sales_type || '').toUpperCase() === 'MANUAL_BILLING';
      if (isManual) manualSoMap[String(row.id || '')] = row;
    });
  }

  try { supabaseDelete('invoice_audit_log', { invoice_id: 'eq.' + invoiceId }); } catch (err) {}
  supabaseDelete('invoice_lines', { invoice_id: 'eq.' + invoiceId });
  supabaseDelete('invoices', { id: 'eq.' + invoiceId });

  Object.keys(manualSoMap).forEach(function(soId) {
    try {
      supabaseDelete('sales_order_lines', { so_id: 'eq.' + soId });
    } catch (err) {}
    try {
      supabaseDelete('sales_orders', { id: 'eq.' + soId });
    } catch (err) {}
  });

  return { ok: true, invoiceId: invoiceId };
}

function billingGetInvoiceEditor(invoiceId, token) {
  _billingRequireSession_(token);
  if (!invoiceId) throw new Error('InvoiceId required');
  const payload = _invLoadInvoice_(invoiceId);
  const inv = payload.inv || {};
  const lines = payload.lines || [];
  const lineRows = lines.map(function(row) {
    return {
      soLineId: String(row.so_line_id || '').trim(),
      qty: _billingRound2_(row.qty),
      rate: _billingRound2_(row.rate),
      gstPct: _billingRound2_(row.gst_pct),
      sourceMode: _billingNormalizeMode_(row.source_mode || inv.billing_mode || 'DISPATCH')
    };
  }).filter(function(row) { return row.soLineId && String(row.sourceMode || '').toUpperCase() !== 'MANUAL'; });
  const manualLines = lines.map(function(row, idx) {
    return {
      lineNo: Number(row.line_no || idx + 1),
      productCode: row.product_code || '',
      productName: row.product_name || '',
      hsn: row.hsn || '',
      unit: row.unit || 'Nos',
      qty: _billingRound2_(row.qty),
      rate: _billingRound2_(row.rate),
      gstPct: _billingRound2_(row.gst_pct)
    };
  }).filter(function(row) {
    return row.productName || row.productCode || row.qty || row.rate;
  });
  return {
    ok: true,
    invoiceId: inv.id,
    invoiceNo: inv.invoice_no || '',
    documentType: _billingInferDocumentType_(inv),
    status: inv.status || '',
    clientCode: inv.client_code || '',
    billToId: String(inv.bill_to_party_id || (inv.bill_to_address ? 'MANUAL' : '')).trim(),
    billToLabel: inv.bill_to_label || '',
    billToName: inv.bill_to_name || '',
    billToAddress: inv.bill_to_address || '',
    billToGstin: inv.bill_to_gstin || '',
    billToState: inv.bill_to_state || '',
    shipToId: String(inv.ship_to_party_id || (inv.ship_to_address ? 'MANUAL' : '')).trim(),
    shipToLabel: inv.ship_to_label || '',
    shipToName: inv.ship_to_name || '',
    shipToAddress: inv.ship_to_address || '',
    shipToGstin: inv.ship_to_gstin || '',
    shipToState: inv.ship_to_state || '',
    billingMode: _billingNormalizeMode_(inv.billing_mode || 'DISPATCH'),
    invoiceDate: inv.invoice_date || '',
    paymentTerms: inv.payment_terms || '',
    remarks: inv.remarks || '',
    transporter: inv.transporter || '',
    vehicleNo: inv.vehicle_no || '',
    lrNo: inv.lr_no || '',
    ewayBillNo: inv.eway_bill_no || '',
    directApprovalNote: inv.direct_approval_note || '',
    freight: _billingRound2_(inv.freight),
    freightGstPct: _billingResolveFreightGstPct_(inv, lines, _billingInferDocumentType_(inv)),
    packing: _billingRound2_(inv.packing),
    other: _billingRound2_(inv.other),
    lines: lineRows,
    manualLines: manualLines,
    printUrl: _billingBuildPrintUrl_(inv.id, token, inv.document_type || inv.invoice_no || '')
  };
}

function updateInvoiceDraft(invoiceId, payload, token) {
  const user = _requireModuleAccess_(token, 'BILLING', 'can_edit');
  if (!invoiceId) throw new Error('InvoiceId required');
  const existing = _invLoadInvoice_(invoiceId);
  const inv = existing.inv || {};
  if (String(inv.status || '').toUpperCase() === 'POSTED') {
    throw new Error('Posted invoice cannot be edited.');
  }

  const normalized = _billingValidateCreatePayload_(payload, token, user);
  const documentType = normalized.documentType || _billingInferDocumentType_(inv);
  const isChallan = documentType === 'CHALLAN';
  if (normalized.mode === 'MANUAL') {
    return _billingUpdateManualInvoiceDraft_(invoiceId, inv, normalized, token);
  }
  const dataset = _billingBuildDatasetRows_({
    clientCode: normalized.clientCode,
    mode: normalized.mode,
    onlyOpen: false
  });
  const rowMap = {};
  (dataset.rows || []).forEach(function(row) {
    rowMap[String(row.soLineId)] = row;
  });
  const currentQtyMap = {};
  (existing.lines || []).forEach(function(row) {
    const key = String(row.so_line_id || '').trim();
    if (!key) return;
    currentQtyMap[key] = _billingRound2_(_billingToNumber_(currentQtyMap[key]) + _billingToNumber_(row.qty));
  });
  const clientMap = _billingSelectClientsByCodes_([normalized.clientCode]);
  const client = clientMap[normalized.clientCode];
  if (!client) throw new Error('Customer not found for billing.');
  const addressChoices = _billingBuildAddressChoices_(client, (_billingSelectClientPartiesByClients_([client])[normalized.clientCode] || []));
  const selectedBillTo = (normalized.billToId || inv.bill_to_party_id) === 'MANUAL'
    ? _billingNormalizeManualAddress_('BILL_TO', normalized.manualBillTo || {
        partyName: inv.bill_to_name,
        address: inv.bill_to_address,
        gstin: inv.bill_to_gstin,
        state: inv.bill_to_state
      }, client)
    : _billingResolveSelectedAddress_(normalized.billToId || inv.bill_to_party_id, addressChoices.billToOptions, addressChoices.defaultBillTo);
  const selectedShipTo = (normalized.shipToId || inv.ship_to_party_id) === 'MANUAL'
    ? _billingNormalizeManualAddress_('SHIP_TO', normalized.manualShipTo || {
        partyName: inv.ship_to_name,
        address: inv.ship_to_address,
        gstin: inv.ship_to_gstin,
        state: inv.ship_to_state
      }, client)
    : _billingResolveSelectedAddress_(normalized.shipToId || inv.ship_to_party_id, addressChoices.shipToOptions, addressChoices.defaultShipTo);
  if (!selectedBillTo) throw new Error('Select a Bill To address before saving the invoice.');
  if (!selectedShipTo) throw new Error('Select a Ship To address before saving the invoice.');

  let subtotal = 0;
  let taxTotal = 0;
  let totalQty = 0;
  const lineInserts = [];

  normalized.lines.forEach(function(entry) {
    const row = rowMap[entry.soLineId];
    if (!row) throw new Error('Billing line not found or no longer available: ' + entry.soLineId);
    const effectiveRate = _billingRound2_(entry.rate > 0 ? entry.rate : row.rate);
    const effectiveGstPct = isChallan ? 0 : _billingRound2_(entry.gstPct != null ? entry.gstPct : row.gstPct);
    const taxable = _billingRound2_(entry.qty * effectiveRate);
    const tax = isChallan
      ? { cgstPct:0, sgstPct:0, igstPct:0, cgstAmt:0, sgstAmt:0, igstAmt:0 }
      : _billingCalcTaxSplit_(selectedBillTo.state || client.state, effectiveGstPct, taxable);
    const lineTotal = _billingRound2_(taxable + tax.cgstAmt + tax.sgstAmt + tax.igstAmt);
    subtotal += taxable;
    taxTotal += tax.cgstAmt + tax.sgstAmt + tax.igstAmt;
    totalQty += entry.qty;
    lineInserts.push({
      invoice_id: invoiceId,
      so_id: row.soId,
      so_line_id: row.soLineId,
      so_number: row.soNumber,
      line_no: row.lineNo,
      product_code: row.productCode,
      product_name: row.productName,
      hsn: row.hsn,
      unit: row.unit,
      qty: _billingRound2_(entry.qty),
      rate: effectiveRate,
      gst_pct: effectiveGstPct,
      taxable_amount: taxable,
      line_amount: taxable,
      cgst_pct: tax.cgstPct,
      sgst_pct: tax.sgstPct,
      igst_pct: tax.igstPct,
      cgst_amt: tax.cgstAmt,
      sgst_amt: tax.sgstAmt,
      igst_amt: tax.igstAmt,
      line_total: lineTotal,
      source_mode: entry.sourceMode,
      dispatch_qty_snapshot: row.dispatchedQty,
      ordered_qty_snapshot: row.orderQty,
      billed_qty_snapshot: row.billedQty
    });
  });

  const freightTax = _billingCalcFreightTax_(selectedBillTo.state || client.state, normalized.freight, documentType, normalized.freightGstPct);
  taxTotal = _billingRound2_(taxTotal + freightTax.cgstAmt + freightTax.sgstAmt + freightTax.igstAmt);

  const optionalHeaderFields = [
    'document_type',
    'currency',
    'exchange_rate',
    'freight',
    'freight_gst_pct',
    'packing',
    'other',
    'subtotal',
    'tax_total',
    'grand_total',
    'status',
    'client_name',
    'client_gst',
    'client_state',
    'billing_mode',
    'payment_terms',
    'remarks',
    'transporter',
    'vehicle_no',
    'lr_no',
    'eway_bill_no',
    'direct_approval_note',
    'total_qty',
    'bill_to_party_id',
    'bill_to_label',
    'bill_to_name',
    'bill_to_address',
    'bill_to_gstin',
    'bill_to_state',
    'ship_to_party_id',
    'ship_to_label',
    'ship_to_name',
    'ship_to_address',
    'ship_to_gstin',
    'ship_to_state'
  ];
  const grandTotal = _billingRound2_(subtotal + taxTotal + normalized.freight + normalized.packing + normalized.other);
  _billingUpdateWithFallback_('invoices', { id: 'eq.' + invoiceId }, {
    invoice_date: normalized.invoiceDate.toISOString().slice(0, 10),
    document_type: documentType,
    client_code: normalized.clientCode,
    client_name: client.client_name || normalized.clientCode,
    client_gst: client.gstin || '',
    client_state: client.state || '',
    currency: inv.currency || 'INR',
    exchange_rate: normalized.exchangeRate,
    freight: normalized.freight,
    freight_gst_pct: normalized.freightGstPct,
    packing: normalized.packing,
    other: normalized.other,
    subtotal: _billingRound2_(subtotal),
    tax_total: _billingRound2_(taxTotal),
    grand_total: grandTotal,
    status: 'DRAFT',
    billing_mode: normalized.mode,
    payment_terms: normalized.paymentTerms,
    remarks: normalized.remarks,
    transporter: normalized.transporter,
    vehicle_no: normalized.vehicleNo,
    lr_no: normalized.lrNo,
    eway_bill_no: normalized.ewayBillNo,
    direct_approval_note: normalized.directApprovalNote,
    total_qty: _billingRound2_(totalQty),
    bill_to_party_id: selectedBillTo.id || null,
    bill_to_label: selectedBillTo.label || null,
    bill_to_name: selectedBillTo.partyName || client.client_name || normalized.clientCode,
    bill_to_address: selectedBillTo.address || '',
    bill_to_gstin: selectedBillTo.gstin || client.gstin || '',
    bill_to_state: selectedBillTo.state || client.state || '',
    ship_to_party_id: selectedShipTo.id || null,
    ship_to_label: selectedShipTo.label || null,
    ship_to_name: selectedShipTo.partyName || client.client_name || normalized.clientCode,
    ship_to_address: selectedShipTo.address || '',
    ship_to_gstin: selectedShipTo.gstin || client.gstin || '',
    ship_to_state: selectedShipTo.state || client.state || ''
  }, optionalHeaderFields);

  supabaseDelete('invoice_lines', { invoice_id: 'eq.' + invoiceId });
  const optionalLineFields = [
    'so_number',
    'line_no',
    'unit',
    'gst_pct',
    'taxable_amount',
    'source_mode',
    'dispatch_qty_snapshot',
    'ordered_qty_snapshot',
    'billed_qty_snapshot'
  ];
  lineInserts.forEach(function(row) {
    _billingInsertWithFallback_('invoice_lines', row, optionalLineFields);
  });

  return {
    ok: true,
    invoiceId: invoiceId,
    invoiceNo: inv.invoice_no || '',
    documentType: documentType,
    status: 'DRAFT',
    printUrl: _billingBuildPrintUrl_(invoiceId, token, documentType)
  };
}

function _billingUpdateManualInvoiceDraft_(invoiceId, inv, normalized, token) {
  const documentType = normalized.documentType || _billingInferDocumentType_(inv);
  const isChallan = documentType === 'CHALLAN';
  const clientMap = normalized.clientCode ? _billingSelectClientsByCodes_([normalized.clientCode]) : {};
  const client = normalized.clientCode ? (clientMap[normalized.clientCode] || null) : null;
  const addressChoices = client ? _billingBuildAddressChoices_(client, (_billingSelectClientPartiesByClients_([client])[normalized.clientCode] || [])) : { billToOptions: [], shipToOptions: [], defaultBillTo: null, defaultShipTo: null };
  const selectedBillTo = (normalized.billToId || inv.bill_to_party_id) === 'MANUAL' || !client
    ? _billingNormalizeManualAddress_('BILL_TO', normalized.manualBillTo || { partyName: inv.bill_to_name, address: inv.bill_to_address, gstin: inv.bill_to_gstin, state: inv.bill_to_state }, client || { client_name:'', client_code:'', pan_no:'', payment_terms:'' })
    : _billingResolveSelectedAddress_(normalized.billToId || inv.bill_to_party_id, addressChoices.billToOptions, addressChoices.defaultBillTo);
  const selectedShipTo = (normalized.shipToId || inv.ship_to_party_id) === 'MANUAL' || !client
    ? _billingNormalizeManualAddress_('SHIP_TO', normalized.manualShipTo || { partyName: inv.ship_to_name, address: inv.ship_to_address, gstin: inv.ship_to_gstin, state: inv.ship_to_state }, client || { client_name:'', client_code:'', pan_no:'', payment_terms:'' })
    : _billingResolveSelectedAddress_(normalized.shipToId || inv.ship_to_party_id, addressChoices.shipToOptions, addressChoices.defaultShipTo);
  if (!selectedBillTo) throw new Error('Select or enter a Bill To address.');
  if (!selectedShipTo) throw new Error('Select or enter a Ship To address.');

  let subtotal = 0;
  let taxTotal = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;
  let totalQty = 0;
  normalized.manualLines.forEach(function(row, idx) {
    const taxable = _billingRound2_(row.qty * row.rate);
    const tax = isChallan
      ? { cgstAmt:0, sgstAmt:0, igstAmt:0 }
      : _billingCalcTaxSplit_(selectedBillTo.state, row.gstPct, taxable);
    subtotal += taxable;
    taxTotal += tax.cgstAmt + tax.sgstAmt + tax.igstAmt;
    cgstTotal += tax.cgstAmt;
    sgstTotal += tax.sgstAmt;
    igstTotal += tax.igstAmt;
    totalQty += row.qty;
  });

  const freightTax = _billingCalcFreightTax_(selectedBillTo.state, normalized.freight, documentType, normalized.freightGstPct);
  taxTotal = _billingRound2_(taxTotal + freightTax.cgstAmt + freightTax.sgstAmt + freightTax.igstAmt);
  cgstTotal = _billingRound2_(cgstTotal + freightTax.cgstAmt);
  sgstTotal = _billingRound2_(sgstTotal + freightTax.sgstAmt);
  igstTotal = _billingRound2_(igstTotal + freightTax.igstAmt);

  const optionalHeaderFields = ['document_type','currency','exchange_rate','freight','freight_gst_pct','packing','other','subtotal','tax_total','grand_total','status','client_name','client_gst','client_state','billing_mode','payment_terms','remarks','transporter','vehicle_no','lr_no','eway_bill_no','direct_approval_note','total_qty','bill_to_party_id','bill_to_label','bill_to_name','bill_to_address','bill_to_gstin','bill_to_state','ship_to_party_id','ship_to_label','ship_to_name','ship_to_address','ship_to_gstin','ship_to_state'];
  const grandTotal = _billingRound2_(subtotal + taxTotal + normalized.freight + normalized.packing + normalized.other);
  _billingUpdateWithFallback_('invoices', { id: 'eq.' + invoiceId }, {
    invoice_date: normalized.invoiceDate.toISOString().slice(0, 10),
    document_type: documentType,
    client_code: normalized.clientCode || 'MANUAL',
    client_name: selectedBillTo.partyName || 'Manual Party',
    client_gst: selectedBillTo.gstin || '',
    client_state: selectedBillTo.state || '',
    currency: inv.currency || 'INR',
    exchange_rate: normalized.exchangeRate,
    freight: normalized.freight,
    freight_gst_pct: normalized.freightGstPct,
    packing: normalized.packing,
    other: normalized.other,
    subtotal: _billingRound2_(subtotal),
    tax_total: _billingRound2_(taxTotal),
    grand_total: grandTotal,
    status: 'DRAFT',
    billing_mode: 'MANUAL',
    payment_terms: normalized.paymentTerms,
    remarks: normalized.remarks,
    transporter: normalized.transporter,
    vehicle_no: normalized.vehicleNo,
    lr_no: normalized.lrNo,
    eway_bill_no: normalized.ewayBillNo,
    direct_approval_note: normalized.directApprovalNote,
    total_qty: _billingRound2_(totalQty),
    bill_to_party_id: 'MANUAL',
    bill_to_label: selectedBillTo.label || 'Manual Entry',
    bill_to_name: selectedBillTo.partyName || '',
    bill_to_address: selectedBillTo.address || '',
    bill_to_gstin: selectedBillTo.gstin || '',
    bill_to_state: selectedBillTo.state || '',
    ship_to_party_id: 'MANUAL',
    ship_to_label: selectedShipTo.label || 'Manual Entry',
    ship_to_name: selectedShipTo.partyName || '',
    ship_to_address: selectedShipTo.address || '',
    ship_to_gstin: selectedShipTo.gstin || '',
    ship_to_state: selectedShipTo.state || ''
  }, optionalHeaderFields);

  const reusableManualSo = _billingExtractReusableManualSo_(_invLoadInvoice_(invoiceId).lines || []);
  const manualSo = _billingCreateOrUpdateManualSalesOrder_({
    soId: reusableManualSo.soId,
    soNumber: reusableManualSo.soNumber,
    normalized: normalized,
    invoiceNo: inv.invoice_no || '',
    invoiceDate: normalized.invoiceDate.toISOString().slice(0, 10),
    selectedBillTo: selectedBillTo,
    selectedShipTo: selectedShipTo,
    manualLines: normalized.manualLines,
    subtotal: subtotal,
    cgstTotal: cgstTotal,
    sgstTotal: sgstTotal,
    igstTotal: igstTotal,
    grandTotal: grandTotal
  });
  supabaseDelete('invoice_lines', { invoice_id: 'eq.' + invoiceId });
  const optionalLineFields = ['so_number','line_no','unit','gst_pct','taxable_amount','source_mode','dispatch_qty_snapshot','ordered_qty_snapshot','billed_qty_snapshot'];
  manualSo.lines.forEach(function(row) {
    const tax = isChallan
      ? { cgstPct:0, sgstPct:0, igstPct:0 }
      : _billingCalcTaxSplit_(selectedBillTo.state, row.gstPct, row.taxableAmount);
    const linePayload = {
      invoice_id: invoiceId,
      so_id: row.soId,
      so_line_id: row.soLineId || null,
      so_number: row.soNumber,
      line_no: row.lineNo,
      product_code: row.productCode,
      product_name: row.productName,
      hsn: row.hsn,
      unit: row.unit,
      qty: row.qty,
      rate: row.rate,
      gst_pct: isChallan ? 0 : row.gstPct,
      taxable_amount: row.taxableAmount,
      line_amount: row.taxableAmount,
      cgst_pct: tax.cgstPct,
      sgst_pct: tax.sgstPct,
      igst_pct: tax.igstPct,
      cgst_amt: isChallan ? 0 : row.cgstAmt,
      sgst_amt: isChallan ? 0 : row.sgstAmt,
      igst_amt: isChallan ? 0 : row.igstAmt,
      line_total: isChallan ? row.taxableAmount : row.lineTotal,
      source_mode: 'MANUAL',
      dispatch_qty_snapshot: 0,
      ordered_qty_snapshot: row.qty,
      billed_qty_snapshot: 0
    };
    _billingInsertWithFallback_('invoice_lines', linePayload, optionalLineFields);
  });
  return { ok:true, invoiceId: invoiceId, invoiceNo: inv.invoice_no || '', documentType: documentType, status:'DRAFT', printUrl:_billingBuildPrintUrl_(invoiceId, token, documentType) };
}

function previewInvoicePDF(invoiceId, token, options) {
  _billingRequireSession_(token);
  if (!invoiceId) throw new Error('InvoiceId required');
  let inv = {};
  try {
    inv = (supabaseSelect('invoices', {
      select: 'id,invoice_no,document_type',
      filters: { id: 'eq.' + invoiceId },
      limit: 1
    }) || [])[0] || {};
  } catch (err) {
    inv = (supabaseSelect('invoices', {
      select: 'id,invoice_no',
      filters: { id: 'eq.' + invoiceId },
      limit: 1
    }) || [])[0] || {};
  }
  return _billingBuildPrintUrl_(invoiceId, token, inv.document_type || inv.invoice_no || '', options || {});
}


function _invLoadInvoice_(invoiceId) {
  const inv = supabaseSelect('invoices', {
    filters: { id: 'eq.' + invoiceId },
    limit: 1
  })[0];

  if (!inv) throw new Error('Invoice not found');

  const lines = supabaseSelect('invoice_lines', {
    filters: { invoice_id: 'eq.' + invoiceId }
  });

  if (!lines.length) throw new Error('Invoice has no lines');

  return { inv, lines };
}

function postInvoice(invoiceId) {
  const token = arguments.length > 1 ? arguments[1] : '';
  _requireModuleAccess_(token, 'BILLING', 'can_edit');
  if (!invoiceId) throw new Error('InvoiceId required');

  const { inv, lines } = _invLoadInvoice_(invoiceId);
  const documentType = _billingInferDocumentType_(inv);
  const label = _billingDocumentLabel_(documentType);
  if (String(inv.status || '').toUpperCase() === 'POSTED') {
    throw new Error(label + ' already posted');
  }

  const calcSubtotal = _billingRound2_(lines.reduce(function(sum, row) {
    return sum + _billingToNumber_(row.line_amount || row.taxable_amount);
  }, 0));
  const calcLineTax = _billingRound2_(lines.reduce(function(sum, row) {
    return sum + _billingToNumber_(row.cgst_amt) + _billingToNumber_(row.sgst_amt) + _billingToNumber_(row.igst_amt);
  }, 0));
  const storedSubtotal = _billingRound2_(inv.subtotal);
  const storedTax = _billingRound2_(inv.tax_total);
  const storedGrand = _billingRound2_(inv.grand_total);
  let billToState = String(inv.bill_to_state || inv.client_state || '').trim();
  if (!billToState && String(inv.client_code || '').trim()) {
    const clientMap = _billingSelectClientsByCodes_([inv.client_code]);
    billToState = String((clientMap[String(inv.client_code)] || {}).state || '').trim();
  }
  const freightGstPct = _billingResolveFreightGstPct_(inv, lines, documentType);
  const inferredFreight = storedGrand > 0
    ? Math.max(_billingRound2_(storedGrand - calcSubtotal - (storedTax || calcLineTax)), 0)
    : _billingRound2_(inv.freight);
  const freight = _billingRound2_(_billingToNumber_(inv.freight) || inferredFreight);
  const freightTax = _billingCalcFreightTax_(billToState, freight, documentType, freightGstPct);
  const calcTax = _billingRound2_(calcLineTax + freightTax.cgstAmt + freightTax.sgstAmt + freightTax.igstAmt);
  const grandTotal = _billingRound2_(calcSubtotal + calcTax + freight);

  _billingUpdateWithFallback_('invoices', { id: 'eq.' + invoiceId }, {
    subtotal: calcSubtotal,
    tax_total: calcTax,
    grand_total: grandTotal,
    freight: freight,
    freight_gst_pct: freightGstPct,
    status: 'POSTED',
    posted_at: new Date().toISOString()
  }, ['subtotal','tax_total','grand_total','freight','freight_gst_pct','posted_at']);

  try {
    supabaseInsert('invoice_audit_log', {
      invoice_id: invoiceId,
      action: 'POSTED',
      actor: Session.getActiveUser()?.getEmail?.() || 'system',
      remarks: 'Posted after totals reconciliation | stored subtotal: ' + storedSubtotal + ' | stored tax: ' + storedTax + ' | stored grand: ' + storedGrand
    });
  } catch (err) {}

  return {
    ok: true,
    invoiceId: invoiceId,
    invoiceNo: inv.invoice_no,
    documentType: documentType,
    pdfUrl: _billingBuildPrintUrl_(invoiceId, token, documentType),
    status: 'POSTED'
  };
}

function billingGetInvoicePrintData(invoiceId, token) {
  _billingRequireSession_(token);
  if (!invoiceId) throw new Error('InvoiceId required');

  const payload = _invLoadInvoice_(invoiceId);
  const inv = payload.inv || {};
  const documentType = _billingInferDocumentType_(inv);
  const lines = payload.lines || [];
  const company = _billingCompanyProfile_();
  const soIds = [...new Set(lines.map(function(row){ return row.so_id; }).filter(Boolean))];
  const soMap = {};
  if (soIds.length) {
    try {
      (_supabaseSelectByKeyInBatches_(
        'sales_orders',
        'id,so_number,so_date,po_number,po_date,remarks,client_code,mode_of_transport,transport_preference,transport_payment,billing_remarks',
        'id',
        soIds
      ) || []).forEach(function(row) {
        soMap[String(row.id)] = _salesOrderEnrichHeaderRow_(row);
      });
    } catch (err) {
      const msg = String((err && err.message) || '');
      const missingNewCols =
        msg.indexOf('sales_orders.mode_of_transport') !== -1 ||
        msg.indexOf('sales_orders.transport_preference') !== -1 ||
        msg.indexOf('sales_orders.transport_payment') !== -1 ||
        msg.indexOf('sales_orders.billing_remarks') !== -1;
      if (!missingNewCols) throw err;
      (_supabaseSelectByKeyInBatches_(
        'sales_orders',
        'id,so_number,so_date,po_number,po_date,remarks,client_code',
        'id',
        soIds
      ) || []).forEach(function(row) {
        soMap[String(row.id)] = _salesOrderEnrichHeaderRow_(row);
      });
    }
  }
  const clientMap = _billingSelectClientsByCodes_([inv.client_code]);
  const client = clientMap[String(inv.client_code || '')] || {};
  const addressChoices = _billingBuildAddressChoices_(client, (_billingSelectClientPartiesByClients_(client && client.id ? [client] : [])[String(inv.client_code || '')] || []));
  const selectedBillTo = _billingResolveSelectedAddress_(inv.bill_to_party_id, addressChoices.billToOptions, addressChoices.defaultBillTo);
  const selectedShipTo = _billingResolveSelectedAddress_(inv.ship_to_party_id, addressChoices.shipToOptions, addressChoices.defaultShipTo);
  const soLineIds = [...new Set(lines.map(function(row){ return row.so_line_id; }).filter(Boolean))];
  const dispatchMap = _billingGetDispatchRowsByLineIds_(soLineIds);

  const printLines = lines.map(function(row, idx) {
    const so = soMap[String(row.so_id)] || {};
    const dispatch = dispatchMap[String(row.so_line_id)] || {};
    const qty = _billingRound2_(row.qty);
    const rate = _billingRound2_(row.rate);
    const taxable = _billingRound2_(row.line_amount || row.taxable_amount);
    const total = _billingRound2_(row.line_total);
    return {
      srNo: idx + 1,
      soNumber: row.so_number || so.so_number || '',
      soDate: so.so_date || '',
      lineNo: row.line_no || '',
      productCode: row.product_code || '',
      productName: row.product_name || '',
      hsn: row.hsn || '',
      qty: qty,
      unit: row.unit || '',
      rate: rate,
      taxable: taxable,
      gstPct: _billingRound2_(row.gst_pct || _billingToNumber_(row.cgst_pct) + _billingToNumber_(row.sgst_pct) + _billingToNumber_(row.igst_pct)),
      cgstAmt: _billingRound2_(row.cgst_amt),
      sgstAmt: _billingRound2_(row.sgst_amt),
      igstAmt: _billingRound2_(row.igst_amt),
      total: total,
      dispatchNo: dispatch.latestDispatchNo || '',
      dispatchDate: dispatch.latestDispatchDate || ''
    };
  });

  const poRefs = [...new Set(Object.keys(soMap).map(function(key){
    const row = soMap[key];
    return row && row.po_number ? row.po_number : '';
  }).filter(Boolean))];
  const soNumbers = [...new Set(printLines.map(function(row){ return row.soNumber; }).filter(Boolean))];
  const soHeaders = Object.keys(soMap).map(function(key){ return soMap[key]; }).filter(Boolean);
  const summarizeField = function(key) {
    const values = [...new Set(soHeaders.map(function(row) {
      return String(row && row[key] || '').trim();
    }).filter(Boolean))];
    if (!values.length) return '';
    return values.join(' | ');
  };
  const subtotal = _billingRound2_(printLines.reduce(function(sum, row){ return sum + row.taxable; }, 0));
  let cgst = _billingRound2_(printLines.reduce(function(sum, row){ return sum + row.cgstAmt; }, 0));
  let sgst = _billingRound2_(printLines.reduce(function(sum, row){ return sum + row.sgstAmt; }, 0));
  let igst = _billingRound2_(printLines.reduce(function(sum, row){ return sum + row.igstAmt; }, 0));
  const savedGrandTotal = _billingRound2_(inv.grand_total);
  const savedFreight = _billingRound2_(inv.freight);
  const savedTaxTotal = _billingRound2_(inv.tax_total);
  const derivedFreight = Math.max(_billingRound2_(savedGrandTotal - subtotal - (savedTaxTotal || (cgst + sgst + igst))), 0);
  const charges = {
    freight: savedFreight || derivedFreight,
    packing: 0,
    other: 0
  };
  const freightGstPct = _billingResolveFreightGstPct_(inv, lines, documentType);
  const freightTax = _billingCalcFreightTax_(
    inv.bill_to_state || (selectedBillTo && selectedBillTo.state) || inv.client_state || client.state || '',
    charges.freight,
    documentType,
    freightGstPct
  );
  cgst = _billingRound2_(cgst + freightTax.cgstAmt);
  sgst = _billingRound2_(sgst + freightTax.sgstAmt);
  igst = _billingRound2_(igst + freightTax.igstAmt);
  const recalculatedGrandTotal = _billingRound2_(subtotal + cgst + sgst + igst + charges.freight);
  const grandTotal = Math.abs(savedGrandTotal - recalculatedGrandTotal) <= 0.01
    ? savedGrandTotal
    : recalculatedGrandTotal;

  return {
    ok: true,
    company: company,
    invoice: {
      id: inv.id,
      documentType: documentType,
      documentLabel: _billingDocumentLabel_(documentType),
      invoiceNo: inv.invoice_no || '',
      invoiceDate: inv.invoice_date || '',
      status: inv.status || '',
      billingMode: inv.billing_mode || '',
      paymentTerms: inv.payment_terms || '',
      remarks: inv.remarks || '',
      transporter: inv.transporter || '',
      vehicleNo: inv.vehicle_no || '',
      lrNo: inv.lr_no || '',
      ewayBillNo: inv.eway_bill_no || '',
      totalQty: _billingRound2_(inv.total_qty || printLines.reduce(function(sum, row){ return sum + row.qty; }, 0))
    },
    customer: {
      code: inv.client_code || '',
      name: inv.client_name || client.client_name || '',
      gstin: inv.client_gst || client.gstin || '',
      state: inv.client_state || client.state || '',
      panNo: client.pan_no || '',
      paymentTerms: inv.payment_terms || client.payment_terms || '',
      address: inv.bill_to_address || (selectedBillTo ? selectedBillTo.address : _clientComposeAddress_(client.bill_to_address || client.address, client.bill_to_city || client.city, client.bill_to_state || client.state, client.bill_to_pincode || client.pincode)),
      shipToAddress: inv.ship_to_address || (selectedShipTo ? selectedShipTo.address : _clientComposeAddress_(client.ship_to_address, client.ship_to_city, client.ship_to_state, client.ship_to_pincode)),
      billTo: {
        id: String(inv.bill_to_party_id || (selectedBillTo && selectedBillTo.id) || '').trim(),
        label: inv.bill_to_label || (selectedBillTo && selectedBillTo.label) || '',
        name: inv.bill_to_name || (selectedBillTo && selectedBillTo.partyName) || inv.client_name || client.client_name || '',
        address: inv.bill_to_address || (selectedBillTo && selectedBillTo.address) || '',
        gstin: inv.bill_to_gstin || (selectedBillTo && selectedBillTo.gstin) || inv.client_gst || client.gstin || '',
        state: inv.bill_to_state || (selectedBillTo && selectedBillTo.state) || client.state || ''
      },
      shipTo: {
        id: String(inv.ship_to_party_id || (selectedShipTo && selectedShipTo.id) || '').trim(),
        label: inv.ship_to_label || (selectedShipTo && selectedShipTo.label) || '',
        name: inv.ship_to_name || (selectedShipTo && selectedShipTo.partyName) || inv.client_name || client.client_name || '',
        address: inv.ship_to_address || (selectedShipTo && selectedShipTo.address) || '',
        gstin: inv.ship_to_gstin || (selectedShipTo && selectedShipTo.gstin) || client.gstin || '',
        state: inv.ship_to_state || (selectedShipTo && selectedShipTo.state) || client.state || ''
      }
    },
    references: {
      soNumbers: soNumbers,
      poNumbers: poRefs,
      poDates: [...new Set(Object.keys(soMap).map(function(key){ return soMap[key]?.po_date || ''; }).filter(Boolean))],
      modeOfTransport: summarizeField('mode_of_transport'),
      transportPreference: summarizeField('transport_preference'),
      transportPayment: summarizeField('transport_payment'),
      billingRemarks: summarizeField('billing_remarks'),
      salesRemarks: summarizeField('remarks')
    },
    lines: printLines,
    totals: {
      subtotal: subtotal,
      cgst: cgst,
      sgst: sgst,
      igst: igst,
      freight: charges.freight,
      freightGstPct: freightGstPct,
      packing: charges.packing,
      other: charges.other,
      grandTotal: grandTotal,
      amountInWords: amountInWords(grandTotal)
    }
  };
}

function amountInWords(num) {
  const a = ['', 'One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten',
    'Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const b = ['', '', 'Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];

  function inWords(n) {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n/10)] + (n%10 ? ' ' + a[n%10] : '');
    if (n < 1000) return a[Math.floor(n/100)] + ' Hundred ' + inWords(n%100);
    if (n < 100000) return inWords(Math.floor(n/1000)) + ' Thousand ' + inWords(n%1000);
    if (n < 10000000) return inWords(Math.floor(n/100000)) + ' Lakh ' + inWords(n%100000);
    return inWords(Math.floor(n/10000000)) + ' Crore ' + inWords(n%10000000);
  }

  return inWords(Math.floor(num)).trim() + ' Only';
}

function savePackingBulk(entries){

  if(!entries?.length)
    throw new Error('No packing entries');

  const packIds = [...new Set(entries.map(e => e.packId).filter(Boolean))];
  const boardRows = packIds.length
    ? (supabaseSelect('v_packing_board',{
        filters:{ pack_id:'in.(' + packIds.join(',') + ')' }
      }) || [])
    : [];
  const boardMap = {};
  boardRows.forEach(row => {
    boardMap[String(row.pack_id)] = row;
  });

  const packedAt = new Date().toISOString();
  const packedBy = Session.getActiveUser()?.getEmail?.()||'user';
  const updates = [];

  entries.forEach(e=>{
    const row = boardMap[String(e.packId)];
    if(!row)
      throw new Error('Packing row not found');

    const producedQty = Number(row.produced_qty||0);
    const packedQty = Number(row.packed_qty||0);
    const balance = producedQty - packedQty;
    const qty = Number(e.packedQty||0);

    if(qty<=0) return;

    if(qty>balance)
      throw new Error('Packing exceeds produced qty');

    updates.push({
      id: e.packId,
      packed_qty: packedQty + qty,
      ready_to_dispatch: e.ready || false,
      packed_by: packedBy,
      packed_at: packedAt
    });
  });

  if (updates.length) {
    supabaseUpsertMinimal('packing_records', updates, { onConflict: 'id' });
    _opsBumpDatasetVersion_();
    _invBumpStockSnapshotVersion_();
  }

  return {ok:true};

}

function saveDispatchBulk(entries){

  if(!entries?.length)
    throw new Error('No dispatch entries');

  const dispatchNo =
  supabaseRpc('get_next_dispatch_no',{})?.[0]?.get_next_dispatch_no;

  if(!dispatchNo)
    throw new Error('Dispatch number failed');

  const packIds = [...new Set(entries.map(e => e.packId).filter(Boolean))];
  const packRows = packIds.length
    ? (supabaseSelect('packing_records',{
        filters:{ id:'in.(' + packIds.join(',') + ')' }
      }) || [])
    : [];
  const packMap = {};
  packRows.forEach(row => {
    packMap[String(row.id)] = row;
  });

  const soLineIds = [...new Set(packRows.map(row => row.so_line_id).filter(Boolean))];
  const existingDispatchRows = soLineIds.length
    ? (supabaseSelect('dispatch_records',{
        select:'so_line_id,dispatch_qty',
        filters:{ so_line_id:'in.(' + soLineIds.join(',') + ')' }
      }) || [])
    : [];
  const dispatchedTotals = {};
  existingDispatchRows.forEach(row => {
    const key = String(row.so_line_id);
    dispatchedTotals[key] = (dispatchedTotals[key] || 0) + Number(row.dispatch_qty || 0);
  });

  const createdAt = new Date().toISOString();
  const createdBy = Session.getActiveUser()?.getEmail?.()||'user';
  const inserts = [];

  entries.forEach(e=>{
    const pack = packMap[String(e.packId)];
    if(!pack)
      throw new Error('Packing record not found');

    const lineKey = String(pack.so_line_id);
    const balance = Number(pack.packed_qty||0) - Number(dispatchedTotals[lineKey] || 0);
    const qty = Number(e.dispatchQty||0);

    if(qty<=0) return;

    if(qty>balance)
      throw new Error('Dispatch exceeds packed qty');

    dispatchedTotals[lineKey] = Number(dispatchedTotals[lineKey] || 0) + qty;

    inserts.push({
      dispatch_no:dispatchNo,
      so_id: pack.so_id,
      so_line_id: pack.so_line_id,
      so_number: pack.so_number,
      line_no: pack.line_no,
      product_code: pack.product_code,
      product_name: pack.product_name,
      packed_qty: pack.packed_qty,
      dispatch_qty: qty,
      transporter:e.transporter||'',
      lr_no:e.lrNo||'',
      vehicle_no:e.vehicleNo||'',
      dispatch_date:e.dispatchDate||createdAt,
      created_by:createdBy,
      created_at:createdAt
    });
  });

  if (inserts.length) {
    supabaseBulkInsertMinimal('dispatch_records', inserts);
    _opsBumpDatasetVersion_();
    _invBumpStockSnapshotVersion_();
  }

  return {ok:true,dispatchNo};

}

/****************************************************
 * PRODUCTION ENGINE — CLEAN STAGE FLOW VERSION
 ****************************************************/

function _prodNormalizeCategoryGroup_(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  if (raw.indexOf('FLEXO') !== -1) return 'FLEXO';
  if (raw.indexOf('CORR') !== -1) return 'CORRUGATION';
  if (raw.indexOf('OFFSET') !== -1) return 'OFFSET';
  if (raw.indexOf('DIGITAL') !== -1) return 'DIGITAL';
  return raw;
}

function _prodIsRecognizedDepartmentCategory_(value) {
  const raw = String(value || '').trim().toUpperCase();
  return raw === 'FLEXO' || raw === 'CORRUGATION' || raw === 'OFFSET' || raw === 'DIGITAL';
}

function _prodRecognizeDepartmentCategory_(value) {
  const normalized = _prodNormalizeCategoryGroup_(value);
  return _prodIsRecognizedDepartmentCategory_(normalized) ? normalized : '';
}

function _prodPickDepartmentCategory_(candidates) {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  for (let i = 0; i < list.length; i += 1) {
    const normalized = _prodRecognizeDepartmentCategory_(list[i]);
    if (normalized) return normalized;
  }
  return '';
}

function _prodFormatCategoryGroupLabel_(value) {
  const v = _prodNormalizeCategoryGroup_(value);
  if (v === 'FLEXO') return 'Flexo';
  if (v === 'CORRUGATION') return 'Corrugation';
  if (v === 'OFFSET') return 'Offset';
  if (v === 'DIGITAL') return 'Digital';
  return value || 'Other';
}

function _prodNormalizeProcessName_(value, categoryGroup) {
  const raw = String(value || '').trim();
  const upper = raw.toUpperCase();
  const category = _prodNormalizeCategoryGroup_(categoryGroup || '');
  if (!raw) return '';
  if (category === 'DIGITAL' && upper.indexOf('DIGITAL') !== -1) return 'Printing';
  if (category === 'FLEXO') {
    if (upper.indexOf('INSPECTION') !== -1 || upper.indexOf('SLITTING') !== -1) return 'Inspection/Slitting';
    if (upper.indexOf('DIE SHEET') !== -1) return 'Flexo Die Sheeting';
    if (upper.indexOf('FLEXO PRINT') !== -1 || upper.indexOf('ONLINE GOLD FOIL') !== -1 || upper.indexOf('ONLINE SILVER FOIL') !== -1) return 'Flexo Printing';
    if (upper.indexOf('DIE CUT') !== -1 || upper.indexOf('DIECUT') !== -1) return 'Flexo Die Cutting Offline';
  }
  if (upper === 'CORRUGATION SHEET PASTING') return 'Sheet Pasting';
  return raw;
}

function _prodIsExcludedProcess_(value) {
  const upper = String(value || '').trim().toUpperCase();
  if (!upper) return false;
  return upper === 'PACKING' ||
    upper === 'DISPATCH' ||
    upper === 'CUTTING PRE' ||
    upper === 'CUTTING POST' ||
    upper === 'QC';
}

function _prodExtractCategoryGroupFromSnapshot_(snapshot) {
  const snap = snapshot || {};
  const jobs = Array.isArray(snap.jobs) ? snap.jobs : [];
  const candidates = [
    snap?.jobDetails?.type,
    snap?.jobDetails?.category,
    snap?.category,
    snap?.departmentCategory,
    jobs[0]?.type,
    jobs[0]?.category,
    jobs[0]?.department
  ];
  return _prodPickDepartmentCategory_(candidates);
}

function _prodResolveDepartmentCategory_(snapshot, artworkCategories, jobCategories) {
  const snapshotCategory = _prodExtractCategoryGroupFromSnapshot_(snapshot);
  const artworkCategory = _prodPickDepartmentCategory_(artworkCategories || []);
  const jobCategory = _prodPickDepartmentCategory_(jobCategories || []);
  if (snapshotCategory === 'FLEXO') return 'FLEXO';
  return _prodPickDepartmentCategory_([artworkCategory, snapshotCategory, jobCategory]);
}

function _prodBuildDowntimeReason_(minutes, reason) {
  const mins = Number(minutes || 0);
  const text = String(reason || '').trim();
  if (mins > 0 && text) return mins + ' min - ' + text;
  if (mins > 0) return mins + ' min';
  return text;
}

function _prodBuildEntryNotes_(payload) {
  const parts = [];
  const soNumber = String(payload?.soNumber || '').trim();
  const lineNo = String(payload?.lineNo || '').trim();
  const jobReference = String(payload?.jobReference || '').trim();
  if (soNumber) parts.push('SO:' + soNumber);
  if (lineNo) parts.push('LINE:' + lineNo);
  if (jobReference) parts.push('JOBREF:' + jobReference);
  const start = String(payload?.startDate || '').trim();
  const end = String(payload?.endDate || '').trim();
  if (start) parts.push('START:' + start);
  if (end) parts.push('END:' + end);
  const downtime = _prodBuildDowntimeReason_(payload?.downtimeMinutes, payload?.downtimeReason);
  if (downtime) parts.push('DOWN:' + downtime);
  return parts.join(' | ');
}

function _prodHydrateEntryIdentityFromNotes_(entry) {
  const row = Object.assign({}, entry || {});
  const notes = String(row.downtime_reason || '').split('|').map(function(part) {
    return String(part || '').trim();
  }).filter(Boolean);
  notes.forEach(function(part) {
    if (!row.so_number && part.indexOf('SO:') === 0) {
      row.so_number = String(part.slice(3)).trim();
      return;
    }
    if (!row.line_no && part.indexOf('LINE:') === 0) {
      row.line_no = String(part.slice(5)).trim();
      return;
    }
    if (!row.job_reference && part.indexOf('JOBREF:') === 0) {
      row.job_reference = String(part.slice(7)).trim();
    }
  });
  return row;
}

function _prodQueueVersion_() {
  return (PropertiesService.getScriptProperties().getProperty('PROD_QUEUE_VERSION') || '0') + '|corr2ply-sheetplan-v4';
}

function _prodBumpQueueVersion_() {
  PropertiesService.getScriptProperties().setProperty('PROD_QUEUE_VERSION', String(Date.now()));
}

function _prodCacheKey_(suffix) {
  return _cacheKeyHash_('PROD_QUEUE', _prodQueueVersion_() + '|' + String(suffix || ''));
}

function _prodCachePutJsonSafe_(cache, key, value, ttlSeconds) {
  try {
    const text = JSON.stringify(value);
    if (!text || text.length > 95000) return;
    cache.put(key, text, ttlSeconds || 60);
  } catch (e) {}
}

function _prodToDateKey_(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function _prodDateInRange_(value, dateFrom, dateTo) {
  const key = _prodToDateKey_(value);
  if (!key) return true;
  if (dateFrom && key < dateFrom) return false;
  if (dateTo && key > dateTo) return false;
  return true;
}

function _prodMapFastViewRows_(rows) {
  return (rows || []).map(function(row) {
    return {
      routingId: row.routing_id,
      woDate: row.wo_date || '',
      workOrderNo: row.wo_number || '',
      soNumberDisplay: row.so_numbers || '',
      clientName: row.client_name || '',
      productName: row.product_names || '',
      artworkNo: row.artwork_nos || '',
      processName: row.process_name || '',
      department: row.department || '',
      sequence: row.sequence_no,
      plannedMachine: row.planned_machine || '',
      categoryGroup: _prodFormatCategoryGroupLabel_(row.department_category || ''),
      expectedDelivery: row.expected_delivery || '',
      jobPriority: row.job_priority || '',
      plannedQty: Number(row.planned_qty || 0),
      producedQty: Number(row.produced_qty || 0),
      balanceQty: Number(row.balance_qty || 0),
      status: String(row.status || 'PENDING'),
      woId: row.wo_id
    };
  });
}

function _prodMapStageRowsFastViewRows_(rows) {
  return (rows || []).map(function(row) {
    return {
      rowKey: String(row.row_key || ''),
      rowKind: String(row.row_kind || 'COMBINED'),
      rowDescription: row.row_description || '',
      planUnit: row.plan_unit || '',
      woId: row.wo_id,
      woDate: row.wo_date || '',
      routingId: row.routing_id,
      workOrderNo: row.wo_number || '',
      soNumber: row.so_number || '',
      soNumberDisplay: row.so_number_display || row.so_numbers || '',
      lineNo: row.line_no || '',
      jobReference: row.job_reference || '',
      jobUps: Number(row.job_ups || 0),
      clientName: row.client_name || '',
      productName: row.product_name || row.product_names || '',
      artworkNo: row.artwork_no || row.artwork_nos || '',
      processName: row.process_name || '',
      processDisplayName: row.process_display_name || row.process_name || '',
      department: row.department || '',
      sequence: row.sequence_no,
      plannedMachine: row.planned_machine || '',
      categoryGroup: _prodFormatCategoryGroupLabel_(row.department_category || ''),
      expectedDelivery: row.expected_delivery || '',
      jobPriority: row.job_priority || '',
      plannedQty: Number(row.planned_qty || 0),
      producedQty: Number(row.produced_qty || 0),
      balanceQty: Number(row.balance_qty || 0),
      status: String(row.status || 'PENDING')
    };
  });
}

function _prodIs2PlyMakingProcess_(row) {
  const name = String(row?.processName || row?.process_name || row?.processDisplayName || row?.department || '').trim().toUpperCase();
  return name.indexOf('2 PLY') !== -1 || name.indexOf('TWO PLY') !== -1 || name.indexOf('PLY MAKING') !== -1;
}

function _prodCorrRound3_(value) {
  const num = Number(value || 0);
  if (!isFinite(num)) return 0;
  return Math.round(num * 1000) / 1000;
}

function _prodCorrFluteFactor_(flute) {
  const key = String(flute || '').trim().toUpperCase();
  if (key === 'B') return 1.40;
  if (key === 'E') return 1.30;
  if (key === 'C') return 1.45;
  return 1.35;
}

function _prodCorrItemCodeFromText_(value) {
  const text = String(value || '').trim();
  const match = text.match(/^([A-Za-z0-9._/-]+)\s*[-|:]\s*(.+)$/);
  return match ? match[1].trim() : '';
}

function _prodCorrItemNameFromText_(value) {
  const text = String(value || '').trim();
  const match = text.match(/^([A-Za-z0-9._/-]+)\s*[-|:]\s*(.+)$/);
  return match ? match[2].trim() : text;
}

function _prodCorrGroupKey_(parts) {
  return [
    parts.linerItemCode || '',
    parts.linerItemName || '',
    Number(parts.linerGsm || 0).toFixed(2),
    parts.flutingItemCode || '',
    parts.flutingItemName || '',
    Number(parts.flutingGsm || 0).toFixed(2),
    String(parts.flute || '').trim().toUpperCase(),
    Number(parts.deckleMm || 0).toFixed(2),
    Number(parts.cutSizeMm || 0).toFixed(2)
  ].join('|').toUpperCase();
}

function _prodCorrSheetPlanFromSnapshot_(snapshot) {
  const snap = snapshot || {};
  const papers = Array.isArray(snap.papers) ? snap.papers : [];
  const fromPapers = papers.reduce(function(max, paper) {
    const qty = Number(paper?.sheetsWithWaste ?? paper?.requiredQty ?? paper?.coreSheets ?? paper?.sheets ?? 0);
    return qty > max ? qty : max;
  }, 0);
  if (fromPapers > 0) return fromPapers;

  const jobs = Array.isArray(snap.jobs) ? snap.jobs : [];
  const waste = Number(snap?.wastage?.processSheets || 0);
  const totalQty = jobs.reduce(function(sum, job) {
    return sum + Number(job?.qty || 0);
  }, 0);
  const groupUps = Number(
    snap?.jobDetails?.ups ||
    snap?.jobDetails?.groupUPS ||
    snap?.jobDetails?.groupUps ||
    snap?.jobDetails?.totalUps ||
    0
  ) || jobs.reduce(function(sum, job) {
    const ups = Number(job?.ups || job?.groupUps || job?.group_ups || 0);
    return sum + (ups > 0 ? ups : 0);
  }, 0);
  if (totalQty > 0 && groupUps > 0) return Math.ceil(totalQty / groupUps) + waste;

  const jobSheetValues = jobs.map(function(job) {
    return Number(job?.sheetsWithWaste || job?.requiredQty || job?.coreSheets || job?.sheets || 0);
  }).filter(function(qty) {
    return qty > 0;
  });
  if (jobSheetValues.length) {
    return jobSheetValues.reduce(function(max, qty) {
      return qty > max ? qty : max;
    }, 0);
  }

  const corrRows = Array.isArray(snap.corrugation) ? snap.corrugation : [];
  const corrSheetValues = corrRows.map(function(row) {
    return Number(row?.sheets || 0);
  }).filter(function(qty) {
    return qty > 0;
  });
  if (corrSheetValues.length) {
    return corrSheetValues.reduce(function(min, qty) {
      return min === 0 || qty < min ? qty : min;
    }, 0);
  }

  return 0;
}

function _prodBuildCorr2PlyGroupsFromSnapshot_(snapshot) {
  const allPlies = (Array.isArray(snapshot?.corrugation) ? snapshot.corrugation : []).slice().sort(function(a, b) {
    return Number(a?.plyNo || 0) - Number(b?.plyNo || 0);
  });
  // In corrugated jobs the top printed/plain sheet is not produced on the
  // 2-ply machine. Odd stacks therefore use rows after the top sheet:
  // 3 ply -> 1 set, 5 ply -> 2 sets, 7 ply -> 3 sets, 9 ply -> 4 sets.
  const plies = allPlies.length % 2 === 1 ? allPlies.slice(1) : allPlies;
  if (plies.length < 2) return [];

  const defaultSheets = _prodCorrSheetPlanFromSnapshot_(snapshot);
  const groupsByKey = {};
  const maxSetCount = Math.floor(plies.length / 2);
  // Temporary floor-entry correction: current legacy corrugation WOs can carry
  // one extra set in the saved sheet basis. Reduce the aggregate basis by one
  // set so 3/5/7/9 ply behave as 1/2/3/4 production sets respectively.
  const setSheetPlan = maxSetCount > 0
    ? Math.round((Number(defaultSheets || 0) / (maxSetCount + 1)) * 1000) / 1000
    : Number(defaultSheets || 0);

  const usedLinerIndexes = {};
  const flutedIndexes = plies.map(function(ply, index) {
    return (!!String(ply?.flute || '').trim() || ply?.hasFlute === true) ? index : -1;
  }).filter(function(index) { return index >= 0; });

  const setPairs = flutedIndexes.slice(0, maxSetCount).map(function(fluteIndex, pairIndex) {
    let linerIndex = -1;
    for (let next = fluteIndex + 1; next < plies.length; next += 1) {
      const candidate = plies[next] || {};
      if (usedLinerIndexes[next]) continue;
      if (String(candidate.flute || '').trim() || candidate.hasFlute === true) continue;
      linerIndex = next;
      break;
    }
    if (linerIndex < 0) {
      for (let prev = fluteIndex - 1; prev >= 0; prev -= 1) {
        const candidate = plies[prev] || {};
        if (usedLinerIndexes[prev]) continue;
        if (String(candidate.flute || '').trim() || candidate.hasFlute === true) continue;
        linerIndex = prev;
        break;
      }
    }
    if (linerIndex >= 0) usedLinerIndexes[linerIndex] = true;
    return {
      setNo: pairIndex + 1,
      fluting: plies[fluteIndex] || {},
      liner: linerIndex >= 0 ? (plies[linerIndex] || {}) : {}
    };
  });

  const effectivePairs = setPairs.length ? setPairs : (function() {
    const fallback = [];
    for (let i = 0; i < plies.length && fallback.length < maxSetCount; i += 2) {
      fallback.push({
        setNo: Math.floor(i / 2) + 1,
        fluting: plies[i] || {},
        liner: plies[i + 1] || {}
      });
    }
    return fallback;
  })();

  effectivePairs.forEach(function(pair) {
    const fluting = pair.fluting || {};
    const liner = pair.liner || {};
    if (!String(fluting.flute || '').trim() && !fluting.hasFlute && setPairs.length) return;
    const setNo = pair.setNo;
    const fallbackPairSheets = Math.max(
      Number(fluting.sheets || 0),
      Number(liner.sheets || 0)
    );
    const parts = {
      setNo: setNo,
      flute: fluting.flute || '',
      linerItemCode: _prodCorrItemCodeFromText_(liner.itemCode || liner.item_code || liner.itemDetails || liner.item_name || ''),
      linerItemName: _prodCorrItemNameFromText_(liner.itemDetails || liner.item_name || liner.itemName || ''),
      linerGsm: Number(liner.gsm || 0),
      flutingItemCode: _prodCorrItemCodeFromText_(fluting.itemCode || fluting.item_code || fluting.itemDetails || fluting.item_name || ''),
      flutingItemName: _prodCorrItemNameFromText_(fluting.itemDetails || fluting.item_name || fluting.itemName || ''),
      flutingGsm: Number(fluting.gsm || 0),
      deckleMm: Number(fluting.deckle || liner.deckle || 0),
      cutSizeMm: Number(fluting.cutSize || fluting.cut_size || liner.cutSize || liner.cut_size || 0),
      // 2-ply production output is board sheets per set. Corrugation rows
      // carry the job-card sheet count; requiredQty on these rows is KG.
      planQty: Number(setSheetPlan || fallbackPairSheets || 0)
    };
    const key = _prodCorrGroupKey_(parts);
    if (!groupsByKey[key]) {
      groupsByKey[key] = Object.assign({
        groupKey: key,
        setNumbers: [],
        planQty: 0
      }, parts);
    }
    groupsByKey[key].setNumbers.push(String(setNo));
    groupsByKey[key].planQty += Number(parts.planQty || 0);
  });
  return Object.keys(groupsByKey).map(function(key) {
    const group = groupsByKey[key];
    group.setNumbersText = group.setNumbers.join(', ');
    group.description = '2 Ply Set ' + group.setNumbersText + ' | ' +
      (group.flutingItemName || 'Fluting') + ' ' + (group.flutingGsm || '') + ' GSM' +
      (group.flute ? ' ' + group.flute + ' flute' : '') + ' + ' +
      (group.linerItemName || 'Liner') + ' ' + (group.linerGsm || '') + ' GSM';
    return group;
  });
}

function _prodGetCorr2PlyDetailTotals_(routingIds) {
  const ids = Array.isArray(routingIds) ? routingIds.filter(Boolean) : [];
  if (!ids.length) return {};
  try {
    const rows = _selectInBatches_(
      'corrugation_2ply_entry_details',
      'routing_id,set_group_key,produced_sheets',
      'routing_id',
      ids
    ) || [];
    const totals = {};
    rows.forEach(function(row) {
      const key = String(row.routing_id || '') + '||' + String(row.set_group_key || '');
      totals[key] = (totals[key] || 0) + Number(row.produced_sheets || 0);
    });
    return totals;
  } catch (err) {
    return {};
  }
}

function _prodExpandCorr2PlyStageRows_(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const targets = list.filter(function(row) {
    return _prodNormalizeCategoryGroup_(row.categoryGroup || row.department_category || '') === 'CORRUGATION' && _prodIs2PlyMakingProcess_(row);
  });
  if (!targets.length) return list;

  const woIds = [...new Set(targets.map(function(row) { return row.woId || row.wo_id; }).filter(Boolean))];
  const workOrders = _selectInBatches_('work_orders', 'id,snapshot_json', 'id', woIds);
  const snapshotByWoId = {};
  workOrders.forEach(function(wo) {
    snapshotByWoId[String(wo.id || '')] = wo.snapshot_json || {};
  });
  const detailTotals = _prodGetCorr2PlyDetailTotals_(targets.map(function(row) { return row.routingId || row.routing_id; }));

  const expanded = [];
  list.forEach(function(row) {
    if (!(_prodNormalizeCategoryGroup_(row.categoryGroup || row.department_category || '') === 'CORRUGATION' && _prodIs2PlyMakingProcess_(row))) {
      expanded.push(row);
      return;
    }
    const groups = _prodBuildCorr2PlyGroupsFromSnapshot_(snapshotByWoId[String(row.woId || row.wo_id)] || {});
    if (!groups.length) {
      expanded.push(Object.assign({}, row, {
        requiresCorrugation2PlyDetails: true,
        corrugation2PlyGroup: null,
        rowDescription: row.rowDescription || '2 Ply Making'
      }));
      return;
    }
    groups.forEach(function(group, index) {
      const produced = Number(detailTotals[String(row.routingId || '') + '||' + group.groupKey] || 0);
      const planned = Number(group.planQty || 0);
      expanded.push(Object.assign({}, row, {
        rowKey: String(row.routingId || '') + '||2PLY||' + group.groupKey,
        rowKind: 'CORR_2PLY',
        rowDescription: group.description,
        planUnit: 'SHEETS',
        corrugation2PlyGroup: group,
        requiresCorrugation2PlyDetails: true,
        plannedQty: planned,
        producedQty: produced,
        balanceQty: Math.max(planned - produced, 0),
        status: _prodStageStatusFromQty_(row.status, planned, produced),
        jobReference: '2PLY-' + (index + 1)
      }));
    });
  });
  return expanded;
}

function _prodGetStageRowsFastResult_(params) {
  const p = params || {};
  const categoryGroup = _prodNormalizeCategoryGroup_(p.category || '');
  const processName = String(p.processName || '').trim();
  const q = String(p.q || '').trim().toLowerCase();
  const includeCompleted = p.includeCompleted === true;
  const showPendingAll = p.showPendingAll === true;
  const dateFrom = _prodToDateKey_(p.dateFrom);
  const dateTo = _prodToDateKey_(p.dateTo);

  const filters = {};
  if (categoryGroup) filters.department_category = 'eq.' + categoryGroup;
  if (processName) filters.process_display_name = 'eq.' + processName;
  if (showPendingAll) {
    filters.status = 'not.in.(COMPLETED,SHORT_CLOSED)';
    filters.balance_qty = 'gt.0';
  } else if (dateFrom && dateTo) {
    filters.and = '(wo_date.gte.' + dateFrom + ',wo_date.lte.' + dateTo + ')';
  } else if (dateFrom) {
    filters.wo_date = 'gte.' + dateFrom;
  } else if (dateTo) {
    filters.wo_date = 'lte.' + dateTo;
  }

  const rows = _prodExpandCorr2PlyStageRows_(_prodMapStageRowsFastViewRows_(supabaseSelect('v_production_stage_rows_fast', {
    select: 'row_key,row_kind,row_description,plan_unit,wo_id,wo_date,routing_id,wo_number,so_numbers,so_number_display,so_number,line_no,job_reference,job_ups,client_name,product_name,product_names,artwork_no,artwork_nos,process_name,process_display_name,department,planned_machine,sequence_no,expected_delivery,job_priority,department_category,planned_qty,produced_qty,balance_qty,status',
    filters: filters,
    order: 'wo_date.desc,wo_number.asc,sequence_no.asc,row_sort.asc,job_sort.asc',
    limit: 10000
  }) || [])).filter(function(row) {
    return !_prodIsExcludedProcess_(row.processName || row.department || '');
  });

  const filteredRows = rows.filter(function(row) {
    if (!includeCompleted && row.status !== 'SHORT_CLOSED' && Number(row.balanceQty || 0) <= 0) return false;
    if (!q) return true;
    return [
      row.workOrderNo,
      row.soNumberDisplay,
      row.clientName,
      row.productName,
      row.processDisplayName || row.processName,
      row.categoryGroup,
      row.artworkNo
    ].join(' ').toLowerCase().indexOf(q) !== -1;
  });

  const processOptions = [...new Set(rows.map(function(row) {
    return String(row.processDisplayName || row.processName || '').trim();
  }).filter(Boolean))].sort();

  return {
    ok: true,
    processOptions: processOptions,
    rows: filteredRows,
    summary: {
      totalRows: filteredRows.length,
      pendingQty: filteredRows.reduce(function(sum, row){ return sum + Number(row.balanceQty || 0); }, 0),
      inProgressRows: filteredRows.filter(function(row){ return Number(row.producedQty || 0) > 0 && Number(row.balanceQty || 0) > 0; }).length,
      shortClosedRows: filteredRows.filter(function(row){ return String(row.status || '').toUpperCase() === 'SHORT_CLOSED'; }).length
    }
  };
}

function _prodGetStageRowsForWoFast_(woId) {
  return _prodExpandCorr2PlyStageRows_(_prodMapStageRowsFastViewRows_(supabaseSelect('v_production_stage_rows_fast', {
    select: 'row_key,row_kind,row_description,plan_unit,wo_id,wo_date,routing_id,wo_number,so_numbers,so_number_display,so_number,line_no,job_reference,job_ups,client_name,product_name,product_names,artwork_no,artwork_nos,process_name,process_display_name,department,planned_machine,sequence_no,expected_delivery,job_priority,department_category,planned_qty,produced_qty,balance_qty,status',
    filters: { wo_id: 'eq.' + woId },
    order: 'sequence_no.asc,row_sort.asc,job_sort.asc',
    limit: 5000
  }) || [])).filter(function(row) {
    return !_prodIsExcludedProcess_(row.processName || row.department || '');
  });
}

function _prodGetCandidateWoIdsFromFastView_(params) {
  const p = params || {};
  const categoryGroup = _prodNormalizeCategoryGroup_(p.category || '');
  const processName = String(p.processName || '').trim();
  const showPendingAll = p.showPendingAll === true;
  const dateFrom = _prodToDateKey_(p.dateFrom);
  const dateTo = _prodToDateKey_(p.dateTo);

  try {
    const filters = {};
    if (categoryGroup) filters.department_category = 'eq.' + categoryGroup;
    if (showPendingAll) {
      filters.status = 'not.in.(COMPLETED,SHORT_CLOSED)';
      filters.balance_qty = 'gt.0';
    } else if (dateFrom && dateTo) {
      filters.and = '(wo_date.gte.' + dateFrom + ',wo_date.lte.' + dateTo + ')';
    } else if (dateFrom) {
      filters.wo_date = 'gte.' + dateFrom;
    } else if (dateTo) {
      filters.wo_date = 'lte.' + dateTo;
    }

    const rows = supabaseSelect('v_production_stage_queue_fast', {
      select: 'wo_id,department_category,process_name,wo_date,status,balance_qty,sequence_no',
      filters: filters,
      order: 'wo_date.desc,sequence_no.asc',
      limit: 10000
    }) || [];

    const filteredRows = rows.filter(function(row) {
      if (_prodIsExcludedProcess_(row.process_name || row.department || '')) return false;
      if (!processName) return true;
      return _prodNormalizeProcessName_(row.process_name || '', row.department_category || '') === processName;
    });

    return {
      woIds: [...new Set(filteredRows.map(function(row) {
        return String(row.wo_id || '').trim();
      }).filter(Boolean))],
      processOptions: [...new Set(rows.filter(function(row) {
        return !_prodIsExcludedProcess_(row.process_name || row.department || '');
      }).map(function(row) {
        return _prodNormalizeProcessName_(row.process_name || '', row.department_category || '');
      }).filter(Boolean))].sort()
    };
  } catch (err) {
    return null;
  }
}

function prodGetCategories(token) {
  _requireModuleAccess_(token, 'PRODUCTION', 'can_view');
  return ['Flexo', 'Corrugation', 'Offset', 'Digital'];
}

function prodGetCorrugationInventoryItems(token) {
  _requireModuleAccess_(token, 'PRODUCTION', 'can_view');
  const cache = CacheService.getScriptCache();
  const cacheKey = _prodCacheKey_('corr_inventory_items');
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);
  const rows = supabaseSelect('inv_items', {
    select: 'item_code,item_name,uom,department,category',
    filters: { department: 'ilike.*CORRUGATION*' },
    order: 'item_name.asc',
    limit: 500
  }) || [];
  const result = rows.map(function(row) {
    return {
      itemCode: row.item_code || '',
      itemName: row.item_name || '',
      uom: row.uom || '',
      department: row.department || '',
      category: row.category || ''
    };
  }).filter(function(row) {
    return row.itemCode || row.itemName;
  });
  _prodCachePutJsonSafe_(cache, cacheKey, result, 600);
  return result;
}

function prodGetStageQueue(params, token) {
  _requireModuleAccess_(token, 'PRODUCTION', 'can_view');
  _prodGetStoreIssuedPlanForWo_._cache = {};

  const p = params || {};
  const categoryGroup = _prodNormalizeCategoryGroup_(p.category || '');
  const processName = String(p.processName || '').trim();
  const q = String(p.q || '').trim().toLowerCase();
  const includeCompleted = p.includeCompleted === true;
  const showPendingAll = p.showPendingAll === true;
  const dateFrom = _prodToDateKey_(p.dateFrom);
  const dateTo = _prodToDateKey_(p.dateTo);
  const cache = CacheService.getScriptCache();
  const cacheKey = _prodCacheKey_(JSON.stringify({
    fn: 'stage_queue',
    category: categoryGroup,
    processName: processName,
    q: q,
    includeCompleted: includeCompleted,
    showPendingAll: showPendingAll,
    dateFrom: dateFrom,
    dateTo: dateTo
  }));
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  try {
    const fastResult = _prodGetStageRowsFastResult_(p);
    _prodCachePutJsonSafe_(cache, cacheKey, fastResult, 60);
    return fastResult;
  } catch (err) {}

  const candidateFromView = _prodGetCandidateWoIdsFromFastView_(p);
  let filteredWoIds = candidateFromView && candidateFromView.woIds && candidateFromView.woIds.length
    ? candidateFromView.woIds.map(String)
    : [];

  let workOrders = [];
  let woMap = {};

  if (filteredWoIds.length) {
    workOrders = _selectInBatches_('work_orders', 'id,wo_number,wo_date,snapshot_json', 'id', filteredWoIds);
    workOrders.forEach(function(row) {
      woMap[String(row.id)] = row;
    });
    filteredWoIds = filteredWoIds.filter(function(id) {
      return !!woMap[String(id)];
    });
  } else {
    const woFilters = {};
    if (!showPendingAll && dateFrom && dateTo) {
      woFilters.and = '(wo_date.gte.' + dateFrom + ',wo_date.lte.' + dateTo + ')';
    } else if (!showPendingAll && dateFrom) {
      woFilters.wo_date = 'gte.' + dateFrom;
    } else if (!showPendingAll && dateTo) {
      woFilters.wo_date = 'lte.' + dateTo;
    }
    workOrders = supabaseSelect('work_orders', {
      select: 'id,wo_number,wo_date,snapshot_json',
      filters: Object.keys(woFilters).length ? woFilters : undefined,
      order: 'wo_date.desc'
    }) || [];
    workOrders.forEach(function(row) {
      woMap[String(row.id)] = row;
    });
    filteredWoIds = workOrders.map(function(row) {
      return String(row.id || '');
    }).filter(Boolean);
  }

  if (!filteredWoIds.length) {
    return {
      ok: true,
      processOptions: [],
      rows: [],
      summary: { totalRows: 0, pendingQty: 0, inProgressRows: 0, shortClosedRows: 0 }
    };
  }

  const workOrderJobs = _filterSalesServiceOnlyItems_(_selectInBatches_(
    'work_order_jobs',
    'wo_id,so_number,line_no,product_name,qty,category,artwork_no,client_name,job_priority,expected_delivery,ups,group_ups,job_reference',
    'wo_id',
    filteredWoIds
  ));
  if (!workOrderJobs.length) {
    const empty = {
      ok: true,
      processOptions: [],
      rows: [],
      summary: { totalRows: 0, pendingQty: 0, inProgressRows: 0, shortClosedRows: 0 }
    };
    _prodCachePutJsonSafe_(cache, cacheKey, empty, 30);
    return empty;
  }

  const artworkNos = [...new Set(workOrderJobs.map(function(row){ return row.artwork_no; }).filter(Boolean))];
  const artworkRows = artworkNos.length
    ? _supabaseSelectByKeyInBatches_('artworks', 'artwork_no,product_type', 'artwork_no', artworkNos)
    : [];
  const artworkCategoryByNo = {};
  artworkRows.forEach(function(row) {
    const category = _prodRecognizeDepartmentCategory_(row.product_type || '');
    if (!category) return;
    artworkCategoryByNo[String(row.artwork_no || '')] = category;
  });

  const routingRows = _selectInBatches_(
    'work_order_routing',
    'id,wo_id,sequence_no,process_name,department,status,planned_machine',
    'wo_id',
    filteredWoIds,
    'sequence_no.asc'
  ).filter(function(row) {
    return !_prodIsExcludedProcess_(row.process_name || row.department || '');
  });

  const jobsByWoId = {};
  const categoryByWoId = {};
  workOrderJobs.forEach(function(job) {
    const key = String(job.wo_id || '');
    if (filteredWoIds.indexOf(job.wo_id) === -1) return;
    if (!jobsByWoId[key]) jobsByWoId[key] = [];
    jobsByWoId[key].push(job);
  });
  filteredWoIds.forEach(function(woId) {
    woId = String(woId);
    const jobs = jobsByWoId[woId] || [];
    const artworkCategories = jobs.map(function(job) {
      return artworkCategoryByNo[String(job.artwork_no || '')] || '';
    }).filter(Boolean);
    const recognizedJobCategories = jobs.map(function(job) {
      return _prodRecognizeDepartmentCategory_(job.category || '');
    }).filter(Boolean);
    categoryByWoId[woId] = _prodResolveDepartmentCategory_(
      woMap[woId].snapshot_json,
      artworkCategories,
      recognizedJobCategories
    );
  });

  const categoryFilteredRouting = routingRows.filter(function(row) {
    if (!categoryGroup) return true;
    return categoryByWoId[String(row.wo_id)] === categoryGroup;
  });

  const processOptions = (candidateFromView && candidateFromView.processOptions && candidateFromView.processOptions.length)
    ? candidateFromView.processOptions.slice()
    : [...new Set(categoryFilteredRouting.map(function(row) {
        const woId = String(row.wo_id || '');
        return _prodNormalizeProcessName_(row.process_name || '', categoryByWoId[woId]);
      }).filter(Boolean))].sort();

  const processFilteredRouting = categoryFilteredRouting.filter(function(row) {
    if (!processName) return true;
    const woId = String(row.wo_id || '');
    return _prodNormalizeProcessName_(row.process_name || '', categoryByWoId[woId]) === processName;
  });

  let rows = _prodBuildStageRowsFromData_(filteredWoIds, woMap, routingRows, jobsByWoId, categoryByWoId).filter(function(row) {
    if (_prodIsExcludedProcess_(row.processName || row.department || '')) return false;
    if (processName && _prodNormalizeProcessName_(row.processDisplayName || row.processName || '', row.categoryGroup) !== processName) return false;
    if (showPendingAll && (String(row.status || '').toUpperCase() === 'COMPLETED' || String(row.status || '').toUpperCase() === 'SHORT_CLOSED')) return false;
    if (!includeCompleted && row.status !== 'SHORT_CLOSED' && Number(row.balanceQty || 0) <= 0) return false;
    if (!q) return true;
    return [
      row.workOrderNo,
      row.soNumberDisplay,
      row.clientName,
      row.productName,
      row.processDisplayName || row.processName,
      row.categoryGroup
    ].join(' ').toLowerCase().indexOf(q) !== -1;
  });

  rows.sort(function(a, b) {
    const aClosed = String(a.status || '').toUpperCase() === 'SHORT_CLOSED' ? 1 : 0;
    const bClosed = String(b.status || '').toUpperCase() === 'SHORT_CLOSED' ? 1 : 0;
    if (aClosed !== bClosed) return aClosed - bClosed;
    if (Number(a.balanceQty || 0) !== Number(b.balanceQty || 0)) return Number(b.balanceQty || 0) - Number(a.balanceQty || 0);
    return String(a.workOrderNo || '').localeCompare(String(b.workOrderNo || ''));
  });

  const result = {
    ok: true,
    processOptions: processOptions,
    rows: rows,
    summary: {
      totalRows: rows.length,
      pendingQty: rows.reduce(function(sum, row){ return sum + Number(row.balanceQty || 0); }, 0),
      inProgressRows: rows.filter(function(row){ return Number(row.producedQty || 0) > 0 && Number(row.balanceQty || 0) > 0; }).length,
      shortClosedRows: rows.filter(function(row){ return String(row.status || '').toUpperCase() === 'SHORT_CLOSED'; }).length
    }
  };
  _prodCachePutJsonSafe_(cache, cacheKey, result, 60);
  return result;
}

/* ==============================
   1️⃣ PROCESS LIST
================================= */

/* ==============================
   🔧 HELPER — GET STAGE PRODUCTION TOTAL
================================= */

function _getStageProducedTotal(routingId) {

  const entries = supabaseSelect('production_entries', {
    select: 'produced_qty,rejected_qty,ok_qty',
    filters: { routing_id: 'eq.' + routingId }
  }) || [];

  return entries.reduce((s, e) =>
    s + _getProductionEntryGoodQty_(e), 0);
}

function _getStageProducedTotalFromMap_(producedTotals, routingId) {
  return Number((producedTotals || {})[String(routingId)] || 0);
}

function _getProductionEntryGoodQty_(entry) {
  const okQty = Number(entry?.ok_qty);
  if (!isNaN(okQty) && okQty >= 0) return okQty;
  const produced = Number(entry?.produced_qty || 0);
  const rejected = Number(entry?.rejected_qty || 0);
  return Math.max(produced - rejected, 0);
}

function _getProductionEntryGrossQty_(entry) {
  return Math.max(Number(entry?.produced_qty || 0), 0);
}

function _prodGetStoreIssuedPlanForWo_(wo, snapshot, targetUomOverride) {
  const woNumber = String(wo?.wo_number || wo?.woNo || wo?.woNumber || '').trim();
  if (!woNumber) return 0;
  const snap = snapshot || wo?.snapshot_json || {};
  const categoryGroup = _prodExtractCategoryGroupFromSnapshot_(snap);
  const targetUom = String(targetUomOverride || '').trim().toUpperCase() || (categoryGroup === 'FLEXO' ? 'RM' : 'SHEET');
  const cacheKey = woNumber + '|' + targetUom;
  _prodGetStoreIssuedPlanForWo_._cache = _prodGetStoreIssuedPlanForWo_._cache || {};
  if (Object.prototype.hasOwnProperty.call(_prodGetStoreIssuedPlanForWo_._cache, cacheKey)) {
    return _prodGetStoreIssuedPlanForWo_._cache[cacheKey];
  }
  const rows = supabaseSelect('inv_ledger', {
    select: 'id,remarks,qty_out',
    filters: {
      ref_type: 'eq.ISSUE',
      ref_no: 'eq.' + woNumber
    },
    limit: 5000
  }) || [];
  if (!rows.length) {
    _prodGetStoreIssuedPlanForWo_._cache[cacheKey] = 0;
    return 0;
  }

  const reversalMap = invGetReversalSummaryMap_(rows.map(function(row) {
    return row.id;
  }));
  const flexoTotalRm = Number(
    snap?.flexoDetails?.totalRunningMeter ||
    snap?.flexoDetails?.baseRunningMeter ||
    0
  );
  const flexoRequiredKg = Number(snap?.flexoDetails?.requiredKg || 0);
  function flexoKgToRm(qtyKg) {
    let kg = Number(qtyKg || 0);
    if (!(kg > 0) || !(flexoTotalRm > 0) || !(flexoRequiredKg > 0)) return 0;
    // Some legacy issue rows carry grams while the material key still says KG.
    // Normalize only when the /1000 value is close to the WO required KG.
    if (kg > flexoRequiredKg * 20 && (kg / 1000) <= flexoRequiredKg * 2.5) {
      kg = kg / 1000;
    }
    const rm = (kg * flexoTotalRm) / flexoRequiredKg;
    return rm > flexoTotalRm * 5 ? flexoTotalRm : rm;
  }
  const issuedQty = rows.reduce(function(sum, row) {
    if (reversalMap[String(row.id || '')]?.reversed === true) return sum;
    const parsed = parseStoredWOMaterialKey_(row.remarks || '');
    const uom = String(parsed.uom || '').trim().toUpperCase();
    const qtyOut = Number(row.qty_out || 0);
    if (targetUom === 'RM') {
      if (['RM', 'R.M.', 'RUNNING METER', 'RUNNING METERS'].indexOf(uom) !== -1) {
        return sum + qtyOut;
      }
      if (categoryGroup === 'FLEXO' && ['KG', 'KGS', 'KILOGRAM', 'KILOGRAMS'].indexOf(uom) !== -1) {
        return sum + flexoKgToRm(qtyOut);
      }
      return sum;
    }
    const isTargetUom = ['SHEET', 'SHEETS'].indexOf(uom) !== -1;
    if (!isTargetUom) return sum;
    return sum + qtyOut;
  }, 0);
  _prodGetStoreIssuedPlanForWo_._cache[cacheKey] = issuedQty;
  return issuedQty;
}

function _getStage1PlannedQtyFromSnapshot_(snapshot, wo, targetUomOverride) {
  const issuedPlan = _prodGetStoreIssuedPlanForWo_(wo || {}, snapshot || {}, targetUomOverride);

  const papers = Array.isArray(snapshot?.papers) ? snapshot.papers : [];
  const jobs = Array.isArray(snapshot?.jobs) ? snapshot.jobs : [];
  const waste = Number(snapshot?.wastage?.processSheets || 0);
  const categoryGroup = _prodExtractCategoryGroupFromSnapshot_(snapshot);
  const preferRunningMeter = String(targetUomOverride || '').trim().toUpperCase() === 'RM' || categoryGroup === 'FLEXO';

  if (preferRunningMeter) {
    const flexoPlan = Number(
      snapshot?.flexoDetails?.totalRunningMeter ||
      snapshot?.flexoDetails?.baseRunningMeter ||
      0
    );
    if (flexoPlan > 0 || issuedPlan > 0) return Math.max(flexoPlan, issuedPlan);
  }

  if (issuedPlan > 0) return issuedPlan;

  // Combined-sheet stages must start from the shared paper plan, not summed job quantities.
  const totalPaperSheetsWithWaste = papers.reduce(function(sum, paper) {
    const withWaste = Number(
      paper?.sheetsWithWaste ??
      paper?.requiredQty ??
      0
    );
    return sum + (withWaste > 0 ? withWaste : 0);
  }, 0);
  if (totalPaperSheetsWithWaste > 0) return totalPaperSheetsWithWaste;

  const totalPaperCoreSheets = papers.reduce(function(sum, paper) {
    const coreSheets = Number(
      paper?.coreSheets ??
      paper?.sheets ??
      0
    );
    return sum + (coreSheets > 0 ? coreSheets : 0);
  }, 0);
  if (totalPaperCoreSheets > 0) return totalPaperCoreSheets + waste;

  if (categoryGroup === 'FLEXO') {
    const flexoPlan = Number(
      snapshot?.flexoDetails?.totalRunningMeter ||
      snapshot?.flexoDetails?.baseRunningMeter ||
      0
    );
    if (flexoPlan > 0) return flexoPlan;
  }

  const totalQty = jobs.reduce(function(sum, job) {
    return sum + Number(job?.qty || 0);
  }, 0);
  const groupUps = Number(snapshot?.jobDetails?.ups || 0) || jobs.reduce(function(sum, job) {
    const ups = Number(job?.ups || job?.groupUps || 0);
    return sum + (ups > 0 ? ups : 0);
  }, 0);
  if (totalQty > 0 && groupUps > 0) {
    return Math.ceil(totalQty / groupUps) + waste;
  }

  const totalCore = jobs.reduce(function(sum, job) {
    return sum + Number(job?.coreSheets || 0);
  }, 0);
  return totalCore + waste;
}

function _getProductionUpsFactorFromSnapshot_(snapshot) {
  const papers = Array.isArray(snapshot?.papers) ? snapshot.papers : [];
  const jobs = Array.isArray(snapshot?.jobs) ? snapshot.jobs : [];
  const explicitUps = jobs.reduce(function(sum, job) {
    const ups = Number(job?.ups || job?.groupUps || 0);
    return sum + (ups > 0 ? ups : 0);
  }, 0);
  if (explicitUps > 0) return explicitUps;

  const totalQty = jobs.reduce(function(sum, job) {
    return sum + Number(job?.qty || 0);
  }, 0);
  const totalPaperCore = papers.reduce(function(sum, paper) {
    const coreSheets = Number(
      paper?.coreSheets ??
      paper?.sheets ??
      0
    );
    return sum + (coreSheets > 0 ? coreSheets : 0);
  }, 0);
  if (totalQty > 0 && totalPaperCore > 0) return totalQty / totalPaperCore;
  const totalCore = jobs.reduce(function(sum, job) {
    return sum + Number(job?.coreSheets || 0);
  }, 0);
  if (totalQty > 0 && totalCore > 0) return totalQty / totalCore;
  return 1;
}

function _isSheetBasedProductionStage_(routingRow) {
  const name = String(routingRow?.process_name || routingRow?.department || '').trim().toUpperCase();
  if (!name) return false;
  return name.indexOf('PRINT') !== -1 ||
    name.indexOf('LAMINAT') !== -1 ||
    name.indexOf('COAT') !== -1 ||
    name.indexOf('DIE CUT') !== -1 ||
    name.indexOf('DIECUT') !== -1 ||
    name.indexOf('2 PLY') !== -1 ||
    name.indexOf('TWO PLY') !== -1 ||
    name.indexOf('PLY MAKING') !== -1 ||
    name.indexOf('CORRUGATION SHEET PASTING') !== -1 ||
    name.indexOf('SHEET PASTING') !== -1 ||
    _isInspectionSlittingProductionStage_(routingRow);
}

function _isInspectionSlittingProductionStage_(routingRow) {
  const name = String(routingRow?.process_name || routingRow?.department || '').trim().toUpperCase();
  return name.indexOf('INSPECTION') !== -1 || name.indexOf('SLITTING') !== -1;
}

function _isDieCutProductionStage_(routingRow) {
  const name = String(routingRow?.process_name || routingRow?.department || '').trim().toUpperCase();
  return name.indexOf('DIE CUT') !== -1 || name.indexOf('DIECUT') !== -1;
}

function _isFlexoOfflineDieCutProductionStage_(routingRow, categoryGroup) {
  const category = _prodNormalizeCategoryGroup_(categoryGroup || routingRow?.department_category || routingRow?.categoryGroup || '');
  const name = String(routingRow?.process_name || routingRow?.department || routingRow?.processDisplayName || '').trim().toUpperCase();
  const isFlexoFlow = category === 'FLEXO' || name.indexOf('FLEXO') !== -1;
  return isFlexoFlow &&
    (name.indexOf('DIE CUT') !== -1 || name.indexOf('DIECUT') !== -1) &&
    name.indexOf('DIE SHEET') === -1;
}

function _prodIsJobSplitDieCutStage_(routingRow, categoryGroup) {
  return _isDieCutProductionStage_(routingRow) &&
    !_isFlexoOfflineDieCutProductionStage_(routingRow, categoryGroup);
}

function _prodFindJobSplitIndex_(routingList, categoryGroup) {
  const list = Array.isArray(routingList) ? routingList : [];
  return list.findIndex(function(row) {
    return _prodIsJobSplitDieCutStage_(row, categoryGroup);
  });
}

function _isSheetQuantityProductionStage_(routingRow) {
  const name = String(routingRow?.process_name || routingRow?.department || '').trim().toUpperCase();
  return _isDieCutProductionStage_(routingRow) ||
    name.indexOf('DIE SHEET') !== -1 ||
    name.indexOf('2 PLY') !== -1 ||
    name.indexOf('TWO PLY') !== -1 ||
    name.indexOf('PLY MAKING') !== -1 ||
    name.indexOf('CORRUGATION SHEET PASTING') !== -1 ||
    name.indexOf('SHEET PASTING') !== -1;
}

function _prodPlanUnitForProductionStage_(routingRow, categoryGroup) {
  if (_isFlexoOfflineDieCutProductionStage_(routingRow, categoryGroup)) return 'RM';
  if (_isInspectionSlittingProductionStage_(routingRow)) return 'RM';
  if (_isSheetQuantityProductionStage_(routingRow)) return 'SHEETS';
  if (_isSheetBasedProductionStage_(routingRow)) {
    return _prodNormalizeCategoryGroup_(categoryGroup) === 'FLEXO' ? 'RM' : 'SHEETS';
  }
  return 'UNITS';
}

function _prodFlexoPcsFromRunningMeter_(runningMeterQty, pcsQty, snapshot) {
  const rm = Number(runningMeterQty || 0);
  const pcs = Number(pcsQty || 0);
  const totalRm = Number(
    snapshot?.flexoDetails?.totalRunningMeter ||
    snapshot?.flexoDetails?.baseRunningMeter ||
    0
  );
  if (!(rm > 0) || !(pcs > 0)) return 0;
  if (!(totalRm > 0)) return pcs;
  return Math.round((rm * pcs) / totalRm);
}

function _prodLastFlexoRmCarryQty_(routingList, currentIndex, combinedTotals, categoryGroup) {
  if (_prodNormalizeCategoryGroup_(categoryGroup) !== 'FLEXO') return 0;
  let carryQty = 0;
  for (let i = 0; i < currentIndex; i += 1) {
    const row = routingList[i];
    if (_prodPlanUnitForProductionStage_(row, categoryGroup) !== 'RM') continue;
    const qty = Number((combinedTotals || {})[String(row?.id || '')] || 0);
    if (qty > 0) carryQty = qty;
  }
  return carryQty;
}

function _prodStageStatusFromQty_(routingStatus, plannedQty, producedQty) {
  const status = String(routingStatus || '').toUpperCase();
  const planned = Number(plannedQty || 0);
  const produced = Number(producedQty || 0);
  const balance = Math.max(planned - produced, 0);
  if (status === 'SHORT_CLOSED') return 'SHORT_CLOSED';
  if (status === 'HOLD') return 'HOLD';
  if (planned <= 0 && produced <= 0) return 'PENDING';
  if (balance <= 0) return 'COMPLETED';
  return produced > 0 ? 'IN_PROGRESS' : 'PENDING';
}

function _prodRowJobKey_(job) {
  const jobReference = String(job?.job_reference || '').trim();
  if (jobReference) return 'REF||' + jobReference;
  return String(job?.so_number || '') + '||' + String(job?.line_no || '');
}

function _prodBuildTotalsFromEntryRows_(entryRows) {
  const combinedTotals = {};
  const jobTotals = {};
  const combinedProducedTotals = {};
  const jobProducedTotals = {};
  (Array.isArray(entryRows) ? entryRows : []).forEach(function(entry) {
    const routingKey = String(entry.routing_id || '');
    const grossQty = _getProductionEntryGrossQty_(entry);
    const goodQty = _getProductionEntryGoodQty_(entry);
    combinedProducedTotals[routingKey] = (combinedProducedTotals[routingKey] || 0) + grossQty;
    combinedTotals[routingKey] = (combinedTotals[routingKey] || 0) + goodQty;
    const jobKey = _prodRowJobKey_(entry);
    if (!jobProducedTotals[routingKey]) jobProducedTotals[routingKey] = {};
    jobProducedTotals[routingKey][jobKey] = (jobProducedTotals[routingKey][jobKey] || 0) + grossQty;
    if (!jobTotals[routingKey]) jobTotals[routingKey] = {};
    jobTotals[routingKey][jobKey] = (jobTotals[routingKey][jobKey] || 0) + goodQty;
  });
  return {
    combinedTotals: combinedTotals,
    jobTotals: jobTotals,
    combinedProducedTotals: combinedProducedTotals,
    jobProducedTotals: jobProducedTotals
  };
}

function _prodFindMatchingJob_(jobs, payload) {
  const list = Array.isArray(jobs) ? jobs : [];
  const jobReference = String(payload?.jobReference || '').trim();
  const soNumber = String(payload?.soNumber || '').trim();
  const lineNo = String(payload?.lineNo || '').trim();
  if (!jobReference && !soNumber && !lineNo) return null;
  return list.find(function(job) {
    const jobRef = String(job?.job_reference || '').trim();
    const jobSo = String(job?.so_number || '').trim();
    const jobLine = String(job?.line_no || '').trim();
    if (jobReference && jobRef) return jobRef === jobReference;
    return jobSo === soNumber && jobLine === lineNo;
  }) || null;
}

function _prodGetPlannedAndProducedForEntry_(payload, routing, routingList, snapshot, workOrder, jobs, combinedProducedTotals, combinedTotals, jobProducedTotals, jobTotals) {
  const list = (Array.isArray(routingList) ? routingList : []).filter(function(row) {
    return !_prodIsExcludedProcess_(row?.process_name || row?.department || '');
  }).sort(function(a, b) {
    return Number(a?.sequence_no || 0) - Number(b?.sequence_no || 0);
  });
  const index = list.findIndex(function(row) {
    return String(row?.id || '') === String(routing?.id || '');
  });
  if (index < 0) {
    return { plannedQty: 0, producedQty: 0, balanceQty: 0, rowKind: 'COMBINED', jobKey: '' };
  }

  const prev = index > 0 ? list[index - 1] : null;
  const routingKey = String(routing?.id || '');
  const categoryGroup = _prodNormalizeCategoryGroup_(
    payload?.categoryGroup ||
    _prodExtractCategoryGroupFromSnapshot_(snapshot || {}) ||
    routing?.department_category ||
    ''
  );
  const totalJobQty = (jobs || []).reduce(function(sum, job) {
    return sum + Number(job?.qty || 0);
  }, 0);
  const stage1Plan = _getStage1PlannedQtyFromSnapshot_(
    snapshot || {},
    workOrder || {},
    _isInspectionSlittingProductionStage_(list[0]) ? 'RM' : ''
  );
  const splitIndex = _prodFindJobSplitIndex_(list, categoryGroup);
  const splitSeq = splitIndex >= 0 ? Number(list[splitIndex].sequence_no || 0) : 0;
  const isSeparatedStage = splitSeq && Number(routing?.sequence_no || 0) > splitSeq && (jobs || []).length;

  if (!isSeparatedStage) {
    const plannedQty = categoryGroup === 'FLEXO' && (_isInspectionSlittingProductionStage_(routing) || _isFlexoOfflineDieCutProductionStage_(routing, categoryGroup)) && index > 0
      ? _prodLastFlexoRmCarryQty_(list, index, combinedTotals, categoryGroup)
      : (index === 0
        ? stage1Plan
        : Number(combinedTotals[String(prev?.id || '')] || 0));
    const producedQty = Number(combinedProducedTotals[routingKey] || 0);
    return {
      plannedQty: plannedQty,
      producedQty: producedQty,
      balanceQty: Math.max(plannedQty - producedQty, 0),
      rowKind: 'COMBINED',
      jobKey: ''
    };
  }

  const job = _prodFindMatchingJob_(jobs, payload);
  if (!job) {
    throw new Error('Unable to resolve the selected job row for this production stage.');
  }

  const jobKey = _prodRowJobKey_(job);
  const ups = Number(job.ups || job.group_ups || job.groupUps || 0) || 1;
  let plannedQty = 0;
  if (prev && Number(prev.sequence_no || 0) === splitSeq) {
    plannedQty = _isFlexoOfflineDieCutProductionStage_(routing, categoryGroup)
      ? Number(combinedTotals[String(prev.id)] || 0)
      : _isSheetBasedProductionStage_(routing)
      ? Number(combinedTotals[String(prev.id)] || 0)
      : Number(combinedTotals[String(prev.id)] || 0) * ups;
  } else if (prev) {
    plannedQty = Number((((jobTotals[String(prev.id)] || {})[jobKey]) || 0));
  }
  const producedQty = Number((((jobProducedTotals[String(routingKey)] || {})[jobKey]) || 0));
  return {
    plannedQty: plannedQty,
    producedQty: producedQty,
    balanceQty: Math.max(plannedQty - producedQty, 0),
    rowKind: 'JOB',
    jobKey: jobKey
  };
}

function _prodGetProducedEntryRowsForRoutingIds_(routingIds) {
  const ids = Array.isArray(routingIds) ? routingIds.filter(Boolean) : [];
  if (!ids.length) return [];
  try {
    return _selectInBatches_(
      'production_entries',
      'routing_id,so_number,line_no,job_reference,produced_qty,rejected_qty,ok_qty',
      'routing_id',
      ids
    );
  } catch (err) {
    return _selectInBatches_(
      'production_entries',
      'routing_id,produced_qty,rejected_qty,ok_qty,downtime_reason',
      'routing_id',
      ids
    ).map(_prodHydrateEntryIdentityFromNotes_);
  }
}

function _supabaseBulkInsertInChunks_(table, rows, maxRows, maxPayloadChars) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return [];
  const rowLimit = Math.max(1, Number(maxRows || 40));
  const payloadLimit = Math.max(10000, Number(maxPayloadChars || 300000));
  const out = [];
  let current = [];
  list.forEach(function(row) {
    const candidate = current.concat([row]);
    if (current.length && (candidate.length > rowLimit || JSON.stringify(candidate).length > payloadLimit)) {
      const result = supabaseBulkInsert(table, current) || [];
      if (Array.isArray(result)) out.push.apply(out, result);
      current = [row];
      return;
    }
    current = candidate;
  });
  if (current.length) {
    const result = supabaseBulkInsert(table, current) || [];
    if (Array.isArray(result)) out.push.apply(out, result);
  }
  return out;
}

function _prodBuildCorr2PlyDetailInsert_(detail, productionEntryId, productionRow, routing, createdBy) {
  const d = detail || {};
  const group = d.group || {};
  const producedSheets = Number(d.producedSheets || productionRow.produced_qty || 0);
  const rejectedSheets = Number(d.rejectedSheets || productionRow.rejected_qty || 0);
  const cutSizeMm = Number(d.cutSizeMm || group.cutSizeMm || 0);
  const linerWidthMm = Number(d.linerReelWidthMm || 0);
  const flutingWidthMm = Number(d.flutingReelWidthMm || 0);
  const linerGsm = Number(d.linerActualGsm || group.linerGsm || 0);
  const flutingGsm = Number(d.flutingActualGsm || group.flutingGsm || 0);
  const linerKg = _prodCorrRound3_(producedSheets * linerWidthMm * cutSizeMm * linerGsm / 1000000000);
  const flutingKg = _prodCorrRound3_(producedSheets * flutingWidthMm * cutSizeMm * flutingGsm * _prodCorrFluteFactor_(group.flute) / 1000000000);
  return {
    production_entry_id: productionEntryId || null,
    wo_id: routing.wo_id,
    routing_id: routing.id,
    row_key: d.rowKey || '',
    set_group_key: group.groupKey || d.groupKey || '',
    set_numbers: group.setNumbersText || '',
    flute: group.flute || '',
    liner_item_code: group.linerItemCode || '',
    liner_item_name: group.linerItemName || '',
    liner_wo_gsm: group.linerGsm || null,
    liner_actual_item_code: d.linerActualItemCode || '',
    liner_actual_item_name: d.linerActualItemName || '',
    liner_actual_gsm: linerGsm || null,
    liner_reel_no: d.linerReelNo || '',
    liner_reel_width_mm: linerWidthMm || null,
    fluting_item_code: group.flutingItemCode || '',
    fluting_item_name: group.flutingItemName || '',
    fluting_wo_gsm: group.flutingGsm || null,
    fluting_actual_item_code: d.flutingActualItemCode || '',
    fluting_actual_item_name: d.flutingActualItemName || '',
    fluting_actual_gsm: flutingGsm || null,
    fluting_reel_no: d.flutingReelNo || '',
    fluting_reel_width_mm: flutingWidthMm || null,
    deckle_mm: group.deckleMm || null,
    cut_size_mm: cutSizeMm || null,
    produced_sheets: producedSheets,
    rejected_sheets: rejectedSheets,
    liner_consumed_kg: linerKg,
    fluting_consumed_kg: flutingKg,
    total_consumed_kg: _prodCorrRound3_(linerKg + flutingKg),
    created_by: createdBy
  };
}

function _prodBuildStageRowsFromData_(woIds, workOrderMap, routingRows, jobsByWoId, categoryByWoId) {
  const ids = Array.isArray(woIds) ? woIds.map(String) : [];
  if (!ids.length) return [];

  const routingByWoId = {};
  routingRows.forEach(function(row) {
    const key = String(row.wo_id || '');
    if (ids.indexOf(key) === -1) return;
    if (!routingByWoId[key]) routingByWoId[key] = [];
    routingByWoId[key].push(row);
  });
  Object.keys(routingByWoId).forEach(function(key) {
    routingByWoId[key].sort(function(a, b) {
      return Number(a.sequence_no || 0) - Number(b.sequence_no || 0);
    });
  });

  const producedEntryRows = _prodGetProducedEntryRowsForRoutingIds_(routingRows.map(function(row) {
    return row.id;
  }));
  const totals = _prodBuildTotalsFromEntryRows_(producedEntryRows);
  const combinedTotals = totals.combinedTotals;
  const jobTotals = totals.jobTotals;
  const combinedProducedTotals = totals.combinedProducedTotals || {};
  const jobProducedTotals = totals.jobProducedTotals || {};

  const out = [];
  ids.forEach(function(woId) {
    const wo = (workOrderMap || {})[woId] || {};
    const snapshot = wo.snapshot_json || {};
    const routingList = (routingByWoId[woId] || []).filter(function(row) {
      return !_prodIsExcludedProcess_(row.process_name || row.department || '');
    });
    if (!routingList.length) return;
    const jobs = (jobsByWoId[woId] || []).slice().sort(function(a, b) {
      return String(a.line_no || '').localeCompare(String(b.line_no || ''));
    });
    const totalJobQty = jobs.reduce(function(sum, job) {
      return sum + Number(job.qty || 0);
    }, 0);
    const stage1Plan = _getStage1PlannedQtyFromSnapshot_(
      snapshot,
      wo,
      _isInspectionSlittingProductionStage_(routingList[0]) ? 'RM' : ''
    );
    const splitIndex = _prodFindJobSplitIndex_(routingList, categoryByWoId[woId]);
    const splitSeq = splitIndex >= 0 ? Number(routingList[splitIndex].sequence_no || 0) : 0;

    routingList.forEach(function(routing, idx) {
      const prev = idx > 0 ? routingList[idx - 1] : null;
      const routingKey = String(routing.id || '');
      const processName = String(routing.process_name || routing.department || '');
      if (splitSeq && Number(routing.sequence_no || 0) > splitSeq && jobs.length) {
        jobs.forEach(function(job) {
          const jobKey = _prodRowJobKey_(job);
          const ups = Number(job.ups || job.group_ups || job.groupUps || 0) || 1;
          let plannedQty = 0;
          if (prev && Number(prev.sequence_no || 0) === splitSeq) {
            plannedQty = _isFlexoOfflineDieCutProductionStage_(routing, categoryByWoId[woId])
              ? Number(combinedTotals[String(prev.id)] || 0)
              : _isSheetBasedProductionStage_(routing)
              ? Number(combinedTotals[String(prev.id)] || 0)
              : Number(combinedTotals[String(prev.id)] || 0) * ups;
          } else if (prev) {
            plannedQty = Number(((jobTotals[String(prev.id)] || {})[jobKey]) || 0);
          }
          const producedQty = Number(((jobProducedTotals[routingKey] || {})[jobKey]) || 0);
          out.push({
            rowKey: String(routing.id) + '||' + jobKey,
            rowKind: 'JOB',
            planUnit: _prodPlanUnitForProductionStage_(routing, categoryByWoId[woId]),
            rowDescription: 'Separated Job',
            woId: wo.id || woId,
            routingId: routing.id,
            workOrderNo: wo.wo_number || '',
            soNumber: job.so_number || '',
            soNumberDisplay: String(job.so_number || ''),
            lineNo: job.line_no || '',
            lineNos: [job.line_no || ''],
            jobReference: job.job_reference || '',
            jobUps: ups,
            clientName: job.client_name || '',
            productName: job.product_name || '',
            artworkNo: job.artwork_no || '',
            processName: processName,
            processDisplayName: _prodNormalizeProcessName_(processName, categoryByWoId[woId]),
            department: routing.department || '',
            sequence: routing.sequence_no,
            plannedMachine: routing.planned_machine || '',
            categoryGroup: _prodFormatCategoryGroupLabel_(categoryByWoId[woId]),
            expectedDelivery: job.expected_delivery || '',
            jobPriority: job.job_priority || '',
            plannedQty: plannedQty,
            producedQty: producedQty,
            balanceQty: Math.max(plannedQty - producedQty, 0),
            status: _prodStageStatusFromQty_(routing.status, plannedQty, producedQty)
          });
        });
        return;
      }

      const plannedQty = _prodNormalizeCategoryGroup_(categoryByWoId[woId]) === 'FLEXO' && (_isInspectionSlittingProductionStage_(routing) || _isFlexoOfflineDieCutProductionStage_(routing, categoryByWoId[woId])) && idx > 0
        ? _prodLastFlexoRmCarryQty_(routingList, idx, combinedTotals, categoryByWoId[woId])
        : (idx === 0
          ? stage1Plan
          : Number(combinedTotals[String(prev && prev.id)] || 0));
      const producedQty = Number(combinedProducedTotals[routingKey] || 0);
      const soNumbers = [...new Set(jobs.map(function(job){ return job.so_number; }).filter(Boolean))];
      const productNames = [...new Set(jobs.map(function(job){ return job.product_name; }).filter(Boolean))];
      const firstJob = jobs[0] || {};
      out.push({
        rowKey: String(routing.id),
        rowKind: 'COMBINED',
        planUnit: _prodPlanUnitForProductionStage_(routing, categoryByWoId[woId]),
        rowDescription: 'Combined Sheet Flow',
        woId: wo.id || woId,
        routingId: routing.id,
        workOrderNo: wo.wo_number || '',
        soNumberDisplay: soNumbers.join(', '),
        lineNos: [...new Set(jobs.map(function(job){ return job.line_no; }).filter(Boolean))],
        jobReference: '',
        jobUps: '',
        clientName: firstJob.client_name || '',
        productName: productNames.join(' / '),
        artworkNo: firstJob.artwork_no || '',
        processName: processName,
        processDisplayName: _prodNormalizeProcessName_(processName, categoryByWoId[woId]),
        department: routing.department || '',
        sequence: routing.sequence_no,
        plannedMachine: routing.planned_machine || '',
        categoryGroup: _prodFormatCategoryGroupLabel_(categoryByWoId[woId]),
        expectedDelivery: firstJob.expected_delivery || '',
        jobPriority: firstJob.job_priority || '',
        plannedQty: plannedQty,
        producedQty: producedQty,
        balanceQty: Math.max(plannedQty - producedQty, 0),
        status: _prodStageStatusFromQty_(routing.status, plannedQty, producedQty)
      });
    });
  });
  return out;
}


/* ==============================
   🔧 HELPER — GET STAGE PLANNED QTY
================================= */

function _getStagePlannedQtyFromMaps_(routingRow, prevStageRow, workOrderMap, producedTotals) {
  const wo = (workOrderMap || {})[String(routingRow.wo_id)];

  if (!wo)
    return 0;

  const snapshot = wo.snapshot_json || {};
  const categoryGroup = _prodExtractCategoryGroupFromSnapshot_(snapshot);
  const stage1Plan = _getStage1PlannedQtyFromSnapshot_(
    snapshot,
    wo,
    _isInspectionSlittingProductionStage_(routingRow) ? 'RM' : ''
  );

  if (routingRow.sequence_no === 1) {
    return stage1Plan;
  }

  if (!prevStageRow)
    return 0;

  const prevGoodQty = _getStageProducedTotalFromMap_(producedTotals, prevStageRow.id);
  if (_isFlexoOfflineDieCutProductionStage_(routingRow, categoryGroup)) return prevGoodQty;
  if (_isSheetBasedProductionStage_(routingRow)) {
    return prevGoodQty;
  }
  if (_isSheetBasedProductionStage_(prevStageRow)) {
    const upsFactor = _getProductionUpsFactorFromSnapshot_(snapshot);
    return Math.round(prevGoodQty * (upsFactor > 0 ? upsFactor : 1));
  }

  return prevGoodQty;
}


/* ==============================
   2️⃣ PRODUCTION BOARD — PROCESS MODE
================================= */

function _selectInBatches_(table, select, key, values, order) {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!list.length) return [];

  const out = [];
  // GAS URLFetch has a strict URL-length ceiling, so keep PostgREST in.(...)
  // filters deliberately small for bulk floor-entry saves.
  const chunks = _supabaseChunkValuesByFilterLength_(list, 800, 20);
  chunks.forEach(function(chunk) {
    const rows = supabaseSelect(table, {
      select: select,
      filters: (function() {
        const obj = {};
        obj[key] = _supabaseInFilter_(chunk);
        return obj;
      })(),
      order: order || ''
    }) || [];
    out.push.apply(out, rows);
  });
  return out;
}

function _getProducedTotalsMapForRoutingIds_(routingIds) {
  const ids = Array.isArray(routingIds) ? routingIds.filter(Boolean) : [];
  if (!ids.length) return { grossTotals: {}, okTotals: {} };

  const rows = _selectInBatches_(
    'production_entries',
    'routing_id,produced_qty,rejected_qty,ok_qty',
    'routing_id',
    ids
  );

  const grossTotals = {};
  const okTotals = {};
  rows.forEach(function(row) {
    const key = String(row.routing_id);
    grossTotals[key] = (grossTotals[key] || 0) + _getProductionEntryGrossQty_(row);
    okTotals[key] = (okTotals[key] || 0) + _getProductionEntryGoodQty_(row);
  });
  return {
    grossTotals: grossTotals,
    okTotals: okTotals
  };
}

function _buildProductionBoardRows_(rows) {
  const boardRows = Array.isArray(rows) ? rows : [];
  if (!boardRows.length) return [];

  const woIds = [...new Set(boardRows.map(function(row){ return row.wo_id; }).filter(Boolean))];
  const workOrders = _selectInBatches_(
    'work_orders',
    'id,snapshot_json',
    'id',
    woIds
  );
  const workOrderMap = {};
  workOrders.forEach(function(row) {
    workOrderMap[String(row.id)] = row;
  });

  const allRoutingRows = _selectInBatches_(
    'work_order_routing',
    'id,wo_id,sequence_no,status',
    'wo_id',
    woIds
  );
  const prevStageMap = {};
  const routingById = {};
  allRoutingRows.forEach(function(row) {
    prevStageMap[String(row.wo_id) + '||' + String(row.sequence_no)] = row;
    routingById[String(row.id)] = row;
  });

  const producedTotals = _getProducedTotalsMapForRoutingIds_(allRoutingRows.map(function(row) {
    return row.id;
  }));
  const producedGrossTotals = producedTotals.grossTotals || {};
  const producedOkTotals = producedTotals.okTotals || {};

  return boardRows.map(function(r) {
    const prevStage = prevStageMap[String(r.wo_id) + '||' + String(Number(r.sequence_no || 0) - 1)] || null;
    const planned = _getStagePlannedQtyFromMaps_(r, prevStage, workOrderMap, producedOkTotals);
    const produced = _getStageProducedTotalFromMap_(producedGrossTotals, r.routing_id);
    const balance = Math.max(planned - produced, 0);
    const routingStatus = String(routingById[String(r.routing_id)]?.status || '').toUpperCase();
    const status = routingStatus === 'SHORT_CLOSED'
      ? 'SHORT_CLOSED'
      : (routingStatus === 'HOLD'
        ? 'HOLD'
        : (planned <= 0 && produced <= 0
          ? 'PENDING'
          : (balance <= 0 ? 'COMPLETED' : (produced > 0 ? 'IN_PROGRESS' : 'PENDING'))));

    return {
      routingId: r.routing_id,
      workOrderNo: r.wo_number,
      artworkNo: r.artwork_no,
      clientName: r.client_name,
      processName: r.process_name,
      department: r.department,
      plannedMachine: r.planned_machine,
      sequence: r.sequence_no,
      plannedQty: planned,
      producedQty: produced,
      balanceQty: balance,
      status: status
    };
  });
}

/* ==============================
   3️⃣ PRODUCTION BOARD — WO MODE
================================= */

function getProductionBoardByWO(woId, token){
  _requireModuleAccess_(token, 'PRODUCTION', 'can_view');
  _prodGetStoreIssuedPlanForWo_._cache = {};

  if (!woId)
    throw new Error('WO required');

  const cache = CacheService.getScriptCache();
  const cacheKey = _prodCacheKey_('wo|' + String(woId));
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  try {
    const fastRows = _prodGetStageRowsForWoFast_(woId);
    if (fastRows && fastRows.length) {
      _prodCachePutJsonSafe_(cache, cacheKey, fastRows, 60);
      return fastRows;
    }
  } catch (err) {}

  const workOrderJobs = _filterSalesServiceOnlyItems_(supabaseSelect('work_order_jobs', {
    select: 'wo_id,so_number,line_no,product_name,qty,category,artwork_no,client_name,job_priority,expected_delivery,ups,group_ups,job_reference',
    filters: { wo_id: 'eq.' + woId }
  }) || []);
  const workOrders = supabaseSelect('work_orders', {
    select: 'id,wo_number,wo_date,snapshot_json',
    filters: { id: 'eq.' + woId },
    limit: 1
  }) || [];
  const wo = workOrders[0] || null;
  if (!wo) throw new Error('Work order not found');
  const routingRows = supabaseSelect('work_order_routing', {
    select: 'id,wo_id,sequence_no,process_name,department,status,planned_machine',
    filters: { wo_id: 'eq.' + woId },
    order: 'sequence_no.asc'
  }) || [];
  const jobsByWoId = {};
  jobsByWoId[String(woId)] = workOrderJobs;
  const artworkNos = [...new Set(workOrderJobs.map(function(row){ return row.artwork_no; }).filter(Boolean))];
  const artworkRows = artworkNos.length
    ? _supabaseSelectByKeyInBatches_('artworks', 'artwork_no,product_type', 'artwork_no', artworkNos)
    : [];
  const artworkCategoryByNo = {};
  artworkRows.forEach(function(row) {
    const category = _prodRecognizeDepartmentCategory_(row.product_type || '');
    if (category) artworkCategoryByNo[String(row.artwork_no || '')] = category;
  });
  const categoryByWoId = {};
  const artworkCategories = workOrderJobs.map(function(job) {
    return artworkCategoryByNo[String(job.artwork_no || '')] || '';
  }).filter(Boolean);
  const recognizedJobCategories = workOrderJobs.map(function(job) {
    return _prodRecognizeDepartmentCategory_(job.category || '');
  }).filter(Boolean);
  categoryByWoId[String(woId)] = _prodResolveDepartmentCategory_(
    wo.snapshot_json,
    artworkCategories,
    recognizedJobCategories
  );
  const woMap = {};
  woMap[String(woId)] = wo;
  const result = _prodBuildStageRowsFromData_([String(woId)], woMap, routingRows, jobsByWoId, categoryByWoId);
  _prodCachePutJsonSafe_(cache, cacheKey, result, 60);
  return result;
}


/* ==============================
   4️⃣ BULK SAVE PRODUCTION ENTRIES
================================= */

function saveProductionBulk(entries, token) {
  _requireModuleAccess_(token, 'PRODUCTION', 'can_edit');
  _prodGetStoreIssuedPlanForWo_._cache = {};

  if (!Array.isArray(entries) || !entries.length)
    throw new Error('No entries');

  const routingIds = [...new Set(entries.map(payload => payload.routingId).filter(Boolean))];
  const routingRows = routingIds.length
    ? _selectInBatches_(
        'work_order_routing',
        'id,wo_id,sequence_no,process_name,department,planned_machine,status',
        'id',
        routingIds
      )
    : [];
  const routingMap = {};
  routingRows.forEach(row => {
    routingMap[String(row.id)] = row;
  });

  const woIds = [...new Set(routingRows.map(row => row.wo_id).filter(Boolean))];
  const workOrders = woIds.length
    ? _selectInBatches_(
        'work_orders',
        'id,wo_number,snapshot_json',
        'id',
        woIds
      )
    : [];
  const workOrderMap = {};
  workOrders.forEach(row => {
    workOrderMap[String(row.id)] = row;
  });

  let allRoutingRows = routingRows.slice();
  if (woIds.length) {
    allRoutingRows = _selectInBatches_(
      'work_order_routing',
      'id,wo_id,sequence_no,process_name,department,planned_machine,status',
      'wo_id',
      woIds
    );
  }
  const routingByWoId = {};
  allRoutingRows.forEach(function(row) {
    const key = String(row.wo_id || '');
    if (!routingByWoId[key]) routingByWoId[key] = [];
    routingByWoId[key].push(row);
  });
  Object.keys(routingByWoId).forEach(function(key) {
    routingByWoId[key].sort(function(a, b) {
      return Number(a.sequence_no || 0) - Number(b.sequence_no || 0);
    });
  });

  const workOrderJobs = woIds.length
    ? _selectInBatches_(
        'work_order_jobs',
        'wo_id,so_number,line_no,product_name,qty,ups,group_ups,job_reference',
        'wo_id',
        woIds
      )
    : [];
  const jobsByWoId = {};
  workOrderJobs.forEach(function(job) {
    const key = String(job.wo_id || '');
    if (!jobsByWoId[key]) jobsByWoId[key] = [];
    jobsByWoId[key].push(job);
  });

  const producedEntryRows = routingIds.length
    ? _prodGetProducedEntryRowsForRoutingIds_(allRoutingRows.map(function(row) { return row.id; }))
    : [];
  const totals = _prodBuildTotalsFromEntryRows_(producedEntryRows);
  const combinedTotals = totals.combinedTotals;
  const jobTotals = totals.jobTotals;
  const combinedProducedTotals = totals.combinedProducedTotals || {};
  const jobProducedTotals = totals.jobProducedTotals || {};

  const createdBy = Session.getActiveUser()?.getEmail?.() || 'user';
  const inserts = [];
  const corr2PlyDetailRefs = [];
  const orderedEntries = entries.slice().sort(function(a, b) {
    const ra = routingMap[String(a.routingId)] || {};
    const rb = routingMap[String(b.routingId)] || {};
    const woCmp = String(ra.wo_id || '').localeCompare(String(rb.wo_id || ''));
    if (woCmp !== 0) return woCmp;
    const seqCmp = Number(ra.sequence_no || 0) - Number(rb.sequence_no || 0);
    if (seqCmp !== 0) return seqCmp;
    return String(a.jobReference || a.lineNo || '').localeCompare(String(b.jobReference || b.lineNo || ''));
  });

  orderedEntries.forEach(function(payload) {
    const routing = routingMap[String(payload.routingId)];
    if (!routing)
      throw new Error('Routing not found');

    const woKey = String(routing.wo_id || '');
    const snapshot = (workOrderMap[woKey] && workOrderMap[woKey].snapshot_json) || {};
    const stageInfo = _prodGetPlannedAndProducedForEntry_(
      payload,
      routing,
      routingByWoId[woKey] || [],
      snapshot,
      workOrderMap[woKey] || {},
      jobsByWoId[woKey] || [],
      combinedProducedTotals,
      combinedTotals,
      jobProducedTotals,
      jobTotals
    );
    const plannedQty = Number(stageInfo.plannedQty || 0);
    const producedQty = Number(stageInfo.producedQty || 0);
    const balance = Number(stageInfo.balanceQty || 0);
    const produced = Number(payload.producedQty || 0);
    const rejected = Number(payload.rejectedQty || 0);

    if (produced <= 0)
      return;

    if (produced > balance)
      throw new Error('Overproduction not allowed');

    if (rejected > produced)
      throw new Error('Reject exceeds produced');

    const goodQty = Math.max(produced - rejected, 0);
    const entryTime = payload.endDate
      ? new Date(payload.endDate).toISOString()
      : (payload.entryDate
        ? new Date(payload.entryDate).toISOString()
        : (payload.startDate
          ? new Date(payload.startDate).toISOString()
          : new Date().toISOString()));
    combinedProducedTotals[String(routing.id)] = (combinedProducedTotals[String(routing.id)] || 0) + produced;
    combinedTotals[String(routing.id)] = (combinedTotals[String(routing.id)] || 0) + goodQty;
    if (stageInfo.rowKind === 'JOB' && stageInfo.jobKey) {
      if (!jobProducedTotals[String(routing.id)]) jobProducedTotals[String(routing.id)] = {};
      jobProducedTotals[String(routing.id)][stageInfo.jobKey] = (jobProducedTotals[String(routing.id)][stageInfo.jobKey] || 0) + produced;
      if (!jobTotals[String(routing.id)]) jobTotals[String(routing.id)] = {};
      jobTotals[String(routing.id)][stageInfo.jobKey] = (jobTotals[String(routing.id)][stageInfo.jobKey] || 0) + goodQty;
    }
    if (payload.corrugation2PlyDetails) {
      const d = payload.corrugation2PlyDetails || {};
      if (!d.group || !d.group.groupKey) throw new Error('2 Ply detail group missing');
      if (!d.linerActualItemCode && !d.linerActualItemName) throw new Error('Select liner material for 2 Ply entry');
      if (!d.flutingActualItemCode && !d.flutingActualItemName) throw new Error('Select fluting material for 2 Ply entry');
      if (!(Number(d.linerActualGsm || d.group.linerGsm || 0) > 0)) throw new Error('Enter liner actual GSM for 2 Ply entry');
      if (!(Number(d.flutingActualGsm || d.group.flutingGsm || 0) > 0)) throw new Error('Enter fluting actual GSM for 2 Ply entry');
      if (!(Number(d.linerReelWidthMm || 0) > 0)) throw new Error('Enter liner reel width for 2 Ply entry');
      if (!(Number(d.flutingReelWidthMm || 0) > 0)) throw new Error('Enter fluting reel width for 2 Ply entry');
      if (!String(d.linerReelNo || '').trim()) throw new Error('Enter liner reel no for 2 Ply entry');
      if (!String(d.flutingReelNo || '').trim()) throw new Error('Enter fluting reel no for 2 Ply entry');
    }

    const productionRow = {
      wo_id: routing.wo_id,
      routing_id: routing.id,
      so_number: payload.soNumber || null,
      line_no: payload.lineNo == null || payload.lineNo === '' ? null : String(payload.lineNo),
      job_reference: payload.jobReference || null,
      entry_datetime: entryTime,
      machine: payload.machine || '',
      operator_name: payload.operator || '',
      produced_qty: produced,
      rejected_qty: rejected,
      ok_qty: goodQty,
      downtime_reason: _prodBuildEntryNotes_(payload),
      created_by: createdBy
    };
    if (payload.corrugation2PlyDetails) {
      corr2PlyDetailRefs.push({
        insertIndex: inserts.length,
        detail: Object.assign({}, payload.corrugation2PlyDetails, {
          producedSheets: produced,
          rejectedSheets: rejected
        }),
        routing: routing
      });
    }
    inserts.push(productionRow);
  });

  if (inserts.length) {
    try {
      if (corr2PlyDetailRefs.length) {
        const insertedRows = _supabaseBulkInsertInChunks_('production_entries', inserts, 30, 250000);
        const detailRows = corr2PlyDetailRefs.map(function(ref) {
          const inserted = insertedRows[ref.insertIndex] || {};
          return _prodBuildCorr2PlyDetailInsert_(
            ref.detail,
            inserted.id || null,
            inserts[ref.insertIndex],
            ref.routing,
            createdBy
          );
        });
        if (detailRows.length) _supabaseBulkInsertMinimalInChunks_('corrugation_2ply_entry_details', detailRows, 30, 250000);
      } else {
        _supabaseBulkInsertMinimalInChunks_('production_entries', inserts, 40, 300000);
      }
    } catch (err) {
      const msg = String(err && err.message || '');
      const missingJobIdentityCols =
        msg.indexOf('production_entries.so_number') !== -1 ||
        msg.indexOf('production_entries.line_no') !== -1 ||
        msg.indexOf('production_entries.job_reference') !== -1 ||
        msg.indexOf("'so_number' column of 'production_entries'") !== -1 ||
        msg.indexOf("'line_no' column of 'production_entries'") !== -1 ||
        msg.indexOf("'job_reference' column of 'production_entries'") !== -1 ||
        msg.indexOf('column "so_number" of relation "production_entries" does not exist') !== -1 ||
        msg.indexOf('column "line_no" of relation "production_entries" does not exist') !== -1 ||
        msg.indexOf('column "job_reference" of relation "production_entries" does not exist') !== -1;
      if (!missingJobIdentityCols) throw err;

      // Keep production posting working on environments that have not applied the
      // optional job-split migration yet.
      if (corr2PlyDetailRefs.length) throw err;
      _supabaseBulkInsertMinimalInChunks_('production_entries', inserts.map(function(row) {
        const copy = Object.assign({}, row);
        delete copy.so_number;
        delete copy.line_no;
        delete copy.job_reference;
        return copy;
      }), 40, 300000);
    }
    _prodBumpQueueVersion_();
    _opsBumpDatasetVersion_();
  }

  return { ok: true };
}


/* ==============================
   5️⃣ SHORT CLOSE STAGE
================================= */

function shortCloseStage(routingId, reason, token) {
  _requireModuleAccess_(token, 'PRODUCTION', 'can_edit');

  if (!reason)
    throw new Error('Reason required');

  supabaseUpdate(
    'work_order_routing',
    { id: 'eq.' + routingId },
    {
      status: 'SHORT_CLOSED'
    }
  );
  _prodBumpQueueVersion_();
  _opsBumpDatasetVersion_();

  return { ok: true };
}

function searchWorkOrders(query, token){
  _requireModuleAccess_(token, 'PRODUCTION', 'can_view');

  if(!query || query.length < 3)
    return [];
  const cache = CacheService.getScriptCache();
  const q = String(query || '').trim().toLowerCase();
  const cacheKey = _prodCacheKey_('wo_search|' + q);
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const safe = q.replace(/[%*,()]/g, ' ').trim();

  try {
    const fastRows = supabaseSelect('v_production_jobcard_lookup_fast', {
      select: 'wo_id,wo_number,wo_date,artwork_nos,client_name,product_names,so_numbers,department_category',
      filters: {
        or: '(wo_number.ilike.*' + safe + '*,artwork_nos.ilike.*' + safe + '*,client_name.ilike.*' + safe + '*,product_names.ilike.*' + safe + '*,so_numbers.ilike.*' + safe + '*)'
      },
      order: 'wo_date.desc',
      limit: 12
    }) || [];
    if (fastRows.length) {
      const fastResult = fastRows.map(function(row) {
        return {
          woId: row.wo_id,
          woNumber: row.wo_number || '',
          artworkNo: String(row.artwork_nos || '').split(',')[0] ? String(row.artwork_nos || '').split(',')[0].trim() : '',
          client: row.client_name || '',
          product: row.product_names || '',
          soNumbers: String(row.so_numbers || '').split(',').map(function(item) {
            return String(item || '').trim();
          }).filter(Boolean),
          category: _prodFormatCategoryGroupLabel_(row.department_category || '')
        };
      });
      _prodCachePutJsonSafe_(cache, cacheKey, fastResult, 120);
      return fastResult;
    }
  } catch (err) {}

  const matchedWoIds = {};
  const directWoRows = supabaseSelect('work_orders', {
    select: 'id,wo_number,wo_date',
    filters: { wo_number: 'ilike.*' + safe + '*' },
    order: 'wo_date.desc',
    limit: 20
  }) || [];
  directWoRows.forEach(function(row) {
    if (row.id) matchedWoIds[String(row.id)] = true;
  });

  ['artwork_no', 'client_name', 'product_name', 'so_number'].forEach(function(field) {
    const filters = {};
    filters[field] = 'ilike.*' + safe + '*';
    const rows = supabaseSelect('work_order_jobs', {
      select: 'wo_id',
      filters: filters,
      limit: 30
    }) || [];
    rows.forEach(function(row) {
      if (row.wo_id) matchedWoIds[String(row.wo_id)] = true;
    });
  });

  const woIds = Object.keys(matchedWoIds);
  if (!woIds.length) return [];

  const workOrders = _selectInBatches_('work_orders', 'id,wo_number,wo_date,snapshot_json', 'id', woIds, 'wo_date.desc');
  const jobRows = _filterSalesServiceOnlyItems_(_selectInBatches_(
    'work_order_jobs',
    'wo_id,so_number,artwork_no,client_name,product_name,category',
    'wo_id',
    woIds
  ));
  const jobsByWoId = {};
  jobRows.forEach(function(row) {
    const key = String(row.wo_id || '');
    if (!jobsByWoId[key]) jobsByWoId[key] = [];
    jobsByWoId[key].push(row);
  });

  const result = workOrders.map(function(r) {
    const jobs = jobsByWoId[String(r.id)] || [];
    const artNos = [...new Set(jobs.map(function(job) { return String(job.artwork_no || '').trim(); }).filter(Boolean))];
    const soNumbers = [...new Set(jobs.map(function(job) { return String(job.so_number || '').trim(); }).filter(Boolean))];
    const products = [...new Set(jobs.map(function(job) { return String(job.product_name || '').trim(); }).filter(Boolean))];
    const client = jobs[0] && jobs[0].client_name ? jobs[0].client_name : (r.snapshot_json?.jobs?.[0]?.client || '');
    const category = _prodFormatCategoryGroupLabel_(_prodResolveDepartmentCategory_(
      r.snapshot_json,
      [],
      jobs.map(function(job) { return job.category || ''; })
    ));
    return {
      woId: r.id,
      woNumber: r.wo_number,
      artworkNo: artNos[0] || '',
      client: client || '',
      product: products.join(' / ') || (r.snapshot_json?.jobs || []).map(function(job){ return job.productName || job.itemName || ''; }).filter(Boolean).join(' / '),
      soNumbers: soNumbers,
      category: category
    };
  }).sort(function(a, b) {
    return String(b.woNumber || '').localeCompare(String(a.woNumber || ''));
  }).slice(0, 12);
  _prodCachePutJsonSafe_(cache, cacheKey, result, 120);
  return result;
}

/* =========================
   PUBLIC API — HTML EXPORTS
   (Supabase-aligned, v3)
   ========================= */

// ===== WORK ORDERS =====
this.listSOWithStatus = listSOWithStatus;
this.listSOWithStatusEndpoint = listSOWithStatus;
this.listFlexoWOStatus = listFlexoWOStatus;
this.getWorkOrder = getWorkOrder;
this.getFlexoWorkOrder = getFlexoWorkOrder;
this.saveAndExportWO = saveAndExportWO;
this.saveFlexoWorkOrder = saveFlexoWorkOrder;
this.deleteWorkOrder = deleteWorkOrder;
this.getNextWONumber = getNextWONumber;
this.getNextFlexoWONumber = getNextFlexoWONumber;
this.getFlexoWOMasters = getFlexoWOMasters;
this.getFlexoArtworkApprovalData = getFlexoArtworkApprovalData;

// ===== SALES ORDER =====
this.saveOrderWithKey = saveOrderWithKey;
this.listSalesOrders = listSalesOrders;
this.getItems = getItems;
this.saveItem = saveItem;
this.updateSalesOrder = updateSalesOrder;
this.loadSalesOrderJson = loadSalesOrderJson;
this.getSalesOrderLines = getSalesOrderLines;
this.getSalesOrderLinesBatch = getSalesOrderLinesBatch;
this.setSalesOrderLifecycleStatus = setSalesOrderLifecycleStatus;

// ===== ARTWORK / PLATES / DIES =====
this.getArtworkJobs = getArtworkJobs;
this.saveArtworkBulk = saveArtworkBulk;
this.approveArtwork = approveArtwork;

this.getPlateDieJobs = getPlateDieJobs;
this.savePlateDieBulk = savePlateDieBulk;
this.purchaseBootstrapJSON = purchaseBootstrapJSON;
this.purchaseListVendorsJSON = purchaseListVendorsJSON;
this.purchaseSaveVendor = purchaseSaveVendor;
this.purchaseSetVendorStatus = purchaseSetVendorStatus;
this.purchaseListInventoryRequestsJSON = purchaseListInventoryRequestsJSON;
this.purchaseListPOsJSON = purchaseListPOsJSON;
this.purchaseListPOsForPRJSON = purchaseListPOsForPRJSON;
this.purchaseCreatePO = purchaseCreatePO;
this.purchaseCreateArtworkPO = purchaseCreateArtworkPO;
this.purchaseUpdatePO = purchaseUpdatePO;
this.purchaseReceivePOLine = purchaseReceivePOLine;
this.purchaseReceiveArtworkPOLine = purchaseReceiveArtworkPOLine;
this.purchaseReceiveArtworkPOBulk = purchaseReceiveArtworkPOBulk;
this.purchaseGetPOPrintData = purchaseGetPOPrintData;
this.purchaseDashboardSummaryJSON = purchaseDashboardSummaryJSON;
this.mastersGetBootstrap = mastersGetBootstrap;
this.mastersSaveClient = mastersSaveClient;
this.mastersToggleClientStatus = mastersToggleClientStatus;

  // ===== SALES ORDER APPROVAL =====
this.getSalesOrderLinesForApproval = getSalesOrderLinesForApproval;
this.updateSalesOrderLineApproval = updateSalesOrderLineApproval;

// ===== INVENTORY (Supabase Ledger v3) =====
this.invSaveItem = invSaveItem;
this.invListItemsJSON = invListItemsJSON;
this.invSearchItemsJSON = invSearchItemsJSON;
this.invCreatePurchaseRequest = invCreatePurchaseRequest;
this.invCreatePurchaseRequestsBulk = invCreatePurchaseRequestsBulk;
this.invUpdatePurchaseRequest = invUpdatePurchaseRequest;
this.invListPurchaseReceiptsJSON = invListPurchaseReceiptsJSON;
this.invReverseLedgerTransaction = invReverseLedgerTransaction;
this.invGetReceiptPrintData = invGetReceiptPrintData;
this.invGetGRNPrintData = invGetGRNPrintData;

this.invGetStockSnapshotJSON = invGetStockSnapshotJSON;
this.invGetCurrentStockQty = invGetCurrentStockQty;

this.invPostPurchaseReceipt = invPostPurchaseReceipt;
this.invPostPurchaseReceiptBulk = invPostPurchaseReceiptBulk;
this.invPostDirectReceipt = invPostDirectReceipt;
this.invPostIssue = invPostIssue;
this.invPostRTS = invPostRTS;
this.invPostRFP = invPostRFP;
this.invPostAdjustment = invPostAdjustment;

this.invListIssueJSON = invListIssueJSON;
this.invListRTSJSON = invListRTSJSON;
this.invListRFPJSON = invListRFPJSON;
this.invListAdjustmentsJSON = invListAdjustmentsJSON;
this.invListAvailableLotsJSON = invListAvailableLotsJSON;

// ===== FG STOCK =====
this.fgGetBootstrap = fgGetBootstrap;
this.fgGetDashboard = fgGetDashboard;
this.fgSaveOpeningStock = fgSaveOpeningStock;
this.fgSaveStockAdjustment = fgSaveStockAdjustment;
this.fgSaveOpeningDispatch = fgSaveOpeningDispatch;
this.fgPostPackedDispatch = fgPostPackedDispatch;

// ===== INVOICING (Supabase) =====
this.billingGetBootstrap = billingGetBootstrap;
this.billingGetDataset = billingGetDataset;
this.billingGetDraftDocumentNo = billingGetDraftDocumentNo;
this.billingListInvoices = billingListInvoices;
this.billingGetInvoiceEditor = billingGetInvoiceEditor;
this.createInvoice = createInvoice;
this.updateInvoiceDraft = updateInvoiceDraft;
this.postInvoice = postInvoice;
this.deleteInvoiceDraft = deleteInvoiceDraft;
this.previewInvoicePDF = previewInvoicePDF;
this.billingGetInvoicePrintData = billingGetInvoicePrintData;

// ===== REPORTS / MIS =====
function _reportsSafeNumber_(value) {
  const num = Number(value || 0);
  return isFinite(num) ? num : 0;
}

function _reportsRoundNumber_(value, decimals) {
  const places = Math.max(0, Number(decimals == null ? 2 : decimals) || 0);
  const factor = Math.pow(10, places);
  return Math.round(_reportsSafeNumber_(value) * factor) / factor;
}

function _reportsDateDiffDays_(fromValue, toValue) {
  const from = fromValue ? new Date(fromValue) : null;
  const to = toValue ? new Date(toValue) : new Date();
  if (!from || isNaN(from.getTime()) || !to || isNaN(to.getTime())) return null;
  return Math.max(0, Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
}

function _reportsTake_(rows, limit) {
  return (rows || []).slice(0, Math.max(0, Number(limit || 0) || 0));
}

function _reportsBuildOverviewCards_(sections) {
  return [
    {
      key: 'approvalPending',
      label: 'Sales Approval Pending',
      value: sections.lifecycle.metrics.salesApprovalPending,
      meta: 'Accounts or business approvals pending'
    },
    {
      key: 'artworkPending',
      label: 'Artwork Pending',
      value: sections.lifecycle.metrics.artworkPending,
      meta: 'Artwork groups pending approval'
    },
    {
      key: 'productionPending',
      label: 'Production Pending Qty',
      value: sections.production.metrics.pendingQty,
      meta: 'Open quantity in production queue'
    },
    {
      key: 'belowMsl',
      label: 'Below MSL Items',
      value: sections.inventory.metrics.belowMslItems,
      meta: 'Items below minimum stock level'
    },
    {
      key: 'openPrs',
      label: 'Open PR Lines',
      value: sections.purchase.metrics.openPrLines,
      meta: 'Purchase requests waiting action'
    },
    {
      key: 'unbilledDispatch',
      label: 'Unbilled Dispatch Qty',
      value: sections.salesBilling.metrics.unbilledDispatchQty,
      meta: 'Dispatched quantity not yet billed'
    }
  ];
}

function _reportsBuildLifecycleSection_(token) {
  const approvalRows = (getSalesOrderLinesForApproval().rows || []).map(function(row) {
    const pendingFlags = [];
    if (String(row.accountsStatus || '').toUpperCase() !== 'APPROVED') pendingFlags.push('Accounts');
    if (String(row.businessStatus || '').toUpperCase() !== 'APPROVED') pendingFlags.push('Business');
    return {
      soNo: row.soNo,
      lineNo: row.lineNo,
      client: row.client,
      product: row.product,
      salesRep: row.salesRep,
      soDate: row.soDate,
      pendingAt: pendingFlags.join(' / ') || 'Approved',
      ageingDays: _reportsDateDiffDays_(row.soDate)
    };
  }).filter(function(row) {
    return row.pendingAt !== 'Approved';
  }).sort(function(a, b) {
    return _reportsSafeNumber_(b.ageingDays) - _reportsSafeNumber_(a.ageingDays);
  });

  const artworkData = getArtworkWorkbench(null, null, true);
  const artworkRows = (artworkData.groups || []).map(function(row) {
    const anchorDate = row.artworkAt || ((row.jobs || [])[0] || {}).soDate || '';
    return {
      artworkNo: row.artworkNo || '',
      productType: row.productType || '',
      client: (row.clientList || []).join(', '),
      salesRep: (row.salesRepList || []).join(', '),
      soList: (row.soList || []).join(', '),
      status: row.status || 'NO_ART',
      plateStatus: row.plateStatus || '',
      dieStatus: row.dieStatus || '',
      qty: _reportsSafeNumber_(row.totalQty),
      ageingDays: _reportsDateDiffDays_(anchorDate)
    };
  }).filter(function(row) {
    return String(row.status || '').toUpperCase() !== 'APPROVED';
  }).sort(function(a, b) {
    return _reportsSafeNumber_(b.ageingDays) - _reportsSafeNumber_(a.ageingDays);
  });

  const lifecycle = opsLifecycleGetChunk({ offset: 0, limit: 30, showPendingAll: true }, token) || {};
  const lifecycleRows = (lifecycle.rows || []).map(function(row) {
    return {
      soNumber: row.soNumber || '',
      lineNo: row.lineNo || '',
      client: row.client || '',
      product: row.product || '',
      currentStage: row.currentStage || '',
      overallStatus: row.overallStatus || '',
      productionPendingQty: _reportsSafeNumber_(row.productionPendingQty),
      packingPendingQty: _reportsSafeNumber_(row.packingPendingQty),
      dispatchPendingQty: _reportsSafeNumber_(row.dispatchPendingQty),
      dueDate: row.finalDelivery || row.expectedDelivery || '',
      ageingDays: _reportsDateDiffDays_(row.woDate || row.expectedDelivery || row.finalDelivery || '')
    };
  });

  return {
    metrics: {
      salesApprovalPending: approvalRows.length,
      artworkPending: artworkRows.length,
      lifecycleOpenOrders: _reportsSafeNumber_(lifecycle.summary && lifecycle.summary.totalOrders),
      pendingProductionQty: _reportsSafeNumber_(lifecycle.summary && lifecycle.summary.pendingProductionQty),
      pendingPackingQty: _reportsSafeNumber_(lifecycle.summary && lifecycle.summary.pendingPackingQty),
      pendingDispatchQty: _reportsSafeNumber_(lifecycle.summary && lifecycle.summary.pendingDispatchQty)
    },
    approvalTable: _reportsTake_(approvalRows, 12),
    artworkTable: _reportsTake_(artworkRows, 12),
    orderTable: _reportsTake_(lifecycleRows, 12)
  };
}

function _reportsBuildProductionSection_(token) {
  const queue = prodGetStageQueue({ showPendingAll: true }, token) || {};
  const rows = (queue.rows || []).map(function(row) {
    return {
      workOrderNo: row.workOrderNo || '',
      processName: row.processName || '',
      clientName: row.clientName || '',
      productName: row.productName || '',
      categoryGroup: row.categoryGroup || '',
      plannedQty: _reportsSafeNumber_(row.plannedQty),
      producedQty: _reportsSafeNumber_(row.producedQty),
      balanceQty: _reportsSafeNumber_(row.balanceQty),
      status: row.status || '',
      plannedMachine: row.plannedMachine || '',
      dueDate: row.expectedDelivery || '',
      ageingDays: _reportsDateDiffDays_(row.woDate || row.expectedDelivery || '')
    };
  }).sort(function(a, b) {
    return _reportsSafeNumber_(b.balanceQty) - _reportsSafeNumber_(a.balanceQty);
  });

  const byProcess = {};
  rows.forEach(function(row) {
    const key = row.processName || 'Unassigned';
    if (!byProcess[key]) {
      byProcess[key] = { processName: key, openJobs: 0, pendingQty: 0, inProgressJobs: 0 };
    }
    byProcess[key].openJobs += 1;
    byProcess[key].pendingQty += _reportsSafeNumber_(row.balanceQty);
    if (String(row.status || '').toUpperCase() === 'IN_PROGRESS') {
      byProcess[key].inProgressJobs += 1;
    }
  });

  return {
    metrics: {
      totalOpenJobs: _reportsSafeNumber_(queue.summary && queue.summary.totalRows),
      pendingQty: _reportsSafeNumber_(queue.summary && queue.summary.pendingQty),
      inProgressJobs: _reportsSafeNumber_(queue.summary && queue.summary.inProgressRows),
      shortClosedJobs: _reportsSafeNumber_(queue.summary && queue.summary.shortClosedRows)
    },
    queueTable: _reportsTake_(rows, 15),
    processTable: _reportsTake_(Object.keys(byProcess).map(function(key) {
      return byProcess[key];
    }).sort(function(a, b) {
      return _reportsSafeNumber_(b.pendingQty) - _reportsSafeNumber_(a.pendingQty);
    }), 12)
  };
}

function _reportsBuildInventorySection_() {
  const snapshot = invGetStockSnapshotJSON({ limit: 5000 }) || {};
  const rows = (snapshot.rows || []).map(function(row) {
    return {
      itemCode: row.itemCode || '',
      itemName: row.itemName || '',
      category: row.category || '',
      department: row.department || '',
      qty: _reportsSafeNumber_(row.qty),
      value: _reportsSafeNumber_(row.value),
      movementClass: row.movementClass || '',
      ageingDays: row.ageingDays == null ? '' : _reportsSafeNumber_(row.ageingDays),
      minimumStockLevel: _reportsSafeNumber_(row.minimumStockLevel),
      mslGap: _reportsSafeNumber_(row.mslGap),
      nextBatchNo: row.nextBatchNo || '',
      batchCount: _reportsSafeNumber_(row.batchCount)
    };
  });

  const belowMsl = rows.filter(function(row) { return row.mslGap < 0; });
  const nonMoving = rows.filter(function(row) { return row.movementClass === 'NON_MOVING'; });

  return {
    metrics: {
      itemCount: rows.length,
      stockValue: rows.reduce(function(sum, row) { return sum + _reportsSafeNumber_(row.value); }, 0),
      belowMslItems: belowMsl.length,
      nonMovingItems: nonMoving.length
    },
    belowMslTable: _reportsTake_(belowMsl.sort(function(a, b) {
      return a.mslGap - b.mslGap;
    }), 15),
    nonMovingTable: _reportsTake_(nonMoving.sort(function(a, b) {
      return _reportsSafeNumber_(b.value) - _reportsSafeNumber_(a.value);
    }), 15)
  };
}

function _reportsBuildPurchaseSection_() {
  const payload = purchaseBootstrapJSON({
    requests: { pendingOnly: true },
    orders: { pendingOnly: true },
    plateDie: { pendingOnly: true }
  }) || {};
  const requestRows = (payload.requests || []).map(function(row) {
    return {
      prNo: row.prNo || '',
      itemCode: row.itemCode || '',
      itemName: row.itemName || '',
      department: row.department || '',
      jobRef: row.jobRef || '',
      availableToOrderQty: _reportsSafeNumber_(row.availableToOrderQty),
      openPOQty: _reportsSafeNumber_(row.openPOQty),
      pendingReceiptQty: _reportsSafeNumber_(row.pendingReceiptQty),
      poRate: _reportsSafeNumber_(row.poRate),
      ageingDays: _reportsDateDiffDays_(row.date)
    };
  }).sort(function(a, b) {
    return _reportsSafeNumber_(b.availableToOrderQty) - _reportsSafeNumber_(a.availableToOrderQty);
  });

  const orderRows = (payload.orders || []).map(function(row) {
    return {
      poNo: row.poNo || '',
      orderDate: row.orderDate || '',
      vendorName: row.vendorName || '',
      status: row.status || '',
      totalValue: _reportsSafeNumber_(row.totalValue),
      pendingQty: _reportsSafeNumber_(row.pendingQty),
      lineCount: _reportsSafeNumber_(row.lineCount),
      ageingDays: _reportsDateDiffDays_(row.orderDate)
    };
  }).sort(function(a, b) {
    return _reportsSafeNumber_(b.pendingQty) - _reportsSafeNumber_(a.pendingQty);
  });

  const plateRows = (payload.plateDieJobs || []).map(function(row) {
    const pendingPlate = String(row.statusPlate || '').toUpperCase() !== 'RECEIVED' && String(row.statusPlate || '').toUpperCase() !== 'NA';
    const pendingDie = String(row.statusDie || '').toUpperCase() !== 'RECEIVED' && String(row.statusDie || '').toUpperCase() !== 'NA';
    return {
      artworkNo: row.artworkNo || '',
      client: row.client || '',
      productName: row.productName || '',
      so: row.so || '',
      plateStatus: row.statusPlate || '',
      dieStatus: row.statusDie || '',
      plateVendor: row.plateVendor || '',
      dieVendor: row.dieVendor || '',
      qty: _reportsSafeNumber_(row.qty),
      pendingFlag: pendingPlate || pendingDie ? 'Pending' : 'Closed',
      ageingDays: _reportsDateDiffDays_(row.soDate)
    };
  }).filter(function(row) {
    return row.pendingFlag === 'Pending';
  }).sort(function(a, b) {
    return _reportsSafeNumber_(b.ageingDays) - _reportsSafeNumber_(a.ageingDays);
  });

  return {
    metrics: {
      openPrLines: requestRows.length,
      openPrQty: requestRows.reduce(function(sum, row) { return sum + _reportsSafeNumber_(row.availableToOrderQty); }, 0),
      openPoCount: orderRows.length,
      openPoValue: orderRows.reduce(function(sum, row) { return sum + _reportsSafeNumber_(row.totalValue); }, 0),
      plateDiePending: plateRows.length
    },
    requestTable: _reportsTake_(requestRows, 15),
    orderTable: _reportsTake_(orderRows, 12),
    plateDieTable: _reportsTake_(plateRows, 12)
  };
}

function _reportsBuildSalesBillingSection_() {
  const invoiceHeaders = (supabaseSelect('invoices', {
    select: 'id,invoice_no,invoice_date,client_name,status,grand_total,total_qty,created_by',
    order: 'invoice_date.desc',
    limit: 500
  }) || []).map(function(row) {
    return {
      invoiceNo: row.invoice_no || '',
      invoiceDate: row.invoice_date || '',
      clientName: row.client_name || '',
      status: row.status || '',
      grandTotal: _reportsSafeNumber_(row.grand_total),
      totalQty: _reportsSafeNumber_(row.total_qty),
      createdBy: row.created_by || ''
    };
  });

  const dispatchTotals = {};
  (supabaseSelect('dispatch_records', {
    select: 'so_line_id,dispatch_qty,so_number,line_no,product_name,dispatch_date,created_at',
    order: 'created_at.desc',
    limit: 5000
  }) || []).forEach(function(row) {
    const key = String(row.so_line_id || '');
    if (!key) return;
    if (!dispatchTotals[key]) {
      dispatchTotals[key] = {
        soLineId: key,
        soNumber: row.so_number || '',
        lineNo: row.line_no || '',
        productName: row.product_name || '',
        dispatchDate: row.dispatch_date || row.created_at || '',
        dispatchedQty: 0
      };
    }
    dispatchTotals[key].dispatchedQty += _reportsSafeNumber_(row.dispatch_qty);
  });

  const billedQtyByLine = {};
  (supabaseSelect('invoice_lines', {
    select: 'so_line_id,qty,so_number,line_no',
    limit: 5000
  }) || []).forEach(function(row) {
    const key = String(row.so_line_id || '');
    if (!key) return;
    billedQtyByLine[key] = (billedQtyByLine[key] || 0) + _reportsSafeNumber_(row.qty);
  });

  const unbilledDispatchRows = Object.keys(dispatchTotals).map(function(key) {
    const row = dispatchTotals[key];
    const billedQty = _reportsSafeNumber_(billedQtyByLine[key]);
    const unbilledQty = Math.max(0, _reportsSafeNumber_(row.dispatchedQty) - billedQty);
    return {
      soNumber: row.soNumber,
      lineNo: row.lineNo,
      productName: row.productName,
      dispatchDate: row.dispatchDate,
      dispatchedQty: _reportsSafeNumber_(row.dispatchedQty),
      billedQty: billedQty,
      unbilledQty: unbilledQty,
      ageingDays: _reportsDateDiffDays_(row.dispatchDate)
    };
  }).filter(function(row) {
    return row.unbilledQty > 0;
  }).sort(function(a, b) {
    return _reportsSafeNumber_(b.unbilledQty) - _reportsSafeNumber_(a.unbilledQty);
  });

  return {
    metrics: {
      draftInvoices: invoiceHeaders.filter(function(row) { return String(row.status || '').toUpperCase() === 'DRAFT'; }).length,
      postedInvoices: invoiceHeaders.filter(function(row) { return String(row.status || '').toUpperCase() === 'POSTED'; }).length,
      invoiceValue: invoiceHeaders.reduce(function(sum, row) { return sum + _reportsSafeNumber_(row.grandTotal); }, 0),
      unbilledDispatchQty: unbilledDispatchRows.reduce(function(sum, row) { return sum + _reportsSafeNumber_(row.unbilledQty); }, 0)
    },
    invoiceTable: _reportsTake_(invoiceHeaders, 12),
    unbilledDispatchTable: _reportsTake_(unbilledDispatchRows, 15)
  };
}

function reportsGetDashboardData(token) {
  _requireModuleAccess_(token, 'REPORTS', 'can_view');
  const sections = {
    lifecycle: _reportsBuildLifecycleSection_(token),
    production: _reportsBuildProductionSection_(token),
    inventory: _reportsBuildInventorySection_(),
    purchase: _reportsBuildPurchaseSection_(),
    salesBilling: _reportsBuildSalesBillingSection_()
  };
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    overviewCards: _reportsBuildOverviewCards_(sections),
    sections: sections
  };
}

this.reportsGetDashboardData = reportsGetDashboardData;

this.adminCreateRole = adminCreateRole;
this.adminListRoles = adminListRoles;
this.adminUpdateRole = adminUpdateRole;
this.adminCreateUser = adminCreateUser;
this.adminListUsers = adminListUsers;
this.adminUpdateUser = adminUpdateUser;
this.adminResetUserPassword = adminResetUserPassword;
this.adminListPermissions = adminListPermissions;
this.adminSaveRolePermissions = adminSaveRolePermissions;
this.getSessionUser = getSessionUser;
this.changeOwnPassword = changeOwnPassword;
this.logout = logout;
this.packGetDataset = packGetDataset;
this.dispatchGetDataset = dispatchGetDataset;
this.opsLifecycleGetDetails = opsLifecycleGetDetails;
this.opsLifecycleSaveInline = opsLifecycleSaveInline;
this.opsLifecycleSaveBulk = opsLifecycleSaveBulk;
this.savePackingBulk = savePackingBulk;
this.saveDispatchBulk = saveDispatchBulk;

function _reportsRequireSession_(token) {
  const user = getSessionUser(token);
  if (!user) throw new Error('Unauthorized');
  return user;
}

function _reportsTrySelect_(table, opts) {
  try {
    return supabaseSelect(table, opts || {}) || [];
  } catch (err) {
    return [];
  }
}

function _reportsSelectAll_(table, opts) {
  const base = Object.assign({}, opts || {});
  delete base.limit;
  delete base.offset;

  const pageSize = 1000;
  const out = [];
  let offset = 0;

  while (true) {
    const rows = _reportsTrySelect_(table, Object.assign({}, base, {
      limit: pageSize,
      offset: offset
    }));
    if (!rows.length) break;

    out.push.apply(out, rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return out;
}

function _reportsDateOnly_(value) {
  if (!value) return '';
  const dt = new Date(value);
  if (isNaN(dt.getTime())) return '';
  return Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function _reportsLifecycleState_(row) {
  const accountsApproved = String(row.accounts_status || row.accountsStatus || '').toUpperCase() === 'APPROVED';
  const businessApproved = String(row.business_status || row.businessStatus || '').toUpperCase() === 'APPROVED';
  const artworkApproved = String(row.artwork_status || row.artworkStatus || '').toUpperCase() === 'APPROVED';
  const orderQty = _reportsSafeNumber_(row.order_qty || row.orderQty);
  const packedQty = _reportsSafeNumber_(row.packed_qty || row.packedQty);
  const dispatchedQty = _reportsSafeNumber_(row.dispatched_qty || row.dispatchedQty);
  const billedQty = _reportsSafeNumber_(row.billed_qty || row.billedQty);
  const woCount = _reportsSafeNumber_(row.wo_count || row.woCount);

  if (!accountsApproved || !businessApproved) return 'SALES_APPROVAL';
  if (!artworkApproved) return 'ARTWORK';
  if (woCount <= 0) return 'WO_PENDING';
  if (packedQty <= 0) return 'PRODUCTION_OR_PACKING';
  if (dispatchedQty < orderQty) return 'DISPATCH';
  if (billedQty < dispatchedQty) return 'BILLING';
  return 'COMPLETED';
}

function _reportsTraceabilityRows_() {
  const viewRows = _reportsTrySelect_('v_report_order_line_traceability', {
    order: 'so_date.desc,so_number.asc,line_no.asc',
    limit: 1000
  });
  if (viewRows.length) {
    return viewRows.map(function(row) {
      const state = _reportsLifecycleState_(row);
      return {
        soNumber: row.so_number || '',
        soDate: row.so_date || '',
        clientName: row.client_name || row.client_code || '',
        salesRep: row.sales_rep || '',
        lineNo: row.line_no || '',
        productName: row.product_name || '',
        orderQty: _reportsSafeNumber_(row.order_qty),
        expectedDelivery: row.expected_delivery || '',
        finalDelivery: row.final_delivery || '',
        accountsStatus: row.accounts_status || 'PENDING',
        businessStatus: row.business_status || 'PENDING',
        artworkNo: row.artwork_no || '',
        artworkStatus: row.artwork_status || 'NO_ART',
        plateStatus: row.plate_status || '',
        dieStatus: row.die_status || '',
        woCount: _reportsSafeNumber_(row.wo_count),
        woNumbers: row.wo_numbers || '',
        packedQty: _reportsSafeNumber_(row.packed_qty),
        dispatchedQty: _reportsSafeNumber_(row.dispatched_qty),
        billedQty: _reportsSafeNumber_(row.billed_qty),
        state: state,
        dueDate: row.final_delivery || row.expected_delivery || '',
        ageingDays: _reportsDateDiffDays_(row.so_date),
        overdueDays: _reportsDateDiffDays_(row.final_delivery || row.expected_delivery || '')
      };
    });
  }

  return (listSalesOrders({ limit: 300 }) || []).map(function(row) {
    return {
      soNumber: row.so_number || '',
      soDate: row.so_date || '',
      clientName: row.client_name || row.client_code || '',
      salesRep: row.sales_rep || '',
      lineNo: '',
      productName: '',
      orderQty: 0,
      expectedDelivery: '',
      finalDelivery: '',
      accountsStatus: row.accounts_status || 'PENDING',
      businessStatus: row.business_status || 'PENDING',
      artworkNo: '',
      artworkStatus: 'UNKNOWN',
      plateStatus: '',
      dieStatus: '',
      woCount: String(row.wo_status || '').toUpperCase() === 'CREATED' ? 1 : 0,
      woNumbers: '',
      packedQty: 0,
      dispatchedQty: 0,
      billedQty: 0,
      state: String(row.wo_status || '').toUpperCase() === 'CREATED' ? 'WO_CREATED' : 'WO_PENDING',
      dueDate: '',
      ageingDays: _reportsDateDiffDays_(row.so_date),
      overdueDays: null
    };
  });
}

function _reportsOverviewData_(token, params) {
  _reportsRequireSession_(token);
  const filters = _reportsNormalizeFilters_(params);
  const traceRows = _reportsTraceabilityRows_().filter(function(row) {
    const pendingPass = filters.pendingOnly ? row.state !== 'COMPLETED' : true;
    return pendingPass &&
      _reportsDatePasses_(row.soDate || row.dueDate, filters) &&
      _reportsTextPasses_(row, filters, ['soNumber','clientName','productName','salesRep','state']) &&
      _reportsStatusPasses_(row, filters, ['state','accountsStatus','businessStatus','artworkStatus']);
  });
  const productionRows = _reportsTrySelect_('v_report_production_bottleneck', {
    order: 'balance_qty.desc,wo_date.asc',
    limit: 300
  }).filter(function(row) {
    const pendingPass = filters.pendingOnly ? String(row.status || '').toUpperCase() !== 'COMPLETED' : true;
    return pendingPass &&
      _reportsDatePasses_(row.wo_date || row.expected_delivery, filters) &&
      _reportsTextPasses_(row, filters, ['wo_number','client_name','product_names','process_name']) &&
      _reportsStatusPasses_(row, filters, ['status','process_name']);
  });
  const stock = invGetStockSnapshotJSON({ limit: 1500 }) || { rows: [] };
  const unbilledRows = _reportsTrySelect_('v_report_unbilled_dispatch', {
    order: 'dispatch_date.desc',
    limit: 500
  }).filter(function(row) {
    return _reportsDatePasses_(row.dispatch_date, filters);
  });
  const openPrRows = _reportsTrySelect_('v_purchase_requests_open', {
    filters: _reportsApplyDateFilterToQuery_(filters, 'created_at'),
    order: 'created_at.desc',
    limit: 500
  }).filter(function(row) {
    return _reportsTextPasses_(row, filters, ['pr_no','item_code','item_name','department','job_ref']) &&
      _reportsStatusPasses_(row, filters, ['status']);
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    cards: [
      { label: 'Approval Pending', value: traceRows.filter(function(r){ return r.state === 'SALES_APPROVAL'; }).length, meta: 'Sales order lines pending approval' },
      { label: 'Artwork / WO Pending', value: traceRows.filter(function(r){ return r.state === 'ARTWORK' || r.state === 'WO_PENDING'; }).length, meta: 'Jobs not yet released to floor' },
      { label: 'Production Bottlenecks', value: productionRows.length, meta: 'Rows pending in production queue view' },
      { label: 'Below MSL Items', value: (stock.rows || []).filter(function(r){ return String(r.mslStatus || '') === 'BELOW_MSL'; }).length, meta: 'Inventory replenishment risks' },
      { label: 'Open Purchase Requests', value: openPrRows.length, meta: 'PR lines still open' },
      { label: 'Unbilled Dispatch Qty', value: (unbilledRows || []).reduce(function(sum, r){ return sum + _reportsSafeNumber_(r.unbilled_qty); }, 0), meta: 'Dispatched but not fully billed' }
    ]
  };
}

function _reportsTodayDateKey_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function _reportsShiftDateKey_(dateKey, monthDelta) {
  const raw = String(dateKey || '').trim();
  const base = raw ? new Date(raw + 'T00:00:00') : new Date();
  if (isNaN(base.getTime())) return _reportsTodayDateKey_();
  base.setMonth(base.getMonth() + Number(monthDelta || 0));
  return Utilities.formatDate(base, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function _reportsNormalizeFilters_(params) {
  const p = params || {};
  const out = {
    fromDate: String(p.fromDate || '').trim(),
    toDate: String(p.toDate || '').trim(),
    pendingOnly: p.pendingOnly === true,
    q: String(p.q || '').trim().toLowerCase(),
    status: String(p.status || '').trim().toLowerCase()
  };
  if (!out.pendingOnly) {
    if (!out.fromDate && !out.toDate) {
      out.toDate = _reportsTodayDateKey_();
      out.fromDate = _reportsShiftDateKey_(out.toDate, -1);
    } else if (!out.fromDate && out.toDate) {
      out.fromDate = _reportsShiftDateKey_(out.toDate, -1);
    } else if (out.fromDate && !out.toDate) {
      out.toDate = _reportsTodayDateKey_();
    }
  }
  return out;
}

function _reportsApplyDateFilterToQuery_(filters, columnName) {
  const f = filters || {};
  if (f.pendingOnly) return {};
  const key = String(columnName || '').trim();
  if (!key) return {};
  if (f.fromDate && f.toDate) {
    const out = {};
    out.and = '(' + key + '.gte.' + f.fromDate + ',' + key + '.lte.' + f.toDate + ')';
    return out;
  }
  if (f.fromDate) {
    const out = {};
    out[key] = 'gte.' + f.fromDate;
    return out;
  }
  if (f.toDate) {
    const out = {};
    out[key] = 'lte.' + f.toDate;
    return out;
  }
  return {};
}

function _reportsIsoFromFilterParts_(dateText, timeText, isEnd) {
  const dateKey = String(dateText || '').trim();
  if (!dateKey) return '';
  const timeKey = String(timeText || '').trim() || (isEnd ? '23:59' : '00:00');
  const normalizedTime = timeKey.length === 5 ? (timeKey + ':00') : timeKey;
  return dateKey + 'T' + normalizedTime;
}

function _reportsApplyDateTimeFilterToQuery_(filters, columnName) {
  const f = filters || {};
  if (f.pendingOnly) return {};
  const key = String(columnName || '').trim();
  if (!key) return {};
  const fromIso = _reportsIsoFromFilterParts_(f.fromDate, '', false);
  const toIso = _reportsIsoFromFilterParts_(f.toDate, '', true);
  if (fromIso && toIso) {
    const out = {};
    out.and = '(' + key + '.gte.' + fromIso + ',' + key + '.lte.' + toIso + ')';
    return out;
  }
  if (fromIso) {
    const out = {};
    out[key] = 'gte.' + fromIso;
    return out;
  }
  if (toIso) {
    const out = {};
    out[key] = 'lte.' + toIso;
    return out;
  }
  return {};
}

function _reportsDatePasses_(value, filters) {
  if (!value) return !filters.fromDate && !filters.toDate;
  if (filters.pendingOnly) return true;
  const key = _reportsDateOnly_(value);
  if (!key) return false;
  if (filters.fromDate && key < filters.fromDate) return false;
  if (filters.toDate && key > filters.toDate) return false;
  return true;
}

function _reportsDateTimePasses_(value, filters) {
  if (!value) return !filters.fromDate && !filters.toDate;
  if (filters.pendingOnly) return true;
  const valueTs = new Date(value).getTime();
  if (isNaN(valueTs)) return false;
  const fromIso = _reportsIsoFromFilterParts_(filters.fromDate, '', false);
  const toIso = _reportsIsoFromFilterParts_(filters.toDate, '', true);
  if (fromIso) {
    const fromTs = new Date(fromIso).getTime();
    if (!isNaN(fromTs) && valueTs < fromTs) return false;
  }
  if (toIso) {
    const toTs = new Date(toIso).getTime();
    if (!isNaN(toTs) && valueTs > toTs) return false;
  }
  return true;
}

function _reportsTextPasses_(row, filters, fields) {
  if (!filters.q) return true;
  const hay = (fields || []).map(function(field) {
    return String(row[field] == null ? '' : row[field]);
  }).join(' ').toLowerCase();
  return hay.indexOf(filters.q) !== -1;
}

function _reportsStatusPasses_(row, filters, fields) {
  if (!filters.status) return true;
  return (fields || []).some(function(field) {
    return String(row[field] == null ? '' : row[field]).toLowerCase().indexOf(filters.status) !== -1;
  });
}

function _reportsPlanningRows_(filters) {
  return _reportsSelectAll_('v_report_planning_lines', {
    filters: _reportsApplyDateFilterToQuery_(filters, 'so_date'),
    order: 'so_datetime.desc,so_number.desc,line_no.asc'
  }).map(function(row) {
    const soDateTime = row.so_datetime || row.so_created_at || row.so_date || '';
    return {
      soNumber: row.so_number || '',
      lineNo: row.line_no == null ? '' : String(row.line_no),
      soDate: row.so_date || '',
      soTime: row.so_time || '',
      poNumber: row.po_number || '',
      poDate: row.po_date || '',
      soLineStatus: row.so_line_status || 'OPEN',
      soDateTime: soDateTime,
      salesRep: row.sales_rep || '',
      clientName: row.client_name || row.client_code || '',
      productCode: row.product_code || '',
      productName: row.product_name || '',
      category: row.category || '',
      orderQty: _reportsSafeNumber_(row.order_qty),
      unit: row.unit || '',
      rate: _reportsSafeNumber_(row.rate),
      expectedDelivery: row.expected_delivery || '',
      finalDelivery: row.final_delivery || '',
      accountsStatus: row.accounts_status || 'PENDING',
      accountsAt: row.accounts_at || '',
      businessStatus: row.business_status || 'PENDING',
      businessAt: row.business_at || '',
      salesApprovalStatus: row.sales_approval_status || 'PENDING',
      salesApprovalAt: row.sales_approval_at || '',
      artworkNo: row.artwork_no || '',
      productType: row.product_type || '',
      plateStatus: row.plate_status || '',
      dieStatus: row.die_status || '',
      artworkStatus: row.artwork_status || 'NO_ART',
      artworkAt: row.artwork_at || '',
      artworkApprovedAt: row.artwork_approved_at || '',
      woCount: _reportsSafeNumber_(row.wo_count),
      woNumbers: row.wo_numbers || '',
      routingCount: _reportsSafeNumber_(row.routing_count),
      routingStatus: row.routing_status || 'PENDING',
      routingMarkedAt: row.routing_marked_at || row.first_wo_at || '',
      routingSteps: row.routing_steps || '',
      currentStage: row.current_stage || '',
      currentStageStatus: row.current_stage_status || '',
      stageLastUpdatedAt: row.stage_last_updated_at || '',
      stageSummary: row.stage_summary || '',
      rmAvailabilityStatus: row.rm_availability_status || 'MATERIAL_NOT_DEFINED',
      rmRequiredQty: _reportsSafeNumber_(row.rm_required_qty),
      rmIssuedQty: _reportsSafeNumber_(row.rm_issued_qty),
      rmPendingQty: _reportsSafeNumber_(row.rm_pending_qty),
      rmInStockQty: _reportsSafeNumber_(row.rm_in_stock_qty),
      rmShortageQty: _reportsSafeNumber_(row.rm_shortage_qty),
      rmPendingReceiptQty: _reportsSafeNumber_(row.rm_pending_receipt_qty),
      rmPoNos: row.rm_po_nos || '',
      rmFirstPoDate: row.rm_first_po_date || '',
      rmLatestGrnDate: row.rm_latest_grn_date || '',
      rmReceiptRefs: row.rm_receipt_refs || '',
      rmPrNos: row.rm_pr_nos || '',
      rmDetail: row.rm_detail || '',
      plateProcurementStatus: row.plate_procurement_status || '',
      platePoNos: row.plate_po_nos || '',
      plateOrderedOn: row.plate_ordered_on || '',
      plateReceivedOn: row.plate_received_on || '',
      plateOrderedQty: _reportsSafeNumber_(row.plate_ordered_qty),
      plateReceivedQty: _reportsSafeNumber_(row.plate_received_qty),
      platePendingQty: _reportsSafeNumber_(row.plate_pending_qty),
      plateVendors: row.plate_vendors || '',
      plateReceiptRefs: row.plate_receipt_refs || '',
      dieProcurementStatus: row.die_procurement_status || '',
      diePoNos: row.die_po_nos || '',
      dieOrderedOn: row.die_ordered_on || '',
      dieReceivedOn: row.die_received_on || '',
      dieOrderedQty: _reportsSafeNumber_(row.die_ordered_qty),
      dieReceivedQty: _reportsSafeNumber_(row.die_received_qty),
      diePendingQty: _reportsSafeNumber_(row.die_pending_qty),
      dieVendors: row.die_vendors || '',
      dieReceiptRefs: row.die_receipt_refs || '',
      billingStatus: row.billing_status || 'PENDING',
      billedQty: _reportsSafeNumber_(row.billed_qty),
      billingPendingQty: _reportsSafeNumber_(row.billing_pending_qty),
      invoiceCount: _reportsSafeNumber_(row.invoice_count),
      invoiceNos: row.invoice_nos || '',
      invoiceDates: row.invoice_dates || '',
      firstInvoiceDate: row.first_invoice_date || '',
      lastInvoiceDate: row.last_invoice_date || '',
      lastBilledAt: row.last_billed_at || ''
    };
  }).filter(function(row) {
    const pendingPass = filters.pendingOnly ? String(row.billingStatus || '').toUpperCase() !== 'CLOSED' : true;
    return pendingPass &&
      _reportsDatePasses_(row.soDate, filters) &&
      _reportsTextPasses_(row, filters, [
        'soNumber',
        'poNumber',
        'soLineStatus',
        'lineNo',
        'clientName',
        'productCode',
        'productName',
        'salesRep',
        'artworkNo',
        'woNumbers',
        'routingSteps',
        'stageSummary',
        'rmAvailabilityStatus',
        'rmPoNos',
        'rmPrNos',
        'rmReceiptRefs',
        'rmDetail',
        'plateProcurementStatus',
        'platePoNos',
        'plateVendors',
        'plateReceiptRefs',
        'dieProcurementStatus',
        'diePoNos',
        'dieVendors',
        'dieReceiptRefs',
        'invoiceNos'
      ]) &&
      _reportsStatusPasses_(row, filters, [
        'accountsStatus',
        'businessStatus',
        'salesApprovalStatus',
        'soLineStatus',
        'artworkStatus',
        'routingStatus',
        'currentStageStatus',
        'rmAvailabilityStatus',
        'plateProcurementStatus',
        'dieProcurementStatus',
        'billingStatus',
        'plateStatus',
        'dieStatus'
      ]);
  });
}

function _reportsSectionPlanning_(token, params) {
  _reportsRequireSession_(token);
  const filters = _reportsNormalizeFilters_(params);
  const rows = _reportsPlanningRows_(filters);
  return {
    ok: true,
    title: 'Planning Lifecycle',
    metrics: {
      totalRows: rows.length,
      billingPending: rows.filter(function(r){ return String(r.billingStatus || '').toUpperCase() !== 'CLOSED'; }).length,
      closedRows: rows.filter(function(r){ return String(r.billingStatus || '').toUpperCase() === 'CLOSED'; }).length,
      salesApprovalPending: rows.filter(function(r){ return String(r.salesApprovalStatus || '').toUpperCase() !== 'APPROVED'; }).length,
      artworkOrRoutingPending: rows.filter(function(r){
        return String(r.artworkStatus || '').toUpperCase() !== 'APPROVED' ||
          String(r.routingStatus || '').toUpperCase() !== 'MARKED';
      }).length
    },
    tables: [{
      key: 'planning',
      title: 'Planning Report',
      subtitle: 'One row per sales order line from approval through invoicing. Pending only means billing is not closed yet.',
      minWidth: 5200,
      columns: [
        { key:'soNumber', label:'SO No' },
        { key:'lineNo', label:'Line' },
        { key:'soDate', label:'SO Date', type:'date' },
        { key:'soTime', label:'SO Time' },
        { key:'poNumber', label:'PO No' },
        { key:'poDate', label:'PO Date', type:'date' },
        { key:'soLineStatus', label:'SO Line Status', type:'status' },
        { key:'salesRep', label:'Sales Rep' },
        { key:'clientName', label:'Client' },
        { key:'productCode', label:'Product Code' },
        { key:'productName', label:'Product' },
        { key:'category', label:'Category' },
        { key:'orderQty', label:'Order Qty', type:'number' },
        { key:'unit', label:'Unit' },
        { key:'rate', label:'Rate', type:'money' },
        { key:'expectedDelivery', label:'Expected Delivery', type:'date' },
        { key:'finalDelivery', label:'Final Delivery', type:'date' },
        { key:'accountsStatus', label:'Accounts Approval', type:'status' },
        { key:'accountsAt', label:'Accounts Time', type:'datetime' },
        { key:'businessStatus', label:'Business Approval', type:'status' },
        { key:'businessAt', label:'Business Time', type:'datetime' },
        { key:'salesApprovalStatus', label:'SO Approval', type:'status' },
        { key:'salesApprovalAt', label:'SO Approval Time', type:'datetime' },
        { key:'artworkNo', label:'Artwork No' },
        { key:'productType', label:'Artwork Type' },
        { key:'plateStatus', label:'Plate', type:'status' },
        { key:'dieStatus', label:'Die', type:'status' },
        { key:'artworkStatus', label:'Artwork Approval', type:'status' },
        { key:'artworkAt', label:'Artwork Created', type:'datetime' },
        { key:'artworkApprovedAt', label:'Artwork Approval Time', type:'datetime' },
        { key:'woCount', label:'WO Count', type:'number' },
        { key:'woNumbers', label:'WO Nos' },
        { key:'routingCount', label:'Routing Rows', type:'number' },
        { key:'routingStatus', label:'Routing Marked', type:'status' },
        { key:'routingMarkedAt', label:'Routing Marked Time', type:'datetime' },
        { key:'routingSteps', label:'Routing Steps' },
        { key:'currentStage', label:'Current Stage' },
        { key:'currentStageStatus', label:'Stage Status', type:'status' },
        { key:'stageLastUpdatedAt', label:'Stage Update Time', type:'datetime' },
        { key:'stageSummary', label:'Stage Qty Update' },
        { key:'rmAvailabilityStatus', label:'RM Availability', type:'status' },
        { key:'rmRequiredQty', label:'RM Required Qty', type:'number' },
        { key:'rmIssuedQty', label:'RM Issued Qty', type:'number' },
        { key:'rmPendingQty', label:'RM Pending Qty', type:'number' },
        { key:'rmInStockQty', label:'RM In Stock Qty', type:'number' },
        { key:'rmShortageQty', label:'RM Shortage Qty', type:'number' },
        { key:'rmPoNos', label:'RM PO Nos' },
        { key:'rmFirstPoDate', label:'RM PO Date', type:'date' },
        { key:'rmPendingReceiptQty', label:'RM Pending Receipt Qty', type:'number' },
        { key:'rmLatestGrnDate', label:'RM Latest GRN Date', type:'date' },
        { key:'rmReceiptRefs', label:'RM GRN / Receipt Refs' },
        { key:'rmPrNos', label:'RM PR Nos' },
        { key:'rmDetail', label:'RM Detail' },
        { key:'plateProcurementStatus', label:'Plate Procurement', type:'status' },
        { key:'platePoNos', label:'Plate PO Nos' },
        { key:'plateOrderedOn', label:'Plate Order Date', type:'date' },
        { key:'plateReceivedOn', label:'Plate Receipt Date', type:'date' },
        { key:'platePendingQty', label:'Plate Pending Qty', type:'number' },
        { key:'plateVendors', label:'Plate Vendor' },
        { key:'plateReceiptRefs', label:'Plate Receipt Refs' },
        { key:'dieProcurementStatus', label:'Die Procurement', type:'status' },
        { key:'diePoNos', label:'Die PO Nos' },
        { key:'dieOrderedOn', label:'Die Order Date', type:'date' },
        { key:'dieReceivedOn', label:'Die Receipt Date', type:'date' },
        { key:'diePendingQty', label:'Die Pending Qty', type:'number' },
        { key:'dieVendors', label:'Die Vendor' },
        { key:'dieReceiptRefs', label:'Die Receipt Refs' },
        { key:'billingStatus', label:'Billing Status', type:'status' },
        { key:'billedQty', label:'Billed Qty', type:'number' },
        { key:'billingPendingQty', label:'Pending Qty', type:'number' },
        { key:'invoiceCount', label:'Invoice Count', type:'number' },
        { key:'invoiceNos', label:'Invoice Nos' },
        { key:'invoiceDates', label:'Invoice Dates' },
        { key:'firstInvoiceDate', label:'First Invoice Date', type:'date' },
        { key:'lastInvoiceDate', label:'Last Invoice Date', type:'date' },
        { key:'lastBilledAt', label:'Last Billing Time', type:'datetime' }
      ],
      rows: rows
    }]
  };
}

function _reportsSalesOrderRows_(filters) {
  return _reportsSelectAll_('v_report_planning_lines', {
    filters: _reportsApplyDateFilterToQuery_(filters, 'so_date'),
    order: 'so_datetime.desc,so_number.desc,line_no.asc'
  }).map(function(row) {
    const orderQty = _reportsSafeNumber_(row.order_qty);
    const rate = _reportsSafeNumber_(row.rate);
    const soDateTime = row.so_datetime || row.so_created_at || row.so_date || '';
    return {
      soNumber: row.so_number || '',
      lineNo: row.line_no == null ? '' : String(row.line_no),
      soDate: row.so_date || '',
      soTime: row.so_time || '',
      poNumber: row.po_number || '',
      poDate: row.po_date || '',
      soDateTime: soDateTime,
      salesRep: row.sales_rep || '',
      clientName: row.client_name || row.client_code || '',
      division: row.division || '',
      productCode: row.product_code || '',
      productName: row.product_name || '',
      category: row.category || '',
      orderQty: orderQty,
      unit: row.unit || '',
      rate: rate,
      lineAmount: Math.round(orderQty * rate * 100) / 100,
      expectedDelivery: row.expected_delivery || '',
      finalDelivery: row.final_delivery || '',
      accountsStatus: row.accounts_status || 'PENDING',
      businessStatus: row.business_status || 'PENDING',
      salesApprovalStatus: row.sales_approval_status || 'PENDING',
      billingStatus: row.billing_status || 'PENDING',
      billedQty: _reportsSafeNumber_(row.billed_qty),
      billingPendingQty: _reportsSafeNumber_(row.billing_pending_qty),
      invoiceNos: row.invoice_nos || '',
      invoiceDates: row.invoice_dates || ''
    };
  }).filter(function(row) {
    const pendingPass = filters.pendingOnly ? String(row.billingStatus || '').toUpperCase() !== 'CLOSED' : true;
    return pendingPass &&
      _reportsDatePasses_(row.soDate, filters) &&
      _reportsTextPasses_(row, filters, [
        'soNumber',
        'poNumber',
        'lineNo',
        'clientName',
        'salesRep',
        'division',
        'productCode',
        'productName',
        'category',
        'invoiceNos'
      ]) &&
      _reportsStatusPasses_(row, filters, [
        'accountsStatus',
        'businessStatus',
        'salesApprovalStatus',
        'billingStatus',
        'division',
        'category'
      ]);
  });
}

function _reportsSectionSalesOrders_(token, params) {
  _reportsRequireSession_(token);
  const filters = _reportsNormalizeFilters_(params);
  const rows = _reportsSalesOrderRows_(filters);
  const divisions = {};
  rows.forEach(function(row) {
    const key = String(row.division || '').trim();
    if (key) divisions[key] = true;
  });
  return {
    ok: true,
    title: 'Sales Order Lines',
    metrics: {
      totalRows: rows.length,
      totalQty: Math.round(rows.reduce(function(sum, row){ return sum + _reportsSafeNumber_(row.orderQty); }, 0) * 100) / 100,
      totalValue: Math.round(rows.reduce(function(sum, row){ return sum + _reportsSafeNumber_(row.lineAmount); }, 0) * 100) / 100,
      divisions: Object.keys(divisions).length,
      approvalPending: rows.filter(function(r){ return String(r.salesApprovalStatus || '').toUpperCase() !== 'APPROVED'; }).length,
      billingPending: rows.filter(function(r){ return String(r.billingStatus || '').toUpperCase() !== 'CLOSED'; }).length
    },
    tables: [{
      key: 'salesorders',
      title: 'Sales Order Item Lines',
      subtitle: 'One row per sales order item line. Pending only means the line is not fully billed / closed.',
      minWidth: 2500,
      columns: [
        { key:'soNumber', label:'SO No' },
        { key:'lineNo', label:'Line' },
        { key:'soDate', label:'SO Date', type:'date' },
        { key:'soTime', label:'SO Time' },
        { key:'poNumber', label:'PO No' },
        { key:'poDate', label:'PO Date', type:'date' },
        { key:'salesRep', label:'Sales Rep' },
        { key:'clientName', label:'Client' },
        { key:'division', label:'Division' },
        { key:'productCode', label:'Product Code' },
        { key:'productName', label:'Product' },
        { key:'category', label:'Category' },
        { key:'orderQty', label:'Order Qty', type:'number' },
        { key:'unit', label:'Unit' },
        { key:'rate', label:'Rate', type:'money' },
        { key:'lineAmount', label:'Line Amount', type:'money' },
        { key:'expectedDelivery', label:'Expected Delivery', type:'date' },
        { key:'finalDelivery', label:'Final Delivery', type:'date' },
        { key:'accountsStatus', label:'Accounts Approval', type:'status' },
        { key:'businessStatus', label:'Business Approval', type:'status' },
        { key:'salesApprovalStatus', label:'SO Approval', type:'status' },
        { key:'billingStatus', label:'Billing Status', type:'status' },
        { key:'billedQty', label:'Billed Qty', type:'number' },
        { key:'billingPendingQty', label:'Pending Qty', type:'number' },
        { key:'invoiceNos', label:'Invoice Nos' },
        { key:'invoiceDates', label:'Invoice Dates' }
      ],
      rows: rows
    }]
  };
}

function _reportsInventoryReceiptMetaByPrNo_(prNos) {
  const ids = [...new Set((prNos || []).map(function(prNo) {
    return String(prNo || '').trim();
  }).filter(Boolean))];
  const out = {};
  if (!ids.length) return out;

  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40);
    const rows = supabaseSelect('inv_ledger', {
      select: 'id,ref_no,created_at,qty_in,remarks',
      filters: {
        ref_type: 'eq.PR-RECEIPT',
        ref_no: _supabaseInFilter_(chunk)
      },
      order: 'created_at.desc',
      limit: 5000
    }) || [];

    rows.forEach(function(row) {
      const prNo = String(row.ref_no || '').trim();
      if (!prNo) return;
      if (!out[prNo]) {
        out[prNo] = {
          receiptCount: 0,
          totalReceiptQty: 0,
          lastReceiptAt: '',
          lastReceiptId: '',
          lastGrnNo: '',
          grnNos: [],
          invoiceNos: []
        };
      }

      const note = invParseReceiptNote_(row.remarks);
      const grnNo = String(note.GRN || '').trim();
      const invoiceNo = String(note.INV || '').trim();
      const meta = out[prNo];

      meta.receiptCount += 1;
      meta.totalReceiptQty += _reportsSafeNumber_(row.qty_in);

      if (grnNo && meta.grnNos.indexOf(grnNo) === -1) meta.grnNos.push(grnNo);
      if (invoiceNo && meta.invoiceNos.indexOf(invoiceNo) === -1) meta.invoiceNos.push(invoiceNo);

      const rowAt = String(row.created_at || '');
      if (rowAt && (!meta.lastReceiptAt || rowAt > meta.lastReceiptAt)) {
        meta.lastReceiptAt = rowAt;
        meta.lastReceiptId = String(row.id || '');
        meta.lastGrnNo = grnNo || '';
      }
    });
  }

  Object.keys(out).forEach(function(key) {
    out[key].grnDisplay = out[key].grnNos.join(', ');
    out[key].invoiceDisplay = out[key].invoiceNos.join(', ');
    out[key].lastReceiptRef = out[key].lastGrnNo || out[key].lastReceiptId || '';
  });

  return out;
}

function _reportsSectionPOLines_(token, params) {
  _reportsRequireSession_(token);
  const filters = _reportsNormalizeFilters_(params);
  const poPayload = purchaseListPOsJSON({
    fromDate: filters.pendingOnly ? '' : filters.fromDate,
    toDate: filters.pendingOnly ? '' : filters.toDate,
    pendingOnly: false
  }) || { rows: [] };

  const prNos = [];
  (poPayload.rows || []).forEach(function(po) {
    (po.lines || []).forEach(function(line) {
      if (String(line.sourceType || '').toUpperCase() !== 'INVENTORY_PR') return;
      const prNo = String(line.sourceRef || '').trim();
      if (prNo && prNos.indexOf(prNo) === -1) prNos.push(prNo);
    });
  });
  const receiptMetaByPrNo = _reportsInventoryReceiptMetaByPrNo_(prNos);

  const rows = [];
  (poPayload.rows || []).forEach(function(po) {
    (po.lines || []).forEach(function(line) {
      const sourceType = String(line.sourceType || '').trim();
      const isInventoryPR = sourceType.toUpperCase() === 'INVENTORY_PR';
      const receiptEntries = Array.isArray(line.receiptEntries) ? line.receiptEntries.slice() : [];
      receiptEntries.sort(function(a, b) {
        return String(b.receiptDate || b.createdAt || '').localeCompare(String(a.receiptDate || a.createdAt || ''));
      });
      const lastReceipt = receiptEntries[0] || null;
      const prMeta = isInventoryPR ? (receiptMetaByPrNo[String(line.sourceRef || '').trim()] || {}) : {};
      const receiptRefs = isInventoryPR
        ? (prMeta.grnDisplay || '')
        : [...new Set(receiptEntries.map(function(entry) {
            return String(entry.challanNo || entry.id || '').trim();
          }).filter(Boolean))].join(', ');
      const latestReceiptRef = isInventoryPR
        ? (prMeta.lastReceiptRef || '')
        : String(lastReceipt && (lastReceipt.challanNo || lastReceipt.id) || '').trim();
      const latestReceiptDate = isInventoryPR
        ? (prMeta.lastReceiptAt || '')
        : (lastReceipt && (lastReceipt.receiptDate || lastReceipt.createdAt) || '');
      const orderedQty = _reportsSafeNumber_(line.qty);
      const receivedQty = _reportsSafeNumber_(line.receivedQty);
      const pendingQty = _reportsSafeNumber_(line.pendingQty);

      rows.push({
        poNo: po.poNo || '',
        orderDate: po.orderDate || '',
        vendorName: po.vendorName || '',
        poStatus: po.status || 'OPEN',
        buyerName: po.buyerName || '',
        workflow: po.workflow || '',
        lineNo: _reportsSafeNumber_(line.lineNo),
        itemCode: line.itemCode || '',
        itemName: line.itemName || '',
        department: line.department || '',
        jobRef: line.jobRef || '',
        sourceType: sourceType,
        sourceRef: line.sourceRef || '',
        orderedQty: orderedQty,
        rate: _reportsSafeNumber_(line.rate),
        taxPct: _reportsSafeNumber_(line.taxPct),
        amount: _reportsSafeNumber_(line.amount),
        taxAmount: _reportsSafeNumber_(line.taxAmount),
        totalAmount: _reportsSafeNumber_(line.totalAmount || line.amount),
        receivedQty: receivedQty,
        pendingQty: pendingQty,
        receiptStatus: pendingQty > 0 ? 'PENDING' : 'MATERIAL_RECEIVED',
        receiptCount: isInventoryPR ? _reportsSafeNumber_(prMeta.receiptCount) : receiptEntries.length,
        receiptRefs: receiptRefs,
        latestReceiptRef: latestReceiptRef,
        latestReceiptDate: latestReceiptDate,
        remarks: line.remarks || '',
        paymentTerms: po.paymentTerms || '',
        freightTerms: po.freightTerms || ''
      });
    });
  });

  const finalRows = rows
    .filter(function(row) {
      const pendingPass = filters.pendingOnly ? _reportsSafeNumber_(row.pendingQty) > 0 : true;
      return pendingPass &&
        _reportsDatePasses_(row.orderDate, filters) &&
        _reportsTextPasses_(row, filters, [
          'poNo',
          'vendorName',
          'buyerName',
          'itemCode',
          'itemName',
          'department',
          'jobRef',
          'sourceType',
          'sourceRef',
          'latestReceiptRef',
          'receiptRefs',
          'workflow'
        ]) &&
        _reportsStatusPasses_(row, filters, [
          'receiptStatus',
          'poStatus',
          'workflow',
          'sourceType'
        ]);
    })
    .sort(function(a, b) {
      return String(b.orderDate || '').localeCompare(String(a.orderDate || '')) ||
        String(b.poNo || '').localeCompare(String(a.poNo || '')) ||
        _reportsSafeNumber_(a.lineNo) - _reportsSafeNumber_(b.lineNo);
    });

  return {
    ok: true,
    title: 'Purchase Order Item Lines',
    metrics: {
      totalLines: finalRows.length,
      pendingLines: finalRows.filter(function(row){ return _reportsSafeNumber_(row.pendingQty) > 0; }).length,
      receivedLines: finalRows.filter(function(row){ return _reportsSafeNumber_(row.pendingQty) <= 0; }).length,
      pendingQty: finalRows.reduce(function(sum, row){ return sum + _reportsSafeNumber_(row.pendingQty); }, 0)
    },
    tables: [{
      key: 'poLines',
      title: 'Purchase Order Line Receipt Status',
      subtitle: 'One row per PO item line. Pending only shows lines where required quantity is not fully received / GRN-completed.',
      minWidth: 2550,
      columns: [
        { key:'poNo', label:'PO No' },
        { key:'orderDate', label:'PO Date', type:'date' },
        { key:'vendorName', label:'Vendor' },
        { key:'poStatus', label:'PO Status', type:'status' },
        { key:'buyerName', label:'Buyer' },
        { key:'workflow', label:'Workflow', type:'status' },
        { key:'lineNo', label:'Line', type:'number' },
        { key:'itemCode', label:'Item Code' },
        { key:'itemName', label:'Item Name' },
        { key:'department', label:'Department' },
        { key:'jobRef', label:'Job Ref' },
        { key:'sourceType', label:'Source Type', type:'status' },
        { key:'sourceRef', label:'Source Ref' },
        { key:'orderedQty', label:'Ordered Qty', type:'number' },
        { key:'rate', label:'Rate', type:'money' },
        { key:'taxPct', label:'Tax %', type:'number' },
        { key:'amount', label:'Basic Amount', type:'money' },
        { key:'taxAmount', label:'Tax Amount', type:'money' },
        { key:'totalAmount', label:'Line Total', type:'money' },
        { key:'receivedQty', label:'Received Qty', type:'number' },
        { key:'pendingQty', label:'Pending Qty', type:'number' },
        { key:'receiptStatus', label:'Receipt Status', type:'status' },
        { key:'receiptCount', label:'Receipt Count', type:'number' },
        { key:'latestReceiptRef', label:'Latest GRN / Receipt' },
        { key:'latestReceiptDate', label:'Latest Receipt Date', type:'datetime' },
        { key:'receiptRefs', label:'GRN / Receipt Refs' },
        { key:'paymentTerms', label:'Payment Terms' },
        { key:'freightTerms', label:'Freight Terms' },
        { key:'remarks', label:'Line Remarks' }
      ],
      rows: finalRows
    }]
  };
}

function _reportsPRLifecycleStatus_(row) {
  const pendingReceiptQty = _reportsSafeNumber_(row.pendingReceiptQty);
  const orderedQty = _reportsSafeNumber_(row.orderedQty);
  const availableToOrderQty = _reportsSafeNumber_(row.availableToOrderQty);
  const receivedQty = _reportsSafeNumber_(row.receivedQty);

  if (pendingReceiptQty <= 0) return 'MATERIAL_RECEIVED';
  if (orderedQty <= 0) return 'PO_PENDING';
  if (availableToOrderQty > 0) return 'PO_PARTIAL';
  if (receivedQty > 0) return 'GRN_PARTIAL';
  return 'GRN_PENDING';
}

function _reportsSectionPRLifecycle_(token, params) {
  _reportsRequireSession_(token);
  const filters = _reportsNormalizeFilters_(params);
  const payload = purchaseListInventoryRequestsJSON({
    fromDate: filters.pendingOnly ? '' : filters.fromDate,
    toDate: filters.pendingOnly ? '' : filters.toDate,
    pendingOnly: false
  }) || { rows: [] };

  const prNos = (payload.rows || []).map(function(row) {
    return row.prNo || '';
  }).filter(Boolean);
  const receiptMetaByPrNo = _reportsInventoryReceiptMetaByPrNo_(prNos);

  const rows = (payload.rows || []).map(function(row) {
    const prNo = String(row.prNo || '').trim();
    const receiptMeta = receiptMetaByPrNo[prNo] || {};
    const normalized = {
      prNo: prNo,
      requestDate: row.date || '',
      itemCode: row.itemCode || '',
      itemName: row.itemName || '',
      department: row.department || '',
      jobRef: row.jobRef || '',
      requestedQty: _reportsSafeNumber_(row.requestedQty),
      orderedQty: _reportsSafeNumber_(row.orderedQty),
      openPOQty: _reportsSafeNumber_(row.openPOQty),
      availableToOrderQty: _reportsSafeNumber_(row.availableToOrderQty),
      receivedQty: _reportsSafeNumber_(row.receivedQty),
      pendingReceiptQty: _reportsSafeNumber_(row.pendingReceiptQty),
      poRate: _reportsSafeNumber_(row.poRate),
      taxPct: _reportsSafeNumber_(row.taxPct),
      poRefs: Array.isArray(row.poRefs) ? row.poRefs.join(', ') : (row.poRefs || ''),
      receiptCount: _reportsSafeNumber_(receiptMeta.receiptCount),
      latestGrnNo: receiptMeta.lastGrnNo || '',
      latestGrnDate: receiptMeta.lastReceiptAt || '',
      grnRefs: receiptMeta.grnDisplay || '',
      invoiceRefs: receiptMeta.invoiceDisplay || '',
      remarks: row.remarks || '',
      prStatus: row.status || 'OPEN'
    };
    normalized.lifecycleStatus = _reportsPRLifecycleStatus_(normalized);
    return normalized;
  }).filter(function(row) {
    const pendingPass = filters.pendingOnly ? _reportsSafeNumber_(row.pendingReceiptQty) > 0 : true;
    return pendingPass &&
      _reportsDatePasses_(row.requestDate, filters) &&
      _reportsTextPasses_(row, filters, [
        'prNo',
        'itemCode',
        'itemName',
        'department',
        'jobRef',
        'poRefs',
        'latestGrnNo',
        'grnRefs',
        'invoiceRefs',
        'remarks'
      ]) &&
      _reportsStatusPasses_(row, filters, [
        'lifecycleStatus',
        'prStatus'
      ]);
  }).sort(function(a, b) {
    return String(b.requestDate || '').localeCompare(String(a.requestDate || '')) ||
      String(b.prNo || '').localeCompare(String(a.prNo || ''));
  });

  return {
    ok: true,
    title: 'Purchase Request Lifecycle',
    metrics: {
      totalRows: rows.length,
      poPendingRows: rows.filter(function(r){
        return ['PO_PENDING','PO_PARTIAL'].indexOf(String(r.lifecycleStatus || '').toUpperCase()) !== -1;
      }).length,
      grnPendingRows: rows.filter(function(r){
        return ['GRN_PENDING','GRN_PARTIAL'].indexOf(String(r.lifecycleStatus || '').toUpperCase()) !== -1;
      }).length,
      pendingQty: rows.reduce(function(sum, row){ return sum + _reportsSafeNumber_(row.pendingReceiptQty); }, 0)
    },
    tables: [{
      key: 'prLifecycle',
      title: 'Purchase Request To PO / GRN',
      subtitle: 'Tracks each purchase request from request creation through PO generation and final material GRN / receipt.',
      minWidth: 2350,
      columns: [
        { key:'prNo', label:'PR No' },
        { key:'requestDate', label:'PR Date', type:'date' },
        { key:'prStatus', label:'PR Status', type:'status' },
        { key:'lifecycleStatus', label:'Lifecycle Status', type:'status' },
        { key:'itemCode', label:'Item Code' },
        { key:'itemName', label:'Item Name' },
        { key:'department', label:'Department' },
        { key:'jobRef', label:'Job Ref' },
        { key:'requestedQty', label:'Requested Qty', type:'number' },
        { key:'orderedQty', label:'PO Qty', type:'number' },
        { key:'openPOQty', label:'Open PO Qty', type:'number' },
        { key:'availableToOrderQty', label:'Yet To PO', type:'number' },
        { key:'receivedQty', label:'GRN Qty', type:'number' },
        { key:'pendingReceiptQty', label:'Pending GRN Qty', type:'number' },
        { key:'poRate', label:'PO Rate', type:'money' },
        { key:'taxPct', label:'Tax %', type:'number' },
        { key:'poRefs', label:'PO Refs' },
        { key:'receiptCount', label:'GRN Count', type:'number' },
        { key:'latestGrnNo', label:'Latest GRN' },
        { key:'latestGrnDate', label:'Latest GRN Date', type:'datetime' },
        { key:'grnRefs', label:'GRN Refs' },
        { key:'invoiceRefs', label:'Invoice Refs' },
        { key:'remarks', label:'Remarks' }
      ],
      rows: rows
    }]
  };
}

function _reportsSectionTraceability_(token, params) {
  _reportsRequireSession_(token);
  const filters = _reportsNormalizeFilters_(params);
  const rows = _reportsTraceabilityRows_().filter(function(row) {
    const pendingPass = filters.pendingOnly ? row.state !== 'COMPLETED' : true;
    return pendingPass &&
      _reportsDatePasses_(row.soDate || row.dueDate, filters) &&
      _reportsTextPasses_(row, filters, ['soNumber','clientName','productName','salesRep','woNumbers','artworkNo','state']) &&
      _reportsStatusPasses_(row, filters, ['state','accountsStatus','businessStatus','artworkStatus','plateStatus','dieStatus']);
  });
  return {
    ok: true,
    title: 'SO Line Traceability',
    metrics: {
      totalRows: rows.length,
      approvalPending: rows.filter(function(r){ return r.state === 'SALES_APPROVAL'; }).length,
      artworkPending: rows.filter(function(r){ return r.state === 'ARTWORK'; }).length,
      woPending: rows.filter(function(r){ return r.state === 'WO_PENDING'; }).length,
      unbilledLines: rows.filter(function(r){ return r.state === 'BILLING'; }).length
    },
    tables: [{
      key: 'traceability',
      title: 'Order Line Traceability',
      subtitle: 'One row per sales order line with approval, artwork, work order, dispatch, and billing position.',
      columns: [
        { key:'soNumber', label:'SO No' },
        { key:'lineNo', label:'Line' },
        { key:'clientName', label:'Client' },
        { key:'productName', label:'Product' },
        { key:'state', label:'Stage', type:'status' },
        { key:'woNumbers', label:'WO Nos' },
        { key:'dispatchedQty', label:'Dispatch Qty', type:'number' },
        { key:'billedQty', label:'Billed Qty', type:'number' }
      ],
      rows: _reportsTake_(rows, 60)
    }]
  };
}

function _reportsSectionDelay_(token, params) {
  _reportsRequireSession_(token);
  const filters = _reportsNormalizeFilters_(params);
  const rows = _reportsTraceabilityRows_()
    .map(function(row) {
      const dueDate = row.finalDelivery || row.expectedDelivery || '';
      const overdueDays = dueDate ? _reportsDateDiffDays_(dueDate) : null;
      return Object.assign({}, row, {
        bottleneck: row.state,
        overdueDays: dueDate ? overdueDays : null
      });
    })
    .filter(function(row) {
      const pendingPass = filters.pendingOnly ? row.state !== 'COMPLETED' : true;
      return pendingPass &&
        row.state !== 'COMPLETED' &&
        row.overdueDays != null &&
        row.overdueDays > 0 &&
        _reportsDatePasses_(row.dueDate, filters) &&
        _reportsTextPasses_(row, filters, ['soNumber','clientName','productName','bottleneck']) &&
        _reportsStatusPasses_(row, filters, ['bottleneck']);
    })
    .sort(function(a, b) {
      return _reportsSafeNumber_(b.overdueDays) - _reportsSafeNumber_(a.overdueDays);
    });

  return {
    ok: true,
    title: 'Delay Attribution',
    metrics: {
      overdueRows: rows.length,
      approvalDelays: rows.filter(function(r){ return r.bottleneck === 'SALES_APPROVAL'; }).length,
      artworkDelays: rows.filter(function(r){ return r.bottleneck === 'ARTWORK'; }).length,
      executionDelays: rows.filter(function(r){ return ['WO_PENDING','PRODUCTION_OR_PACKING','DISPATCH'].indexOf(r.bottleneck) !== -1; }).length
    },
    tables: [{
      key: 'delays',
      title: 'Delayed Orders',
      subtitle: 'Orders overdue against expected or final delivery with current blocking stage.',
      columns: [
        { key:'soNumber', label:'SO No' },
        { key:'lineNo', label:'Line' },
        { key:'clientName', label:'Client' },
        { key:'dueDate', label:'Due Date', type:'date' },
        { key:'bottleneck', label:'Blocked At', type:'status' },
        { key:'overdueDays', label:'Overdue Days', type:'number' }
      ],
      rows: _reportsTake_(rows, 60)
    }]
  };
}

function _reportsSectionProduction_(token, params) {
  _reportsRequireSession_(token);
  const filters = _reportsNormalizeFilters_(params);
  const rows = _reportsTrySelect_('v_report_production_bottleneck', {
    filters: _reportsApplyDateFilterToQuery_(filters, 'expected_delivery'),
    order: 'balance_qty.desc,wo_date.asc',
    limit: 1000
  });
  const finalRows = rows.length ? rows.map(function(row) {
    return {
      woNumber: row.wo_number || '',
      processName: row.process_name || '',
      clientName: row.client_name || '',
      productNames: row.product_names || '',
      plannedMachine: row.planned_machine || '',
      balanceQty: _reportsSafeNumber_(row.balance_qty),
      status: row.status || '',
      expectedDelivery: row.expected_delivery || '',
      ageingDays: _reportsDateDiffDays_(row.wo_date || row.expected_delivery || '')
    };
  }) : (prodGetStageQueue({ showPendingAll: true }, token).rows || []).map(function(row) {
    return {
      woNumber: row.workOrderNo || '',
      processName: row.processName || '',
      clientName: row.clientName || '',
      productNames: row.productName || '',
      plannedMachine: row.plannedMachine || '',
      balanceQty: _reportsSafeNumber_(row.balanceQty),
      status: row.status || '',
      expectedDelivery: row.expectedDelivery || '',
      ageingDays: _reportsDateDiffDays_(row.woDate || row.expectedDelivery || '')
    };
  }).filter(function(row) {
    const pendingPass = filters.pendingOnly ? String(row.status || '').toUpperCase() !== 'COMPLETED' : true;
    return pendingPass &&
      _reportsDatePasses_(row.expectedDelivery, filters) &&
      _reportsTextPasses_(row, filters, ['woNumber','processName','clientName','productNames','plannedMachine']) &&
      _reportsStatusPasses_(row, filters, ['status','processName']);
  });

  return {
    ok: true,
    title: 'Production Bottleneck',
    metrics: {
      totalRows: finalRows.length,
      holdRows: finalRows.filter(function(r){ return String(r.status || '').toUpperCase() === 'HOLD'; }).length,
      inProgressRows: finalRows.filter(function(r){ return String(r.status || '').toUpperCase() === 'IN_PROGRESS'; }).length,
      pendingQty: finalRows.reduce(function(sum, r){ return sum + _reportsSafeNumber_(r.balanceQty); }, 0)
    },
    tables: [{
      key: 'production',
      title: 'Production Stage Backlog',
      subtitle: 'Open production rows ordered by pending quantity.',
      columns: [
        { key:'woNumber', label:'WO No' },
        { key:'processName', label:'Process' },
        { key:'clientName', label:'Client' },
        { key:'plannedMachine', label:'Machine' },
        { key:'balanceQty', label:'Balance Qty', type:'number' },
        { key:'status', label:'Status', type:'status' }
      ],
      rows: _reportsTake_(finalRows, 60)
    }]
  };
}

function _reportsMachineLoadStandards_() {
  return [
    { key:'SM74', machine:'Heidelberg SM74', makeReady:30, target:4125 },
    { key:'CD102', machine:'CD102', makeReady:30, target:4125 },
    { key:'LAMINATION', machine:'Lamination', makeReady:10, target:2200 },
    { key:'LAM1', machine:'Lamination Roll-1', makeReady:10, target:1100 },
    { key:'LAM2', machine:'Lamination 02', makeReady:10, target:1100 },
    { key:'LAM3', machine:'Lamination 03', makeReady:10, target:1100 },
    { key:'DIEOFFSET', machine:'Die Cutting - Offset', makeReady:30, target:2400 },
    { key:'DICORR', machine:'Die Cutting - Corrugation', makeReady:30, target:1600 },
    { key:'DIE1', machine:'Die Cutting 01', makeReady:30, target:880 },
    { key:'DIE2', machine:'Die Cutting 02', makeReady:30, target:880 },
    { key:'DIE3', machine:'Die Cutting 03', makeReady:30, target:880 },
    { key:'DIE4', machine:'Die Cutting 04', makeReady:30, target:880 },
    { key:'DIE5', machine:'Die Cutting 05', makeReady:30, target:880 },
    { key:'FLEXOPRINT', machine:'Markany Flexo E5', makeReady:30, target:55 },
    { key:'FLEXODIE', machine:'Flexo Die Cutting Offline', makeReady:30, target:44 },
    { key:'FLEXOSLIT', machine:'Rhyguan', makeReady:30, target:88 },
    { key:'DIGITAL', machine:'Canon Digital Printing', makeReady:10, target:660 },
    { key:'2PLY', machine:'2 Ply Making Machine', makeReady:15, target:2000 },
    { key:'ROTARY', machine:'Rotary Cutting', makeReady:0, target:650 },
    { key:'MSP1', machine:'Manual Sheet Pasting', makeReady:0, target:750 },
    { key:'MSP2', machine:'Manual Pasting', makeReady:0, target:600 },
    { key:'FMZ', machine:'Flute Laminator', makeReady:0, target:2000 },
    { key:'DCMAN1', machine:'Manual Die Cutting 04', makeReady:45, target:800 },
    { key:'DCMAN2', machine:'Manual Die Cutting 05', makeReady:45, target:800 },
    { key:'DCAUTO', machine:'Automatic Die Cutting', makeReady:90, target:2500 },
    { key:'STMAN1', machine:'Stitching Manual 01', makeReady:0, target:250 },
    { key:'STMAN2', machine:'Stitching Manual 02', makeReady:0, target:250 },
    { key:'STAUTO', machine:'Auto Stitching', makeReady:0, target:200 },
    { key:'FOLDER', machine:'Folder Gluer', makeReady:45, target:15000 },
    { key:'RS4', machine:'RS4 Printing', makeReady:60, target:1500 }
  ];
}

function _reportsMachineLoadStandardsMap_() {
  const map = {};
  _reportsMachineLoadStandards_().forEach(function(row) {
    map[row.key] = row;
  });
  return map;
}

function _reportsMachineLoadNormalizeKey_(machine, processName, department, categoryGroup) {
  const rawMachine = String(machine || processName || department || 'UNASSIGNED').toUpperCase();
  const rawProcess = String(processName || department || '').toUpperCase();
  const rawCategory = String(categoryGroup || '').toUpperCase();
  if (rawMachine.indexOf('SM74') !== -1 || rawMachine.indexOf('SM-74') !== -1 || rawMachine.indexOf('HEIDELBERG') !== -1) return 'SM74';
  if (rawMachine.indexOf('CD102') !== -1 || rawMachine.indexOf('CD-102') !== -1 || rawMachine.indexOf('CD 102') !== -1) return 'CD102';
  if (rawMachine.indexOf('LAMINATION 01') !== -1 || rawMachine.indexOf('LAMINATION 1') !== -1 || rawMachine.indexOf('LAMINATION ROLL-1') !== -1 || rawMachine.indexOf('LAMINATION ROLL 1') !== -1 || rawMachine.indexOf('LAM-1') !== -1 || rawMachine === 'LAM1' || rawMachine.indexOf('LAMINATION 02') !== -1 || rawMachine.indexOf('LAMINATION 2') !== -1 || rawMachine.indexOf('LAM-2') !== -1 || rawMachine === 'LAM2' || rawMachine === 'LAMINATION' || rawProcess === 'LAMINATION') return 'LAMINATION';
  if (rawMachine.indexOf('LAMINATION 03') !== -1 || rawMachine.indexOf('LAMINATION 3') !== -1 || rawMachine.indexOf('LAM-3') !== -1 || rawMachine === 'LAM3') return 'LAM3';
  if (rawMachine.indexOf('RHYGUAN') !== -1 || rawProcess.indexOf('INSPECTION') !== -1 || rawProcess.indexOf('SLITTING') !== -1 || rawProcess.indexOf('SLIT') !== -1) return 'FLEXOSLIT';
  if ((rawProcess.indexOf('FLEXO') !== -1 && (rawProcess.indexOf('DIE') !== -1 || rawProcess.indexOf('CUT') !== -1)) || (rawMachine.indexOf('FLEXO') !== -1 && (rawMachine.indexOf('DIE') !== -1 || rawMachine.indexOf('CUT') !== -1))) return 'FLEXODIE';
  if (rawProcess.indexOf('FLEXO') !== -1 || rawMachine.indexOf('FLEXO') !== -1 || rawMachine.indexOf('MARKANY') !== -1) return 'FLEXOPRINT';
  if (rawMachine.indexOf('DIGITAL') !== -1 || rawMachine.indexOf('CANON') !== -1) return 'DIGITAL';
  if ((rawMachine === 'PRINTING' || rawMachine === 'OFFSET PRINTING' || rawProcess === 'PRINTING' || rawProcess === 'OFFSET PRINTING') && rawCategory.indexOf('CORRUGATION') !== -1) return 'CD102';
  if (rawMachine === 'PRINTING' || rawMachine === 'OFFSET PRINTING' || rawProcess === 'PRINTING' || rawProcess === 'OFFSET PRINTING') return 'SM74';
  if (rawMachine === 'AUTOMATIC' || rawMachine === 'AUTO') return '2PLY';
  if (rawMachine.indexOf('2 PLY') !== -1 || rawMachine.indexOf('TWO PLY') !== -1 || rawMachine.indexOf('PLY MAKING') !== -1) return '2PLY';
  if (rawMachine.indexOf('ROTARY') !== -1 || rawProcess.indexOf('ROTARY') !== -1) return 'ROTARY';
  if (rawMachine.indexOf('FMZ') !== -1 || rawMachine.indexOf('FLUTE') !== -1) return 'FMZ';
  if (rawMachine.indexOf('MANUAL SHEET PASTING') !== -1) return 'MSP1';
  if (rawMachine === 'PASTING' || rawMachine === 'SIDE PASTING' || rawProcess === 'PASTING' || rawProcess === 'SIDE PASTING') return 'FOLDER';
  if (rawMachine.indexOf('MANUAL PASTING') !== -1 || rawMachine.indexOf('MANUAL SHEET PASTING 2') !== -1 || rawMachine.indexOf('MANUAL SHEET PASTING - 2') !== -1) return 'MSP2';
  if ((rawMachine.indexOf('MANUAL DIE CUTTING 05') !== -1 || rawMachine.indexOf('DIE CUTTING MANUAL 2') !== -1 || rawMachine.indexOf('DIE CUTTING MANUAL - 2') !== -1 || rawMachine.indexOf('MANUAL DIE') !== -1 || rawMachine.indexOf('DIE CUTTING MANUAL') !== -1 || rawMachine.indexOf('MANUAL DIE CUTTING 04') !== -1) && rawCategory.indexOf('CORRUGATION') !== -1) return 'DICORR';
  if (rawMachine.indexOf('MANUAL DIE CUTTING 05') !== -1 || rawMachine.indexOf('DIE CUTTING MANUAL 2') !== -1 || rawMachine.indexOf('DIE CUTTING MANUAL - 2') !== -1) return 'DCMAN2';
  if (rawMachine.indexOf('MANUAL DIE') !== -1 || rawMachine.indexOf('DIE CUTTING MANUAL') !== -1 || rawMachine.indexOf('MANUAL DIE CUTTING 04') !== -1) return 'DCMAN1';
  if (rawProcess.indexOf('FLEXO') !== -1 && rawMachine.indexOf('AUTOMATIC DIE') !== -1) return 'FLEXODIE';
  if (rawMachine.indexOf('AUTOMATIC DIE') !== -1 || rawMachine.indexOf('AUTO DIE') !== -1 || rawMachine.indexOf('DIE CUTTING AUTO') !== -1) return 'DCAUTO';
  const dieCore = rawMachine === 'DIE CUTTING' || rawProcess === 'DIE CUTTING' || rawMachine.indexOf('DIE CUTTING 01') !== -1 || rawMachine.indexOf('DIE CUTTING-01') !== -1 || rawMachine.indexOf('DIE-CUTTING-01') !== -1 || rawMachine.indexOf('DIE-1') !== -1 || rawMachine.indexOf('DYE-1') !== -1 || rawMachine.indexOf('DIE CUTTING 02') !== -1 || rawMachine.indexOf('DIE CUTTING-02') !== -1 || rawMachine.indexOf('DIE-CUTTING-02') !== -1 || rawMachine.indexOf('DIE-2') !== -1 || rawMachine.indexOf('DYE-2') !== -1 || rawMachine.indexOf('DIE CUTTING 03') !== -1 || rawMachine.indexOf('DIE CUTTING-03') !== -1 || rawMachine.indexOf('DIE-CUTTING-03') !== -1 || rawMachine.indexOf('DIE-3') !== -1 || rawMachine.indexOf('DYE-3') !== -1;
  if (dieCore && rawCategory.indexOf('CORRUGATION') !== -1) return 'DICORR';
  if (dieCore) return 'DIEOFFSET';
  if (rawMachine.indexOf('DIE CUTTING 04') !== -1 || rawMachine.indexOf('DIE-4') !== -1 || rawMachine.indexOf('DYE-4') !== -1) return 'DIE4';
  if (rawMachine.indexOf('DIE CUTTING 05') !== -1 || rawMachine.indexOf('DIE-5') !== -1 || rawMachine.indexOf('DYE-5') !== -1) return 'DIE5';
  if (rawMachine.indexOf('STITCHING MANUAL 02') !== -1 || rawMachine.indexOf('STITCHING MANUAL - 2') !== -1) return 'STMAN2';
  if (rawMachine.indexOf('STITCHING MANUAL') !== -1 || rawMachine.indexOf('STITCHING MANUAL 01') !== -1 || rawMachine.indexOf('STITCHING MANUAL - 1') !== -1) return 'STMAN1';
  if (rawMachine.indexOf('AUTO STITCH') !== -1 || rawMachine.indexOf('STITCHING AUTO') !== -1) return 'STAUTO';
  if (rawMachine.indexOf('FOLDER GLUER') !== -1) return 'FOLDER';
  if (rawMachine.indexOf('RS4') !== -1) return 'RS4';
  return rawMachine.replace(/[^A-Z0-9]+/g, '');
}

function _reportsMachineLoadFromQueueRow_(row) {
  const standards = _reportsMachineLoadStandardsMap_();
  const key = _reportsMachineLoadNormalizeKey_(row.planned_machine || row.plannedMachine || '', row.process_name || row.processName || '', row.department || '', row.department_category || row.categoryGroup || '');
  const standard = standards[key] || {};
  const plannedQty = _reportsSafeNumber_(row.planned_qty || row.plannedQty);
  const balanceQty = _reportsSafeNumber_(row.balance_qty || row.balanceQty);
  const loadQty = balanceQty > 0 ? balanceQty : plannedQty;
  const planUnit = row.plan_unit || row.planUnit || '';
  const targetOutput = _reportsSafeNumber_(standard.target);
  const hourlyCapacity = _reportsProductionNOPIsFlexoMeterPerMinute_(key) ? targetOutput * 60 : targetOutput;
  const makeReadyHours = _reportsSafeNumber_(standard.makeReady) / 60;
  const runningLoadHours = hourlyCapacity > 0 ? loadQty / hourlyCapacity : 0;
  const totalLoadHours = runningLoadHours + makeReadyHours;
  return {
    routingId: row.routing_id || row.routingId || '',
    woId: row.wo_id || row.woId || '',
    woNumber: row.wo_number || row.woNumber || row.workOrderNo || '',
    woDate: row.wo_date || row.woDate || '',
    soNumbers: row.so_numbers || row.soNumbers || '',
    lineNos: row.line_nos || row.lineNos || '',
    artworkNos: row.artwork_nos || row.artworkNos || '',
    clientName: row.client_name || row.clientName || '',
    productNames: row.product_names || row.productNames || row.productName || '',
    categoryGroup: row.department_category || row.categoryGroup || '',
    processName: row.process_name || row.processName || '',
    department: row.department || '',
    plannedMachine: row.planned_machine || row.plannedMachine || '',
    machineKey: key,
    machine: standard.machine || row.planned_machine || row.plannedMachine || key || 'Unassigned',
    expectedDelivery: row.expected_delivery || row.expectedDelivery || '',
    plannedQty: plannedQty,
    producedQty: _reportsSafeNumber_(row.produced_qty || row.producedQty),
    balanceQty: balanceQty,
    planUnit: planUnit,
    baseLoadQty: _reportsRoundNumber_(loadQty, 2),
    loadQty: _reportsRoundNumber_(loadQty, 2),
    loadQtyUnit: _reportsProductionNOPIsFlexoMeterPerMinute_(key) ? 'meter' : (String(planUnit || '').toLowerCase() || 'qty'),
    flexoTotalRm: 0,
    flexoTotalJobQty: 0,
    status: row.status || '',
    standardMakeReadyMinutes: _reportsSafeNumber_(standard.makeReady),
    targetOutput: targetOutput,
    targetUnit: _reportsProductionNOPIsFlexoMeterPerMinute_(key) ? 'meter/min' : 'qty/hour',
    targetHourlyCapacity: _reportsRoundNumber_(hourlyCapacity, 2),
    makeReadyHours: _reportsRoundNumber_(makeReadyHours, 2),
    runningLoadHours: _reportsRoundNumber_(runningLoadHours, 2),
    totalLoadHours: _reportsRoundNumber_(totalLoadHours, 2),
    loadDays: _reportsRoundNumber_(totalLoadHours / 8, 2),
    loadStatus: hourlyCapacity > 0 ? 'OPEN_LOAD' : 'NO_TARGET'
  };
}

function _reportsMachineLoadRows_(filters) {
  let rows = _reportsSelectAll_('v_report_machine_load_lines', {
    filters: {},
    order: 'total_load_hours.desc,machine.asc'
  }).map(function(row) {
    const plannedQty = _reportsSafeNumber_(row.planned_qty);
    const balanceQty = _reportsSafeNumber_(row.balance_qty);
    const hasBaseLoadQty = row.base_load_qty !== null && typeof row.base_load_qty !== 'undefined' && row.base_load_qty !== '';
    const hasLoadQty = row.load_qty !== null && typeof row.load_qty !== 'undefined' && row.load_qty !== '';
    const baseLoadQty = hasBaseLoadQty ? _reportsSafeNumber_(row.base_load_qty) : (balanceQty > 0 ? balanceQty : plannedQty);
    const loadQty = hasLoadQty ? _reportsSafeNumber_(row.load_qty) : (balanceQty > 0 ? balanceQty : plannedQty);
    const targetHourlyCapacity = _reportsSafeNumber_(row.target_hourly_capacity);
    const makeReadyHours = _reportsSafeNumber_(row.make_ready_hours);
    const runningLoadHours = targetHourlyCapacity > 0 ? loadQty / targetHourlyCapacity : _reportsSafeNumber_(row.running_load_hours);
    const totalLoadHours = runningLoadHours + makeReadyHours;
    return {
      routingId: row.routing_id || '',
      woId: row.wo_id || '',
      woNumber: row.wo_number || '',
      woDate: row.wo_date || '',
      soNumbers: row.so_numbers || '',
      lineNos: row.line_nos || '',
      artworkNos: row.artwork_nos || '',
      clientName: row.client_name || '',
      productNames: row.product_names || '',
      categoryGroup: row.department_category || '',
      processName: row.process_name || '',
      department: row.department || '',
      plannedMachine: row.planned_machine || '',
      machineKey: row.machine_key || '',
      machine: row.machine || row.planned_machine || '',
      expectedDelivery: row.expected_delivery || '',
      plannedQty: plannedQty,
      producedQty: _reportsSafeNumber_(row.produced_qty),
      balanceQty: balanceQty,
      planUnit: row.plan_unit || '',
      baseLoadQty: _reportsRoundNumber_(baseLoadQty, 2),
      loadQty: _reportsRoundNumber_(loadQty, 2),
      loadQtyUnit: row.load_qty_unit || '',
      flexoTotalRm: _reportsSafeNumber_(row.flexo_total_rm),
      flexoTotalJobQty: _reportsSafeNumber_(row.flexo_total_job_qty),
      status: row.status || '',
      standardMakeReadyMinutes: _reportsSafeNumber_(row.standard_make_ready_minutes),
      targetOutput: _reportsSafeNumber_(row.target_output),
      targetUnit: row.target_unit || '',
      targetHourlyCapacity: targetHourlyCapacity,
      makeReadyHours: _reportsRoundNumber_(makeReadyHours, 2),
      runningLoadHours: _reportsRoundNumber_(runningLoadHours, 2),
      totalLoadHours: _reportsRoundNumber_(totalLoadHours, 2),
      loadDays: _reportsRoundNumber_(totalLoadHours / 8, 2),
      loadStatus: row.load_status || ''
    };
  });

  if (!rows.length) {
    rows = _reportsTrySelect_('v_report_production_bottleneck', {
      order: 'balance_qty.desc,wo_date.asc',
      limit: 5000
    }).map(_reportsMachineLoadFromQueueRow_);
  }

  return rows.filter(function(row) {
    return _reportsTextPasses_(row, filters, [
        'woNumber',
        'soNumbers',
        'lineNos',
        'clientName',
        'productNames',
        'categoryGroup',
        'processName',
        'department',
        'plannedMachine',
        'machine',
        'planUnit',
        'loadQtyUnit',
        'loadStatus'
      ]) &&
      _reportsStatusPasses_(row, filters, [
        'status',
        'categoryGroup',
        'processName',
        'department',
        'plannedMachine',
        'machine',
        'planUnit',
        'loadQtyUnit',
        'loadStatus'
      ]);
  }).sort(function(a, b) {
    return _reportsSafeNumber_(b.totalLoadHours) - _reportsSafeNumber_(a.totalLoadHours) ||
      String(a.expectedDelivery || '').localeCompare(String(b.expectedDelivery || '')) ||
      String(a.machine || '').localeCompare(String(b.machine || ''));
  });
}

function _reportsMachineLoadRollup_(rows, includeStage) {
  const groups = {};
  (rows || []).forEach(function(row) {
    const stage = includeStage ? (row.processName || row.department || 'Unspecified') : 'All Open Stages';
    const department = includeStage ? (row.department || 'Unassigned') : '';
    const groupKey = (row.machineKey || row.machine || 'UNASSIGNED') + '||' + department + '||' + stage;
    if (!groups[groupKey]) {
      groups[groupKey] = {
        machineKey: row.machineKey || '',
        machine: row.machine || 'Unassigned',
        department: department,
        processName: stage,
        jobs: {},
        openJobs: 0,
        loadQty: 0,
        balanceQty: 0,
        targetHourlyCapacity: _reportsSafeNumber_(row.targetHourlyCapacity),
        targetOutput: _reportsSafeNumber_(row.targetOutput),
        targetUnit: row.targetUnit || '',
        makeReadyHours: 0,
        runningLoadHours: 0,
        totalLoadHours: 0,
        earliestDelivery: '',
        loadStatus: 'OPEN_LOAD'
      };
    }
    const out = groups[groupKey];
    const jobKey = String(row.routingId || row.woNumber || row.woId || '') + '|' + String(row.processName || row.department || '');
    if (jobKey && !out.jobs[jobKey]) {
      out.jobs[jobKey] = true;
      out.openJobs += 1;
    }
    out.loadQty += _reportsSafeNumber_(row.loadQty);
    out.balanceQty += _reportsSafeNumber_(row.balanceQty);
    out.makeReadyHours += _reportsSafeNumber_(row.makeReadyHours);
    out.runningLoadHours += _reportsSafeNumber_(row.runningLoadHours);
    out.totalLoadHours += _reportsSafeNumber_(row.totalLoadHours);
    if (!out.targetHourlyCapacity && row.targetHourlyCapacity) out.targetHourlyCapacity = _reportsSafeNumber_(row.targetHourlyCapacity);
    if (!out.targetOutput && row.targetOutput) out.targetOutput = _reportsSafeNumber_(row.targetOutput);
    if (!out.targetUnit && row.targetUnit) out.targetUnit = row.targetUnit;
    if (String(row.loadStatus || '').toUpperCase() === 'NO_TARGET') out.loadStatus = 'NO_TARGET';
    if (row.expectedDelivery && (!out.earliestDelivery || row.expectedDelivery < out.earliestDelivery)) out.earliestDelivery = row.expectedDelivery;
  });

  return Object.keys(groups).map(function(key) {
    const row = groups[key];
    delete row.jobs;
    row.loadQty = _reportsRoundNumber_(row.loadQty, 2);
    row.balanceQty = _reportsRoundNumber_(row.balanceQty, 2);
    row.makeReadyHours = _reportsRoundNumber_(row.makeReadyHours, 2);
    row.runningLoadHours = _reportsRoundNumber_(row.runningLoadHours, 2);
    row.totalLoadHours = _reportsRoundNumber_(row.totalLoadHours, 2);
    row.loadDays = _reportsRoundNumber_(row.totalLoadHours / 8, 2);
    row.targetHourlyCapacity = _reportsRoundNumber_(row.targetHourlyCapacity, 2);
    row.targetOutput = _reportsRoundNumber_(row.targetOutput, 2);
    if (row.loadStatus !== 'NO_TARGET') row.loadStatus = row.loadDays >= 5 ? 'HIGH_LOAD' : 'OPEN_LOAD';
    return row;
  }).sort(function(a, b) {
    return _reportsSafeNumber_(b.totalLoadHours) - _reportsSafeNumber_(a.totalLoadHours) ||
      String(a.machine || '').localeCompare(String(b.machine || '')) ||
      String(a.processName || '').localeCompare(String(b.processName || ''));
  });
}

function _reportsSectionMachineLoad_(token, params) {
  _reportsRequireSession_(token);
  const filters = _reportsNormalizeFilters_(params);
  const rows = _reportsMachineLoadRows_(filters);
  const machineRows = _reportsMachineLoadRollup_(rows, false);

  return {
    ok: true,
    title: 'Machine Load',
    metrics: {},
    tables: [
      {
        key: 'machine-load-summary',
        title: 'Machine Load Summary',
        subtitle: 'Total open load by machine. Running hours are based on target capacity; make-ready/changeover is added once per open job; days are calculated at 8 hours/day.',
        minWidth: 1150,
        className: 'machineLoadTable',
        wrapClass: 'machineLoadWrap',
        columnGroups: [
          { label:'Machine', span:1 },
          { label:'Open Backlog', span:3 },
          { label:'Capacity', span:1 },
          { label:'Calculated Load', span:4 },
          { label:'Priority', span:2 }
        ],
        columns: [
          { key:'machine', label:'Machine' },
          { key:'openJobs', label:'Open Jobs', type:'number' },
          { key:'loadQty', label:'Load Qty', type:'number' },
          { key:'balanceQty', label:'Balance Qty', type:'number' },
          { key:'targetHourlyCapacity', label:'Capacity / Hr', type:'number' },
          { key:'makeReadyHours', label:'Make Ready Hrs', type:'number' },
          { key:'runningLoadHours', label:'Running Hrs', type:'number' },
          { key:'totalLoadHours', label:'Total Load Hrs', type:'number' },
          { key:'loadDays', label:'Load Days', type:'number' },
          { key:'earliestDelivery', label:'Earliest Delivery', type:'date' },
          { key:'loadStatus', label:'Status', type:'status' }
        ],
        rows: machineRows
      },
      {
        key: 'machine-load-details',
        title: 'Open Machine Load Details',
        subtitle: 'WO level calculation details. Flexo rates are converted from meters per minute into hourly capacity.',
        minWidth: 1700,
        className: 'machineLoadDetailTable',
        wrapClass: 'machineLoadWrap',
        columns: [
          { key:'woNumber', label:'WO No' },
          { key:'soNumbers', label:'SO No' },
          { key:'lineNos', label:'Line' },
          { key:'clientName', label:'Client' },
          { key:'productNames', label:'Product' },
          { key:'categoryGroup', label:'Article Dept' },
          { key:'department', label:'Department' },
          { key:'processName', label:'Stage / Process' },
          { key:'machine', label:'Machine' },
          { key:'plannedQty', label:'Plan Qty', type:'number' },
          { key:'producedQty', label:'Produced Qty', type:'number' },
          { key:'balanceQty', label:'Balance Qty', type:'number' },
          { key:'planUnit', label:'Plan Unit' },
          { key:'baseLoadQty', label:'Base Load Qty', type:'number' },
          { key:'loadQty', label:'Load Qty', type:'number' },
          { key:'loadQtyUnit', label:'Load Unit' },
          { key:'standardMakeReadyMinutes', label:'Make Ready Min', type:'number' },
          { key:'targetOutput', label:'Target Rate', type:'number' },
          { key:'targetUnit', label:'Target Unit' },
          { key:'targetHourlyCapacity', label:'Capacity / Hr', type:'number' },
          { key:'runningLoadHours', label:'Running Hrs', type:'number' },
          { key:'makeReadyHours', label:'Make Ready Hrs', type:'number' },
          { key:'totalLoadHours', label:'Total Load Hrs', type:'number' },
          { key:'loadDays', label:'Load Days', type:'number' },
          { key:'expectedDelivery', label:'Expected Delivery', type:'date' },
          { key:'status', label:'Stage Status', type:'status' },
          { key:'loadStatus', label:'Load Status', type:'status' }
        ],
        rows: rows
      }
    ]
  };
}

function _reportsDateRangeFilters_(fromDate, toDate, columnName) {
  return _reportsApplyDateFilterToQuery_({
    fromDate: fromDate || '',
    toDate: toDate || '',
    pendingOnly: false
  }, columnName);
}

function _reportsMonthStartDateKey_(dateKey) {
  const raw = String(dateKey || '').trim() || _reportsTodayDateKey_();
  const dt = new Date(raw + 'T00:00:00');
  if (isNaN(dt.getTime())) return _reportsTodayDateKey_().slice(0, 8) + '01';
  dt.setDate(1);
  return Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function _reportsProductionNOPRows_(filters, fromDate, toDate) {
  const rows = _reportsSelectAll_('v_report_production_nop_daily', {
    filters: _reportsDateRangeFilters_(fromDate, toDate, 'production_date'),
    order: 'production_date.desc,machine.asc'
  }).map(function(row) {
    return {
      productionDate: row.production_date || '',
      machineKey: row.machine_key || '',
      machine: row.machine || '',
      operatorNames: row.operator_names || '',
      workingHours: _reportsSafeNumber_(row.working_hours),
      downtimeReasons: row.downtime_reasons || '',
      downtimeHours: _reportsSafeNumber_(row.downtime_hours),
      makeReadyJobs: _reportsSafeNumber_(row.make_ready_jobs),
      standardMakeReadyMinutes: _reportsSafeNumber_(row.standard_make_ready_minutes),
      totalMakeReadyHours: _reportsSafeNumber_(row.total_make_ready_hours),
      actualRunningHours: _reportsSafeNumber_(row.actual_running_hours),
      targetHourlyOutput: _reportsSafeNumber_(row.target_hourly_output),
      targetProduction: _reportsSafeNumber_(row.target_production),
      actualProduction: _reportsSafeNumber_(row.actual_production),
      actualNop: _reportsSafeNumber_(row.actual_nop),
      nopDeviation: _reportsSafeNumber_(row.nop_deviation),
      nopAchievementPct: _reportsSafeNumber_(row.nop_achievement_pct),
      performanceStatus: row.performance_status || '',
      lastCompletionAt: row.last_completion_at || ''
    };
  });

  return rows.filter(function(row) {
    return _reportsTextPasses_(row, filters, [
        'productionDate',
        'machine',
        'operatorNames',
        'downtimeReasons',
        'performanceStatus'
      ]) &&
      _reportsStatusPasses_(row, filters, [
        'machine',
        'operatorNames',
        'downtimeReasons',
        'performanceStatus'
      ]);
  });
}

function _reportsProductionNOPPeriodLabel_(fromDate, toDate) {
  const from = String(fromDate || '').trim();
  const to = String(toDate || '').trim();
  if (from && to) return from + ' to ' + to;
  if (from) return 'From ' + from;
  if (to) return 'Till ' + to;
  return 'All Dates';
}

function _reportsProductionNOPMachineStandards_() {
  return [
    { key:'SM74', machine:'Heidelberg SM74', target:4125 },
    { key:'CD102', machine:'CD102', target:4125 },
    { key:'LAM1', machine:'Lamination Roll-1', target:1100 },
    { key:'LAM2', machine:'Lamination 02', target:1100 },
    { key:'LAM3', machine:'Lamination 03', target:1100 },
    { key:'DIE1', machine:'Die Cutting 01', target:880 },
    { key:'DIE2', machine:'Die Cutting 02', target:880 },
    { key:'DIE3', machine:'Die Cutting 03', target:880 },
    { key:'2PLY', machine:'2 Ply Making Machine', target:2000 },
    { key:'ROTARY', machine:'Rotary Cutting', target:650 },
    { key:'AUTOWINDOW', machine:'Auto Window Pasting', target:1500 },
    { key:'MSP1', machine:'Manual Sheet Pasting', target:600 },
    { key:'MSP2', machine:'Manual Pasting', target:600 },
    { key:'FMZ', machine:'Flute Laminator', target:2000 },
    { key:'DCMAN1', machine:'Manual Die Cutting 04', target:800 },
    { key:'DCMAN2', machine:'Manual Die Cutting 05', target:800 },
    { key:'DCAUTO', machine:'Automatic Die Cutting', target:2500 },
    { key:'STMAN1', machine:'Stitching Manual 01', target:250 },
    { key:'STMAN2', machine:'Stitching Manual 02', target:250 },
    { key:'STAUTO', machine:'Auto Stitching', target:200 },
    { key:'FOLDER', machine:'Folder Gluer', target:15000 },
    { key:'RS4', machine:'RS4 Printing', target:1500 },
    { key:'FLEXOPRINT', machine:'Markany Flexo E5', target:55 },
    { key:'FLEXODIE', machine:'Flexo Die Cutting Offline', target:44 },
    { key:'FLEXOSLIT', machine:'Rhyguan', target:88 },
    { key:'DIGITAL', machine:'Canon Digital Printing', target:660 }
  ];
}

function _reportsProductionNOPIsFlexoMeterPerMinute_(machineKey) {
  return ['FLEXOPRINT', 'FLEXODIE', 'FLEXOSLIT'].indexOf(String(machineKey || '').toUpperCase()) !== -1;
}

function _reportsProductionNOPDateLabel_(dateKey) {
  const raw = String(dateKey || '').trim();
  const dt = raw ? new Date(raw + 'T00:00:00') : null;
  if (!dt || isNaN(dt.getTime())) return raw || '';
  return Utilities.formatDate(dt, Session.getScriptTimeZone(), 'd MMM');
}

function _reportsProductionNOPWeekStartDateKey_(dateKey) {
  const raw = String(dateKey || '').trim() || _reportsTodayDateKey_();
  const dt = new Date(raw + 'T00:00:00');
  if (isNaN(dt.getTime())) return _reportsMonthStartDateKey_(raw);
  const day = dt.getDate();
  const startDay = day <= 7 ? 1 : (day <= 14 ? 8 : (day <= 21 ? 15 : 22));
  dt.setDate(startDay);
  return Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function _reportsProductionNOPWeekBucket_(dateKey) {
  const raw = String(dateKey || '').trim();
  const dt = raw ? new Date(raw + 'T00:00:00') : null;
  if (!dt || isNaN(dt.getTime())) {
    return { key: 'unknown', label: 'Unknown', sort: '9999-99-99' };
  }
  const day = dt.getDate();
  const startDay = day <= 7 ? 1 : (day <= 14 ? 8 : (day <= 21 ? 15 : 22));
  const endLabel = startDay === 22 ? 'EOM' : String(startDay + 6).padStart(2, '0');
  const monthKey = Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy-MM');
  const startLabel = String(startDay).padStart(2, '0');
  return {
    key: monthKey + '-' + startLabel,
    label: startLabel + ' to ' + endLabel,
    sort: monthKey + '-' + startLabel
  };
}

function _reportsProductionNOPRollup_(rows, groupFn) {
  const groups = {};
  (rows || []).forEach(function(row) {
    const group = groupFn(row);
    const key = group.key + '||' + row.machineKey;
    if (!groups[key]) {
      groups[key] = {
        period: group.label,
        periodSort: group.sort || group.label,
        machineKey: row.machineKey || '',
        machine: row.machine || '',
        operatorNames: [],
        downtimeReasons: [],
        days: {},
        workingHours: 0,
        downtimeHours: 0,
        makeReadyJobs: 0,
        totalMakeReadyHours: 0,
        actualRunningHours: 0,
        targetHourlyOutput: row.targetHourlyOutput,
        targetProduction: 0,
        actualProduction: 0
      };
    }
    const out = groups[key];
    if (row.operatorNames) {
      String(row.operatorNames).split(',').forEach(function(item) {
        const value = String(item || '').trim();
        if (value && out.operatorNames.indexOf(value) === -1) out.operatorNames.push(value);
      });
    }
    if (row.downtimeReasons) {
      String(row.downtimeReasons).split(',').forEach(function(item) {
        const value = String(item || '').trim();
        if (value && out.downtimeReasons.indexOf(value) === -1) out.downtimeReasons.push(value);
      });
    }
    if (row.productionDate) out.days[row.productionDate] = true;
    out.workingHours += _reportsSafeNumber_(row.workingHours);
    out.downtimeHours += _reportsSafeNumber_(row.downtimeHours);
    out.makeReadyJobs += _reportsSafeNumber_(row.makeReadyJobs);
    out.totalMakeReadyHours += _reportsSafeNumber_(row.totalMakeReadyHours);
    out.actualRunningHours += _reportsSafeNumber_(row.actualRunningHours);
    out.targetProduction += _reportsSafeNumber_(row.targetProduction);
    out.actualProduction += _reportsSafeNumber_(row.actualProduction);
    if (!out.targetHourlyOutput && row.targetHourlyOutput) out.targetHourlyOutput = row.targetHourlyOutput;
  });

  return Object.keys(groups).map(function(key) {
    const row = groups[key];
    const actualNop = row.actualRunningHours > 0 ? row.actualProduction / row.actualRunningHours : 0;
    const targetNop = row.actualRunningHours > 0 && row.targetProduction > 0
      ? row.targetProduction / row.actualRunningHours
      : row.targetHourlyOutput;
    const achievement = row.targetProduction > 0 ? (row.actualProduction / row.targetProduction) * 100 : 0;
    return {
      period: row.period,
      periodSort: row.periodSort,
      machine: row.machine,
      operatorNames: row.operatorNames.join(', '),
      days: Object.keys(row.days).length,
      workingHours: Math.round(row.workingHours * 100) / 100,
      downtimeHours: Math.round(row.downtimeHours * 100) / 100,
      makeReadyJobs: row.makeReadyJobs,
      totalMakeReadyHours: Math.round(row.totalMakeReadyHours * 100) / 100,
      actualRunningHours: Math.round(row.actualRunningHours * 100) / 100,
      targetHourlyOutput: Math.round(targetNop * 100) / 100,
      targetProduction: Math.round(row.targetProduction * 100) / 100,
      actualProduction: Math.round(row.actualProduction * 100) / 100,
      actualNop: Math.round(actualNop * 100) / 100,
      nopDeviation: Math.round((actualNop - targetNop) * 100) / 100,
      nopAchievementPct: Math.round(achievement * 100) / 100,
      downtimeReasons: row.downtimeReasons.join(', '),
      performanceStatus: targetNop <= 0 ? 'NO_TARGET' : (actualNop >= targetNop ? 'ON_TARGET' : 'BELOW_TARGET')
    };
  }).sort(function(a, b) {
    return String(a.periodSort || '').localeCompare(String(b.periodSort || '')) ||
      String(a.machine || '').localeCompare(String(b.machine || ''));
  });
}

function _reportsProductionNOPColumns_(includePeriod) {
  const cols = [];
  if (includePeriod) cols.push({ key:'period', label:'Period' });
  cols.push(
    { key:'machine', label:'Machine' },
    { key:'operatorNames', label:'Operator Name' },
    { key:'days', label:'Days', type:'number' },
    { key:'workingHours', label:'Working Hours', type:'number' },
    { key:'downtimeHours', label:'Downtime Hours', type:'number' },
    { key:'makeReadyJobs', label:'Make Ready Jobs', type:'number' },
    { key:'totalMakeReadyHours', label:'Make Ready Hours', type:'number' },
    { key:'actualRunningHours', label:'Actual Running Hours', type:'number' },
    { key:'targetHourlyOutput', label:'Target NOP / Hr', type:'number' },
    { key:'targetProduction', label:'Target Production', type:'number' },
    { key:'actualProduction', label:'Actual Production', type:'number' },
    { key:'actualNop', label:'Actual NOP / Hr', type:'number' },
    { key:'nopDeviation', label:'Deviation', type:'number' },
    { key:'nopAchievementPct', label:'Achievement %', type:'number' },
    { key:'performanceStatus', label:'Status', type:'status' },
    { key:'downtimeReasons', label:'Downtime Reasons' }
  );
  return cols;
}

function _reportsProductionNOPActualByMachine_(rows) {
  const totals = {};
  (rows || []).forEach(function(row) {
    const key = row.machineKey || '';
    if (!key) return;
    if (!totals[key]) {
      totals[key] = {
        machineKey: key,
        machine: row.machine || '',
        target: _reportsSafeNumber_(row.targetHourlyOutput),
        actualProduction: 0,
        runningHours: 0
      };
    }
    totals[key].actualProduction += _reportsSafeNumber_(row.actualProduction);
    totals[key].runningHours += _reportsSafeNumber_(row.actualRunningHours);
    if (!totals[key].target && row.targetHourlyOutput) totals[key].target = _reportsSafeNumber_(row.targetHourlyOutput);
  });

  Object.keys(totals).forEach(function(key) {
    const row = totals[key];
    row.actual = row.runningHours > 0 ? row.actualProduction / row.runningHours : 0;
    if (_reportsProductionNOPIsFlexoMeterPerMinute_(key)) row.actual = row.actual / 60;
  });
  return totals;
}

function _reportsProductionNOPSummaryMetric_(target, actual) {
  const t = _reportsSafeNumber_(target);
  const a = _reportsSafeNumber_(actual);
  return {
    target: Math.round(t * 100) / 100,
    actual: a > 0 ? Math.round(a * 100) / 100 : '',
    deviation: t > 0 ? Math.round(((a - t) / t) * 1000) / 10 : 0
  };
}

function _reportsProductionNOPSummaryRows_(onDateRows, weekRows, mtdRows, filters) {
  const onDateMap = _reportsProductionNOPActualByMachine_(onDateRows);
  const weekMap = _reportsProductionNOPActualByMachine_(weekRows);
  const mtdMap = _reportsProductionNOPActualByMachine_(mtdRows);
  const standards = _reportsProductionNOPMachineStandards_();
  const known = {};
  const rows = standards.map(function(machine) {
    known[machine.key] = true;
    const target = machine.target;
    const onDate = _reportsProductionNOPSummaryMetric_(target, onDateMap[machine.key] && onDateMap[machine.key].actual);
    const week = _reportsProductionNOPSummaryMetric_(target, weekMap[machine.key] && weekMap[machine.key].actual);
    const mtd = _reportsProductionNOPSummaryMetric_(target, mtdMap[machine.key] && mtdMap[machine.key].actual);
    return {
      machine: machine.machine,
      onDateTarget: onDate.target,
      onDateActual: onDate.actual,
      onDateDeviationPct: onDate.deviation,
      weekTarget: week.target,
      weekActual: week.actual,
      weekDeviationPct: week.deviation,
      mtdTarget: mtd.target,
      mtdActual: mtd.actual,
      mtdDeviationPct: mtd.deviation
    };
  });

  Object.keys(mtdMap).sort().forEach(function(key) {
    if (known[key]) return;
    const src = mtdMap[key] || weekMap[key] || onDateMap[key] || {};
    const target = _reportsSafeNumber_(src.target);
    const onDate = _reportsProductionNOPSummaryMetric_(target, onDateMap[key] && onDateMap[key].actual);
    const week = _reportsProductionNOPSummaryMetric_(target, weekMap[key] && weekMap[key].actual);
    const mtd = _reportsProductionNOPSummaryMetric_(target, mtdMap[key] && mtdMap[key].actual);
    rows.push({
      machine: src.machine || key,
      onDateTarget: onDate.target,
      onDateActual: onDate.actual,
      onDateDeviationPct: onDate.deviation,
      weekTarget: week.target,
      weekActual: week.actual,
      weekDeviationPct: week.deviation,
      mtdTarget: mtd.target,
      mtdActual: mtd.actual,
      mtdDeviationPct: mtd.deviation
    });
  });

  return rows.filter(function(row) {
    const pendingPass = filters.pendingOnly
      ? row.onDateDeviationPct < 0 || row.weekDeviationPct < 0 || row.mtdDeviationPct < 0
      : true;
    return pendingPass &&
      _reportsTextPasses_(row, filters, ['machine']) &&
      _reportsStatusPasses_(row, filters, ['machine']);
  });
}

function _reportsSectionProductionNOP_(token, params) {
  _reportsRequireSession_(token);
  const filters = _reportsNormalizeFilters_(params);
  const selectedToDate = filters.toDate || _reportsTodayDateKey_();
  const monthStart = _reportsMonthStartDateKey_(selectedToDate);
  const weekStart = _reportsProductionNOPWeekStartDateKey_(selectedToDate);
  const onDateRows = _reportsProductionNOPRows_(filters, selectedToDate, selectedToDate);
  const weekSourceRows = _reportsProductionNOPRows_(filters, weekStart, selectedToDate);
  const mtdSourceRows = _reportsProductionNOPRows_(filters, monthStart, selectedToDate);
  const summaryRows = _reportsProductionNOPSummaryRows_(onDateRows, weekSourceRows, mtdSourceRows, filters);
  const belowTargetRows = summaryRows.filter(function(row) {
    return row.onDateDeviationPct < 0 || row.weekDeviationPct < 0 || row.mtdDeviationPct < 0;
  }).length;
  const onDateLabel = 'On Date - ' + _reportsProductionNOPDateLabel_(selectedToDate);
  const weekLabel = 'Week Till Date (' + _reportsProductionNOPDateLabel_(weekStart) + ' to ' + _reportsProductionNOPDateLabel_(selectedToDate) + ')';
  const mtdLabel = 'Month Till Date (' + _reportsProductionNOPDateLabel_(monthStart) + ' to ' + _reportsProductionNOPDateLabel_(selectedToDate) + ')';

  return {
    ok: true,
    title: 'Production NOP',
    metrics: {
      machines: summaryRows.length,
      belowTargetRows: belowTargetRows
    },
    tables: [
      {
        key: 'nop-review-summary',
        title: 'Production NOP Review Summary',
        subtitle: 'Machine-wise Target NOP, Actual NOP, and Deviation %. Pending only shows machines below target in any period.',
        minWidth: 1500,
        className: 'nopSummaryTable',
        wrapClass: 'nopSummaryTableWrap',
        hideHeader: true,
        columnGroups: [
          { label:'Machine', span:1 },
          { label:onDateLabel, span:3 },
          { label:weekLabel, span:3 },
          { label:mtdLabel, span:3 }
        ],
        columns: [
          { key:'machine', label:'Machine' },
          { key:'onDateTarget', label:'Target', type:'nop' },
          { key:'onDateActual', label:'Actual', type:'nop' },
          { key:'onDateDeviationPct', label:'Deviation%', type:'deviationPct' },
          { key:'weekTarget', label:'Target', type:'nop' },
          { key:'weekActual', label:'Actual', type:'nop' },
          { key:'weekDeviationPct', label:'Deviation%', type:'deviationPct' },
          { key:'mtdTarget', label:'Target', type:'nop' },
          { key:'mtdActual', label:'Actual', type:'nop' },
          { key:'mtdDeviationPct', label:'Deviation%', type:'deviationPct' }
        ],
        rows: summaryRows
      }
    ]
  };
}

function _reportsSectionInventory_(token, params) {
  _reportsRequireSession_(token);
  const filters = _reportsNormalizeFilters_(params);
  const snapshot = invGetStockSnapshotJSON({ limit: 5000, q: filters.q || '' }) || { rows: [] };
  const baseRows = (snapshot.rows || []).filter(function(row) {
    return _reportsStatusPasses_(row, filters, ['movementClass','mslStatus','department','category']);
  });
  const belowMsl = baseRows.filter(function(row){ return String(row.mslStatus || '') === 'BELOW_MSL'; });
  const nonMoving = baseRows.filter(function(row){ return String(row.movementClass || '') === 'NON_MOVING'; });
  return {
    ok: true,
    title: 'Inventory Exposure',
    metrics: {
      totalItems: (snapshot.rows || []).length,
      belowMslItems: belowMsl.length,
      nonMovingItems: nonMoving.length,
      stockValue: (snapshot.rows || []).reduce(function(sum, row){ return sum + _reportsSafeNumber_(row.value); }, 0)
    },
    tables: [{
      key: 'belowMsl',
      title: 'Below MSL',
      subtitle: 'Items below minimum stock level.',
      columns: [
        { key:'itemCode', label:'Item Code' },
        { key:'itemName', label:'Item Name' },
        { key:'department', label:'Department' },
        { key:'qty', label:'Qty', type:'number' },
        { key:'minimumStockLevel', label:'MSL', type:'number' },
        { key:'mslGap', label:'Gap', type:'number' }
      ],
      rows: _reportsTake_(belowMsl.map(function(row){ return row; }), 50)
    },{
      key: 'nonMoving',
      title: 'Non-moving Stock',
      subtitle: 'Items with ageing above configured threshold.',
      columns: [
        { key:'itemCode', label:'Item Code' },
        { key:'itemName', label:'Item Name' },
        { key:'category', label:'Category' },
        { key:'value', label:'Value', type:'money' },
        { key:'ageingDays', label:'Ageing Days', type:'number' },
        { key:'nextBatchNo', label:'Batch' }
      ],
      rows: _reportsTake_(nonMoving.map(function(row){ return row; }), 50)
    }]
  };
}

function _reportsSectionProcurement_(token, params) {
  _reportsRequireSession_(token);
  const filters = _reportsNormalizeFilters_(params);
  const prRows = _reportsTrySelect_('v_purchase_requests_open', {
    filters: _reportsApplyDateFilterToQuery_(filters, 'created_at'),
    order: 'created_at.desc',
    limit: 1000
  }).map(function(row) {
    return {
      prNo: row.pr_no || '',
      createdAt: row.created_at || '',
      itemCode: row.item_code || '',
      itemName: row.item_name || '',
      department: row.department || '',
      jobRef: row.job_ref || '',
      pendingQty: _reportsSafeNumber_(row.pending_qty),
      ageingDays: _reportsDateDiffDays_(row.created_at)
    };
  }).filter(function(row) {
    return _reportsTextPasses_(row, filters, ['prNo','itemCode','itemName','department','jobRef']) &&
      _reportsStatusPasses_(row, filters, ['department']);
  });
  const materialRows = (invListWorkOrdersForIssue().rows || []).filter(function(row) {
    return String(row.materialStatus || '').toUpperCase() === 'PENDING';
  }).map(function(row) {
    return {
      woNo: row.woNo || '',
      materialStatus: row.materialStatus || '',
      pendingLines: (row.requirements || []).filter(function(req) {
        return _reportsSafeNumber_(req.pendingQty || req.balanceQty) > 0;
      }).length
    };
  }).filter(function(row) {
    return _reportsTextPasses_(row, filters, ['woNo','materialStatus']) &&
      _reportsStatusPasses_(row, filters, ['materialStatus']);
  });
  const plateRows = getPlateDieJobs({ pendingOnly: true }).map(function(row) {
    return {
      artworkNo: row.artworkNo || '',
      so: row.so || '',
      client: row.client || '',
      productName: row.productName || '',
      plateStatus: row.statusPlate || '',
      dieStatus: row.statusDie || '',
      ageingDays: _reportsDateDiffDays_(row.soDate)
    };
  }).filter(function(row) {
    return _reportsDatePasses_(row.soDate, filters) &&
      _reportsTextPasses_(row, filters, ['artworkNo','so','client','productName']) &&
      _reportsStatusPasses_(row, filters, ['plateStatus','dieStatus']);
  });

  return {
    ok: true,
    title: 'Procurement Dependency',
    metrics: {
      openPrRows: prRows.length,
      materialPendingWos: materialRows.length,
      plateDiePending: plateRows.length,
      openPrQty: prRows.reduce(function(sum, row){ return sum + _reportsSafeNumber_(row.pendingQty); }, 0)
    },
    tables: [{
      key: 'prs',
      title: 'Open Purchase Requests',
      subtitle: 'PRs still waiting release or receipt.',
      columns: [
        { key:'prNo', label:'PR No' },
        { key:'itemName', label:'Item' },
        { key:'department', label:'Dept' },
        { key:'jobRef', label:'Job Ref' },
        { key:'pendingQty', label:'Pending Qty', type:'number' },
        { key:'ageingDays', label:'Ageing Days', type:'number' }
      ],
      rows: _reportsTake_(prRows, 40)
    },{
      key: 'materials',
      title: 'WO Material Readiness',
      subtitle: 'Work orders with pending material issue.',
      columns: [
        { key:'woNo', label:'WO No' },
        { key:'materialStatus', label:'Status', type:'status' },
        { key:'pendingLines', label:'Pending Materials', type:'number' }
      ],
      rows: _reportsTake_(materialRows, 40)
    },{
      key: 'plateDie',
      title: 'Plate / Die Dependency',
      subtitle: 'Artwork-linked plate or die procurement still pending.',
      columns: [
        { key:'artworkNo', label:'Artwork No' },
        { key:'so', label:'SO' },
        { key:'client', label:'Client' },
        { key:'plateStatus', label:'Plate', type:'status' },
        { key:'dieStatus', label:'Die', type:'status' },
        { key:'ageingDays', label:'Ageing Days', type:'number' }
      ],
      rows: _reportsTake_(plateRows, 40)
    }]
  };
}

function _reportsSectionDelivery_(token, params) {
  _reportsRequireSession_(token);
  const filters = _reportsNormalizeFilters_(params);
  const rows = _reportsTrySelect_('v_report_delivery_performance', {
    filters: _reportsApplyDateFilterToQuery_(filters, 'delivery_date'),
    order: 'delivery_date.asc,so_number.asc,line_no.asc',
    limit: 1000
  }).map(function(row) {
    return {
      soNumber: row.so_number || '',
      lineNo: row.line_no || '',
      clientName: row.client_name || '',
      productName: row.product_name || '',
      deliveryDate: row.delivery_date || '',
      lastDispatchDate: row.last_dispatch_date || '',
      orderQty: _reportsSafeNumber_(row.order_qty),
      dispatchedQty: _reportsSafeNumber_(row.dispatched_qty),
      deliveryStatus: row.delivery_status || '',
      delayDays: _reportsSafeNumber_(row.delay_days)
    };
  });
  const finalRows = (rows.length ? rows : _reportsTraceabilityRows_().map(function(row) {
    const dueDate = row.finalDelivery || row.expectedDelivery || '';
    const dispatchDone = row.dispatchedQty >= row.orderQty && row.orderQty > 0;
    const delayDays = dueDate ? _reportsDateDiffDays_(dueDate) : 0;
    return {
      soNumber: row.soNumber,
      lineNo: row.lineNo,
      clientName: row.clientName,
      productName: row.productName,
      deliveryDate: dueDate,
      lastDispatchDate: '',
      orderQty: row.orderQty,
      dispatchedQty: row.dispatchedQty,
      deliveryStatus: dispatchDone ? 'DISPATCHED' : 'PENDING',
      delayDays: dispatchDone ? 0 : delayDays
    };
  })).filter(function(row) {
    const pendingPass = filters.pendingOnly ? ['PENDING','DELAYED'].indexOf(String(row.deliveryStatus || '').toUpperCase()) !== -1 : true;
    return pendingPass &&
      _reportsDatePasses_(row.deliveryDate, filters) &&
      _reportsTextPasses_(row, filters, ['soNumber','clientName','productName']) &&
      _reportsStatusPasses_(row, filters, ['deliveryStatus']);
  });

  return {
    ok: true,
    title: 'Delivery Performance',
    metrics: {
      totalRows: finalRows.length,
      onTimeRows: finalRows.filter(function(r){ return String(r.deliveryStatus || '').toUpperCase() === 'ON_TIME'; }).length,
      delayedRows: finalRows.filter(function(r){ return String(r.deliveryStatus || '').toUpperCase() === 'DELAYED'; }).length,
      pendingRows: finalRows.filter(function(r){ return String(r.deliveryStatus || '').toUpperCase() === 'PENDING'; }).length
    },
    tables: [{
      key: 'delivery',
      title: 'Delivery Performance',
      subtitle: 'Expected delivery against actual dispatch position.',
      columns: [
        { key:'soNumber', label:'SO No' },
        { key:'lineNo', label:'Line' },
        { key:'clientName', label:'Client' },
        { key:'deliveryDate', label:'Delivery Date', type:'date' },
        { key:'lastDispatchDate', label:'Last Dispatch', type:'date' },
        { key:'deliveryStatus', label:'Status', type:'status' },
        { key:'delayDays', label:'Delay Days', type:'number' }
      ],
      rows: _reportsTake_(finalRows, 60)
    }]
  };
}

function _reportsSectionBilling_(token, params) {
  _reportsRequireSession_(token);
  const filters = _reportsNormalizeFilters_(params);
  const unbilledRows = _reportsTrySelect_('v_report_unbilled_dispatch', {
    filters: _reportsApplyDateFilterToQuery_(filters, 'dispatch_date'),
    order: 'dispatch_date.desc',
    limit: 1000
  }).map(function(row) {
    return {
      soNumber: row.so_number || '',
      lineNo: row.line_no || '',
      productName: row.product_name || '',
      dispatchDate: row.dispatch_date || '',
      dispatchedQty: _reportsSafeNumber_(row.dispatched_qty),
      billedQty: _reportsSafeNumber_(row.billed_qty),
      unbilledQty: _reportsSafeNumber_(row.unbilled_qty),
      ageingDays: _reportsDateDiffDays_(row.dispatch_date)
    };
  }).filter(function(row) {
    return _reportsTextPasses_(row, filters, ['soNumber','productName']) &&
      _reportsStatusPasses_(row, filters, ['soNumber']);
  });
  const invoiceRows = _reportsTrySelect_('invoices', {
    select: 'invoice_no,invoice_date,client_name,status,grand_total,total_qty,created_by',
    filters: _reportsApplyDateFilterToQuery_(filters, 'invoice_date'),
    order: 'invoice_date.desc',
    limit: 300
  }).map(function(row) {
    return {
      invoiceNo: row.invoice_no || '',
      invoiceDate: row.invoice_date || '',
      clientName: row.client_name || '',
      status: row.status || '',
      grandTotal: _reportsSafeNumber_(row.grand_total),
      totalQty: _reportsSafeNumber_(row.total_qty),
      createdBy: row.created_by || ''
    };
  }).filter(function(row) {
    const pendingPass = filters.pendingOnly ? ['DRAFT'].indexOf(String(row.status || '').toUpperCase()) !== -1 : true;
    return pendingPass &&
      _reportsTextPasses_(row, filters, ['invoiceNo','clientName','createdBy']) &&
      _reportsStatusPasses_(row, filters, ['status']);
  });

  return {
    ok: true,
    title: 'Billing & Unbilled Dispatch',
    metrics: {
      draftInvoices: invoiceRows.filter(function(r){ return String(r.status || '').toUpperCase() === 'DRAFT'; }).length,
      postedInvoices: invoiceRows.filter(function(r){ return String(r.status || '').toUpperCase() === 'POSTED'; }).length,
      unbilledDispatchRows: unbilledRows.length,
      unbilledDispatchQty: unbilledRows.reduce(function(sum, row){ return sum + _reportsSafeNumber_(row.unbilledQty); }, 0)
    },
    tables: [{
      key: 'unbilled',
      title: 'Unbilled Dispatch Ageing',
      subtitle: 'Dispatch quantity not yet fully billed.',
      columns: [
        { key:'soNumber', label:'SO No' },
        { key:'lineNo', label:'Line' },
        { key:'productName', label:'Product' },
        { key:'dispatchDate', label:'Dispatch Date', type:'date' },
        { key:'unbilledQty', label:'Unbilled Qty', type:'number' },
        { key:'ageingDays', label:'Ageing Days', type:'number' }
      ],
      rows: _reportsTake_(unbilledRows, 60)
    },{
      key: 'invoiceRegister',
      title: 'Invoice Register',
      subtitle: 'Recent invoice activity.',
      columns: [
        { key:'invoiceNo', label:'Invoice No' },
        { key:'invoiceDate', label:'Date', type:'date' },
        { key:'clientName', label:'Client' },
        { key:'status', label:'Status', type:'status' },
        { key:'totalQty', label:'Qty', type:'number' },
        { key:'grandTotal', label:'Amount', type:'money' }
      ],
      rows: _reportsTake_(invoiceRows, 40)
    }]
  };
}

function reportsGetOverviewData(params, token) {
  return _reportsOverviewData_(token, params);
}

function reportsGetSectionData(section, params, token) {
  _reportsRequireSession_(token);
  const key = String(section || '').trim().toLowerCase();
  if (key === 'planning') return _reportsSectionPlanning_(token, params);
  if (key === 'salesorders') return _reportsSectionSalesOrders_(token, params);
  if (key === 'polines') return _reportsSectionPOLines_(token, params);
  if (key === 'prlifecycle') return _reportsSectionPRLifecycle_(token, params);
  if (key === 'traceability') return _reportsSectionTraceability_(token, params);
  if (key === 'delay') return _reportsSectionDelay_(token, params);
  if (key === 'production') return _reportsSectionProduction_(token, params);
  if (key === 'machineload') return _reportsSectionMachineLoad_(token, params);
  if (key === 'productionnop') return _reportsSectionProductionNOP_(token, params);
  if (key === 'inventory') return _reportsSectionInventory_(token, params);
  if (key === 'procurement') return _reportsSectionProcurement_(token, params);
  if (key === 'delivery') return _reportsSectionDelivery_(token, params);
  if (key === 'billing') return _reportsSectionBilling_(token, params);
  throw new Error('Unknown report section');
}

this.reportsGetOverviewData = reportsGetOverviewData;
this.reportsGetSectionData = reportsGetSectionData;

// ===== DEDICATED PLANNING MODULE =====
function _planningNormalizeFilters_(params) {
  const p = params || {};
  return {
    fromDate: String(p.fromDate || '').trim(),
    toDate: String(p.toDate || '').trim(),
    pendingOnly: false,
    q: String(p.q || '').trim().toLowerCase(),
    status: String(p.status || '').trim().toLowerCase(),
    includeClosed: p.includeClosed === true
  };
}

function _planningCompositeKey_(soNumber, lineNo) {
  return String(soNumber || '').trim() + '||' + String(lineNo == null ? '' : lineNo).trim();
}

function _planningStageLabel_(stageKey) {
  const key = String(stageKey || '').trim().toUpperCase();
  if (key === 'SALES_APPROVAL') return 'Sales Approval';
  if (key === 'ARTWORK') return 'Artwork';
  if (key === 'WO_ROUTING') return 'WO / Routing';
  if (key === 'PRODUCTION') return 'Production';
  if (key === 'PACKING') return 'Packing';
  if (key === 'DISPATCH') return 'Dispatch';
  if (key === 'BILLING') return 'Billing';
  if (key === 'HOLD') return 'Hold';
  if (key === 'CLOSED') return 'Closed';
  return key || 'Unknown';
}

function _planningIsHeaderClosed_(status) {
  const value = String(status || '').trim().toUpperCase();
  return value === 'CLOSED' || value === 'CANCELLED';
}

function _planningBlockingStageKey_(row) {
  const headerStatus = String(row.headerStatus || '').trim().toUpperCase();
  if (headerStatus === 'CLOSED' || headerStatus === 'CANCELLED') return 'CLOSED';
  if (headerStatus === 'HOLD' || row.holdFlag === true) return 'HOLD';
  if (String(row.salesApprovalStatus || '').toUpperCase() !== 'APPROVED') return 'SALES_APPROVAL';
  if (String(row.artworkStatus || '').toUpperCase() !== 'APPROVED') return 'ARTWORK';
  if (_reportsSafeNumber_(row.woCount) <= 0 || String(row.routingStatus || '').toUpperCase() !== 'MARKED') return 'WO_ROUTING';
  if (_reportsSafeNumber_(row.productionPendingQty) > 0) return 'PRODUCTION';
  if (_reportsSafeNumber_(row.packingPendingQty) > 0) return 'PACKING';
  if (_reportsSafeNumber_(row.dispatchPendingQty) > 0) return 'DISPATCH';
  if (String(row.billingStatus || '').toUpperCase() !== 'CLOSED') return 'BILLING';
  return 'CLOSED';
}

function _planningBlockingStatus_(row) {
  const stageKey = _planningBlockingStageKey_(row);
  if (stageKey === 'SALES_APPROVAL') {
    const parts = [];
    if (String(row.accountsStatus || '').toUpperCase() !== 'APPROVED') parts.push('Accounts');
    if (String(row.businessStatus || '').toUpperCase() !== 'APPROVED') parts.push('Business');
    if (String(row.salesApprovalStatus || '').toUpperCase() !== 'APPROVED') parts.push(row.salesApprovalStatus || 'Pending');
    return parts.join(' / ') || 'Pending';
  }
  if (stageKey === 'ARTWORK') {
    const tooling = [];
    if (String(row.plateStatus || '').toUpperCase() && String(row.plateStatus || '').toUpperCase() !== 'RECEIVED') tooling.push('Plate ' + (row.plateStatus || 'Pending'));
    if (String(row.dieStatus || '').toUpperCase() && String(row.dieStatus || '').toUpperCase() !== 'RECEIVED') tooling.push('Die ' + (row.dieStatus || 'Pending'));
    return tooling.length ? tooling.join(' / ') : (row.artworkStatus || 'Pending');
  }
  if (stageKey === 'WO_ROUTING') {
    return _reportsSafeNumber_(row.woCount) <= 0 ? 'WO Pending' : (row.routingStatus || 'Routing Pending');
  }
  if (stageKey === 'PRODUCTION') return row.productionStatus || row.currentStageStatus || 'PENDING';
  if (stageKey === 'PACKING') return row.packingStatus || 'PENDING';
  if (stageKey === 'DISPATCH') return row.dispatchStatus || 'PENDING';
  if (stageKey === 'BILLING') return row.billingStatus || 'PENDING';
  if (stageKey === 'HOLD') return 'HOLD';
  return row.headerStatus || 'CLOSED';
}

function _planningBlockingPendingQty_(row) {
  const stageKey = _planningBlockingStageKey_(row);
  if (stageKey === 'PRODUCTION') return _reportsSafeNumber_(row.productionPendingQty);
  if (stageKey === 'PACKING') return _reportsSafeNumber_(row.packingPendingQty);
  if (stageKey === 'DISPATCH') return _reportsSafeNumber_(row.dispatchPendingQty);
  if (stageKey === 'BILLING') {
    const explicitPending = _reportsSafeNumber_(row.billingPendingQty);
    if (explicitPending > 0) return explicitPending;
    return Math.max(_reportsSafeNumber_(row.orderQty) - _reportsSafeNumber_(row.billedQty), 0);
  }
  if (stageKey === 'CLOSED') return 0;
  return _reportsSafeNumber_(row.orderQty);
}

function _planningBlockingUpdatedAt_(row) {
  const stageKey = _planningBlockingStageKey_(row);
  if (stageKey === 'SALES_APPROVAL') return row.salesApprovalAt || row.businessAt || row.accountsAt || row.soDateTime || row.soDate || '';
  if (stageKey === 'ARTWORK') return row.artworkApprovedAt || row.artworkAt || row.soDateTime || row.soDate || '';
  if (stageKey === 'WO_ROUTING') return row.routingMarkedAt || row.artworkApprovedAt || row.soDateTime || row.soDate || '';
  if (stageKey === 'PRODUCTION' || stageKey === 'PACKING' || stageKey === 'DISPATCH') return row.stageLastUpdatedAt || row.routingMarkedAt || row.soDateTime || row.soDate || '';
  if (stageKey === 'BILLING') return row.lastBilledAt || row.lastInvoiceDate || row.firstInvoiceDate || row.stageLastUpdatedAt || row.soDateTime || row.soDate || '';
  return row.soDateTime || row.soDate || '';
}

function _planningHeaderStatusMap_(soNumbers) {
  const list = Array.isArray(soNumbers) ? soNumbers.filter(Boolean) : [];
  if (!list.length) return {};
  const rows = _supabaseSelectByKeyInBatches_(
    'sales_orders',
    'so_number,status',
    'so_number',
    [...new Set(list)],
    'so_number.asc',
    80
  ) || [];
  const map = {};
  rows.forEach(function(row) {
    map[String(row.so_number || '').trim()] = String(row.status || '').trim().toUpperCase() || 'OPEN';
  });
  return map;
}

function _planningMergedRows_(params, token) {
  _reportsRequireSession_(token);
  const filters = _planningNormalizeFilters_(params);
  const baseFilters = Object.assign({}, filters, { q: '', status: '', pendingOnly: false });
  const planningRows = _reportsPlanningRows_(baseFilters);
  if (!planningRows.length) return [];

  const soNumbers = [...new Set(planningRows.map(function(row) { return row.soNumber; }).filter(Boolean))];
  const headerStatusMap = _planningHeaderStatusMap_(soNumbers);
  const opsRows = _opsEnrichChunkRows_(_opsLoadLifecycleRows_({ stageFocus: 'ALL', quickFilter: 'ALL', q: '' }));
  const opsMap = {};
  (opsRows || []).forEach(function(row) {
    opsMap[_planningCompositeKey_(row.soNumber, row.lineNo)] = row;
  });

  return planningRows.map(function(src) {
    const row = Object.assign({}, src || {});
    const ops = opsMap[_planningCompositeKey_(row.soNumber, row.lineNo)] || {};
    row.headerStatus = headerStatusMap[String(row.soNumber || '').trim()] || 'OPEN';
    row.producedQty = _reportsSafeNumber_(ops.producedQty);
    row.packedQty = _reportsSafeNumber_(ops.packedQty);
    row.dispatchedQty = _reportsSafeNumber_(ops.dispatchedQty);
    row.productionPendingQty = _reportsSafeNumber_(ops.productionPendingQty);
    row.packingPendingQty = _reportsSafeNumber_(ops.packingPendingQty);
    row.dispatchPendingQty = _reportsSafeNumber_(ops.dispatchPendingQty);
    row.productionStatus = ops.productionStatus || '';
    row.packingStatus = ops.packingStatus || '';
    row.dispatchStatus = ops.dispatchStatus || '';
    row.overallOpsStatus = ops.overallStatus || '';
    row.holdFlag = ops.holdFlag === true || String(row.headerStatus || '').toUpperCase() === 'HOLD';
    row.blockingStageKey = _planningBlockingStageKey_(row);
    row.blockingStage = _planningStageLabel_(row.blockingStageKey);
    row.blockingStatus = _planningBlockingStatus_(row);
    row.blockingPendingQty = _planningBlockingPendingQty_(row);
    row.blockingUpdatedAt = _planningBlockingUpdatedAt_(row);
    row.ageingDays = _reportsDateDiffDays_(row.soDateTime || row.soDate || '');
    row.overdueDays = _reportsDateDiffDays_(row.finalDelivery || row.expectedDelivery || '');
    row.actionLabel = String(row.headerStatus || '').toUpperCase() === 'CLOSED' ? 'Reopen SO' : 'Close SO';
    row.actionTargetStatus = String(row.headerStatus || '').toUpperCase() === 'CLOSED' ? 'OPEN' : 'CLOSED';
    row.actionEnabled = String(row.headerStatus || '').toUpperCase() !== 'CANCELLED';
    row.actionTone = String(row.headerStatus || '').toUpperCase() === 'CLOSED' ? 'secondary' : 'danger';
    return row;
  }).filter(function(row) {
    if (String(row.headerStatus || '').toUpperCase() === 'CANCELLED') return false;
    if (!filters.includeClosed && _planningIsHeaderClosed_(row.headerStatus)) return false;
    return _reportsTextPasses_(row, filters, [
      'soNumber',
      'lineNo',
      'clientName',
      'productCode',
      'productName',
      'salesRep',
      'artworkNo',
      'woNumbers',
      'routingSteps',
      'stageSummary',
      'invoiceNos',
      'blockingStage',
      'blockingStatus',
      'headerStatus'
    ]) && _reportsStatusPasses_(row, filters, [
      'headerStatus',
      'salesApprovalStatus',
      'accountsStatus',
      'businessStatus',
      'artworkStatus',
      'routingStatus',
      'currentStageStatus',
      'billingStatus',
      'plateStatus',
      'dieStatus',
      'productionStatus',
      'packingStatus',
      'dispatchStatus',
      'blockingStage',
      'blockingStatus'
    ]);
  });
}

function _planningSectionOpenOrders_(params, token) {
  const rows = _planningMergedRows_(params, token);
  const uniqueOrders = {};
  let closedOrders = 0;
  rows.forEach(function(row) {
    const soNumber = String(row.soNumber || '').trim();
    if (!soNumber) return;
    if (!uniqueOrders[soNumber]) uniqueOrders[soNumber] = String(row.headerStatus || '').toUpperCase();
  });
  Object.keys(uniqueOrders).forEach(function(soNumber) {
    if (String(uniqueOrders[soNumber] || '').toUpperCase() === 'CLOSED') closedOrders += 1;
  });

  return {
    ok: true,
    title: 'Open Sales Orders',
    metrics: {
      salesOrders: Object.keys(uniqueOrders).length,
      totalLines: rows.length,
      activeLines: rows.filter(function(row) { return !_planningIsHeaderClosed_(row.headerStatus); }).length,
      holdLines: rows.filter(function(row) { return row.blockingStageKey === 'HOLD'; }).length,
      billingPendingLines: rows.filter(function(row) { return row.blockingStageKey === 'BILLING'; }).length,
      closedOrders: closedOrders
    },
    tables: [{
      key: 'openOrders',
      title: 'Planning Order Book',
      subtitle: 'Same planning visibility as Reports & MIS with close / reopen control at the sales-order level.',
      minWidth: 4300,
      columns: [
        { key:'actionLabel', label:'Action', type:'action', filterable:false },
        { key:'headerStatus', label:'SO Status', type:'status' },
        { key:'blockingStage', label:'Blocking Stage', type:'status' },
        { key:'blockingStatus', label:'Blocking Detail', type:'status' },
        { key:'blockingPendingQty', label:'Blocking Qty', type:'number' },
        { key:'soNumber', label:'SO No' },
        { key:'lineNo', label:'Line' },
        { key:'soDate', label:'SO Date', type:'date' },
        { key:'soTime', label:'SO Time' },
        { key:'salesRep', label:'Sales Rep' },
        { key:'clientName', label:'Client' },
        { key:'productCode', label:'Product Code' },
        { key:'productName', label:'Product' },
        { key:'category', label:'Category' },
        { key:'orderQty', label:'Order Qty', type:'number' },
        { key:'unit', label:'Unit' },
        { key:'rate', label:'Rate', type:'money' },
        { key:'expectedDelivery', label:'Expected Delivery', type:'date' },
        { key:'finalDelivery', label:'Final Delivery', type:'date' },
        { key:'accountsStatus', label:'Accounts Approval', type:'status' },
        { key:'accountsAt', label:'Accounts Time', type:'datetime' },
        { key:'businessStatus', label:'Business Approval', type:'status' },
        { key:'businessAt', label:'Business Time', type:'datetime' },
        { key:'salesApprovalStatus', label:'SO Approval', type:'status' },
        { key:'salesApprovalAt', label:'SO Approval Time', type:'datetime' },
        { key:'artworkNo', label:'Artwork No' },
        { key:'productType', label:'Artwork Type' },
        { key:'plateStatus', label:'Plate', type:'status' },
        { key:'dieStatus', label:'Die', type:'status' },
        { key:'artworkStatus', label:'Artwork Approval', type:'status' },
        { key:'artworkAt', label:'Artwork Created', type:'datetime' },
        { key:'artworkApprovedAt', label:'Artwork Approval Time', type:'datetime' },
        { key:'woCount', label:'WO Count', type:'number' },
        { key:'woNumbers', label:'WO Nos' },
        { key:'routingCount', label:'Routing Rows', type:'number' },
        { key:'routingStatus', label:'Routing Marked', type:'status' },
        { key:'routingMarkedAt', label:'Routing Marked Time', type:'datetime' },
        { key:'routingSteps', label:'Routing Steps' },
        { key:'productionPendingQty', label:'Production Pending', type:'number' },
        { key:'packingPendingQty', label:'Packing Pending', type:'number' },
        { key:'dispatchPendingQty', label:'Dispatch Pending', type:'number' },
        { key:'currentStage', label:'Current Stage' },
        { key:'currentStageStatus', label:'Stage Status', type:'status' },
        { key:'stageLastUpdatedAt', label:'Stage Update Time', type:'datetime' },
        { key:'stageSummary', label:'Stage Qty Update' },
        { key:'billingStatus', label:'Billing Status', type:'status' },
        { key:'billedQty', label:'Billed Qty', type:'number' },
        { key:'billingPendingQty', label:'Billing Pending Qty', type:'number' },
        { key:'invoiceCount', label:'Invoice Count', type:'number' },
        { key:'invoiceNos', label:'Invoice Nos' },
        { key:'invoiceDates', label:'Invoice Dates' },
        { key:'firstInvoiceDate', label:'First Invoice Date', type:'date' },
        { key:'lastInvoiceDate', label:'Last Invoice Date', type:'date' },
        { key:'lastBilledAt', label:'Last Billing Time', type:'datetime' }
      ],
      rows: rows
    }]
  };
}

function _planningSectionStageWise_(params, token) {
  const rows = _planningMergedRows_(params, token).filter(function(row) {
    return !_planningIsHeaderClosed_(row.headerStatus) && row.blockingStageKey !== 'CLOSED';
  });
  const summaryOrder = ['SALES_APPROVAL', 'ARTWORK', 'WO_ROUTING', 'PRODUCTION', 'PACKING', 'DISPATCH', 'BILLING', 'HOLD'];
  const summaryRows = summaryOrder.map(function(stageKey) {
    const stageRows = rows.filter(function(row) { return row.blockingStageKey === stageKey; });
    const orderSet = {};
    stageRows.forEach(function(row) {
      if (row.soNumber) orderSet[row.soNumber] = true;
    });
    return {
      stage: _planningStageLabel_(stageKey),
      lineCount: stageRows.length,
      orderCount: Object.keys(orderSet).length,
      pendingQty: stageRows.reduce(function(sum, row) { return sum + _reportsSafeNumber_(row.blockingPendingQty); }, 0),
      overdueLines: stageRows.filter(function(row) { return _reportsSafeNumber_(row.overdueDays) > 0; }).length,
      oldestAgeingDays: stageRows.reduce(function(maxAge, row) {
        return Math.max(maxAge, _reportsSafeNumber_(row.ageingDays));
      }, 0)
    };
  }).filter(function(row) {
    return row.lineCount > 0;
  });

  const detailRows = rows.map(function(row) {
    return {
      stage: row.blockingStage,
      stageStatus: row.blockingStatus,
      soStatus: row.headerStatus,
      soNumber: row.soNumber,
      lineNo: row.lineNo,
      clientName: row.clientName,
      salesRep: row.salesRep,
      productCode: row.productCode,
      productName: row.productName,
      orderQty: _reportsSafeNumber_(row.orderQty),
      pendingQty: _reportsSafeNumber_(row.blockingPendingQty),
      expectedDelivery: row.expectedDelivery,
      finalDelivery: row.finalDelivery,
      ageingDays: _reportsSafeNumber_(row.ageingDays),
      overdueDays: _reportsSafeNumber_(row.overdueDays),
      lastUpdatedAt: row.blockingUpdatedAt,
      currentStage: row.currentStage || row.blockingStage,
      billingStatus: row.billingStatus || ''
    };
  }).sort(function(a, b) {
    if (String(a.stage || '') !== String(b.stage || '')) {
      return String(a.stage || '').localeCompare(String(b.stage || ''));
    }
    return _reportsSafeNumber_(b.pendingQty) - _reportsSafeNumber_(a.pendingQty);
  });

  return {
    ok: true,
    title: 'Stage Wise Planning',
    metrics: {
      approvalLines: rows.filter(function(row) { return row.blockingStageKey === 'SALES_APPROVAL'; }).length,
      artworkLines: rows.filter(function(row) { return row.blockingStageKey === 'ARTWORK'; }).length,
      routingLines: rows.filter(function(row) { return row.blockingStageKey === 'WO_ROUTING'; }).length,
      productionLines: rows.filter(function(row) { return row.blockingStageKey === 'PRODUCTION'; }).length,
      packingLines: rows.filter(function(row) { return row.blockingStageKey === 'PACKING'; }).length,
      dispatchLines: rows.filter(function(row) { return row.blockingStageKey === 'DISPATCH'; }).length,
      billingLines: rows.filter(function(row) { return row.blockingStageKey === 'BILLING'; }).length,
      holdLines: rows.filter(function(row) { return row.blockingStageKey === 'HOLD'; }).length
    },
    tables: [{
      key: 'stageSummary',
      title: 'Stage Summary',
      subtitle: 'Current bottleneck stage grouped for planning review.',
      minWidth: 1100,
      columns: [
        { key:'stage', label:'Stage', type:'status' },
        { key:'orderCount', label:'Sales Orders', type:'number' },
        { key:'lineCount', label:'Lines', type:'number' },
        { key:'pendingQty', label:'Pending Qty', type:'number' },
        { key:'overdueLines', label:'Overdue Lines', type:'number' },
        { key:'oldestAgeingDays', label:'Oldest Ageing (Days)', type:'number' }
      ],
      rows: summaryRows
    },{
      key: 'stageDetails',
      title: 'Stage Pendency Detail',
      subtitle: 'Line-wise current pending stage so planning can be aligned to the next bottleneck.',
      minWidth: 2200,
      columns: [
        { key:'stage', label:'Stage', type:'status' },
        { key:'stageStatus', label:'Stage Detail', type:'status' },
        { key:'soStatus', label:'SO Status', type:'status' },
        { key:'soNumber', label:'SO No' },
        { key:'lineNo', label:'Line' },
        { key:'clientName', label:'Client' },
        { key:'salesRep', label:'Sales Rep' },
        { key:'productCode', label:'Product Code' },
        { key:'productName', label:'Product' },
        { key:'orderQty', label:'Order Qty', type:'number' },
        { key:'pendingQty', label:'Pending Qty', type:'number' },
        { key:'expectedDelivery', label:'Expected Delivery', type:'date' },
        { key:'finalDelivery', label:'Final Delivery', type:'date' },
        { key:'ageingDays', label:'Ageing Days', type:'number' },
        { key:'overdueDays', label:'Overdue Days', type:'number' },
        { key:'lastUpdatedAt', label:'Last Updated', type:'datetime' },
        { key:'currentStage', label:'Current Stage' },
        { key:'billingStatus', label:'Billing Status', type:'status' }
      ],
      rows: detailRows
    }]
  };
}

function planningGetSectionData(section, params, token) {
  const key = String(section || '').trim().toLowerCase();
  if (key === 'openorders') return _planningSectionOpenOrders_(params, token);
  if (key === 'stagewise') return _planningSectionStageWise_(params, token);
  throw new Error('Unknown planning section');
}

function planningSetSalesOrderStatus(soNumber, nextStatus, token) {
  _requireModuleAccess_(token, 'SALES_ORDER_ENTRY', 'can_edit');
  return setSalesOrderLifecycleStatus(soNumber, nextStatus, token);
}

this.planningGetSectionData = planningGetSectionData;
this.planningSetSalesOrderStatus = planningSetSalesOrderStatus;
