<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<base target="_top">
<title>Artwork Studio</title>
<style>
:root{
  --bg:#f3f6fb;
  --card:#ffffff;
  --text:#0f172a;
  --muted:#64748b;
  --border:#dbe3ef;
  --accent:#0f62fe;
  --accent-soft:#e8f0ff;
  --ok:#16a34a;
  --warn:#d97706;
  --danger:#dc2626;
  --shadow:0 14px 36px rgba(15,23,42,0.08);
  --radius:18px;
  --header-h:64px;
  --font:"Segoe UI",Arial,sans-serif;
}

html,body{
  margin:0;
  min-height:100%;
  font-family:var(--font);
  background:
    radial-gradient(circle at top left,#ecf4ff,#f3f6fb 42%,#f8fafc 100%);
  color:var(--text);
}

.top{
  position:sticky;
  top:0;
  z-index:20;
  height:var(--header-h);
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:10px 20px;
  background:rgba(255,255,255,0.9);
  backdrop-filter:blur(14px);
  border-bottom:1px solid rgba(219,227,239,0.9);
  box-shadow:0 10px 24px rgba(15,23,42,0.05);
  box-sizing:border-box;
}

.titleBlock{
  display:flex;
  flex-direction:column;
  gap:2px;
}

.title{
  font-size:18px;
  font-weight:700;
  letter-spacing:.01em;
}

.subtitle{
  font-size:13px;
  color:var(--muted);
}

.btn{
  height:36px;
  border-radius:999px;
  padding:0 14px;
  border:1px solid rgba(148,163,184,0.35);
  background:#fff;
  color:var(--text);
  font-size:12px;
  font-weight:600;
  cursor:pointer;
  box-shadow:0 4px 14px rgba(15,23,42,0.06);
  transition:transform .16s ease, box-shadow .16s ease, filter .16s ease, background .16s ease;
}

.btn:hover{
  transform:translateY(-1px);
  box-shadow:0 8px 18px rgba(15,23,42,0.09);
}

.btn.primary{
  border:none;
  background:linear-gradient(135deg,#0f62fe,#2563eb);
  color:#fff;
}

.btn.secondary{
  background:#eef4ff;
  color:#1d4ed8;
  border-color:#c7d7ff;
  box-shadow:none;
}

.btn.warn{
  background:#fff7ed;
  color:#c2410c;
  border-color:#fdba74;
  box-shadow:none;
}

button:disabled{
  opacity:.55;
  cursor:not-allowed;
}

.page{
  max-width:1520px;
  margin:0 auto;
  padding:16px;
  padding-top:calc(16px + var(--header-h));
  box-sizing:border-box;
}

.panel{
  background:var(--card);
  border:1px solid rgba(219,227,239,0.95);
  border-radius:var(--radius);
  box-shadow:var(--shadow);
}

.filters{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
  gap:10px;
  padding:14px;
  margin-bottom:14px;
}

.field{
  display:flex;
  flex-direction:column;
  gap:6px;
}

.field label{
  font-size:11px;
  color:var(--muted);
  text-transform:uppercase;
  letter-spacing:.06em;
  font-weight:700;
}

input,select{
  width:100%;
  min-width:0;
  border:1px solid #cfd8e3;
  border-radius:12px;
  background:#fff;
  color:var(--text);
  font-size:12px;
  padding:9px 10px;
  box-sizing:border-box;
  transition:border-color .16s ease, box-shadow .16s ease, background .16s ease;
}

input:focus,select:focus{
  outline:none;
  border-color:#8ab4ff;
  box-shadow:0 0 0 3px rgba(15,98,254,0.12);
  background:#fff;
}

.checkRow{
  display:flex;
  align-items:center;
  gap:8px;
  padding-top:26px;
}

.checkRow input{
  width:auto;
}

.toolbarBtns{
  display:flex;
  gap:8px;
  justify-content:flex-end;
  align-items:end;
}

.summary{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(170px,1fr));
  gap:10px;
  margin-bottom:14px;
}

.tile{
  padding:12px 14px;
  border:1px solid var(--border);
  border-radius:16px;
  background:linear-gradient(180deg,#ffffff,#f7fbff);
}

.tile .count{
  font-size:22px;
  font-weight:700;
}

.tile .label{
  font-size:11px;
  color:var(--muted);
  text-transform:uppercase;
  letter-spacing:.06em;
}

.workspace{
  display:grid;
  grid-template-columns:minmax(360px, 1.05fr) minmax(420px, .95fr);
  gap:14px;
}

.column{
  display:flex;
  flex-direction:column;
  gap:14px;
}

.leftTabs{
  display:flex;
  gap:8px;
  padding:12px 14px 0 14px;
}

.tabBtn{
  height:34px;
  padding:0 12px;
  border-radius:999px;
  border:1px solid #cfd8e3;
  background:#f8fafc;
  color:#334155;
  font-size:12px;
  font-weight:700;
  cursor:pointer;
}

.tabBtn.active{
  background:#0f62fe;
  border-color:#0f62fe;
  color:#fff;
}

.tabPane.hidden{
  display:none;
}

.queueActions{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  padding:0 14px 12px 14px;
}

.queueHint{
  font-size:11px;
  color:var(--muted);
  line-height:1.45;
}

.cardHead{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  padding:14px 14px 0 14px;
}

.cardTitle{
  font-size:15px;
  font-weight:700;
}

.cardSub{
  font-size:12px;
  color:var(--muted);
  line-height:1.45;
}

.scroll{
  max-height:calc(100vh - 300px);
  overflow:auto;
  padding:14px;
}

.groupList,.jobList{
  display:flex;
  flex-direction:column;
  gap:10px;
}

.groupCard,.jobCard{
  border:1px solid var(--border);
  border-radius:16px;
  padding:12px;
  background:#fff;
  transition:border-color .18s ease, box-shadow .18s ease, transform .18s ease, background .18s ease;
}

.groupCard:hover,.jobCard:hover{
  border-color:#b7cdfc;
  box-shadow:0 10px 22px rgba(15,98,254,0.08);
  transform:translateY(-1px);
}

.groupCard.active{
  border-color:#8ab4ff;
  box-shadow:0 0 0 3px rgba(15,98,254,0.1);
}

.jobCard.selected{
  border-color:#8ab4ff;
  background:linear-gradient(180deg,#eff6ff,#ffffff);
}

.jobTop,.groupTop{
  display:flex;
  justify-content:space-between;
  gap:10px;
  align-items:flex-start;
  margin-bottom:8px;
}

.jobTitle,.groupTitle{
  font-size:13px;
  font-weight:700;
}

.meta{
  display:flex;
  flex-wrap:wrap;
  gap:8px 12px;
  font-size:11px;
  color:#334155;
  line-height:1.45;
}

.metaLabel{
  color:var(--muted);
  margin-right:4px;
}

.badgeRow{
  display:flex;
  flex-wrap:wrap;
  gap:6px;
}

.badge{
  padding:4px 10px;
  border-radius:999px;
  font-size:10px;
  font-weight:700;
}

.b-approved{background:#dcfce7;color:#166534;}
.b-pending{background:#fef3c7;color:#92400e;}
.b-info{background:#dbeafe;color:#1d4ed8;}
.b-danger{background:#fee2e2;color:#b91c1c;}
.b-neutral{background:#e2e8f0;color:#334155;}
.b-soft{background:#eef2ff;color:#3730a3;}

.jobFoot,.groupFoot{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:10px;
  margin-top:10px;
}

.editor{
  padding:14px;
}

.editorShell{
  display:flex;
  flex-direction:column;
  gap:14px;
}

.editorSummary{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:10px;
}

.summaryMini{
  border:1px solid var(--border);
  border-radius:16px;
  padding:10px 12px;
  background:#fbfdff;
}

.summaryMini .miniLabel{
  font-size:11px;
  color:var(--muted);
  text-transform:uppercase;
  letter-spacing:.06em;
}

.summaryMini .miniValue{
  font-size:13px;
  font-weight:700;
  margin-top:4px;
  line-height:1.4;
}

.editorTop{
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  gap:12px;
  margin-bottom:12px;
}

.artNo{
  font-size:18px;
  font-weight:800;
}

.hint{
  font-size:11px;
  color:var(--muted);
  line-height:1.45;
}

.warning{
  margin-top:10px;
  padding:10px 12px;
  border:1px solid #fcd34d;
  border-radius:14px;
  background:#fff9db;
  color:#854d0e;
  font-size:11px;
}

.repeatBox{
  margin-top:2px;
  padding:12px;
  border:1px solid var(--border);
  border-radius:16px;
  background:#f8fbff;
}

.repeatRow{
  display:flex;
  gap:10px;
  align-items:flex-end;
  flex-wrap:wrap;
}

.repeatHelp{
  font-size:11px;
  color:var(--muted);
  margin-top:6px;
  line-height:1.45;
}

.grid2{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:10px;
}

.selectedWrap{
  margin-top:14px;
  border:1px solid var(--border);
  border-radius:16px;
  overflow:hidden;
}

.selectedHead{
  padding:10px 12px;
  background:#f8fbff;
  border-bottom:1px solid var(--border);
  font-size:11px;
  font-weight:700;
  text-transform:uppercase;
  letter-spacing:.05em;
}

.selectionBar{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  padding:0 14px 12px 14px;
}

.selectionInfo{
  font-size:11px;
  color:var(--muted);
  line-height:1.45;
}

.selectionInfo strong{
  color:var(--text);
}

.selectedRows{
  max-height:280px;
  overflow:auto;
}

.selectedRow{
  display:grid;
  grid-template-columns:1.15fr 1.2fr 120px 150px 90px;
  gap:10px;
  padding:10px 12px;
  border-bottom:1px solid #edf2f7;
  align-items:center;
}

.selectedRow:last-child{
  border-bottom:none;
}

.selectedMeta{
  font-size:11px;
  line-height:1.45;
}

.facts{
  display:flex;
  flex-wrap:wrap;
  gap:8px;
  margin-top:10px;
}

.fact{
  display:inline-flex;
  align-items:center;
  gap:6px;
  padding:6px 10px;
  border-radius:999px;
  background:#f8fbff;
  border:1px solid #dce7f8;
  font-size:10px;
  color:#334155;
  font-weight:600;
}

.factLabel{
  color:#64748b;
  font-weight:700;
  text-transform:uppercase;
  letter-spacing:.04em;
}

.approvalStrip{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  margin-top:12px;
}

.approvalItem{
  display:inline-flex;
  align-items:center;
  gap:6px;
  padding:7px 10px;
  border-radius:12px;
  font-size:10px;
  font-weight:700;
  border:1px solid #dce7f8;
  background:#fbfdff;
  color:#334155;
}

.approvalItem.b-approved{
  background:#dcfce7;
  color:#166534;
  border-color:#86efac;
}

.approvalItem.b-pending{
  background:#fef3c7;
  color:#92400e;
  border-color:#fcd34d;
}

.approvalItem.b-danger{
  background:#fee2e2;
  color:#b91c1c;
  border-color:#fca5a5;
}

.approvalItem strong{
  color:#0f172a;
}

.jobAction{
  display:flex;
  align-items:center;
  justify-content:flex-end;
}

.selectedMeta strong{
  display:block;
  margin-bottom:3px;
}

.stockAllocationBox{
  border:1px solid #dbeafe;
  border-radius:14px;
  background:linear-gradient(180deg,#f8fbff,#ffffff);
  padding:8px;
}

.stockAllocationBox label{
  font-size:10px;
  color:#475569;
  font-weight:800;
  text-transform:uppercase;
  letter-spacing:.04em;
}

.stockAllocationBox input{
  margin-top:5px;
}

.stockAllocationHint{
  margin-top:5px;
  color:#64748b;
  font-size:10px;
  line-height:1.35;
}

.stockAllocationHint strong{
  color:#0f172a;
}

.editorActions{
  display:flex;
  justify-content:flex-end;
  gap:8px;
  margin-top:14px;
  flex-wrap:wrap;
  position:sticky;
  bottom:0;
  padding-top:10px;
  background:linear-gradient(180deg,rgba(255,255,255,0),rgba(255,255,255,0.97) 28%);
}

.empty{
  padding:30px 14px;
  text-align:center;
  color:var(--muted);
  font-size:12px;
}

.toast{
  position:fixed;
  right:18px;
  bottom:18px;
  z-index:40;
  min-width:240px;
  max-width:380px;
  padding:12px 14px;
  border-radius:16px;
  box-shadow:var(--shadow);
  background:#0f172a;
  color:#fff;
  font-size:13px;
  display:none;
}

.toast.show{
  display:block;
}

.toast.ok{
  background:#166534;
}

.toast.warn{
  background:#9a3412;
}

.loadingOverlay{
  position:fixed;
  inset:0;
  background:rgba(243,246,251,0.72);
  backdrop-filter:blur(4px);
  display:none;
  align-items:center;
  justify-content:center;
  z-index:60;
}

.loadingOverlay.show{
  display:flex;
}

.loadingCard{
  min-width:260px;
  max-width:340px;
  padding:18px 20px;
  border-radius:18px;
  background:#fff;
  border:1px solid var(--border);
  box-shadow:var(--shadow);
  text-align:center;
}

.loadingSpinner{
  width:34px;
  height:34px;
  margin:0 auto 12px auto;
  border-radius:50%;
  border:3px solid #dbeafe;
  border-top-color:#0f62fe;
  animation:spin 0.85s linear infinite;
}

.loadingTitle{
  font-size:14px;
  font-weight:700;
  margin-bottom:4px;
}

.loadingText{
  font-size:12px;
  color:var(--muted);
}

@keyframes spin{
  to{ transform:rotate(360deg); }
}

@media (max-width: 1120px){
  .workspace{
    grid-template-columns:1fr;
  }

  .scroll{
    max-height:none;
  }

  .editorSummary{
    grid-template-columns:1fr 1fr;
  }
}

@media (max-width: 760px){
  .filters{
    grid-template-columns:1fr 1fr;
  }

  .toolbarBtns{
    grid-column:1 / -1;
    justify-content:stretch;
  }

  .toolbarBtns .btn{
    flex:1;
  }

  .grid2,
  .editorSummary,
  .selectedRow{
    grid-template-columns:1fr;
  }

  .queueActions,
  .selectionBar{
    flex-direction:column;
    align-items:stretch;
  }
}
</style>
<?!= include('ERPSharedUI'); ?>
</head>
<body>
<div class="top">
  <div style="display:flex;align-items:center;gap:12px">
    <button class="btn secondary" onclick="goMenu()">Menu</button>
    <div class="titleBlock">
      <div class="title">Artwork Studio</div>
      <div class="subtitle">One artwork can cover many jobs. Job-wise UPS, artwork-wise approval.</div>
    </div>
  </div>
  <div></div>
</div>

<div class="page">
  <div class="panel filters">
    <div class="field">
      <label for="date_from">From Date</label>
      <input type="date" id="date_from">
    </div>
    <div class="field">
      <label for="date_to">To Date</label>
      <input type="date" id="date_to">
    </div>
    <div class="field">
      <label for="search_box">Search</label>
      <input id="search_box" placeholder="Artwork / SO / client / product / sales rep">
    </div>
      <div class="field">
        <label for="job_filter">Jobs Filter</label>
        <select id="job_filter">
          <option value="ALL">All jobs</option>
          <option value="UNASSIGNED">Unassigned only</option>
          <option value="ASSIGNED">Assigned only</option>
        </select>
      </div>
      <div class="field">
        <label for="division_filter">Division</label>
        <select id="division_filter">
          <option value="ALL">All divisions</option>
        </select>
      </div>
      <div class="field">
        <label for="group_filter">Artwork Status</label>
        <select id="group_filter">
        <option value="ALL">All artworks</option>
        <option value="OPEN">Open / Pending</option>
        <option value="APPROVED">Approved</option>
      </select>
    </div>
    <div class="checkRow">
      <input type="checkbox" id="pending_only" checked>
      <label for="pending_only" style="font-size:12px;color:var(--text);text-transform:none;letter-spacing:0;font-weight:600">Pending only</label>
    </div>
    <div class="toolbarBtns">
      <button class="btn secondary" onclick="clearFilters()">Clear</button>
      <button class="btn primary" onclick="loadWorkbench()">Load</button>
    </div>
  </div>

  <div id="summary" class="summary"></div>

  <div class="workspace">
    <div class="column">
      <div class="panel">
        <div class="leftTabs">
          <button id="tab_groups" class="tabBtn active" onclick="setView('groups')">Artwork Queue</button>
          <button id="tab_jobs" class="tabBtn" onclick="setView('jobs')">Jobs Pool</button>
        </div>
        <div id="pane_groups" class="tabPane">
        <div class="cardHead">
          <div>
            <div class="cardTitle">Artwork Groups</div>
            <div class="cardSub">Open, revise, or approve grouped artworks. Queue stays focused on artwork-level work.</div>
          </div>
        </div>
        <div class="queueActions">
          <div class="queueHint">Start a fresh artwork from selected jobs, or open an existing artwork from the queue below.</div>
          <button class="btn primary" onclick="newArtwork()">Create New Artwork</button>
        </div>
        <div id="groupList" class="scroll groupList"></div>
        </div>
        <div id="pane_jobs" class="tabPane hidden">
        <div class="cardHead">
          <div>
            <div class="cardTitle">Jobs Pool</div>
            <div class="cardSub">Select jobs for the current artwork. Existing assignments are shown before you move them.</div>
          </div>
        </div>
        <div class="selectionBar">
          <div id="jobs_selection_info" class="selectionInfo">Select jobs from the pool, or create a fresh artwork to clear the current editor and start over.</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn primary" onclick="newArtwork()">Create New Artwork</button>
          </div>
        </div>
        <div id="jobList" class="scroll jobList"></div>
        </div>
      </div>
    </div>

    <div class="column">
      <div class="panel editor">
        <div class="editorShell">
          <div class="editorTop">
            <div>
              <div class="cardTitle">Artwork Editor</div>
              <div id="editor_art_no" class="artNo">New artwork</div>
              <div id="editor_hint" class="hint">Artwork number is generated automatically on first save.</div>
            </div>
            <div class="badgeRow" id="editor_status_badges"></div>
          </div>

          <div class="editorSummary">
            <div class="summaryMini">
              <div class="miniLabel">Selected Jobs</div>
              <div id="editor_jobs_summary" class="miniValue">No jobs selected</div>
            </div>
            <div class="summaryMini">
              <div class="miniLabel">Sales Orders</div>
              <div id="editor_so_summary" class="miniValue">-</div>
            </div>
            <div class="summaryMini">
              <div class="miniLabel">Clients</div>
              <div id="editor_client_summary" class="miniValue">-</div>
            </div>
            <div class="summaryMini">
              <div class="miniLabel">FG Stock</div>
              <div id="editor_fg_stock_summary" class="miniValue">-</div>
            </div>
          </div>

          <div class="repeatBox">
            <div class="repeatRow">
              <div class="field" style="flex:1 1 280px;margin:0">
                <label for="editor_reuse_artwork_no">Repeat Order Artwork No</label>
                <input id="editor_reuse_artwork_no" list="artwork_no_options" placeholder="Enter existing artwork no">
                <datalist id="artwork_no_options"></datalist>
              </div>
              <button class="btn secondary" type="button" onclick="applyRepeatArtworkNo()">Use Existing Artwork</button>
              <button class="btn secondary" type="button" onclick="clearRepeatArtworkNo()">Use New Artwork No</button>
            </div>
            <div id="repeat_help" class="repeatHelp">For repeat orders or artwork revisions, apply an approved or saved artwork number to reuse the same artwork settings without generating a new number.</div>
          </div>

          <div class="grid2">
            <div class="field">
              <label for="editor_product_type">Product Type *</label>
              <select id="editor_product_type">
                <option value=""></option>
                <option>Flexo</option>
                <option>Offset</option>
                <option>Digital</option>
                <option>Corrugation</option>
              </select>
            </div>
            <div class="field">
              <label for="editor_printing_colors">Printing Colors *</label>
              <input id="editor_printing_colors" placeholder="e.g. 4+0 or CMYK">
            </div>
            <div class="field">
              <label for="editor_plate_status">Plate Status *</label>
              <select id="editor_plate_status">
                <option value=""></option>
                <option>New</option>
                <option>Old</option>
              </select>
            </div>
            <div class="field">
              <label for="editor_die_status">Die Status *</label>
              <select id="editor_die_status">
                <option value=""></option>
                <option>New</option>
                <option>Old</option>
              </select>
            </div>
            <div class="field">
              <label for="editor_sheet_length">Sheet Length *</label>
              <input id="editor_sheet_length" type="number" min="0" step="0.01">
            </div>
            <div class="field">
              <label for="editor_sheet_width">Sheet Width *</label>
              <input id="editor_sheet_width" type="number" min="0" step="0.01">
            </div>
          </div>

          <div id="plate_fields" class="grid2" style="display:none">
            <div class="field" id="plate_size_field">
              <label for="editor_plate_size">Plate Size *</label>
              <select id="editor_plate_size">
                <option value=""></option>
                <option>605X745</option>
                <option>790X1030</option>
              </select>
            </div>
            <div class="field">
              <label for="editor_plate_count">Plate Count *</label>
              <input id="editor_plate_count" type="number" min="0" step="1">
            </div>
            <div class="field" id="hybrid_plate_toggle_field">
              <label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0">
                <input id="editor_has_hybrid_plate" type="checkbox" style="width:auto">
                Add Hybrid Plate
              </label>
            </div>
          </div>

          <div id="hybrid_plate_fields" class="grid2" style="display:none">
            <div class="field">
              <label for="editor_hybrid_plate_size">Hybrid Plate Size *</label>
              <input id="editor_hybrid_plate_size" value="770X1030">
            </div>
            <div class="field">
              <label for="editor_hybrid_plate_count">Hybrid Plate Count *</label>
              <input id="editor_hybrid_plate_count" type="number" min="0" step="1">
            </div>
          </div>

          <div id="die_fields" class="grid2" style="display:none">
            <div class="field">
              <label for="editor_die_count">Die Count *</label>
              <input id="editor_die_count" type="number" min="0" step="1">
            </div>
          </div>

          <div id="flexo_fields" class="grid2" style="display:none">
            <div class="field">
              <label for="editor_across_ups">Across UPS *</label>
              <input id="editor_across_ups" type="number" min="0" step="1">
            </div>
            <div class="field">
              <label for="editor_along_ups">Along UPS *</label>
              <input id="editor_along_ups" type="number" min="0" step="1">
            </div>
            <div class="field">
              <label for="editor_total_ups">Total UPS</label>
              <input id="editor_total_ups" type="number" min="0" step="1" readonly>
            </div>
            <div class="field">
              <label for="editor_across_width">Across Width *</label>
              <input id="editor_across_width" type="number" min="0" step="0.01">
            </div>
            <div class="field">
              <label for="editor_teeth">Teeth *</label>
              <input id="editor_teeth" type="number" min="0" step="1">
            </div>
            <div class="field">
              <label for="editor_across_gap_mm">Across Gap (mm) *</label>
              <input id="editor_across_gap_mm" type="number" min="0" step="0.01">
            </div>
            <div class="field">
              <label for="editor_along_gap_mm">Along Gap (mm) *</label>
              <input id="editor_along_gap_mm" type="number" min="0" step="0.01">
            </div>
          </div>

          <div id="editor_warning" style="display:none" class="warning"></div>

          <div class="selectedWrap">
            <div class="selectedHead">Selected Jobs, Job-wise UPS and Stock Billing</div>
            <div id="selected_rows" class="selectedRows"></div>
          </div>

          <div class="editorActions">
            <button id="btn_save_artwork" class="btn secondary" onclick="saveArtwork()">Save Artwork</button>
            <button id="btn_approve_artwork" class="btn primary" onclick="approveArtwork()">Approve Artwork</button>
            <button id="btn_unapprove_artwork" class="btn warn" onclick="unapproveArtwork()">Un-approve</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
<div id="toast" class="toast"></div>
<div id="loading_overlay" class="loadingOverlay">
  <div class="loadingCard">
    <div class="loadingSpinner"></div>
    <div class="loadingTitle">Loading Artwork Data</div>
    <div class="loadingText">Please wait while the queue and artwork details are prepared.</div>
  </div>
</div>

<script>
function escapeHtml(s){
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

var WEB_APP_URL = <?!= JSON.stringify(WEB_APP_URL || '') ?>;

const S = {
  jobs: [],
  allJobs: [],
  groups: [],
  poolSelectedJobIds: [],
  view: 'groups',
  busyAction: '',
  editor: {
    artworkNo: '',
    repeatArtworkNo: '',
    assignmentMode: 'new',
    productType: '',
    plateStatus: '',
    dieStatus: '',
    plateSize: '',
    plateCount: '',
    hasHybridPlate: false,
    hybridPlateSize: '770X1030',
    hybridPlateCount: '',
    dieCount: '',
    sheetLength: '',
    sheetWidth: '',
    printingColors: '',
    acrossUps: '',
    alongUps: '',
    totalUps: '',
    acrossWidth: '',
    teeth: '',
    acrossGapMm: '',
    alongGapMm: '',
    selectedJobIds: [],
    jobUps: {},
    stockQtyToBill: {},
    status: 'NEW'
  }
};
const ARTWORK_WORKBENCH_CACHE_KEY = 'ERP_ARTWORK_WORKBENCH_V3';
const ARTWORK_WORKBENCH_CACHE_TTL_MS = 120000;

let TOAST_TIMER = null;

function getToken(){
  const urlToken = new URLSearchParams(window.location.search).get('token');
  if (urlToken){
    try { localStorage.setItem('ERP_TOKEN', urlToken); } catch(e){}
    try { sessionStorage.setItem('ERP_TOKEN', urlToken); } catch(e){}
  }
  return urlToken || localStorage.getItem('ERP_TOKEN') || sessionStorage.getItem('ERP_TOKEN');
}

function redirectToLogin(){
  try { localStorage.removeItem('ERP_TOKEN'); } catch(e){}
  try { sessionStorage.removeItem('ERP_TOKEN'); } catch(e){}
  const base = WEB_APP_URL || window.location.href.split('?')[0];
  const u = new URL(base);
  u.searchParams.set('p', 'login');
  window.location.replace(u.toString());
}

function fmtDate(v){
  if (!v) return '-';
  const d = new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleDateString();
}

function fmtDateTime(v){
  if (!v) return '-';
  const d = new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleString();
}

function editorValues(){
  S.editor.productType = document.getElementById('editor_product_type').value;
  S.editor.plateStatus = document.getElementById('editor_plate_status').value;
  S.editor.dieStatus = document.getElementById('editor_die_status').value;
  S.editor.plateSize = document.getElementById('editor_plate_size').value;
  S.editor.plateCount = document.getElementById('editor_plate_count').value;
  S.editor.hasHybridPlate = document.getElementById('editor_has_hybrid_plate').checked;
  S.editor.hybridPlateSize = document.getElementById('editor_hybrid_plate_size').value.trim();
  S.editor.hybridPlateCount = document.getElementById('editor_hybrid_plate_count').value;
  S.editor.dieCount = document.getElementById('editor_die_count').value;
  S.editor.sheetLength = document.getElementById('editor_sheet_length').value;
  S.editor.sheetWidth = document.getElementById('editor_sheet_width').value;
  S.editor.printingColors = document.getElementById('editor_printing_colors').value.trim();
  S.editor.acrossUps = document.getElementById('editor_across_ups').value;
  S.editor.alongUps = document.getElementById('editor_along_ups').value;
  S.editor.acrossWidth = document.getElementById('editor_across_width').value;
  S.editor.teeth = document.getElementById('editor_teeth').value;
  S.editor.acrossGapMm = document.getElementById('editor_across_gap_mm').value;
  S.editor.alongGapMm = document.getElementById('editor_along_gap_mm').value;
  S.editor.totalUps = String(
    Number(S.editor.acrossUps || 0) * Number(S.editor.alongUps || 0)
  );
  document.getElementById('editor_total_ups').value = S.editor.totalUps || '';
  return S.editor;
}

function onEditorFieldChange(){
  editorValues();
  syncEditorMode();
  syncEditorLocks();
}

function preserveEditorState(){
  try { editorValues(); } catch(e){}
}

function setEditorForm(){
  syncEditorProductTypeDefault();
  document.getElementById('editor_reuse_artwork_no').value = S.editor.repeatArtworkNo || '';
  document.getElementById('editor_product_type').value = S.editor.productType || '';
  document.getElementById('editor_plate_status').value = S.editor.plateStatus || '';
  document.getElementById('editor_die_status').value = S.editor.dieStatus || '';
  document.getElementById('editor_plate_size').value = S.editor.plateSize || '';
  document.getElementById('editor_plate_count').value = S.editor.plateCount || '';
  document.getElementById('editor_has_hybrid_plate').checked = S.editor.hasHybridPlate === true;
  document.getElementById('editor_hybrid_plate_size').value = S.editor.hybridPlateSize || '770X1030';
  document.getElementById('editor_hybrid_plate_count').value = S.editor.hybridPlateCount || '';
  document.getElementById('editor_die_count').value = S.editor.dieCount || '';
  document.getElementById('editor_sheet_length').value = S.editor.sheetLength || '';
  document.getElementById('editor_sheet_width').value = S.editor.sheetWidth || '';
  document.getElementById('editor_printing_colors').value = S.editor.printingColors || '';
  document.getElementById('editor_across_ups').value = S.editor.acrossUps || '';
  document.getElementById('editor_along_ups').value = S.editor.alongUps || '';
  document.getElementById('editor_total_ups').value = S.editor.totalUps || '';
  document.getElementById('editor_across_width').value = S.editor.acrossWidth || '';
  document.getElementById('editor_teeth').value = S.editor.teeth || '';
  document.getElementById('editor_across_gap_mm').value = S.editor.acrossGapMm || '';
  document.getElementById('editor_along_gap_mm').value = S.editor.alongGapMm || '';
  document.getElementById('editor_art_no').textContent = S.editor.artworkNo || 'New artwork';
  document.getElementById('editor_hint').textContent = S.editor.assignmentMode === 'repeat'
    ? 'Repeat order mode. Existing artwork details are loaded as a starting point and remain editable before saving.'
    : S.editor.assignmentMode === 'legacy-repeat'
      ? 'Existing artwork no mode. Any available old-job details are loaded first, and the artwork details remain editable.'
    : (S.editor.artworkNo
        ? 'Edits revise the same artwork group. Selected jobs can be added or removed before saving.'
        : 'Artwork number is generated automatically on first save.');
  const repeatHelp = document.getElementById('repeat_help');
  if (repeatHelp) {
    repeatHelp.textContent = S.editor.assignmentMode === 'repeat'
      ? 'Using existing artwork no ' + (S.editor.artworkNo || '-') + '. The stored artwork details are prefilled and can still be revised by the artwork team.'
      : S.editor.assignmentMode === 'legacy-repeat'
        ? 'Using an existing artwork no from the older system. Any available old-job details are prefilled, and the current artwork fields stay editable.'
      : 'For repeat orders or revisions, apply an approved or saved artwork number to reuse the same artwork settings without generating a new number.';
  }
  const dataList = document.getElementById('artwork_no_options');
  if (dataList) {
    dataList.innerHTML = S.groups.map(function(group){
      return '<option value="' + escapeHtml(group.artworkNo) + '">';
    }).join('');
  }
  syncEditorMode();
  syncEditorLocks();
}

function buildSummary(){
  const allJobs = filteredJobs();
  const allGroups = filteredGroups();
  const unassigned = allJobs.filter(j => !j.artworkNo).length;
  const approved = allGroups.filter(g => String(g.status || '').toUpperCase() === 'APPROVED').length;
  const open = allGroups.filter(g => String(g.status || '').toUpperCase() !== 'APPROVED').length;

  document.getElementById('summary').innerHTML = [
    ['Visible Jobs', allJobs.length],
    ['Unassigned Jobs', unassigned],
    ['Visible Artworks', allGroups.length],
    ['Open Artworks', open],
    ['Approved Artworks', approved]
  ].map(function(x){
    return '<div class="tile"><div class="count">' + x[1] + '</div><div class="label">' + x[0] + '</div></div>';
  }).join('');
}

function syncDivisionFilterOptions(){
  const el = document.getElementById('division_filter');
  if (!el) return;
  const current = el.value || 'ALL';
  const divisions = [...new Set((S.allJobs || S.jobs || []).map(function(job){
    return String(job.division || '').trim();
  }).filter(Boolean))].sort(function(a, b){
    return a.localeCompare(b);
  });
  el.innerHTML = '<option value="ALL">All divisions</option>' + divisions.map(function(division){
    return '<option value="' + escapeHtml(division) + '">' + escapeHtml(division) + '</option>';
  }).join('');
  el.value = divisions.indexOf(current) === -1 ? 'ALL' : current;
}

function showToast(message, type){
  const el = document.getElementById('toast');
  if (!el) return;
  el.className = 'toast show ' + (type || '');
  el.textContent = message;
  clearTimeout(TOAST_TIMER);
  TOAST_TIMER = setTimeout(function(){
    el.className = 'toast';
  }, 2600);
}

function setLoading(isLoading, text){
  const overlay = document.getElementById('loading_overlay');
  if (!overlay) return;
  const textEl = overlay.querySelector('.loadingText');
  if (text && textEl) textEl.textContent = text;
  overlay.classList.toggle('show', !!isLoading);
}

function setView(view){
  preserveEditorState();
  S.view = view === 'jobs' ? 'jobs' : 'groups';
  document.getElementById('tab_groups').classList.toggle('active', S.view === 'groups');
  document.getElementById('tab_jobs').classList.toggle('active', S.view === 'jobs');
  document.getElementById('pane_groups').classList.toggle('hidden', S.view !== 'groups');
  document.getElementById('pane_jobs').classList.toggle('hidden', S.view !== 'jobs');
}

function isEditorApproved(){
  return String(S.editor.status || '').toUpperCase() === 'APPROVED';
}

function isEditorReadOnly(){
  return isEditorApproved();
}

function normalizeArtworkProductType(value){
  const upper = String(value || '').trim().toUpperCase();
  if (!upper) return '';
  if (upper.indexOf('CORR') !== -1) return 'Corrugation';
  if (upper.indexOf('FLEXO') !== -1) return 'Flexo';
  if (upper.indexOf('OFFSET') !== -1) return 'Offset';
  if (upper.indexOf('DIGIT') !== -1) return 'Digital';
  return String(value || '').trim();
}

function syncEditorProductTypeDefault(){
  if (String(S.editor.productType || '').trim()) return;
  const selected = S.editor.selectedJobIds.map(function(id){
    return S.allJobs.find(function(j){ return j.id === id; }) ||
      S.jobs.find(function(j){ return j.id === id; });
  }).filter(Boolean);
  if (!selected.length) return;
  const types = [...new Set(selected.map(function(job){
    return normalizeArtworkProductType(job.productType || job.division || job.category || '');
  }).filter(Boolean))];
  if (types.length === 1) S.editor.productType = types[0];
}

function isDigitalProductType(){
  return String(S.editor.productType || '').trim().toUpperCase() === 'DIGITAL';
}

function syncEditorMode(){
  const isFlexo = String(S.editor.productType || '').trim().toUpperCase() === 'FLEXO';
  const isDigital = isDigitalProductType();
  const plateNew = String(S.editor.plateStatus || '').toUpperCase() === 'NEW';
  const dieNew = String(S.editor.dieStatus || '').toUpperCase() === 'NEW';
  const showHybrid = plateNew && !isFlexo && !isDigital && S.editor.hasHybridPlate === true;
  document.getElementById('flexo_fields').style.display = isFlexo ? '' : 'none';
  document.getElementById('editor_printing_colors').closest('.field').style.display = isDigital ? 'none' : '';
  document.getElementById('editor_plate_status').closest('.field').style.display = isDigital ? 'none' : '';
  document.getElementById('editor_die_status').closest('.field').style.display = isDigital ? 'none' : '';
  document.getElementById('editor_sheet_length').closest('.field').style.display = isFlexo ? 'none' : '';
  document.getElementById('editor_sheet_width').closest('.field').style.display = isFlexo ? 'none' : '';
  document.getElementById('plate_fields').style.display = plateNew && !isDigital ? '' : 'none';
  document.getElementById('plate_size_field').style.display = plateNew && !isFlexo && !isDigital ? '' : 'none';
  document.getElementById('hybrid_plate_toggle_field').style.display = plateNew && !isFlexo && !isDigital ? '' : 'none';
  document.getElementById('hybrid_plate_fields').style.display = showHybrid ? '' : 'none';
  document.getElementById('die_fields').style.display = dieNew && !isDigital ? '' : 'none';
}

function syncEditorLocks(){
  const approved = isEditorApproved();
  const readOnly = isEditorReadOnly();
  const busy = !!S.busyAction;
  const lockInputs = approved || busy;

  [
    'editor_reuse_artwork_no',
    'editor_product_type',
    'editor_printing_colors',
    'editor_plate_status',
    'editor_die_status',
    'editor_plate_size',
    'editor_plate_count',
    'editor_has_hybrid_plate',
    'editor_hybrid_plate_size',
    'editor_hybrid_plate_count',
    'editor_die_count',
    'editor_sheet_length',
    'editor_sheet_width',
    'editor_across_ups',
    'editor_along_ups',
    'editor_across_width',
    'editor_teeth',
    'editor_across_gap_mm',
    'editor_along_gap_mm'
  ].forEach(function(id){
    const el = document.getElementById(id);
    if (el) el.disabled = lockInputs;
  });
  document.querySelectorAll('#selected_rows input').forEach(function(el){
    el.disabled = lockInputs;
  });

  const saveBtn = document.getElementById('btn_save_artwork');
  const approveBtn = document.getElementById('btn_approve_artwork');
  const unapproveBtn = document.getElementById('btn_unapprove_artwork');

  if (saveBtn) {
    saveBtn.disabled = readOnly || busy;
    saveBtn.textContent = S.busyAction === 'save' ? 'Saving...' : 'Save Artwork';
  }
  if (approveBtn) {
    approveBtn.disabled = readOnly || busy;
    approveBtn.textContent = S.busyAction === 'approve' ? 'Approving...' : 'Approve Artwork';
    approveBtn.style.display = readOnly ? 'none' : '';
  }
  if (unapproveBtn) {
    unapproveBtn.disabled = !readOnly || busy;
    unapproveBtn.style.display = readOnly ? '' : 'none';
  }
}

function setBusyAction(action){
  S.busyAction = action || '';
  syncEditorLocks();
}

function applyLocalArtworkState(artworkNo, status, approvedAt){
  const no = String(artworkNo || '').trim();
  const nextStatus = String(status || '').toUpperCase();
  S.allJobs.forEach(function(job){
    if (String(job.artworkNo || '').trim() !== no) return;
    job.status = nextStatus;
    job.approvedAt = approvedAt || null;
  });
  S.jobs.forEach(function(job){
    if (String(job.artworkNo || '').trim() !== no) return;
    job.status = nextStatus;
    job.approvedAt = approvedAt || null;
  });
  S.groups.forEach(function(group){
    if (String(group.artworkNo || '').trim() !== no) return;
    group.status = nextStatus;
    group.approvedAt = approvedAt || null;
    group.jobs = (group.jobs || []).map(function(job){
      job.status = nextStatus;
      job.approvedAt = approvedAt || null;
      return job;
    });
  });
  if (String(S.editor.artworkNo || '').trim() === no) {
    S.editor.status = nextStatus;
  }
  renderAll({ preserve:false });
}

function approvalClass(status){
  const s = String(status || '').toUpperCase();
  if (s === 'APPROVED') return 'b-approved';
  if (s === 'HOLD') return 'b-danger';
  return 'b-pending';
}

function filteredJobs(){
  const q = (document.getElementById('search_box').value || '').toLowerCase();
  const mode = document.getElementById('job_filter').value;
  const divisionFilter = document.getElementById('division_filter')?.value || 'ALL';

  return S.jobs.filter(function(job){
    if (S.editor.selectedJobIds.indexOf(job.id) !== -1) return false;
    const hay = [
      job.artworkNo,
      job.so,
      job.lineNo,
      job.client,
      job.productName,
      job.salesRep,
      job.category,
      job.division,
      job.productType
    ].join(' ').toLowerCase();

    if (q && hay.indexOf(q) === -1) return false;
    if (mode === 'UNASSIGNED' && job.artworkNo) return false;
    if (mode === 'ASSIGNED' && !job.artworkNo) return false;
    if (divisionFilter !== 'ALL' && String(job.division || '').trim() !== divisionFilter) return false;
    return true;
  });
}

function togglePoolJob(id){
  if (S.busyAction) return;
  if (isEditorReadOnly()) {
    showToast('Un-approve the artwork before changing jobs.', 'warn');
    return;
  }
  const idx = S.editor.selectedJobIds.indexOf(id);
  if (idx === -1) {
    S.editor.selectedJobIds.push(id);
    const job = S.allJobs.find(function(j){ return j.id === id; }) ||
      S.jobs.find(function(j){ return j.id === id; });
    if (!(id in S.editor.jobUps)) {
      S.editor.jobUps[id] = job ? (job.sheetUps || '') : '';
    }
    if (job && !String(S.editor.productType || '').trim()) {
      S.editor.productType = normalizeArtworkProductType(job.productType || job.division || job.category || '');
    }
  } else {
    S.editor.selectedJobIds.splice(idx, 1);
    delete S.editor.jobUps[id];
  }
  renderAll({ preserve:false });
}

function removeEditorJob(id){
  if (isEditorReadOnly()) {
    showToast('Un-approve the artwork before changing jobs.', 'warn');
    return;
  }
  const idx = S.editor.selectedJobIds.indexOf(id);
  if (idx === -1) return;
  S.editor.selectedJobIds.splice(idx, 1);
  delete S.editor.jobUps[id];
  delete S.editor.stockQtyToBill[id];
  renderAll({ preserve:false });
}

function filteredGroups(){
  const q = (document.getElementById('search_box').value || '').toLowerCase();
  const mode = document.getElementById('group_filter').value;
  const divisionFilter = document.getElementById('division_filter')?.value || 'ALL';

  return S.groups.filter(function(group){
    const hay = [
      group.artworkNo,
      (group.soList || []).join(' '),
      (group.clientList || []).join(' '),
      (group.salesRepList || []).join(' '),
      (group.divisionList || []).join(' ')
    ].join(' ').toLowerCase();

    if (q && hay.indexOf(q) === -1) return false;
    if (mode === 'APPROVED' && String(group.status || '').toUpperCase() !== 'APPROVED') return false;
    if (mode === 'OPEN' && String(group.status || '').toUpperCase() === 'APPROVED') return false;
    if (divisionFilter !== 'ALL' && (group.divisionList || []).indexOf(divisionFilter) === -1) return false;
    return true;
  });
}

function statusBadge(status){
  const s = String(status || '').toUpperCase();
  if (s === 'APPROVED') return '<span class="badge b-approved">Approved</span>';
  if (s === 'PENDING_APPROVAL') return '<span class="badge b-pending">Pending Approval</span>';
  return '<span class="badge b-neutral">Draft</span>';
}

function jobAssignmentBadge(job){
  if (!job.artworkNo) return '<span class="badge b-neutral">Unassigned</span>';
  if (String(job.status || '').toUpperCase() === 'APPROVED') {
    return '<span class="badge b-approved">' + escapeHtml(job.artworkNo) + '</span>';
  }
  if (String(job.status || '').toUpperCase() === 'PENDING_APPROVAL') {
    return '<span class="badge b-pending">' + escapeHtml(job.artworkNo) + '</span>';
  }
  return '<span class="badge b-soft">' + escapeHtml(job.artworkNo) + '</span>';
}

function renderGroups(){
  const groups = filteredGroups();
  const root = document.getElementById('groupList');
  if (!groups.length){
    root.innerHTML = '<div class="empty">No artwork groups for the current filter.</div>';
    return;
  }

  root.innerHTML = groups.map(function(group){
    const active = group.artworkNo === S.editor.artworkNo ? 'active' : '';
    const groupStatus = String(group.status || '').toUpperCase();
    return '' +
      '<div class="groupCard ' + active + '">' +
        '<div class="groupTop">' +
          '<div>' +
            '<div class="groupTitle">' + escapeHtml(group.artworkNo) + '</div>' +
            '<div class="meta">' +
              '<div><span class="metaLabel">Jobs</span>' + escapeHtml(group.jobCount) + '</div>' +
              '<div><span class="metaLabel">SO</span>' + escapeHtml((group.soList || []).join(', ') || '-') + '</div>' +
              '<div><span class="metaLabel">Division</span>' + escapeHtml((group.divisionList || []).join(', ') || '-') + '</div>' +
              '<div><span class="metaLabel">Sales Rep</span>' + escapeHtml((group.salesRepList || []).join(', ') || '-') + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="badgeRow">' +
            statusBadge(group.status) +
            '<span class="badge ' + (group.isReady ? 'b-approved' : 'b-danger') + '">' + (group.isReady ? 'Ready' : 'Missing Fields') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="facts">' +
          '<span class="fact"><span class="factLabel">Type</span>' + escapeHtml(group.productType || '-') + '</span>' +
          '<span class="fact"><span class="factLabel">Division</span>' + escapeHtml((group.divisionList || []).join(', ') || '-') + '</span>' +
          '<span class="fact"><span class="factLabel">Plate</span>' + escapeHtml(group.plateStatus || '-') + '</span>' +
          '<span class="fact"><span class="factLabel">Die</span>' + escapeHtml(group.dieStatus || '-') + '</span>' +
          '<span class="fact"><span class="factLabel">Sheet</span>' + escapeHtml((group.sheetLength || '-') + ' x ' + (group.sheetWidth || '-')) + '</span>' +
          '<span class="fact"><span class="factLabel">Colors</span>' + escapeHtml(group.printingColors || '-') + '</span>' +
          (groupStatus === 'PENDING_APPROVAL' ? '<span class="fact"><span class="factLabel">Action</span>Pending Approval</span>' : '') +
        '</div>' +
        '<div class="groupFoot">' +
          '<div class="hint">Saved: ' + escapeHtml(fmtDateTime(group.artworkAt)) + ' | Approved: ' + escapeHtml(fmtDateTime(group.approvedAt)) + '</div>' +
          '<button class="btn secondary" onclick="editGroup(\'' + escapeHtml(group.artworkNo) + '\')">Open</button>' +
        '</div>' +
      '</div>';
  }).join('');
}

function renderJobs(){
  const jobs = filteredJobs();
  const root = document.getElementById('jobList');
  if (!jobs.length){
    root.innerHTML = '<div class="empty">No jobs match the current filter.</div>';
    return;
  }

  root.innerHTML = jobs.map(function(job){
    const checked = S.editor.selectedJobIds.indexOf(job.id) !== -1;
    return '' +
      '<div class="jobCard ' + (checked ? 'selected' : '') + '">' +
        '<div class="jobTop">' +
          '<div>' +
            '<div class="jobTitle">' + escapeHtml(job.so) + ' / Line ' + escapeHtml(job.lineNo) + '</div>' +
            '<div class="meta"><div><span class="metaLabel">Client</span>' + escapeHtml(job.client || '-') + '</div></div>' +
          '</div>' +
          '<div class="badgeRow">' +
            jobAssignmentBadge(job) +
            statusBadge(job.status) +
          '</div>' +
        '</div>' +
        '<div class="meta"><div><span class="metaLabel">Product</span>' + escapeHtml(job.productName || '-') + '</div></div>' +
        '<div class="facts">' +
          '<span class="fact"><span class="factLabel">FG Stock</span>' + escapeHtml(Number(job.fgStockQty || 0)) + ' Pcs</span>' +
          '<span class="fact"><span class="factLabel">Qty</span>' + escapeHtml(job.qty) + ' ' + escapeHtml(job.unit || '') + '</span>' +
          '<span class="fact"><span class="factLabel">SO Date</span>' + escapeHtml(fmtDate(job.soDate)) + '</span>' +
          '<span class="fact"><span class="factLabel">SO Time</span>' + escapeHtml(job.soTime || '-') + '</span>' +
          '<span class="fact"><span class="factLabel">Division</span>' + escapeHtml(job.division || '-') + '</span>' +
          '<span class="fact"><span class="factLabel">Sales Rep</span>' + escapeHtml(job.salesRep || '-') + '</span>' +
        '</div>' +
        '<div class="approvalStrip">' +
          '<span class="approvalItem ' + approvalClass(job.accountsApproved) + '"><strong>Accounts</strong> ' + escapeHtml(job.accountsApproved || '-') + '</span>' +
          '<span class="approvalItem ' + approvalClass(job.businessApproved) + '"><strong>Business</strong> ' + escapeHtml(job.businessApproved || '-') + '</span>' +
        '</div>' +
        '<div class="jobFoot">' +
          '<div class="hint">' + (checked ? 'Selected for current artwork' : 'Available in jobs pool') + '</div>' +
          '<div class="jobAction"><button class="btn ' + (checked ? 'warn' : 'secondary') + '" onclick="togglePoolJob(\'' + escapeHtml(job.id) + '\')">' + (checked ? 'Remove' : 'Select') + '</button></div>' +
        '</div>' +
      '</div>';
  }).join('');
}

function renderSelectedJobs(){
  const selected = S.editor.selectedJobIds.map(function(id){
    return S.allJobs.find(function(j){ return j.id === id; }) ||
      S.jobs.find(function(j){ return j.id === id; });
  }).filter(Boolean);

  const root = document.getElementById('selected_rows');
  if (!selected.length){
    root.innerHTML = '<div class="empty">Select one or more jobs. UPS is mandatory for each selected job.</div>';
    return;
  }

  const isFlexo = String(S.editor.productType || '').trim().toUpperCase() === 'FLEXO';
  root.innerHTML = selected.map(function(job){
    const currentArtwork = job.artworkNo && job.artworkNo !== S.editor.artworkNo
      ? '<span class="badge b-info">' + escapeHtml(job.artworkNo) + '</span>'
      : '<span class="badge b-neutral">' + escapeHtml(job.artworkNo || 'New assignment') + '</span>';
    const stockQty = Number(job.fgStockQty || 0);
    const stockBillQty = S.editor.stockQtyToBill[job.id] || job.stockQtyToBill || '';
    const productionQty = Math.max(0, Number(job.qty || 0) - Number(stockBillQty || 0));
    const stockAllocationHtml = stockQty > 0
      ? '<div class="stockAllocationBox">' +
          '<label>Bill From Stock</label>' +
          '<input ' + (isEditorReadOnly() ? 'disabled ' : '') + 'type="number" min="0" max="' + escapeHtml(Math.min(Number(job.qty || 0), stockQty)) + '" step="0.01" value="' + escapeHtml(stockBillQty) + '" onchange="setStockQtyToBill(\'' + escapeHtml(job.id) + '\',this.value)">' +
          '<div class="stockAllocationHint">Available <strong>' + escapeHtml(stockQty) + '</strong> | Production <strong>' + escapeHtml(productionQty) + '</strong></div>' +
        '</div>'
      : '<div class="stockAllocationBox"><label>Bill From Stock</label><div class="stockAllocationHint">No FG stock available for this item.</div></div>';

    return '' +
      '<div class="selectedRow">' +
        '<div class="selectedMeta">' +
          '<strong>' + escapeHtml(job.so) + ' / Line ' + escapeHtml(job.lineNo) + '</strong>' +
          '<div>' + escapeHtml(job.client || '-') + '</div>' +
          '<div class="approvalStrip" style="margin-top:8px">' +
            '<span class="approvalItem ' + approvalClass(job.accountsApproved) + '"><strong>Accounts</strong> ' + escapeHtml(job.accountsApproved || '-') + '</span>' +
            '<span class="approvalItem ' + approvalClass(job.businessApproved) + '"><strong>Business</strong> ' + escapeHtml(job.businessApproved || '-') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="selectedMeta">' +
          '<strong>' + escapeHtml(job.productName || '-') + '</strong>' +
          '<div>Qty ' + escapeHtml(job.qty) + ' ' + escapeHtml(job.unit || '') + '</div>' +
          '<div style="margin-top:8px;color:var(--muted)">FG Stock ' + escapeHtml(Number(job.fgStockQty || 0)) + ' Pcs</div>' +
          '<div style="margin-top:8px;color:var(--muted)">Division ' + escapeHtml(job.division || '-') + '</div>' +
          '<div style="margin-top:8px;color:var(--muted)">Category ' + escapeHtml(job.category || '-') + '</div>' +
        '</div>' +
        (
          isFlexo
            ? '<div class="selectedMeta"><strong>Flexo UPS</strong><div>Uses Across / Along / Total UPS above</div></div>'
            : '<div class="field"><label>UPS *</label><input ' + (isEditorReadOnly() ? 'disabled ' : '') + 'type="number" min="0.01" step="0.01" value="' + escapeHtml(S.editor.jobUps[job.id] || job.sheetUps || '') + '" onchange="setJobUps(\'' + escapeHtml(job.id) + '\',this.value)"></div>'
        ) +
        stockAllocationHtml +
        '<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start">' +
          currentArtwork +
          '<button class="btn secondary" ' + (isEditorReadOnly() ? 'disabled ' : '') + 'onclick="removeEditorJob(\'' + escapeHtml(job.id) + '\')">Remove</button>' +
        '</div>' +
      '</div>';
  }).join('');

  const moves = selected.filter(function(job){
    return job.artworkNo && job.artworkNo !== S.editor.artworkNo;
  });
  const warn = document.getElementById('editor_warning');
  if (S.editor.assignmentMode === 'repeat') {
    warn.style.display = '';
    warn.textContent = 'Repeat order mode keeps the original artwork group intact and adds the selected jobs to artwork ' + (S.editor.artworkNo || '-') + '.';
  } else if (S.editor.assignmentMode === 'legacy-repeat') {
    warn.style.display = '';
    warn.textContent = 'Saving will revise the current artwork number to ' + (S.editor.artworkNo || '-') + ' while keeping the current artwork details.';
  } else if (moves.length){
    warn.style.display = '';
    warn.textContent = 'Saving will move ' + moves.length + ' selected job(s) from their current artwork group into this artwork revision.';
  } else {
    warn.style.display = 'none';
    warn.textContent = '';
  }
}

function renderEditorBadges(){
  const badges = [];
  badges.push('<span class="badge b-info">' + escapeHtml(S.editor.selectedJobIds.length) + ' selected jobs</span>');
  if (S.editor.assignmentMode === 'repeat') {
    badges.push('<span class="badge b-soft">Repeat Order</span>');
  } else if (S.editor.assignmentMode === 'legacy-repeat') {
    badges.push('<span class="badge b-soft">Existing Artwork No</span>');
  }
  badges.push(S.editor.artworkNo ? statusBadge(S.editor.status) : '<span class="badge b-neutral">Unsaved</span>');
  document.getElementById('editor_status_badges').innerHTML = badges.join('');
}

function renderEditorSummary(){
  const selected = S.editor.selectedJobIds.map(function(id){
    return S.allJobs.find(function(j){ return j.id === id; }) ||
      S.jobs.find(function(j){ return j.id === id; });
  }).filter(Boolean);

  const soList = [];
  const clientList = [];
  selected.forEach(function(job){
    if (job.so && soList.indexOf(job.so) === -1) soList.push(job.so);
    if (job.client && clientList.indexOf(job.client) === -1) clientList.push(job.client);
  });
  const fgTotal = selected.reduce(function(sum, job){
    return sum + Number(job.fgStockQty || 0);
  }, 0);
  const billFromStockTotal = selected.reduce(function(sum, job){
    return sum + Number(S.editor.stockQtyToBill[job.id] || job.stockQtyToBill || 0);
  }, 0);

  document.getElementById('editor_jobs_summary').textContent = selected.length
    ? selected.length + ' job(s) selected'
    : 'No jobs selected';
  document.getElementById('editor_so_summary').textContent = soList.length
    ? soList.join(', ')
    : '-';
  document.getElementById('editor_client_summary').textContent = clientList.length
    ? clientList.join(', ')
    : '-';
  document.getElementById('editor_fg_stock_summary').textContent = selected.length
    ? 'FG ' + String(fgTotal) + ' Pcs | Bill ' + String(billFromStockTotal) + ' Pcs'
    : '-';

  const info = document.getElementById('jobs_selection_info');
  if (info) {
    const selectedCount = S.editor.selectedJobIds.length;
    info.innerHTML = selectedCount
      ? ('<strong>' + selectedCount + ' job(s)</strong> selected for the current artwork.' + ((S.editor.assignmentMode === 'repeat' || S.editor.assignmentMode === 'legacy-repeat')
          ? ' They will be linked to artwork <strong>' + escapeHtml(S.editor.artworkNo || '-') + '</strong>.'
          : ''))
      : 'Select jobs from the pool.';
  }
}

function renderAll(options){
  const opts = options || {};
  if (opts.preserve !== false) {
    preserveEditorState();
  }
  syncDivisionFilterOptions();
  buildSummary();
  setEditorForm();
  setView(S.view);
  renderEditorBadges();
  renderEditorSummary();
  renderGroups();
  renderJobs();
  renderSelectedJobs();
}

function workbenchFilters(){
  const pendingOnly = document.getElementById('pending_only').checked;
  return {
    from: pendingOnly ? '' : document.getElementById('date_from').value,
    to: pendingOnly ? '' : document.getElementById('date_to').value,
    pendingOnly: pendingOnly
  };
}

function workbenchCacheSignature(filters){
  return JSON.stringify(filters || {});
}

function readWorkbenchCache(filters){
  try {
    const raw = sessionStorage.getItem(ARTWORK_WORKBENCH_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached || !cached.ts || !cached.sig || !cached.data) return null;
    if ((Date.now() - Number(cached.ts || 0)) > ARTWORK_WORKBENCH_CACHE_TTL_MS) return null;
    if (cached.sig !== workbenchCacheSignature(filters)) return null;
    return cached.data;
  } catch (e) {
    return null;
  }
}

function writeWorkbenchCache(filters, data){
  try {
    sessionStorage.setItem(ARTWORK_WORKBENCH_CACHE_KEY, JSON.stringify({
      ts: Date.now(),
      sig: workbenchCacheSignature(filters),
      data: data
    }));
  } catch (e) {}
}

function clearWorkbenchCache(){
  try { sessionStorage.removeItem(ARTWORK_WORKBENCH_CACHE_KEY); } catch (e) {}
}

function applyWorkbenchData(data, focusArtworkNo){
  S.allJobs = data.allJobs || data.jobs || [];
  S.jobs = data.jobs || [];
  S.groups = data.groups || [];

  if (focusArtworkNo){
    const exists = S.groups.find(function(g){ return g.artworkNo === focusArtworkNo; });
    if (exists){
      editGroup(focusArtworkNo);
      return;
    }
  }

  if (S.editor.artworkNo){
    const current = S.groups.find(function(g){ return g.artworkNo === S.editor.artworkNo; });
    if (current){
      editGroup(current.artworkNo);
      return;
    }
  }

  if (!focusArtworkNo && !S.editor.artworkNo){
    const firstOpen = S.groups.find(function(g){
      return String(g.status || '').toUpperCase() !== 'APPROVED';
    });
    if (firstOpen){
      editGroup(firstOpen.artworkNo);
      return;
    }
  }

  renderAll();
}

function newArtwork(options){
  const opts = options || {};
  const selectedJobIds = opts.preserveSelection && S.editor.selectedJobIds ? S.editor.selectedJobIds.slice() : [];
  const jobUps = opts.preserveSelection ? Object.assign({}, S.editor.jobUps || {}) : {};
  const stockQtyToBill = opts.preserveSelection ? Object.assign({}, S.editor.stockQtyToBill || {}) : {};
  let defaultProductType = '';
  if (selectedJobIds.length) {
    const selectedJobs = selectedJobIds.map(function(id){
      return S.allJobs.find(function(j){ return j.id === id; }) ||
        S.jobs.find(function(j){ return j.id === id; });
    }).filter(Boolean);
    const types = [...new Set(selectedJobs.map(function(job){
      return normalizeArtworkProductType(job.productType || job.division || job.category || '');
    }).filter(Boolean))];
    if (types.length === 1) defaultProductType = types[0];
  }
  S.poolSelectedJobIds = [];
  S.editor = {
    artworkNo: '',
    repeatArtworkNo: '',
    assignmentMode: 'new',
    productType: defaultProductType,
    plateStatus: '',
    dieStatus: '',
    plateSize: '',
    plateCount: '',
    hasHybridPlate: false,
    hybridPlateSize: '770X1030',
    hybridPlateCount: '',
    dieCount: '',
    sheetLength: '',
    sheetWidth: '',
    printingColors: '',
    acrossUps: '',
    alongUps: '',
    totalUps: '',
    acrossWidth: '',
    teeth: '',
    acrossGapMm: '',
    alongGapMm: '',
    selectedJobIds: selectedJobIds,
    jobUps: jobUps,
    stockQtyToBill: stockQtyToBill,
    status: 'NEW'
  };
  renderAll({ preserve:false });
}

function editGroup(artworkNo){
  const group = S.groups.find(function(g){ return g.artworkNo === artworkNo; });
  if (!group) return;
  const firstJob = (group.jobs || [])[0] || {};

  S.editor = {
    artworkNo: group.artworkNo,
    repeatArtworkNo: '',
    assignmentMode: 'edit',
    productType: group.productType || normalizeArtworkProductType(firstJob.productType || firstJob.division || firstJob.category || ''),
    plateStatus: group.plateStatus || '',
    dieStatus: group.dieStatus || '',
    plateSize: group.plateSize || '',
    plateCount: group.plateCount || '',
    hasHybridPlate: group.hasHybridPlate === true,
    hybridPlateSize: group.hybridPlateSize || '770X1030',
    hybridPlateCount: group.hybridPlateCount || '',
    dieCount: group.dieCount || '',
    sheetLength: group.sheetLength || '',
    sheetWidth: group.sheetWidth || '',
    printingColors: group.printingColors || '',
    acrossUps: group.acrossUps || '',
    alongUps: group.alongUps || '',
    totalUps: group.totalUps || '',
    acrossWidth: group.acrossWidth || '',
    teeth: group.teeth || '',
    acrossGapMm: group.acrossGapMm || '',
    alongGapMm: group.alongGapMm || '',
    selectedJobIds: (group.jobs || []).map(function(j){ return j.id; }),
    jobUps: {},
    stockQtyToBill: {},
    status: group.status || 'PENDING_APPROVAL'
  };

  (group.jobs || []).forEach(function(job){
    S.editor.jobUps[job.id] = job.sheetUps || '';
    S.editor.stockQtyToBill[job.id] = job.stockQtyToBill || '';
  });
  S.view = 'groups';
  renderAll({ preserve:false });
}

function applyRepeatArtworkNo(){
  preserveEditorState();
  const no = String(document.getElementById('editor_reuse_artwork_no').value || '').trim();
  if (!no) {
    showToast('Enter an existing artwork no first.', 'warn');
    return;
  }
  const group = S.groups.find(function(g){
    return String(g.artworkNo || '').trim().toUpperCase() === no.toUpperCase();
  });
  const applyReference = function(groupRef){
    S.editor.artworkNo = groupRef.artworkNo;
    S.editor.repeatArtworkNo = groupRef.artworkNo;
    S.editor.assignmentMode = groupRef.legacyOnly ? 'legacy-repeat' : 'repeat';
    S.editor.productType = normalizeArtworkProductType(groupRef.productType || S.editor.productType || '');
    S.editor.plateStatus = groupRef.plateStatus || '';
    S.editor.dieStatus = groupRef.dieStatus || '';
    S.editor.plateSize = groupRef.plateSize || '';
    S.editor.plateCount = groupRef.plateCount || '';
    S.editor.hasHybridPlate = groupRef.hasHybridPlate === true;
    S.editor.hybridPlateSize = groupRef.hybridPlateSize || '770X1030';
    S.editor.hybridPlateCount = groupRef.hybridPlateCount || '';
    S.editor.dieCount = groupRef.dieCount || '';
    S.editor.sheetLength = groupRef.sheetLength || '';
    S.editor.sheetWidth = groupRef.sheetWidth || '';
    S.editor.printingColors = groupRef.printingColors || '';
    S.editor.acrossUps = groupRef.acrossUps || '';
    S.editor.alongUps = groupRef.alongUps || '';
    S.editor.totalUps = groupRef.totalUps || '';
    S.editor.acrossWidth = groupRef.acrossWidth || '';
    S.editor.teeth = groupRef.teeth || '';
    S.editor.acrossGapMm = groupRef.acrossGapMm || '';
    S.editor.alongGapMm = groupRef.alongGapMm || '';
    S.editor.status = groupRef.status || 'PENDING_APPROVAL';
    renderAll({ preserve:false });
    showToast((groupRef.legacyOnly ? 'Existing artwork no applied: ' : 'Repeat artwork applied: ') + groupRef.artworkNo, 'ok');
  };

  if (group) {
    applyReference(group);
    return;
  }

  setLoading(true, 'Loading existing artwork reference...');
  google.script.run
    .withSuccessHandler(function(ref){
      setLoading(false);
      applyReference(ref);
    })
    .withFailureHandler(function(err){
      setLoading(false);
      const msg = String(err && err.message ? err.message : err || '');
      if (/Artwork no not found/i.test(msg)) {
        S.editor.artworkNo = no;
        S.editor.repeatArtworkNo = no;
        S.editor.assignmentMode = 'legacy-repeat';
        S.editor.status = 'PENDING_APPROVAL';
        renderAll({ preserve:false });
        showToast('Existing artwork no applied manually: ' + no, 'warn');
        return;
      }
      alert(msg || 'Artwork no not found');
    })
    .getArtworkReference(no);
}

function clearRepeatArtworkNo(){
  preserveEditorState();
  newArtwork({ preserveSelection:true });
  showToast('Artwork will use a new artwork no on save.', 'ok');
}

function setJobUps(id, value){
  if (isEditorReadOnly()) return;
  S.editor.jobUps[id] = value;
}

function setStockQtyToBill(id, value){
  if (isEditorReadOnly()) return;
  S.editor.stockQtyToBill[id] = value;
  renderEditorSummary();
  renderSelectedJobs();
}

function collectPayload(){
  editorValues();
  const normalizedType = String(S.editor.productType || '').trim().toUpperCase();
  const isFlexo = normalizedType === 'FLEXO';
  const isDigital = normalizedType === 'DIGITAL';
  return {
    artworkNo: S.editor.artworkNo || '',
    preserveExistingJobs: S.editor.assignmentMode === 'repeat',
    productType: S.editor.productType,
    plateStatus: isDigital ? '' : S.editor.plateStatus,
    dieStatus: isDigital ? '' : S.editor.dieStatus,
    plateSize: isDigital ? '' : S.editor.plateSize,
    plateCount: isDigital ? '' : S.editor.plateCount,
    hasHybridPlate: isDigital ? false : (S.editor.hasHybridPlate === true),
    hybridPlateSize: isDigital ? '' : S.editor.hybridPlateSize,
    hybridPlateCount: isDigital ? '' : S.editor.hybridPlateCount,
    dieCount: isDigital ? '' : S.editor.dieCount,
    sheetLength: S.editor.sheetLength,
    sheetWidth: S.editor.sheetWidth,
    printingColors: isDigital ? '' : S.editor.printingColors,
    acrossUps: S.editor.acrossUps,
    alongUps: S.editor.alongUps,
    totalUps: S.editor.totalUps,
    acrossWidth: S.editor.acrossWidth,
    teeth: S.editor.teeth,
    acrossGapMm: S.editor.acrossGapMm,
    alongGapMm: S.editor.alongGapMm,
    jobs: S.editor.selectedJobIds.map(function(id){
      return {
        id: id,
        sheetUps: isFlexo ? S.editor.totalUps : S.editor.jobUps[id],
        stockQtyToBill: S.editor.stockQtyToBill[id] || 0
      };
    })
  };
}

function validatePayload(payload){
  if (!payload.jobs.length) throw new Error('Select at least one job.');
  const normalizedType = String(payload.productType || '').trim().toUpperCase();
  const isDigital = normalizedType === 'DIGITAL';
  ['productType'].forEach(function(key){
    if (payload[key] === '' || payload[key] === null || typeof payload[key] === 'undefined') {
      throw new Error(key + ' is mandatory.');
    }
  });
  if (!isDigital) {
    ['plateStatus','dieStatus','printingColors'].forEach(function(key){
      if (payload[key] === '' || payload[key] === null || typeof payload[key] === 'undefined') {
        throw new Error(key + ' is mandatory.');
      }
    });
  }
  const isFlexo = normalizedType === 'FLEXO';
  if (isFlexo) {
    ['acrossUps','alongUps','totalUps','acrossWidth','teeth','acrossGapMm','alongGapMm'].forEach(function(key){
      if (payload[key] === '' || payload[key] === null || typeof payload[key] === 'undefined') {
        throw new Error(key + ' is mandatory for Flexo.');
      }
    });
  } else {
    ['sheetLength','sheetWidth'].forEach(function(key){
      if (payload[key] === '' || payload[key] === null || typeof payload[key] === 'undefined') {
        throw new Error(key + ' is mandatory.');
      }
    });
  }
  if (!isDigital && String(payload.plateStatus || '').toUpperCase() === 'NEW') {
    if (!(Number(payload.plateCount || 0) > 0)) throw new Error('plateCount is mandatory when plate status is New.');
    if (!isFlexo && !String(payload.plateSize || '').trim()) throw new Error('plateSize is mandatory when plate status is New.');
    if (!isFlexo && payload.hasHybridPlate) {
      if (!String(payload.hybridPlateSize || '').trim()) throw new Error('hybridPlateSize is mandatory when hybrid plate is selected.');
      if (!(Number(payload.hybridPlateCount || 0) > 0)) throw new Error('hybridPlateCount is mandatory when hybrid plate is selected.');
    }
  }
  if (!isDigital && String(payload.dieStatus || '').toUpperCase() === 'NEW' && !(Number(payload.dieCount || 0) > 0)) {
    throw new Error('dieCount is mandatory when die status is New.');
  }
  payload.jobs.forEach(function(job){
    if (!(Number(job.sheetUps || 0) > 0)) throw new Error('UPS is mandatory for each selected job.');
    const sourceJob = S.allJobs.find(function(row){ return row.id === job.id; }) ||
      S.jobs.find(function(row){ return row.id === job.id; }) || {};
    const stockQtyToBill = Number(job.stockQtyToBill || 0);
    if (stockQtyToBill < 0) throw new Error('Bill from stock qty cannot be negative.');
    if (stockQtyToBill > Number(sourceJob.qty || 0)) throw new Error('Bill from stock qty cannot exceed order qty.');
    if (stockQtyToBill > Number(sourceJob.fgStockQty || 0)) throw new Error('Bill from stock qty cannot exceed available FG stock.');
  });
  const stockByProduct = {};
  payload.jobs.forEach(function(job){
    const sourceJob = S.allJobs.find(function(row){ return row.id === job.id; }) ||
      S.jobs.find(function(row){ return row.id === job.id; }) || {};
    const code = String(sourceJob.productCode || sourceJob.productName || job.id || '').trim();
    if (!stockByProduct[code]) stockByProduct[code] = { requested: 0, available: Number(sourceJob.fgStockQty || 0) };
    stockByProduct[code].requested += Number(job.stockQtyToBill || 0);
    stockByProduct[code].available = Math.max(stockByProduct[code].available, Number(sourceJob.fgStockQty || 0));
  });
  Object.keys(stockByProduct).forEach(function(code){
    const row = stockByProduct[code];
    if (row.requested > row.available) throw new Error('Total bill from stock qty exceeds available FG stock for one item.');
  });
}

function saveArtwork(afterSave){
  if (S.busyAction) return;
  try{
    const payload = collectPayload();
    validatePayload(payload);
    setBusyAction('save');

    google.script.run
      .withSuccessHandler(function(res){
        setBusyAction('');
        S.editor.artworkNo = res.artworkNo;
        showToast('Artwork saved: ' + res.artworkNo, 'ok');
        if (afterSave === 'approve'){
          approveArtwork();
          return;
        }
        clearWorkbenchCache();
        loadWorkbench(res.artworkNo, { force:true });
      })
      .withFailureHandler(function(err){
        setBusyAction('');
        alert(err && err.message ? err.message : 'Save failed');
      })
      .saveArtworkGroup(payload);
  } catch (e){
    setBusyAction('');
    alert(e.message || e);
  }
}

function approveArtwork(){
  if (S.busyAction) return;
  try{
    const payload = collectPayload();
    validatePayload(payload);

    if (!S.editor.artworkNo){
      saveArtwork('approve');
      return;
    }
    setBusyAction('approve');

    google.script.run
      .withSuccessHandler(function(){
        setBusyAction('');
        showToast('Artwork approved: ' + S.editor.artworkNo, 'ok');
        clearWorkbenchCache();
        applyLocalArtworkState(S.editor.artworkNo, 'APPROVED', new Date().toISOString());
      })
      .withFailureHandler(function(err){
        setBusyAction('');
        alert(err && err.message ? err.message : 'Approve failed');
      })
      .approveArtworkGroup(S.editor.artworkNo);
  } catch (e){
    setBusyAction('');
    alert(e.message || e);
  }
}

function unapproveArtwork(){
  if (S.busyAction) return;
  if (!S.editor.artworkNo){
    alert('Open an artwork first.');
    return;
  }
  setBusyAction('unapprove');

  google.script.run
    .withSuccessHandler(function(){
      setBusyAction('');
      showToast('Artwork moved back to pending approval.', 'warn');
      clearWorkbenchCache();
      applyLocalArtworkState(S.editor.artworkNo, 'PENDING_APPROVAL', null);
    })
    .withFailureHandler(function(err){
      setBusyAction('');
      alert(err && err.message ? err.message : 'Un-approve failed');
    })
    .unapproveArtworkGroup(S.editor.artworkNo);
}

function loadWorkbench(focusArtworkNo, options){
  const opts = options || {};
  preserveEditorState();
  const filters = workbenchFilters();
  const from = filters.from;
  const to = filters.to;
  const pendingOnly = filters.pendingOnly;

  if (!pendingOnly && (!from || !to)){
    alert('Select date range.');
    return;
  }

  const cached = opts.force ? null : readWorkbenchCache(filters);
  if (cached) {
    applyWorkbenchData(cached, focusArtworkNo);
  }

  setLoading(true, 'Please wait while the queue and artwork details are prepared.');
  google.script.run
    .withSuccessHandler(function(res){
      setLoading(false);
      const data = typeof res === 'string' ? JSON.parse(res) : (res || { jobs:[], groups:[] });
      writeWorkbenchCache(filters, data);
      applyWorkbenchData(data, focusArtworkNo);
    })
    .withFailureHandler(function(err){
      setLoading(false);
      alert(err && err.message ? err.message : 'Load failed');
    })
    .getArtworkWorkbenchJson(from, to, pendingOnly);
}

function clearFilters(){
  preserveEditorState();
  document.getElementById('search_box').value = '';
  document.getElementById('job_filter').value = 'ALL';
  document.getElementById('division_filter').value = 'ALL';
  document.getElementById('group_filter').value = 'ALL';
  renderAll();
}

function goMenu(){
  const token = getToken();
  if (!token){
    redirectToLogin();
    return;
  }
  const base = WEB_APP_URL || window.location.href.split('?')[0];
  const u = new URL(base);
  u.searchParams.set('p', 'menu');
  u.searchParams.set('token', token);
  window.location.replace(u.toString());
}

function bootstrap(){
  const token = getToken();
  if (!token){
    redirectToLogin();
    return;
  }

  const today = new Date();
  const last7 = new Date();
  last7.setDate(today.getDate() - 7);
  document.getElementById('date_from').value = last7.toISOString().slice(0,10);
  document.getElementById('date_to').value = today.toISOString().slice(0,10);

  const bootUser = window.__ERP_TEMPLATE_USER__ || null;
  if (bootUser) {
    setLoading(true, 'Opening artwork module...');
    loadWorkbench();
    return;
  }

  google.script.run
    .withSuccessHandler(function(user){
      if (!user){
        redirectToLogin();
        return;
      }
      setLoading(true, 'Opening artwork module...');
      loadWorkbench();
    })
    .withFailureHandler(function(){
      redirectToLogin();
    })
    .getSessionUser(token);
}

function debounce(fn, wait){
  let t;
  return function(){
    clearTimeout(t);
    t = setTimeout(fn, wait || 250);
  };
}

document.addEventListener('DOMContentLoaded', function(){
  bootstrap();
  const refresh = debounce(renderAll, 200);
  ['search_box'].forEach(function(id){
    document.getElementById(id).addEventListener('input', refresh);
  });
  ['job_filter','division_filter','group_filter'].forEach(function(id){
    document.getElementById(id).addEventListener('change', renderAll);
  });
  ['pending_only'].forEach(function(id){
    document.getElementById(id).addEventListener('change', loadWorkbench);
  });
  [
    'editor_product_type',
    'editor_plate_status',
    'editor_die_status',
    'editor_plate_size',
    'editor_plate_count',
    'editor_has_hybrid_plate',
    'editor_hybrid_plate_size',
    'editor_hybrid_plate_count',
    'editor_die_count',
    'editor_sheet_length',
    'editor_sheet_width',
    'editor_printing_colors',
    'editor_across_ups',
    'editor_along_ups',
    'editor_across_width',
    'editor_teeth',
    'editor_across_gap_mm',
    'editor_along_gap_mm'
  ].forEach(function(id){
    document.getElementById(id).addEventListener('input', onEditorFieldChange);
    document.getElementById(id).addEventListener('change', onEditorFieldChange);
  });
});
</script>
</body>
</html>
